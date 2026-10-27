import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSection, loadSections, sectionIdOfSeat, sectionIdOfSpaceBooking, sectionOfResource, sectionOfSession } from '@/lib/sections/sections';
import { canManageSection } from '@/lib/tenancy/sections-access';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

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
let owner: TestUser;
let turfStaff: TestUser;
let spaceBooking: string; // a walk-in at the café table
let walkInStatus: string;
let seat: string; // a seat in the café game

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

  // An owner, turf-only staff, a café walk-in and a café seat: what the staff actions touch.
  owner = await createTestUser(db);
  turfStaff = await createTestUser(db);
  must(await db.from('organization_members').insert([
    { organization_id: orgId, user_id: owner.id, role: 'owner' },
    { organization_id: orgId, user_id: turfStaff.id, role: 'staff' },
  ]));
  must(await db.from('section_staff').insert({ organization_id: orgId, section_id: turf, user_id: turfStaff.id }));
  const walkIn = must(await db.rpc('book_resource', {
    p_organization_id: orgId, p_resource_id: table, p_starts_at: at(2 * 86_400_000), p_slots: 1,
    p_profile_id: null, p_guest_name: 'Karim', p_guest_phone: '+8801712345678', p_created_by: owner.id,
  })) as Array<{ status: string; booking_id: string }>;
  spaceBooking = walkIn[0]!.booking_id;
  walkInStatus = walkIn[0]!.status;
  const player = must(await db.from('player_profiles').insert({ organization_id: orgId, user_id: owner.id, display_name: 'Owner plays' }).select('id').single()).id;
  const activity = must(await db.from('activities').insert({ organization_id: orgId, section_id: cafe, name: 'Catan', min_players: 2, max_players: 4, duration_min: 90 }).select('id').single()).id;
  const group = must(await db.from('groups').insert({ organization_id: orgId, session_id: session, resource_id: table, activity_id: activity, capacity: 4 }).select('id').single()).id;
  seat = must(await db.from('bookings').insert({ organization_id: orgId, session_id: session, group_id: group, profile_id: player, seat_no: 1, price_poisha: 20000 }).select('id').single()).id;
});

afterAll(async () => {
  await db.from('organizations').delete().in('id', [orgId, otherOrgId]);
  for (const u of [owner, turfStaff]) if (u) await deleteTestUser(db, u.id);
});

describe('sections', () => {
  it('lists a brand’s sections in display order, each with its own rules', async () => {
    const sections = await loadSections(db, orgId);
    expect(sections.map((s) => [s.slug, s.name, s.kind, s.accent, s.position])).toEqual([
      ['turf', 'Turf', 'turf', '#43a66b', 1],
      ['cafe', 'Board-game café', 'boardgame_cafe', '#2e9e93', 2],
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

  it('finds the section each staff write touches, so turf staff are refused café rows (Review: action barrier)', async () => {
    expect(walkInStatus).toBe('booked');
    expect(await sectionIdOfSpaceBooking(db, spaceBooking)).toBe(cafe);
    expect(await sectionIdOfSeat(db, seat)).toBe(cafe);
    for (const sectionId of [await sectionIdOfSpaceBooking(db, spaceBooking), await sectionIdOfSeat(db, seat), (await sectionOfResource(db, table))!.id, (await sectionOfSession(db, session))!.id]) {
      expect(await canManageSection(db, { organizationId: orgId, userId: turfStaff.id, sectionId: sectionId! })).toBe(false);
      expect(await canManageSection(db, { organizationId: orgId, userId: owner.id, sectionId: sectionId! })).toBe(true);
    }
    expect(await canManageSection(db, { organizationId: orgId, userId: turfStaff.id, sectionId: turf })).toBe(true);
    for (const missing of [randomUUID(), 'nope']) {
      expect(await sectionIdOfSpaceBooking(db, missing)).toBeNull();
      expect(await sectionIdOfSeat(db, missing)).toBeNull();
    }
  });

  it('keeps Turf first even when the café was renamed to sort earlier', async () => {
    must(await db.from('sections').update({ name: 'Arcade café' }).eq('id', cafe));
    expect((await loadSections(db, orgId)).map((s) => s.id)).toEqual([turf, cafe]);
  });
});
