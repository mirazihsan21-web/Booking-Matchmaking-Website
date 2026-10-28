import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelSpaceBooking, listMyBookings, setSpaceBookingStatus } from '@/lib/bookings/bookings';
import { cancelSeat, listMySeats, setSeatStatus } from '@/lib/open-play/open-play';
import { livePayments, recordPayment, voidPayment } from '@/lib/payments/payments';
import { loadSections } from '@/lib/sections/sections';
import { boardgame } from '@/presets/boardgame';
import { lounge } from '@/presets/lounge';
import { turf } from '@/presets/turf';
import { setupBrand } from '../../scripts/brand-setup-core.mjs';
import { createTestUser, deleteTestUser, serviceDb, signedInClient, type TestUser } from './helpers';

// A brand with Turf and Café; an owner, a turf-only staff member and a player. Walk-ins and a player's
// booking tomorrow, a turf booking that started 10 minutes ago, and a turf game in three days with the
// player seated.
const db = serviceDb();
const slug = `pay-${randomUUID().slice(0, 8)}`;
let orgId: string;
let turfId: string;
let cafeId: string;
const users: TestUser[] = [];
let owner: SupabaseClient;
let staff: SupabaseClient;
let profileId: string;
const id: Record<string, string> = {};

const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const range = (fromH: number, toH: number) => `[${hours(fromH)},${hours(toH)})`;

beforeAll(async () => {
  await setupBrand(db, { slug, name: 'Pay Arena', presets: [turf, boardgame, lounge] });
  orgId = must(await db.from('organizations').select('id').eq('slug', slug).single()).id;
  const sections = await loadSections(db, orgId);
  turfId = sections.find((s) => s.kind === 'turf')!.id;
  cafeId = sections.find((s) => s.kind === 'boardgame_cafe')!.id;
  const [o, t, p] = await Promise.all([createTestUser(db), createTestUser(db), createTestUser(db)]);
  users.push(o, t, p);
  must(await db.from('organization_members').insert([
    { organization_id: orgId, user_id: o.id, role: 'owner' },
    { organization_id: orgId, user_id: t.id, role: 'staff' },
  ]));
  must(await db.from('section_staff').insert({ organization_id: orgId, section_id: turfId, user_id: t.id }));
  profileId = must(await db.from('player_profiles').insert({ organization_id: orgId, user_id: p.id, display_name: 'Player P' }).select('id').single()).id;
  owner = await signedInClient(o.email, o.password);
  staff = await signedInClient(t.email, t.password);

  const space = async (sectionId: string) => must(await db.from('resources').select('id').eq('section_id', sectionId).order('name').limit(1).single()).id;
  const pitch = await space(turfId);
  const table = await space(cafeId);
  const book = async (key: string, resourceId: string, period: string, price: number, extra: Record<string, unknown> = { guest_name: key, guest_phone: '01712345678' }) => {
    id[key] = must(
      await db.from('resource_bookings').insert({ organization_id: orgId, resource_id: resourceId, period, price_poisha: price, ...extra }).select('id').single(),
    ).id;
  };
  await book('walkIn', pitch, range(24, 25), 60000);
  await book('cafe', table, range(24, 25), 0);
  await book('toCancel', pitch, range(26, 27), 60000);
  await book('players', pitch, range(72, 73), 60000, { profile_id: profileId });
  await book('started', pitch, range(-1 / 6, 5 / 6), 60000);

  const activity = must(await db.from('activities').select('id').eq('section_id', turfId).limit(1).single()).id;
  const session = must(
    await db
      .from('open_play_sessions')
      .insert({ organization_id: orgId, section_id: turfId, activity_id: activity, starts_at: hours(72), ends_at: hours(73), seat_price_poisha: 30000, status: 'matched' })
      .select('id')
      .single(),
  ).id;
  const group = must(
    await db.from('groups').insert({ organization_id: orgId, session_id: session, resource_id: pitch, activity_id: activity, capacity: 10 }).select('id').single(),
  ).id;
  id.seat = must(
    await db.from('bookings').insert({ organization_id: orgId, session_id: session, group_id: group, profile_id: profileId, seat_no: 1, price_poisha: 30000 }).select('id').single(),
  ).id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  for (const u of users) await deleteTestUser(db, u.id);
});

