import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeRole, listMembers, removeMember } from '@/lib/orgs/members';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
const users: TestUser[] = [];
let orgId: string;

async function user(): Promise<TestUser> {
  const u = await createTestUser(db);
  users.push(u);
  return u;
}

async function addMember(userId: string, role: 'owner' | 'staff') {
  const { error } = await db.from('organization_members').insert({ organization_id: orgId, user_id: userId, role });
  if (error) throw error;
}

beforeAll(async () => {
  const { data, error } = await db
    .from('organizations')
    .insert({ slug: `members-${randomUUID().slice(0, 8)}`, name: 'Members Turf', business_type: 'turf' })
    .select('id')
    .single();
  if (error) throw error;
  orgId = data.id;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  for (const u of users) await deleteTestUser(db, u.id);
});

describe('organization members (Review Focus 5)', () => {
  it('removing the only owner reports last_owner', async () => {
    const owner = await user();
    await addMember(owner.id, 'owner');
    expect(await removeMember(db, orgId, owner.id)).toEqual({ status: 'last_owner' });
  });

  it('demoting the only owner reports last_owner', async () => {
    const [onlyOwner] = (await listMembers(db, orgId)).filter((m) => m.role === 'owner');
    expect(await changeRole(db, orgId, onlyOwner!.userId, 'staff')).toEqual({ status: 'last_owner' });
  });

  it('with two owners, one can be removed', async () => {
    const second = await user();
    await addMember(second.id, 'owner');
    expect(await removeMember(db, orgId, second.id)).toEqual({ status: 'ok' });
  });

  it('staff can be removed', async () => {
    const staff = await user();
    await addMember(staff.id, 'staff');
    expect(await removeMember(db, orgId, staff.id)).toEqual({ status: 'ok' });
    const members = await listMembers(db, orgId);
    expect(members.map((m) => m.userId)).not.toContain(staff.id);
  });

  it('lists members with their emails', async () => {
    const members = await listMembers(db, orgId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: 'owner', email: users[0]!.email.toLowerCase() });
  });
});
