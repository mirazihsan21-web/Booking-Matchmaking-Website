import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { matchSession } from '@/lib/open-play/open-play';
import { cancelOpenPlay } from '@/lib/schedule/schedule';
import { loadBrand } from '@/lib/tenancy/brand';
import { boardgame } from '@/presets/boardgame';
import { lounge } from '@/presets/lounge';
import { turf } from '@/presets/turf';
import { setupBrand } from '../../scripts/brand-setup-core.mjs';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

// One brand per run (a unique slug), set up the way `pnpm brand:setup` does it, run twice.
const db = serviceDb();
const slug = `brand-${randomUUID().slice(0, 8)}`;
const presets = [turf, boardgame, lounge];
const users: TestUser[] = [];
const orgIds: string[] = [];
let orgId: string;

async function demoUserIds(): Promise<string[]> {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.filter((u) => u.email?.startsWith(`demo-${slug}-`)).map((u) => u.id);
}

async function perSection(table: 'resources' | 'activities'): Promise<Record<string, number>> {
  const { data, error } = await db.from(table).select('sections(slug)').eq('organization_id', orgId);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data as unknown as Array<{ sections: { slug: string } }>) counts[row.sections.slug] = (counts[row.sections.slug] ?? 0) + 1;
  return counts;
}

afterAll(async () => {
  await db.from('organizations').delete().in('id', orgIds);
  for (const id of await demoUserIds()) await deleteTestUser(db, id);
  for (const u of users) await deleteTestUser(db, u.id);
});

describe('setupBrand', () => {
  it('creates the live brand with its three sections and their spaces and games', async () => {
    const report = await setupBrand(db, { slug, name: 'Test Arena', presets });
    expect(report).toEqual({ brand: 'created', sectionsAdded: ['turf', 'cafe', 'lounge'], owner: null, demo: null });

    const { data: org } = await db.from('organizations').select('id, name, status').eq('slug', slug).single();
    expect(org).toMatchObject({ name: 'Test Arena', status: 'live' });
    orgId = org!.id;
    orgIds.push(orgId);
    const { data: sections } = await db.from('sections').select('slug, kind, accent, position').eq('organization_id', orgId).order('position');
    expect(sections).toEqual([
      { slug: 'turf', kind: 'turf', accent: '#43a66b', position: 1 },
      { slug: 'cafe', kind: 'boardgame_cafe', accent: '#2e9e93', position: 2 },
      { slug: 'lounge', kind: 'gaming_lounge', accent: '#8a78e6', position: 3 },
    ]);
    expect(await perSection('resources')).toEqual({ turf: 3, cafe: 7, lounge: 4 });
    expect(await perSection('activities')).toEqual({ turf: 3, cafe: 8, lounge: 4 });
  });

  it('a second run changes nothing', async () => {
    expect(await setupBrand(db, { slug, presets })).toEqual({ brand: 'existing', sectionsAdded: [], owner: null, demo: null });
    expect(await perSection('resources')).toEqual({ turf: 3, cafe: 7, lounge: 4 });
    expect(await perSection('activities')).toEqual({ turf: 3, cafe: 8, lounge: 4 });
  });

  it('invites an owner who has no account yet, and makes an existing user the owner', async () => {
    const newcomer = `owner-${randomUUID().slice(0, 8)}@example.test`;
    expect((await setupBrand(db, { slug, presets, ownerEmail: newcomer })).owner).toBe('invited');
    const { data: invite } = await db.from('organization_invites').select('role, section_ids, accepted_at').eq('organization_id', orgId).eq('email', newcomer).single();
    expect(invite).toEqual({ role: 'owner', section_ids: [], accepted_at: null });
    expect((await setupBrand(db, { slug, presets, ownerEmail: newcomer })).owner).toBe('already');

    const existing = await createTestUser(db);
    users.push(existing);
    expect((await setupBrand(db, { slug, presets, ownerEmail: existing.email.toUpperCase() })).owner).toBe('member');
    const { data: member } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', existing.id).single();
    expect(member?.role).toBe('owner');
    expect((await setupBrand(db, { slug, presets, ownerEmail: existing.email })).owner).toBe('already');
  });

  it('adds demo players and one open game per section, which match through lib/', async () => {
    expect((await setupBrand(db, { slug, presets, demo: true })).demo).toEqual({ players: 12, sessions: 3 });

    const { data: profiles } = await db.from('player_profiles').select('id, profile_section_skills(skill)').eq('organization_id', orgId);
    expect(profiles).toHaveLength(12);
    expect(profiles!.every((p) => (p.profile_section_skills as unknown[]).length === 3)).toBe(true);

    const { data: sessions } = await db.from('open_play_sessions').select('id, sections(slug), seat_requests(count)').eq('organization_id', orgId);
    const bySection = Object.fromEntries(
      (sessions as unknown as Array<{ id: string; sections: { slug: string }; seat_requests: Array<{ count: number }> }>).map((s) => [s.sections.slug, { id: s.id, requests: s.seat_requests[0]!.count }]),
    );
    expect(Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, v.requests]))).toEqual({ turf: 11, cafe: 6, lounge: 6 });
    expect(await matchSession(db, { organizationId: orgId, sessionId: bySection.turf!.id })).toBe('matched');

    expect((await setupBrand(db, { slug, presets, demo: true })).demo).toEqual({ players: 0, sessions: 0 });

    // Once a section has no game coming up (here: the café's was cancelled), the next demo run gives it a
    // new one; the others keep theirs.
    expect(await cancelOpenPlay(db, bySection.cafe!.id)).toBe('cancelled');
    expect((await setupBrand(db, { slug, presets, demo: true })).demo).toEqual({ players: 0, sessions: 1 });
    const { count: upcoming } = await db
      .from('open_play_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['open', 'matched'])
      .gt('starts_at', new Date().toISOString());
    expect(upcoming).toBe(3);
  });
});