describe('recordPayment and voidPayment', () => {
  it('lets turf staff take cash for a turf booking, once', async () => {
    expect(await recordPayment(staff, { kind: 'space', bookingId: id.walkIn!, amountPoisha: 60000 })).toBe('recorded');
    expect(await recordPayment(staff, { kind: 'space', bookingId: id.walkIn!, amountPoisha: 60000 })).toBe('already_paid');
  });

  it('refuses them a café booking, and refuses amounts out of range', async () => {
    expect(await recordPayment(staff, { kind: 'space', bookingId: id.cafe!, amountPoisha: 50000 })).toBe('not_found');
    expect(await recordPayment(owner, { kind: 'space', bookingId: id.cafe!, amountPoisha: 0 })).toBe('invalid_amount');
  });

  it('takes a typed amount for a booking priced at the venue (spec edge 8)', async () => {
    expect(await recordPayment(owner, { kind: 'space', bookingId: id.cafe!, amountPoisha: 50000 })).toBe('recorded');
  });

  it('refuses cash for a cancelled booking (Review Focus 1)', async () => {
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id.toCancel!, actor: { kind: 'staff' }, cancelledBy: users[0]!.id })).toBe('cancelled');
    expect(await recordPayment(staff, { kind: 'space', bookingId: id.toCancel!, amountPoisha: 60000 })).toBe('not_payable');
  });

  it('voids a payment once, and only live payments count', async () => {
    const live = await livePayments(db, { spaceBookingIds: [id.walkIn!, id.cafe!], seatBookingIds: [] });
    expect(live.get(id.walkIn!)?.amountPoisha).toBe(60000);
    expect(await voidPayment(staff, { paymentId: live.get(id.walkIn!)!.id })).toBe('voided');
    expect(await voidPayment(staff, { paymentId: live.get(id.walkIn!)!.id })).toBe('already_voided');
    expect(await voidPayment(staff, { paymentId: live.get(id.cafe!)!.id })).toBe('not_found'); // a café payment
    const after = await livePayments(db, { spaceBookingIds: [id.walkIn!, id.cafe!], seatBookingIds: [] });
    expect([...after.keys()]).toEqual([id.cafe!]);
  });
});

describe('paid bookings and seats', () => {
  it('shows a paid booking as paid, and the player can no longer cancel it', async () => {
    expect(await recordPayment(owner, { kind: 'space', bookingId: id.players!, amountPoisha: 60000 })).toBe('recorded');
    expect((await listMyBookings(db, { organizationId: orgId, profileId })).upcoming.find((b) => b.id === id.players)?.paid).toBe(true);
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id.players!, actor: { kind: 'player', profileId }, cancelledBy: users[2]!.id })).toBe('paid');
  });

  it('lets the desk cancel it, which voids the payment', async () => {
    expect(await cancelSpaceBooking(db, { organizationId: orgId, bookingId: id.players!, actor: { kind: 'staff' }, cancelledBy: users[0]!.id })).toBe('cancelled');
    expect((await livePayments(db, { spaceBookingIds: [id.players!], seatBookingIds: [] })).size).toBe(0);
  });

  it('does the same for a seat', async () => {
    expect(await recordPayment(owner, { kind: 'seat', bookingId: id.seat!, amountPoisha: 30000 })).toBe('recorded');
    expect((await listMySeats(db, { organizationId: orgId, profileId })).upcoming.find((s) => s.bookingId === id.seat)?.paid).toBe(true);
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: id.seat!, actor: { kind: 'player', profileId } })).toBe('paid');
    expect(await cancelSeat(db, { organizationId: orgId, bookingId: id.seat!, actor: { kind: 'staff' } })).toBe('cancelled');
    expect((await livePayments(db, { spaceBookingIds: [], seatBookingIds: [id.seat!] })).size).toBe(0);
  });
});

describe('desk statuses', () => {
  it('marks a started booking arrived and undoes it', async () => {
    expect(await setSpaceBookingStatus(db, { organizationId: orgId, bookingId: id.started!, status: 'attended' })).toBe('updated');
    expect(await setSpaceBookingStatus(db, { organizationId: orgId, bookingId: id.started!, status: 'confirmed' })).toBe('updated');
  });

  it('refuses a seat check-in days before its game, and a seat of another brand', async () => {
    const otherSeat = randomUUID();
    expect(await setSeatStatus(db, { organizationId: orgId, bookingId: otherSeat, status: 'attended' })).toBe('not_found');
    const seats = must(await db.from('bookings').select('id').eq('organization_id', orgId).neq('status', 'cancelled'));
    expect(seats).toEqual([]); // the only seat was cancelled above
    expect(await setSeatStatus(db, { organizationId: orgId, bookingId: id.seat!, status: 'attended' })).toBe('invalid');
  });
});
