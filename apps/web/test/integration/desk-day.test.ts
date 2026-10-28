import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, instantAt, localDate } from '@/lib/bookings/slots';
import { loadDeskDay } from '@/lib/manage/desk-day';
import { recordPayment } from '@/lib/payments/payments';
import { scheduleOpenPlay } from '@/lib/schedule/schedule';
import { loadSections } from '@/lib/sections/sections';
import { boardgame } from '@/presets/boardgame';
import { lounge } from '@/presets/lounge';
import { turf } from '@/presets/turf';
import { setupBrand } from '../../scripts/brand-setup-core.mjs';
import { serviceDb } from './helpers';

// Two days ahead: a game on Pitch 1 + Pitch 2 at 18:00; a paid booking on the badminton court at 12:00;
// a booking on a turf space that is then switched off; a café table booking on a weekday the café is
// closed. Review Focus 2: the switched-off space and the closed section's booking still show.
const db = serviceDb();
const slug = `desk-${randomUUID().slice(0, 8)}`;
const TZ = 'Asia/Dhaka';
const today = localDate(new Date(), TZ);
const date = addDays(today, 2);
let orgId: string;
const ids: Record<string, string> = {};

const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};
const at = (hour: number) => `[${instantAt(date, hour * 60, TZ).toISOString()},${instantAt(date, hour * 60 + 60, TZ).toISOString()})`;

beforeAll(async () => {
  await setupBrand(db, { slug, name: 'Desk Arena', presets: [turf, boardgame, lounge] });
  orgId = must(await db.from('organizations').select('id').eq('slug', slug).single()).id;
  const sections = await loadSections(db, orgId);
  const turfSection = sections.find((s) => s.kind === 'turf')!;
  ids.turf = turfSection.id;
  ids.cafe = sections.find((s) => s.kind === 'boardgame_cafe')!.id;
  ids.lounge = sections.find((s) => s.kind === 'gaming_lounge')!.id;
  const space = async (sectionId: string, name: string) => must(await db.from('resources').select('id').eq('section_id', sectionId).eq('name', name).single()).id;
  ids.pitch1 = await space(ids.turf, 'Pitch 1');
  ids.pitch2 = await space(ids.turf, 'Pitch 2');
  ids.court = await space(ids.turf, 'Badminton Court 1');
  ids.table = await space(ids.cafe, 'Table 1');
  ids.old = must(await db.from('resources').insert({ organization_id: orgId, section_id: ids.turf, name: 'Old Court', kind: 'court', capacity: 4 }).select('id').single()).id;

  const book = async (resourceId: string, period: string) =>
    must(
      await db
        .from('resource_bookings')
        .insert({ organization_id: orgId, resource_id: resourceId, period, price_poisha: 60000, guest_name: 'Desk Guest', guest_phone: '01712345678' })
        .select('id')
        .single(),
    ).id;
  ids.paid = await book(ids.court, at(12));
  ids.oldBooking = await book(ids.old, at(15));
  ids.cafeBooking = await book(ids.table, at(12));
  expect(await recordPayment(db, { kind: 'space', bookingId: ids.paid, amountPoisha: 60000 })).toBe('recorded');
  must(await db.from('resources').update({ active: false }).eq('id', ids.old));
  const weekday = String(new Date(`${date}T00:00:00Z`).getUTCDay());
  const cafe = sections.find((s) => s.id === ids.cafe)!;
  must(await db.from('sections').update({ opening_hours: { ...cafe.openingHours, [weekday]: null } }).eq('id', ids.cafe));

  const activity = must(await db.from('activities').select('id').eq('section_id', ids.turf).limit(1).single()).id;
  const scheduled = await scheduleOpenPlay(db, {
    organizationId: orgId, sectionId: ids.turf, activityId: activity, resourceIds: [ids.pitch1, ids.pitch2], first: { date, time: '18:00' },
    weeks: 1, durationMin: 60, seatPricePoisha: 30000, timeZone: TZ, openingHours: turfSection.openingHours,
  });
  expect(scheduled.status).toBe('scheduled');
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
});

describe('loadDeskDay', () => {
  it('shows a game once, over every space it uses', async () => {
    const day = await loadDeskDay(db, { organizationId: orgId, sectionIds: [ids.turf!, ids.cafe!, ids.lounge!], date, now: new Date(), timeZone: TZ });
    expect(day.games).toHaveLength(1);
    expect([...day.games[0]!.resourceIds].sort()).toEqual([ids.pitch1!, ids.pitch2!].sort());
    expect(day.games[0]!.seats.total).toBeGreaterThan(0);
  });

  it('keeps a switched-off space and a closed section that still have bookings (Review Focus 2)', async () => {
    const day = await loadDeskDay(db, { organizationId: orgId, sectionIds: [ids.turf!, ids.cafe!, ids.lounge!], date, now: new Date(), timeZone: TZ });
    const turfSpaces = day.sections.find((s) => s.section.id === ids.turf)!.spaces;
    const old = turfSpaces.find((s) => s.id === ids.old)!;
    expect(old.active).toBe(false);
    expect(old.bookings.map((b) => b.id)).toEqual([ids.oldBooking]);
    const cafeBookings = day.sections.find((s) => s.section.id === ids.cafe)!.spaces.flatMap((s) => s.bookings.map((b) => b.id));
    expect(cafeBookings).toContain(ids.cafeBooking);
  });

  it('carries a paid booking’s payment and counts the day', async () => {
    const day = await loadDeskDay(db, { organizationId: orgId, sectionIds: [ids.turf!, ids.cafe!, ids.lounge!], date, now: new Date(), timeZone: TZ });
    const paid = day.sections.flatMap((s) => s.spaces.flatMap((sp) => sp.bookings)).find((b) => b.id === ids.paid)!;
    expect(paid.payment?.amountPoisha).toBe(60000);
    expect(paid.pricePoisha).toBe(60000);
    expect(day.counts).toMatchObject({ bookings: 3, arrived: 0, noShows: 0 });
  });

  it('shows only the sections asked for', async () => {
    const day = await loadDeskDay(db, { organizationId: orgId, sectionIds: [ids.turf!], date, now: new Date(), timeZone: TZ });
    expect(day.sections.map((s) => s.section.id)).toEqual([ids.turf]);
  });

  it('counts the cash taken today in the shown sections', async () => {
    const all = await loadDeskDay(db, { organizationId: orgId, sectionIds: [ids.turf!, ids.cafe!, ids.lounge!], date: today, now: new Date(), timeZone: TZ });
    expect(all.counts.cashPoisha).toBe(60000);
    const cafeOnly = await loadDeskDay(db, { organizationId: orgId, sectionIds: [ids.cafe!], date: today, now: new Date(), timeZone: TZ });
    expect(cafeOnly.counts.cashPoisha).toBe(0);
  });
});
