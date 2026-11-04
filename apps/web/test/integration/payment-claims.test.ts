import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookSpace, cancelSpaceBooking, listMyBookings } from '@/lib/bookings/bookings';
import { loadDeskDay } from '@/lib/manage/desk-day';
import { livePayments } from '@/lib/payments/payments';
import { claimsToCheck, claimsToCheckCount, decideClaim, holdsWaiting, payBooking, submitClaim } from '@/lib/payments/claims';
import { paymentNumbers, setPaymentNumbers } from '@/lib/payments/numbers';
import { ownerEmails, teamForSection } from '@/lib/payments/team-emails';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// Paying for online bookings by bKash or Nagad, through the app's library: a player's request is pending with the
// venue's numbers on its pay page; the details show up for the team of that section only; deciding, cancelling and
// the numbers. A fresh brand (Dhaka time, 10:00–23:00) with a turf section (Pitch 1, ৳2,500/h) and a café section;
// owner, turf staff, café staff, players A and B. Times count from today.
const db = serviceDb();
const hours = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, ['10:00', '23:00']]));
const dhakaDate = (daysAhead: number) => new Date(Date.now() + 6 * 3_600_000 + daysAhead * 86_400_000).toISOString().slice(0, 10);
const at = (daysAhead: number, hour: number) => new Date(`${dhakaDate(daysAhead)}T${String(hour).padStart(2, '0')}:00:00+06:00`);

let orgId: string;
let turf: string;
let cafe: string;
let pitch: string;
const people: Record<'owner' | 'turfStaff' | 'cafeStaff' | 'a' | 'b', TestUser> = {} as never;
let profileA: string;
let profileB: string;
let requested: string; // A's request, tomorrow 20:00

beforeAll(async () => {
  for (const who of ['owner', 'turfStaff', 'cafeStaff', 'a', 'b'] as const) people[who] = await createTestUser(db);
  const org = await db
    .from('organizations')
    .insert({ slug: `pay-${randomUUID().slice(0, 8)}`, name: 'Pay Turf', business_type: 'turf', status: 'live', bkash_number: '01712345678' })
    .select('id')
    .single();
  if (org.error) throw org.error;
  orgId = org.data.id;
  const sections = await db
    .from('sections')
    .insert([
      { organization_id: orgId, name: 'Turf', kind: 'turf', slug: 'turf', max_upcoming_bookings: 10, opening_hours: hours },
      { organization_id: orgId, name: 'Café', kind: 'boardgame_cafe', slug: 'cafe', max_upcoming_bookings: 10, opening_hours: hours },
    ])
    .select('id, slug');
  if (sections.error) throw sections.error;
  turf = sections.data.find((s) => s.slug === 'turf')!.id;
  cafe = sections.data.find((s) => s.slug === 'cafe')!.id;
  await db.from('organization_members').insert([
    { organization_id: orgId, user_id: people.owner.id, role: 'owner' },
    { organization_id: orgId, user_id: people.turfStaff.id, role: 'staff' },
    { organization_id: orgId, user_id: people.cafeStaff.id, role: 'staff' },
  ]);
  await db.from('section_staff').insert([
    { organization_id: orgId, section_id: turf, user_id: people.turfStaff.id },
    { organization_id: orgId, section_id: cafe, user_id: people.cafeStaff.id },
  ]);
  const res = await db
    .from('resources')
    .insert({ organization_id: orgId, section_id: turf, name: 'Pitch 1', kind: 'pitch', capacity: 14, price_per_hour_poisha: 250000 })
    .select('id')
    .single();
  if (res.error) throw res.error;
  pitch = res.data.id;
  const profiles = await db
    .from('player_profiles')
    .insert([
      { organization_id: orgId, user_id: people.a.id, display_name: 'Sami', phone: '+8801711111111' },
      { organization_id: orgId, user_id: people.b.id, display_name: 'Tanvir' },
    ])
    .select('id, user_id');
  if (profiles.error) throw profiles.error;
  profileA = profiles.data.find((p) => p.user_id === people.a.id)!.id;
  profileB = profiles.data.find((p) => p.user_id === people.b.id)!.id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  for (const who of Object.values(people)) await deleteTestUser(db, who.id);
});

const request = (profileId: string, user: TestUser, startsAt: Date) =>
  bookSpace(db, { organizationId: orgId, resourceId: pitch, startsAt, slots: 1, who: { profileId }, createdBy: user.id, actor: 'player' });

