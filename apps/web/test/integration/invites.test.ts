import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { completeSignIn } from '@/lib/auth/complete-sign-in';
import { acceptPendingInvites, cancelInvite, inviteMember } from '@/lib/orgs/invites';
import { anonClient, createTestUser, deleteTestUser, emailLinkTo, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
const users: string[] = [];
let owner: TestUser;
let orgId: string;
let turf: string;
let cafe: string;

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
  turf = (await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'turf', p_name: 'Turf' })).data as string;
  cafe = (await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'boardgame_cafe', p_name: 'Café' })).data as string;
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  for (const id of users) await deleteTestUser(db, id);
});

describe('staff invites', () => {
  it('an invite becomes a membership when that email signs in', async () => {
    const email = `New.Staff+${randomUUID().slice(0, 6)}@Example.test`;
    const result = await inviteMember(db, { organizationId: orgId, email, role: 'staff', sectionIds: [turf], invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
    expect(result.status).toBe('invited');

    const staffId = await userIdByEmail(email.toLowerCase()); // inviteUserByEmail created the account
    users.push(staffId);
    expect(await acceptPendingInvites(db, staffId, email.toLowerCase())).toBe(1);

    const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', staffId).single();
    expect(data?.role).toBe('staff');
    const { data: sections } = await db.from('section_staff').select('section_id').eq('user_id', staffId);
    expect(sections).toEqual([{ section_id: turf }]); // only the section the owner ticked
  });

  it('a staff invite must name a section of this venue; an owner invite names none', async () => {
    const email = `nosec-${randomUUID().slice(0, 8)}@example.test`;
    const base = { organizationId: orgId, email, invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' };
    expect(await inviteMember(db, { ...base, role: 'staff', sectionIds: [] })).toEqual({ status: 'no_sections' });
    expect(await inviteMember(db, { ...base, role: 'staff', sectionIds: [randomUUID()] })).toEqual({ status: 'no_sections' });
    expect((await inviteMember(db, { ...base, role: 'owner', sectionIds: [turf, cafe] })).status).toBe('invited');
    users.push(await userIdByEmail(email));
    const { data } = await db.from('organization_invites').select('role, section_ids').eq('organization_id', orgId).eq('email', email).single();
    expect(data).toEqual({ role: 'owner', section_ids: [] });
  });

  it('an accepted invite skips a section deleted since it was sent', async () => {
    const user = await createTestUser(db);
    users.push(user.id);
    const lounge = (await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'gaming_lounge', p_name: 'Lounge' })).data as string;
    await inviteMember(db, { organizationId: orgId, email: user.email, role: 'staff', sectionIds: [turf, lounge], invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
    await db.from('sections').delete().eq('id', lounge);
    expect(await acceptPendingInvites(db, user.id, user.email)).toBe(1);
    const { data } = await db.from('section_staff').select('section_id').eq('user_id', user.id);
    expect(data).toEqual([{ section_id: turf }]);
  });

  it('the invite email signs the invitee in on the root site, and the invite becomes a membership', async () => {
    const email = `invitee-${randomUUID().slice(0, 8)}@example.test`;
    const result = await inviteMember(db, { organizationId: orgId, email, role: 'staff', sectionIds: [turf], invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback?next=/manage' });
    expect(result).toEqual({ status: 'invited', emailSent: true });
    users.push(await userIdByEmail(email));

    // What the invitee clicks: our callback with a one-time token hash (PKCE can't be used for admin invites)
    const link = await emailLinkTo(email);
    expect(`${link.origin}${link.pathname}`).toBe('http://localhost:3000/auth/callback');
    expect(link.searchParams.get('type')).toBe('invite');
    expect(link.searchParams.get('next')).toBe('/manage');

    const browser = anonClient();
    expect(await completeSignIn(browser, link.searchParams)).toBe(true);
    const { data } = await browser.auth.getUser();
    expect(data.user?.email).toBe(email);
    expect(await acceptPendingInvites(db, data.user!.id, email)).toBe(1);
  });

  it('a cancelled invite (say, a mistyped address) is never accepted', async () => {
    const email = `typo-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(db, { organizationId: orgId, email, role: 'staff', sectionIds: [turf], invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
    const strangerId = await userIdByEmail(email);
    users.push(strangerId);
    const { data: invite } = await db.from('organization_invites').select('id').eq('organization_id', orgId).eq('email', email).single();

    expect(await cancelInvite(db, randomUUID(), invite!.id)).toBe('not_found'); // only from its own venue
    expect(await cancelInvite(db, orgId, invite!.id)).toBe('cancelled');
    expect(await cancelInvite(db, orgId, invite!.id)).toBe('not_found');
    expect(await acceptPendingInvites(db, strangerId, email)).toBe(0);
  });

  it('acceptance is idempotent', async () => {
    const user = await createTestUser(db);
    users.push(user.id);
    await inviteMember(db, { organizationId: orgId, email: user.email, role: 'staff', sectionIds: [turf], invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
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
      section_ids: [turf],
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await acceptPendingInvites(db, user.id, user.email)).toBe(0);
  });

  it('inviting an existing member reports already_member', async () => {
    const result = await inviteMember(db, { organizationId: orgId, email: owner.email.toUpperCase(), role: 'staff', sectionIds: [turf], invitedBy: owner.id, redirectTo: 'http://localhost:3000/auth/callback' });
    expect(result.status).toBe('already_member');
  });
});
