import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookSpace, branchDay, cancelSpaceBooking, listMyBookings, setSpaceBookingStatus, spaceDay } from '@/lib/bookings/bookings';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// A fresh venue (Dhaka time, defaults: 14-day window, 2-hour cancel cut-off; limit raised to 10 so it
// doesn't interfere). Main branch 10:00–23:00 with Pitch 1 and Pitch 2; Late branch 14:00–02:00 with
// Zone L. "Now" for the TypeScript checks is Tue 20 Oct 2026, 12:00 in Dhaka.
const db = serviceDb();
const now = new Date('2026-10-20T06:00:00Z');
const FRI_8PM = new Date('2026-10-23T14:00:00Z');
const FRI_9PM = new Date('2026-10-23T15:00:00Z');
const hours = (open: string, close: string) => Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, [open, close]]));

let orgId: string;
let otherOrgPitch: string;
let mainBranch: string;
let pitch1: string;
let pitch2: string;
let zoneL: string;
const users: TestUser[] = [];
let staffUser: TestUser;
let a: string; // profiles
let b: string;
let aBooking: string;

beforeAll(async () => {
  const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
    if (r.error || r.data === null) throw r.error ?? new Error('no data');
    return r.data as NonNullable<T>;
  };
  const [ua, ub, us] = await Promise.all([createTestUser(db), createTestUser(db), createTestUser(db)]);
  users.push(ua, ub, us);
  staffUser = us;
  const org = must(
    await db
      .from('organizations')
      .insert({ slug: `bk-${randomUUID().slice(0, 8)}`, name: 'Booking Turf', business_type: 'turf', status: 'live', max_upcoming_bookings: 10 })
      .select('id')
      .single(),
  );
  orgId = org.id;
  must(await db.from('organization_members').insert({ organization_id: orgId, user_id: us.id, role: 'staff' }));
  const branches = must(
    await db
      .from('branches')
      .insert([
        { organization_id: orgId, name: 'Main', opening_hours: hours('10:00', '23:00') },
        { organization_id: orgId, name: 'Late', opening_hours: hours('14:00', '02:00') },
      ])
      .select('id, name'),
  );
  mainBranch = branches.find((x) => x.name === 'Main')!.id;
  const lateBranch = branches.find((x) => x.name === 'Late')!.id;
  const resources = must(
    await db
      .from('resources')
      .insert([
        { organization_id: orgId, branch_id: mainBranch, name: 'Pitch 1', kind: 'pitch', capacity: 14, price_per_hour_poisha: 250000 },
        { organization_id: orgId, branch_id: mainBranch, name: 'Pitch 2', kind: 'pitch', capacity: 14, price_per_hour_poisha: 250000 },
        { organization_id: orgId, branch_id: lateBranch, name: 'Zone L', kind: 'zone', capacity: 10, price_per_hour_poisha: 150000 },
      ])
      .select('id, name'),
  );
  pitch1 = resources.find((r) => r.name === 'Pitch 1')!.id;
  pitch2 = resources.find((r) => r.name === 'Pitch 2')!.id;
  zoneL = resources.find((r) => r.name === 'Zone L')!.id;
  const profiles = must(
    await db
      .from('player_profiles')
      .insert([
        { organization_id: orgId, user_id: ua.id, display_name: 'Ayesha', skill: 3 },
        { organization_id: orgId, user_id: ub.id, display_name: 'Bilal', skill: 3 },
      ])
      .select('id, user_id'),
  );
  a = profiles.find((p) => p.user_id === ua.id)!.id;
  b = profiles.find((p) => p.user_id === ub.id)!.id;

  const other = must(await db.from('organizations').insert({ slug: `bkx-${randomUUID().slice(0, 8)}`, name: 'Other', business_type: 'turf', status: 'live' }).select('id').single());
  const otherBranch = must(await db.from('branches').insert({ organization_id: other.id, name: 'X' }).select('id').single());
  otherOrgPitch = must(
    await db.from('resources').insert({ organization_id: other.id, branch_id: otherBranch.id, name: 'X1', kind: 'pitch', capacity: 14 }).select('id').single(),
  ).id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  const { data: x } = await db.from('resources').select('organization_id').eq('id', otherOrgPitch).single();
  if (x) await db.from('organizations').delete().eq('id', x.organization_id);
  for (const u of users) await deleteTestUser(db, u.id);
});

