import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instantAt, localDate } from '@/lib/bookings/slots';
import { recordPayment, voidPayment, livePayments } from '@/lib/payments/payments';
import { takingsDay, takingsWeek } from '@/lib/payments/takings';
import { loadSections } from '@/lib/sections/sections';
import { boardgame } from '@/presets/boardgame';
import { lounge } from '@/presets/lounge';
import { turf } from '@/presets/turf';
import { setupBrand } from '../../scripts/brand-setup-core.mjs';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// A brand with today's turf bookings (one paid ৳600; on another a wrong ৳550 voided and ৳500 recorded),
// a cancelled turf booking, and a café seat paid ৳200. Sections keep the default hours (no overnight),
// so today's business day is today's date.
const db = serviceDb();
const slug = `tk-${randomUUID().slice(0, 8)}`;
const TZ = 'Asia/Dhaka';
const today = localDate(new Date(), TZ);
let orgId: string;
let turfId: string;
let cafeId: string;
let player: TestUser | undefined;

const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};
const noonRange = (hour: number) => `[${instantAt(today, hour * 60, TZ).toISOString()},${instantAt(today, hour * 60 + 60, TZ).toISOString()})`;

beforeAll(async () => {
  await setupBrand(db, { slug, name: 'Takings Arena', presets: [turf, boardgame, lounge] });
  orgId = must(await db.from('organizations').select('id').eq('slug', slug).single()).id;
  const sections = await loadSections(db, orgId);
  turfId = sections.find((s) => s.kind === 'turf')!.id;
  cafeId = sections.find((s) => s.kind === 'boardgame_cafe')!.id;
  const pitch = must(await db.from('resources').select('id').eq('section_id', turfId).order('name').limit(1).single()).id;
  const table = must(await db.from('resources').select('id').eq('section_id', cafeId).order('name').limit(1).single()).id;
  const book = async (period: string, status = 'confirmed') =>
    must(
      await db
        .from('resource_bookings')
        .insert({ organization_id: orgId, resource_id: pitch, period, price_poisha: 60000, status, guest_name: 'G', guest_phone: '01712345678' })
        .select('id')
        .single(),
    ).id;
  const paid = await book(noonRange(12));
  const fixed = await book(noonRange(14));
  await book(noonRange(16), 'cancelled');
  expect(await recordPayment(db, { kind: 'space', bookingId: paid, amountPoisha: 60000 })).toBe('recorded');
  expect(await recordPayment(db, { kind: 'space', bookingId: fixed, amountPoisha: 55000 })).toBe('recorded');
  const wrong = (await livePayments(db, { spaceBookingIds: [fixed], seatBookingIds: [] })).get(fixed)!.id;
  expect(await voidPayment(db, { paymentId: wrong })).toBe('voided');
  expect(await recordPayment(db, { kind: 'space', bookingId: fixed, amountPoisha: 50000 })).toBe('recorded');

  const activity = must(await db.from('activities').select('id').eq('section_id', cafeId).limit(1).single()).id;
  const session = must(
    await db
      .from('open_play_sessions')
      .insert({
        organization_id: orgId, section_id: cafeId, activity_id: activity, starts_at: instantAt(today, 19 * 60, TZ).toISOString(),
        ends_at: instantAt(today, 21 * 60, TZ).toISOString(), seat_price_poisha: 20000, status: 'matched',
      })
      .select('id')
      .single(),
  ).id;
  const group = must(await db.from('groups').insert({ organization_id: orgId, session_id: session, resource_id: table, activity_id: activity, capacity: 4 }).select('id').single()).id;
  player = await createTestUser(db);
  const profile = must(await db.from('player_profiles').insert({ organization_id: orgId, user_id: player.id, display_name: 'Player' }).select('id').single()).id;
  const seat = must(
    await db.from('bookings').insert({ organization_id: orgId, session_id: session, group_id: group, profile_id: profile, seat_no: 1, price_poisha: 20000 }).select('id').single(),
  ).id;
  expect(await recordPayment(db, { kind: 'seat', bookingId: seat, amountPoisha: 20000 })).toBe('recorded');
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  if (player) await deleteTestUser(db, player.id);
});

describe('takingsDay', () => {
  it('sums today’s live cash per section and counts today’s bookings', async () => {
    const day = await takingsDay(db, { organizationId: orgId, date: today, timeZone: TZ });
    const turfRow = day.rows.find((r) => r.sectionId === turfId)!;
    expect(turfRow.cashPoisha).toBe(110000); // ৳600 + ৳500, not the voided ৳550 (Review Focus 5)
    expect(turfRow.bookings).toBe(2); // the cancelled one doesn't count
    const cafeRow = day.rows.find((r) => r.sectionId === cafeId)!;
    expect([cafeRow.seats, cafeRow.cashPoisha]).toEqual([1, 20000]);
    expect(day.total.cashPoisha).toBe(130000);
  });
});

describe('takingsWeek', () => {
  it('lists seven days, today first', async () => {
    const week = await takingsWeek(db, { organizationId: orgId, endDate: today, timeZone: TZ });
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({ date: today, cashPoisha: 130000 });
    expect(week[6]!.cashPoisha).toBe(0);
  });
});