describe('a player requests a priced space', () => {
  it('is pending, held, and its pay page shows the price and the venue’s numbers', async () => {
    const result = await request(profileA, people.a, at(1, 20));
    expect(result).toEqual({ status: 'pending', bookingId: expect.any(String) });
    if (result.status !== 'pending') return;
    requested = result.bookingId;
    const view = await payBooking(db, { bookingId: requested, profileId: profileA });
    expect(view).toMatchObject({ status: 'hold', amountPoisha: 250000, resourceName: 'Pitch 1', sectionName: 'Turf', numbers: { bkash: '01712345678', nagad: null } });
    expect(view!.holdUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await payBooking(db, { bookingId: requested, profileId: profileB })).toBeNull(); // not B's
  });

  it('a second click on the same slot is "already yours"', async () => {
    expect(await request(profileA, people.a, at(1, 20))).toEqual({ status: 'already_yours' });
  });

  it('with no number set, a priced space can’t be requested', async () => {
    await db.from('organizations').update({ bkash_number: null }).eq('id', orgId);
    expect(await request(profileB, people.b, at(2, 20))).toEqual({ status: 'payment_closed' });
    await db.from('organizations').update({ bkash_number: '01712345678' }).eq('id', orgId);
  });
});

describe('sending the details', () => {
  it('the team of that section sees them to check; the booking waits', async () => {
    expect(await submitClaim(db, { bookingId: requested, userId: people.a.id, method: 'bkash', senderPhone: '01911111111', trxId: '9jk7 abc123' })).toBe('submitted');
    expect((await payBooking(db, { bookingId: requested, profileId: profileA }))!.status).toBe('sent');
    const mine = (await listMyBookings(db, { organizationId: orgId, profileId: profileA })).upcoming.find((b) => b.id === requested)!;
    expect(mine).toMatchObject({ status: 'pending', payment: 'sent', cancellable: false });

    const toCheck = await claimsToCheck(db, { organizationId: orgId, sectionIds: [turf] });
    expect(toCheck).toEqual([
      expect.objectContaining({
        bookingId: requested,
        playerName: 'Sami',
        playerPhone: '+8801711111111',
        resourceName: 'Pitch 1',
        sectionName: 'Turf',
        amountPoisha: 250000,
        method: 'bkash',
        senderPhone: '01911111111',
        trxId: '9JK7ABC123',
        started: false,
      }),
    ]);
    expect(await claimsToCheck(db, { organizationId: orgId, sectionIds: [cafe] })).toEqual([]);
    expect(await claimsToCheckCount(db, { organizationId: orgId, sectionIds: [turf, cafe] })).toBe(1);
    expect(await claimsToCheckCount(db, { organizationId: orgId, sectionIds: [cafe] })).toBe(0);

    const desk = await loadDeskDay(db, { organizationId: orgId, sectionIds: [turf], date: dhakaDate(1), now: new Date(), timeZone: 'Asia/Dhaka' });
    const atDesk = desk.sections[0]!.spaces[0]!.bookings.find((b) => b.id === requested)!;
    expect(atDesk).toMatchObject({ status: 'pending', claim: { method: 'bkash', senderPhone: '01911111111', trxId: '9JK7ABC123' } });
    expect(desk.counts.bookings).toBe(0); // not booked until the team confirms
  });

  it('a hold still waiting for the player is listed apart, and the player can cancel it; not once details are sent', async () => {
    const hold = await request(profileB, people.b, at(3, 20));
    if (hold.status !== 'pending') throw new Error(hold.status);
    expect(await holdsWaiting(db, { organizationId: orgId, sectionIds: [turf] })).toEqual([
      expect.objectContaining({ bookingId: hold.bookingId, playerName: 'Tanvir', resourceName: 'Pitch 1' }),
    ]);
    const mine = (await listMyBookings(db, { organizationId: orgId, profileId: profileB })).upcoming.find((b) => b.id === hold.bookingId)!;
    expect(mine).toMatchObject({ payment: 'hold', cancellable: true });
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: hold.bookingId, actor: { kind: 'player', profileId: profileB }, cancelledBy: people.b.id })).toBe('cancelled');
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: requested, actor: { kind: 'player', profileId: profileA }, cancelledBy: people.a.id })).toBe('paid');
  });
});