const asPlayer = (profileId: string, userId: string, startsAt: Date, resourceId = pitch1, slots = 1) =>
  bookSpace(db, { organizationId: orgId, resourceId, startsAt, slots, who: { profileId }, createdBy: userId, actor: 'player', now });
const asStaff = (startsAt: Date, resourceId = pitch1, slots = 1) =>
  bookSpace(db, {
    organizationId: orgId,
    resourceId,
    startsAt,
    slots,
    who: { guestName: 'Karim', guestPhone: '+8801712345678' },
    createdBy: staffUser.id,
    actor: 'staff',
    now,
  });

describe('bookSpace', () => {
  it('books a free slot', async () => {
    const result = await asPlayer(a, users[0]!.id, FRI_8PM);
    expect(result.status).toBe('booked');
    if (result.status === 'booked') aBooking = result.bookingId;
  });

  it('tells a second player the slot was taken', async () => {
    expect(await asPlayer(b, users[1]!.id, FRI_8PM)).toEqual({ status: 'taken' });
  });

  it('tells the same player they already have it (double click)', async () => {
    expect(await asPlayer(a, users[0]!.id, FRI_8PM)).toEqual({ status: 'already_yours' });
  });

  it('lets staff book a walk-in', async () => {
    expect((await asStaff(FRI_9PM)).status).toBe('booked');
  });

  it('refuses a start between grid lines', async () => {
    expect(await asPlayer(b, users[1]!.id, new Date('2026-10-23T14:30:00Z'))).toEqual({ status: 'invalid', reason: 'off_grid' });
  });

  it('keeps players inside the booking window but lets staff book further ahead', async () => {
    const far = new Date('2026-11-06T14:00:00Z'); // 17 days out
    expect(await asPlayer(b, users[1]!.id, far)).toEqual({ status: 'invalid', reason: 'beyond_horizon' });
    expect((await asStaff(far)).status).toBe('booked');
  });

  it("refuses another venue's space", async () => {
    expect(await asPlayer(b, users[1]!.id, FRI_8PM, otherOrgPitch)).toEqual({ status: 'invalid', reason: 'not_bookable' });
  });
});

describe('day views', () => {
  it('shows players what is taken without saying who', async () => {
    const day = await spaceDay(db, { organizationId: orgId, resourceId: pitch1, date: '2026-10-23', withNames: false, now });
    const eight = day!.slots.find((s) => s.start.getTime() === FRI_8PM.getTime())!;
    expect(eight.state).toBe('taken');
    expect(eight.booking).toBeUndefined();
    expect(day!.slots.every((s) => s.booking === undefined)).toBe(true);
  });

  it('shows staff the names, and the phone of a walk-in', async () => {
    const days = await branchDay(db, { organizationId: orgId, branchId: mainBranch, date: '2026-10-23', now });
    const pitch = days!.find((d) => d.resource.id === pitch1)!;
    expect(pitch.slots.find((s) => s.start.getTime() === FRI_8PM.getTime())!.booking).toMatchObject({ name: 'Ayesha', phone: null });
    expect(pitch.slots.find((s) => s.start.getTime() === FRI_9PM.getTime())!.booking).toMatchObject({ name: 'Karim', phone: '+8801712345678' });
  });

  it("returns nothing for another venue's space or a malformed id (Review Focus 1)", async () => {
    expect(await spaceDay(db, { organizationId: orgId, resourceId: otherOrgPitch, date: '2026-10-23', withNames: false, now })).toBeNull();
    expect(await spaceDay(db, { organizationId: orgId, resourceId: 'not-a-uuid', date: '2026-10-23', withNames: false, now })).toBeNull();
    expect(await branchDay(db, { organizationId: orgId, branchId: 'not-a-uuid', date: '2026-10-23', now })).toBeNull();
  });
});

