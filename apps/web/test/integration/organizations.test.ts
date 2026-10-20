import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSlug, createOrganization } from '@/lib/orgs/create-organization';
import { publishOrganization, setOrganizationStatus } from '@/lib/orgs/publish';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
const orgIds: string[] = [];
let owner: TestUser;
const suffix = () => randomUUID().slice(0, 6);

async function created(input: Parameters<typeof createOrganization>[1]) {
  const result = await createOrganization(db, input);
  if (result.status !== 'created') throw new Error(`expected created, got ${result.status}`);
  orgIds.push(result.organizationId);
  return result;
}

beforeAll(async () => {
  owner = await createTestUser(db);
});

afterAll(async () => {
  if (orgIds.length) await db.from('organizations').delete().in('id', orgIds);
  await deleteTestUser(db, owner.id);
});

describe('createOrganization', () => {
  it('creates a turf venue with the preset pitches, court and three formats', async () => {
    const { organizationId } = await created({ userId: owner.id, businessType: 'turf', name: 'Dhanmondi Turf', slug: `dhanmondi-${suffix()}` });

    const { data: org } = await db.from('organizations').select('status, business_type, branding, created_by').eq('id', organizationId).single();
    expect(org).toMatchObject({ status: 'onboarding', business_type: 'turf', created_by: owner.id, branding: { primary: '#15803D', accent: '#FACC15' } });

    const { data: members } = await db.from('organization_members').select('user_id, role').eq('organization_id', organizationId);
    expect(members).toEqual([{ user_id: owner.id, role: 'owner' }]);

    const { data: branches } = await db.from('branches').select('id, name').eq('organization_id', organizationId);
    expect(branches).toHaveLength(1);
    expect(branches![0]!.name).toBe('Dhanmondi Turf');

    const { data: resources } = await db.from('resources').select('name, kind, capacity, price_per_hour_poisha, branch_id').eq('organization_id', organizationId);
    expect(resources).toHaveLength(3);
    expect(resources!.every((r) => r.branch_id === branches![0]!.id)).toBe(true);
    expect(resources!.find((r) => r.name === 'Pitch 1')).toMatchObject({ kind: 'pitch', capacity: 14, price_per_hour_poisha: 250000 });

    const { data: activities } = await db.from('activities').select('name, team_mode, team_size').eq('organization_id', organizationId);
    expect(activities!.map((a) => a.name).sort()).toEqual(['5-a-side futsal', '7-a-side', 'Badminton doubles']);
  });

  it('normalises the slug', async () => {
    const tag = suffix();
    const result = await created({ userId: owner.id, businessType: 'gaming_lounge', name: 'Gulshan PC Zone', slug: `  Gulshan PC ${tag} ` });
    expect(result.slug).toBe(`gulshan-pc-${tag}`);
  });

  it('reports slug_taken case-insensitively (Review Focus 1)', async () => {
    const slug = `taken-${suffix()}`;
    await created({ userId: owner.id, businessType: 'boardgame_cafe', name: 'First Café', slug });
    const again = await createOrganization(db, { userId: owner.id, businessType: 'boardgame_cafe', name: 'Second Café', slug: slug.toUpperCase() });
    expect(again).toEqual({ status: 'slug_taken' });
  });

  it('rejects reserved and malformed slugs', async () => {
    expect(await createOrganization(db, { userId: owner.id, businessType: 'turf', name: 'Admin Turf', slug: 'admin' })).toEqual({ status: 'invalid_slug', reason: 'reserved' });
    expect(await createOrganization(db, { userId: owner.id, businessType: 'turf', name: 'Bad Turf', slug: '-bad' })).toEqual({ status: 'invalid_slug', reason: 'format' });
  });

  it('rejects a blank name', async () => {
    expect(await createOrganization(db, { userId: owner.id, businessType: 'turf', name: '  ', slug: `blank-${suffix()}` })).toEqual({ status: 'invalid_name' });
  });
});

describe('checkSlug', () => {
  it('reports available, taken and invalid slugs', async () => {
    const slug = `check-${suffix()}`;
    expect(await checkSlug(db, ` ${slug.toUpperCase()} `)).toEqual({ status: 'available', slug });
    await created({ userId: owner.id, businessType: 'turf', name: 'Check Turf', slug });
    expect(await checkSlug(db, slug)).toEqual({ status: 'slug_taken' });
    expect(await checkSlug(db, 'www')).toEqual({ status: 'invalid_slug', reason: 'reserved' });
  });
});

describe('publishOrganization', () => {
  it('makes a complete venue live', async () => {
    const { organizationId } = await created({ userId: owner.id, businessType: 'turf', name: 'Live Turf', slug: `live-${suffix()}` });
    expect(await publishOrganization(db, organizationId)).toEqual({ status: 'live' });
    const { data } = await db.from('organizations').select('status').eq('id', organizationId).single();
    expect(data?.status).toBe('live');
  });

  it('reports what is missing', async () => {
    const { organizationId } = await created({ userId: owner.id, businessType: 'turf', name: 'Empty Turf', slug: `empty-${suffix()}` });
    await db.from('resources').update({ active: false }).eq('organization_id', organizationId);
    expect(await publishOrganization(db, organizationId)).toEqual({ status: 'not_ready', missing: ['resource'] });
  });

  it('does not republish a suspended venue', async () => {
    const { organizationId } = await created({ userId: owner.id, businessType: 'turf', name: 'Banned Turf', slug: `banned-${suffix()}` });
    await setOrganizationStatus(db, organizationId, 'suspended');
    expect(await publishOrganization(db, organizationId)).toEqual({ status: 'suspended' });
  });
});