describe('the team decides', () => {
  it('café staff can’t decide a turf payment (Review Focus 3)', async () => {
    expect(await decideClaim(db, { bookingId: requested, userId: people.cafeStaff.id, decision: 'confirm', reason: null })).toBe('not_allowed');
  });

  it('turf staff confirm: booked and paid', async () => {
    expect(await decideClaim(db, { bookingId: requested, userId: people.turfStaff.id, decision: 'confirm', reason: null })).toBe('confirmed');
    const mine = (await listMyBookings(db, { organizationId: orgId, profileId: profileA })).upcoming.find((b) => b.id === requested)!;
    expect(mine).toMatchObject({ status: 'confirmed', paid: true, payment: null });
    // The desk and the Bookings list see how it was paid (final review: not "in cash").
    expect((await livePayments(db, { spaceBookingIds: [requested], seatBookingIds: [] })).get(requested)).toMatchObject({ amountPoisha: 250000, method: 'bkash' });
    expect(await claimsToCheckCount(db, { organizationId: orgId, sectionIds: [turf] })).toBe(0);
  });

  it('a rejected one says why on My bookings', async () => {
    const other = await request(profileB, people.b, at(4, 20));
    if (other.status !== 'pending') throw new Error(other.status);
    await submitClaim(db, { bookingId: other.bookingId, userId: people.b.id, method: 'bkash', senderPhone: '01922222222', trxId: 'NOTREAL99' });
    expect(await decideClaim(db, { bookingId: other.bookingId, userId: people.owner.id, decision: 'reject', reason: 'Payment not found' })).toBe('rejected');
    const mine = (await listMyBookings(db, { organizationId: orgId, profileId: profileB })).past.find((b) => b.id === other.bookingId)!;
    expect(mine).toMatchObject({ status: 'cancelled', payment: 'rejected', rejectReason: 'Payment not found' });
  });
});

describe('a request that ended', () => {
  const statusOf = async (bookingId: string, profileId: string) => (await payBooking(db, { bookingId, profileId }))!.status;

  it('the venue’s cancel says so on the pay page; a hold that ran out, or one the player dropped, says the hold ended', async () => {
    const byVenue = await request(profileB, people.b, at(5, 20));
    const ranOut = await request(profileB, people.b, at(6, 20));
    const dropped = await request(profileB, people.b, at(7, 20));
    if (byVenue.status !== 'pending' || ranOut.status !== 'pending' || dropped.status !== 'pending') throw new Error('not pending');
    expect((await db.rpc('cancel_resource_booking', { p_booking_id: byVenue.bookingId, p_cancelled_by: people.owner.id })).data).toBe('cancelled');
    await db.from('resource_bookings').update({ hold_until: new Date(Date.now() - 60_000).toISOString() }).eq('id', ranOut.bookingId);
    expect((await db.rpc('expire_payment_holds')).error).toBeNull();
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: dropped.bookingId, actor: { kind: 'player', profileId: profileB }, cancelledBy: people.b.id })).toBe(
      'cancelled',
    );
    expect([await statusOf(byVenue.bookingId, profileB), await statusOf(ranOut.bookingId, profileB), await statusOf(dropped.bookingId, profileB)]).toEqual([
      'cancelled',
      'ended',
      'ended',
    ]);
  });

  it('a paid booking the venue cancelled later says the venue cancelled it', async () => {
    const paid = await request(profileA, people.a, at(8, 20));
    if (paid.status !== 'pending') throw new Error(paid.status);
    await submitClaim(db, { bookingId: paid.bookingId, userId: people.a.id, method: 'bkash', senderPhone: '01911111111', trxId: 'LATERCANCEL1' });
    expect(await decideClaim(db, { bookingId: paid.bookingId, userId: people.owner.id, decision: 'confirm', reason: null })).toBe('confirmed');
    expect((await db.rpc('cancel_resource_booking', { p_booking_id: paid.bookingId, p_cancelled_by: people.owner.id })).data).toBe('cancelled');
    expect(await statusOf(paid.bookingId, profileA)).toBe('cancelled');
  });
});

describe('who hears about a payment', () => {
  it('the owners and the staff of that section — not another section’s staff', async () => {
    expect((await teamForSection(db, { organizationId: orgId, sectionId: turf })).sort()).toEqual([people.owner.email, people.turfStaff.email].sort());
    expect(await ownerEmails(db, orgId)).toEqual([people.owner.email]);
  });
});

describe('the venue’s numbers', () => {
  it('only owners change them, and hear what they were', async () => {
    expect(await setPaymentNumbers(db, { organizationId: orgId, userId: people.turfStaff.id, bkash: '01799999999', nagad: null })).toMatchObject({ status: 'not_allowed' });
    expect(await setPaymentNumbers(db, { organizationId: orgId, userId: people.owner.id, bkash: '01712345678', nagad: '01812345678' })).toEqual({
      status: 'saved',
      old: { bkash: '01712345678', nagad: null },
    });
    expect(await paymentNumbers(db, orgId)).toEqual({ bkash: '01712345678', nagad: '01812345678' });
  });
});
