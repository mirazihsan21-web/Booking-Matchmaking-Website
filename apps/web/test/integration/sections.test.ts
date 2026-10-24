import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSection, loadSections, sectionOfResource, sectionOfSession } from '@/lib/sections/sections';
import { serviceDb } from './helpers';

// A brand with Turf and Café (made by add_section, so slugs, accents and positions are the real
// defaults), and another brand with its own Turf.
const db = serviceDb();
let orgId: string;
let otherOrgId: string;
let turf: string;
let cafe: string;
let otherTurf: string;
let table: string;
let session: string;

const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};

beforeAll(async () => {
  orgId = must(await db.from('organizations').insert({ slug: `sec-${randomUUID().slice(0, 8)}`, name: 'Sections', status: 'live' }).select('id').single()).id;
  otherOrgId = must(await db.from('organizations').insert({ slug: `secx-${randomUUID().slice(0, 8)}`, name: 'Other', status: 'live' }).select('id').single()).id;
  turf = must(await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'turf', p_name: 'Turf' })) as string;
  cafe = must(await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'boardgame_cafe', p_name: 'Board-game café' })) as string;
  otherTurf = must(await db.rpc('add_section', { p_organization_id: otherOrgId, p_kind: 'turf', p_name: 'Turf' })) as string;
  must(await db.from('sections').update({ booking_horizon_days: 3, cancel_cutoff_minutes: 30, match_cutoff_minutes: 90, max_upcoming_bookings: 2, offer_ttl_seconds: 600 }).eq('id', cafe));
  table = must(await db.from('resources').insert({ organization_id: orgId, section_id: cafe, name: 'Table 1', kind: 'table', capacity: 4 }).select('id').single()).id;
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  session = must(
    await db
      .from('open_play_sessions')
      .insert({ organization_id: orgId, section_id: cafe, starts_at: at(86_400_000), ends_at: at(90_000_000), seat_price_poisha: 20000 })
      .select('id')
      .single(),
  ).id;
});

afterAll(async () => {
  await db.from('organizations').delete().in('id', [orgId, otherOrgId]);
});

describe('sections', () => {
  it('lists a brand’s sections in display order, each with its own rules', async () => {
    const sections = await loadSections(db, orgId);
    expect(sections.map((s) => [s.slug, s.name, s.kind, s.accent, s.position])).toEqual([
      ['turf', 'Turf', 'turf', '#15803D', 1],
      ['cafe', 'Board-game café', 'boardgame_cafe', '#0F766E', 2],
    ]);
    expect(sections[0]!.rules).toEqual({ bookingHorizonDays: 14, cancelCutoffMinutes: 120, matchCutoffMinutes: 360, maxUpcomingBookings: 3, offerTtlSeconds: 900 });
    expect(sections[1]!.rules).toEqual({ bookingHorizonDays: 3, cancelCutoffMinutes: 30, matchCutoffMinutes: 90, maxUpcomingBookings: 2, offerTtlSeconds: 600 });
    expect(sections[1]!.organizationId).toBe(orgId);
  });

  it('loads one section of this brand, and nothing for another brand’s or a malformed id', async () => {
    expect((await loadSection(db, { organizationId: orgId, sectionId: cafe }))?.slug).toBe('cafe');
    expect(await loadSection(db, { organizationId: orgId, sectionId: otherTurf })).toBeNull();
    expect(await loadSection(db, { organizationId: orgId, sectionId: 'nope' })).toBeNull();
  });

  it('finds the section of a space and of a game', async () => {
    expect((await sectionOfResource(db, table))?.id).toBe(cafe);
    expect((await sectionOfSession(db, session))?.id).toBe(cafe);
    expect(await sectionOfResource(db, randomUUID())).toBeNull();
    expect(await sectionOfSession(db, 'nope')).toBeNull();
  });

  it('keeps Turf first even when the café was renamed to sort earlier', async () => {
    must(await db.from('sections').update({ name: 'Arcade café' }).eq('id', cafe));
    expect((await loadSections(db, orgId)).map((s) => s.id)).toEqual([turf, cafe]);
  });
});
