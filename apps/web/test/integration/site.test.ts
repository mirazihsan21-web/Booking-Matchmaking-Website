import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelOpenPlay } from '@/lib/schedule/schedule';
import { loadSections } from '@/lib/sections/sections';
import { findSection, loadComingUp } from '@/lib/site/home';
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