describe('setupBrand when something goes wrong part-way', () => {
  it('takes back a section whose spaces could not be added, so the next run adds it whole', async () => {
    const half = `${slug}-h`;
    const broken = { ...lounge, resources: [{ ...lounge.resources[0]!, capacity: 0 }] }; // breaks the capacity check
    await expect(setupBrand(db, { slug: half, name: 'Half', presets: [turf, boardgame, broken] })).rejects.toBeTruthy();
    const { data: org } = await db.from('organizations').select('id').eq('slug', half).single();
    orgIds.push(org!.id);
    const kinds = async () => ((await db.from('sections').select('kind').eq('organization_id', org!.id).order('position')).data ?? []).map((x) => x.kind);
    expect(await kinds()).toEqual(['turf', 'boardgame_cafe']);
    expect((await setupBrand(db, { slug: half, presets })).sectionsAdded).toEqual(['lounge']);
    expect(await kinds()).toEqual(['turf', 'boardgame_cafe', 'gaming_lounge']);
  });

  it('an owner invite replaces a pending staff invite for the same address', async () => {
    const email = `was-staff-${randomUUID().slice(0, 8)}@example.test`;
    const turfSection = (await db.from('sections').select('id').eq('organization_id', orgId).eq('kind', 'turf').single()).data!.id;
    await db.from('organization_invites').insert({ organization_id: orgId, email, role: 'staff', section_ids: [turfSection] });
    expect((await setupBrand(db, { slug, presets, ownerEmail: email })).owner).toBe('invited');
    const { data } = await db.from('organization_invites').select('role').eq('organization_id', orgId).eq('email', email).is('accepted_at', null);
    expect(data).toEqual([{ role: 'owner' }]);
  });
});

describe('setupBrand on a brand that exists but is not live', () => {
  it('makes an onboarding brand live, and leaves a suspended one suspended', async () => {
    const rows = await db
      .from('organizations')
      .insert([
        { slug: `${slug}-o`, name: 'Half set up', status: 'onboarding' },
        { slug: `${slug}-s`, name: 'Stopped', status: 'suspended' },
      ])
      .select('id, slug');
    for (const row of rows.data!) orgIds.push(row.id);
    expect((await setupBrand(db, { slug: `${slug}-o`, presets })).brand).toBe('existing');
    expect((await db.from('organizations').select('status').eq('slug', `${slug}-o`).single()).data?.status).toBe('live');
    await setupBrand(db, { slug: `${slug}-s`, presets });
    expect((await db.from('organizations').select('status').eq('slug', `${slug}-s`).single()).data?.status).toBe('suspended');
  });
});

describe('loadBrand', () => {
  it('loads the live brand with its sections in order', async () => {
    const brand = await loadBrand(db, slug);
    expect(brand).toMatchObject({ id: orgId, slug, name: 'Test Arena', timezone: 'Asia/Dhaka' });
    expect(brand!.sections.map((s) => s.slug)).toEqual(['turf', 'cafe', 'lounge']);
  });

  it('is null for a brand that is not live, an unknown slug or none', async () => {
    const { data } = await db.from('organizations').insert({ slug: `${slug}-x`, name: 'Not yet', status: 'onboarding' }).select('id').single();
    orgIds.push(data!.id);
    expect(await loadBrand(db, `${slug}-x`)).toBeNull();
    expect(await loadBrand(db, `${slug}-nope`)).toBeNull();
    expect(await loadBrand(db, '')).toBeNull();
  });
});