describe('cancelling', () => {
  it('lets a player cancel before the cut-off, but not after', async () => {
    const result = await asPlayer(a, users[0]!.id, new Date('2026-10-23T12:00:00Z'), pitch2); // Fri 6pm
    if (result.status !== 'booked') throw new Error(result.status);
    const id = result.bookingId;
    const at = (h: number) => new Date(new Date('2026-10-23T12:00:00Z').getTime() - h * 3_600_000);
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id, actor: { kind: 'player', profileId: a }, cancelledBy: users[0]!.id, now: at(1) })).toBe('too_late');
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id, actor: { kind: 'player', profileId: a }, cancelledBy: users[0]!.id, now: at(3) })).toBe('cancelled');
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id, actor: { kind: 'player', profileId: a }, cancelledBy: users[0]!.id, now: at(3) })).toBe(
      'not_cancellable',
    ); // second click (Review Focus 5)
  });

  it("does not let a player cancel someone else's booking", async () => {
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: aBooking, actor: { kind: 'player', profileId: b }, cancelledBy: users[1]!.id, now })).toBe('not_found');
  });

  it('lets staff cancel after the cut-off and mark attendance', async () => {
    const result = await asPlayer(b, users[1]!.id, new Date('2026-10-23T13:00:00Z'), pitch2); // Fri 7pm
    if (result.status !== 'booked') throw new Error(result.status);
    const late = new Date('2026-10-23T12:30:00Z'); // 30 minutes before
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: result.bookingId, actor: { kind: 'staff' }, cancelledBy: staffUser.id, now: late })).toBe('cancelled');
    expect(await setSpaceBookingStatus(db, { organizationId: orgId, bookingId: aBooking, status: 'attended' })).toBe('updated');
    expect(await setSpaceBookingStatus(db, { organizationId: orgId, bookingId: result.bookingId, status: 'no_show' })).toBe('invalid');
  });
});

describe('my bookings', () => {
  it('keeps a booking visible and cancellable after its space changes (Review Focus 3)', async () => {
    const result = await asPlayer(b, users[1]!.id, new Date('2026-10-23T10:00:00Z'), pitch2); // Fri 4pm
    if (result.status !== 'booked') throw new Error(result.status);
    await db.from('resources').update({ active: false, slot_minutes: 90 }).eq('id', pitch2);

    const mine = await listMyBookings(db, { organizationId: orgId, profileId: b, now });
    expect(mine.upcoming.find((x) => x.id === result.bookingId)).toMatchObject({ resourceName: 'Pitch 2', cancellable: true });
    const day = await spaceDay(db, { organizationId: orgId, resourceId: pitch2, date: '2026-10-23', withNames: false, now });
    expect(day!.slots.filter((s) => s.state === 'taken').length).toBeGreaterThanOrEqual(1);
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: result.bookingId, actor: { kind: 'player', profileId: b }, cancelledBy: users[1]!.id, now })).toBe(
      'cancelled',
    );
  });

  it('puts a 01:00 booking on the previous business day and in time order (Review Focus 2)', async () => {
    const eleven = await asPlayer(a, users[0]!.id, new Date('2026-10-23T17:00:00Z'), zoneL); // Fri 23:00
    const one = await asPlayer(a, users[0]!.id, new Date('2026-10-23T19:00:00Z'), zoneL); // Sat 01:00, business day Fri
    expect(eleven.status).toBe('booked');
    expect(one.status).toBe('booked');
    const day = await spaceDay(db, { organizationId: orgId, resourceId: zoneL, date: '2026-10-23', withNames: false, now });
    expect(day!.slots.at(-1)!.state).toBe('taken'); // the 01:00–02:00 slot belongs to Friday's grid

    const order = (await listMyBookings(db, { organizationId: orgId, profileId: a, now })).upcoming.map((x) => x.startsAt);
    expect([...order].sort()).toEqual(order);
  });
});
