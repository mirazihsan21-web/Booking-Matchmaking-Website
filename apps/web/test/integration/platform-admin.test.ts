import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPlatformAdmin, listOrganizations } from '@/lib/admin/platform';
import { createOrganization } from '@/lib/orgs/create-organization';
import { publishOrganization, setOrganizationStatus } from '@/lib/orgs/publish';
import { anonClient, createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
let owner: TestUser;
let admin: TestUser;
let orgId: string;
let slug: string;

beforeAll(async () => {
  owner = await createTestUser(db);
  admin = await createTestUser(db);
  const created = await createOrganization(db, { userId: owner.id, businessType: 'turf', name: 'Admin Turf', slug: `adm-${randomUUID().slice(0, 6)}` });
  if (created.status !== 'created') throw new Error(created.status);
  orgId = created.organizationId;
  slug = created.slug;
  await publishOrganization(db, orgId);
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  await deleteTestUser(db, owner.id);
  await deleteTestUser(db, admin.id);
});

describe('platform admin', () => {
  it('a normal user is not a platform admin', async () => {
    expect(await isPlatformAdmin(db, owner.id)).toBe(false);
  });

  it('a granted user is', async () => {
    await db.from('platform_admins').insert({ user_id: admin.id });
    expect(await isPlatformAdmin(db, admin.id)).toBe(true);
  });

  it("lists organizations with the owner's email", async () => {
    const org = (await listOrganizations(db)).find((o) => o.id === orgId);
    expect(org).toMatchObject({ slug, name: 'Admin Turf', businessType: 'turf', status: 'live', ownerEmail: owner.email });
  });

  it('suspending hides the venue from visitors', async () => {
    const visitor = anonClient();
    expect((await visitor.from('organizations').select('id').eq('slug', slug)).data).toHaveLength(1);
    await setOrganizationStatus(db, orgId, 'suspended');
    expect((await visitor.from('organizations').select('id').eq('slug', slug)).data).toHaveLength(0);
  });
});
