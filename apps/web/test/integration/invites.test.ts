import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acceptPendingInvites, inviteMember } from '@/lib/orgs/invites';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
const users: string[] = [];
let owner: TestUser;
let orgId: string;

async function userIdByEmail(email: string): Promise<string> {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`no user ${email}`);
  return user.id;
}

beforeAll(async () => {
  owner = await createTestUser(db);
  users.push(owner.id);
  const { data, error } = await db
    .from('organizations')
    .insert({ slug: `inv-${randomUUID().slice(0, 8)}`, name: 'Invite Turf', business_type: 'turf', created_by: owner.id })
    .select('id')
    .single();
  if (error) throw error;
  orgId = data.id;
  await db.from('organization_members').insert({ organization_id: orgId, user_id: owner.id, role: 'owner' });
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  for (const id of users) await deleteTestUser(db, id);
});

describe('staff invites', () => {
  it('an invite becomes a membership when that email signs in', async () => {
    const email = `New.Staff+${randomUUID().slice(0, 6)}@Example.test`;
    const result = await inviteMember(db, { organizationId: orgId, email, role: 'staff', invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
    expect(result.status).toBe('invited');

    const staffId = await userIdByEmail(email.toLowerCase()); // inviteUserByEmail created the account
    users.push(staffId);
    expect(await acceptPendingInvites(db, staffId, email.toLowerCase())).toBe(1);

    const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', staffId).single();
    expect(data?.role).toBe('staff');
  });

  it('acceptance is idempotent', async () => {
    const user = await createTestUser(db);
    users.push(user.id);
    await inviteMember(db, { organizationId: orgId, email: user.email, role: 'staff', invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
    expect(await acceptPendingInvites(db, user.id, user.email)).toBe(1);
    expect(await acceptPendingInvites(db, user.id, user.email)).toBe(0);
    const { count } = await db.from('organization_members').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
    expect(count).toBe(1);
  });

  it('expired invites are ignored', async () => {
    const user = await createTestUser(db);
    users.push(user.id);
    await db.from('organization_invites').insert({
      organization_id: orgId,
      email: user.email,
      role: 'staff',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await acceptPendingInvites(db, user.id, user.email)).toBe(0);
  });

  it('inviting an existing member reports already_member', async () => {
    const result = await inviteMember(db, { organizationId: orgId, email: owner.email.toUpperCase(), role: 'staff', invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
    expect(result.status).toBe('already_member');
  });
});
