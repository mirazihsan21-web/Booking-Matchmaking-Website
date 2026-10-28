import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelOpenPlay } from '@/lib/schedule/schedule';
import { loadSections } from '@/lib/sections/sections';
import { findSection, loadComingUp, loadSectionFacts, oldBookSection } from '@/lib/site/home';
import { boardgame } from '@/presets/boardgame';
import { lounge } from '@/presets/lounge';
import { turf } from '@/presets/turf';
import { setupBrand } from '../../scripts/brand-setup-core.mjs';
import { deleteTestUser, serviceDb } from './helpers';

// A demo brand (as `pnpm brand:setup --demo` makes it): turf, café and lounge, 12 rated players and one
// open game per section — café 2 days ahead at 19:00 (6 asked, Tables 1–2 seat 8), turf 2 days ahead at
// 20:00 (11 asked for 10 seats), lounge 3 days ahead at 21:00 (6 asked for 10).
const db = serviceDb();
const slug = `site-${randomUUID().slice(0, 8)}`;
const orgIds: string[] = [];
let orgId: string;

beforeAll(async () => {
  await setupBrand(db, { slug, name: 'Site Arena', presets: [turf, boardgame, lounge], demo: true });
  orgId = (await db.from('organizations').select('id').eq('slug', slug).single()).data!.id;
  orgIds.push(orgId);
});

afterAll(async () => {
  await db.from('organizations').delete().in('id', orgIds);
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data.users.filter((x) => x.email?.startsWith(`demo-${slug}-`))) await deleteTestUser(db, u.id);
});

describe('loadComingUp', () => {
  it('lists games coming up across sections, soonest first, with seats', async () => {
    const sections = await loadSections(db, orgId);
    const slugOf = new Map(sections.map((s) => [s.id, s.slug]));
    const games = await loadComingUp(db, { organizationId: orgId });
    expect(games.map((g) => [slugOf.get(g.sectionId), g.activityName, g.left, g.total])).toEqual([
      ['cafe', null, 2, 8],
      ['turf', '5-a-side futsal', 0, 10],
      ['lounge', 'Valorant 5v5', 4, 10],
    ]);
    expect(games[0]!.pricePoisha).toBe(20000);
    expect(Date.parse(games[0]!.startsAt)).toBeLessThan(Date.parse(games[1]!.startsAt));
  });

  it('leaves out games past the window, and cancelled ones', async () => {
    expect(await loadComingUp(db, { organizationId: orgId, days: 1 })).toEqual([]);
    const games = await loadComingUp(db, { organizationId: orgId });
    expect(await cancelOpenPlay(db, games[2]!.id)).toBe('cancelled');
    expect((await loadComingUp(db, { organizationId: orgId })).map((g) => g.id)).toEqual([games[0]!.id, games[1]!.id]);
  });

  it('has nothing for a brand with no games (Review Focus 2)', async () => {
    const quiet = `${slug}-q`;
    await setupBrand(db, { slug: quiet, name: 'Quiet', presets: [turf, boardgame, lounge] });
    const id = (await db.from('organizations').select('id').eq('slug', quiet).single()).data!.id;
    orgIds.push(id);
    expect(await loadComingUp(db, { organizationId: id })).toEqual([]);
  });
});

describe('findSection (Review Focus 4)', () => {
  it('finds a section by its address, a second turf too, and never a reserved word', async () => {
    await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'turf', p_name: 'Second turf' });
    const sections = await loadSections(db, orgId);
    expect(findSection(sections, 'turf')?.name).toBe('Turf');
    expect(findSection(sections, 'turf-2')?.name).toBe('Second turf');
    expect(findSection(sections, 'me')).toBeNull();
    expect(findSection(sections, 'nope')).toBeNull();
  });
});

describe('oldBookSection (Review Focus 1: old /book links)', () => {
  it("finds an old booking link's section from its space or its section, only in this brand", async () => {
    const sections = await loadSections(db, orgId);
    const cafe = sections.find((x) => x.slug === 'cafe')!;
    const lounge = sections.find((x) => x.slug === 'lounge')!;
    const table = (await db.from('resources').select('id').eq('section_id', cafe.id).limit(1).single()).data!.id;
    const q = (query: string) => new URLSearchParams(query);
    expect(await oldBookSection(db, orgId, q(`resource=${table}&date=2026-10-30`))).toBe('cafe');
    expect(await oldBookSection(db, orgId, q(`section=${lounge.id}`))).toBe('lounge');
    expect(await oldBookSection(db, orgId, q(`section=${lounge.id}&resource=${table}`))).toBe('cafe'); // the space wins
    expect(await oldBookSection(db, orgId, q('resource=not-a-uuid&section=nope'))).toBeNull();
    expect(await oldBookSection(db, orgId, q(''))).toBeNull();
    const elsewhere = (await db.from('resources').select('id').neq('organization_id', orgId).limit(1).single()).data!.id;
    expect(await oldBookSection(db, orgId, q(`resource=${elsewhere}`))).toBeNull();
  });
});

describe('loadSectionFacts (services on the landing page)', () => {
  it("gives each section its active spaces, its lowest hourly price and its top games", async () => {
    const sections = await loadSections(db, orgId);
    const facts = await loadSectionFacts(db, orgId);
    const of = (slug: string) => facts.get(sections.find((x) => x.slug === slug)!.id);
    expect(of('turf')).toEqual({ spaces: 3, fromPoisha: 60000, games: ['5-a-side futsal', '7-a-side football', 'Badminton doubles'] });
    expect(of('lounge')).toEqual({ spaces: 4, fromPoisha: 40000, games: ['Valorant 5v5', 'EA FC 1v1', 'CS2 5v5', 'PUBG squad'] });
    expect(of('cafe')).toMatchObject({ spaces: 7, fromPoisha: null }); // tables are priced at the venue
    expect(of('cafe')!.games.length).toBeLessThanOrEqual(4);

    // An inactive space no longer counts, nor does its price.
    const turf = sections.find((x) => x.slug === 'turf')!;
    const court = (await db.from('resources').select('id').eq('section_id', turf.id).eq('name', 'Badminton Court 1').single()).data!.id;
    await db.from('resources').update({ active: false }).eq('id', court);
    expect((await loadSectionFacts(db, orgId)).get(turf.id)).toMatchObject({ spaces: 2, fromPoisha: 250000 });
  });
});
