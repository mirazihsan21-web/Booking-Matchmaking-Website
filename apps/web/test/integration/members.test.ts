import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeRole, listMembers, removeMember, setStaffSections } from '@/lib/orgs/members';
import { recordPayment } from '@/lib/payments/payments';
import { allowedSectionIds, canManageSection } from '@/lib/tenancy/sections-access';
import { createTestUser, deleteTestUser, serviceDb, signedInClient, type TestUser } from './helpers';

const db = serviceDb();
const users: TestUser[] = [];
let orgId: string;
let turf: string;
let cafe: string;
let otherOrgId: string | undefined;

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
  turf = (await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'turf', p_name: 'Turf' })).data as string;
  cafe = (await db.rpc('add_section', { p_organization_id: orgId, p_kind: 'boardgame_cafe', p_name: 'Café' })).data as string;
});

const sectionsOf = async (userId: string) =>
  ((await db.from('section_staff').select('section_id').eq('user_id', userId)).data ?? []).map((r) => r.section_id).sort();

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  if (otherOrgId) await db.from('organizations').delete().eq('id', otherOrgId);
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

describe('staff per section', () => {
  it('an owner made staff gets every section, and staff made owner lose their section rows', async () => {
    const second = await user();
    await addMember(second.id, 'owner');
    expect(await changeRole(db, orgId, second.id, 'staff')).toEqual({ status: 'ok' });
    expect(await sectionsOf(second.id)).toEqual([turf, cafe].sort());
    expect(await changeRole(db, orgId, second.id, 'owner')).toEqual({ status: 'ok' });
    expect(await sectionsOf(second.id)).toEqual([]);
  });

  it('staff manage only their sections; the owner manages all of them', async () => {
    const staff = await user();
    await addMember(staff.id, 'staff');
    must(await db.from('section_staff').insert({ organization_id: orgId, section_id: turf, user_id: staff.id }));
    const owner = users[0]!;
    expect(await canManageSection(db, { organizationId: orgId, userId: staff.id, sectionId: turf })).toBe(true);
    expect(await canManageSection(db, { organizationId: orgId, userId: staff.id, sectionId: cafe })).toBe(false);
    expect(await canManageSection(db, { organizationId: orgId, userId: owner.id, sectionId: cafe })).toBe(true);
    expect(await allowedSectionIds(db, { organizationId: orgId, userId: owner.id })).toEqual([turf, cafe]);
    expect(await allowedSectionIds(db, { organizationId: orgId, userId: staff.id })).toEqual([turf]);
  });

  it("someone outside the team, or another venue's section, is never allowed", async () => {
    const stranger = await user();
    expect(await canManageSection(db, { organizationId: orgId, userId: stranger.id, sectionId: turf })).toBe(false);
    expect(await allowedSectionIds(db, { organizationId: orgId, userId: stranger.id })).toEqual([]);
    expect(await canManageSection(db, { organizationId: randomUUID(), userId: users[0]!.id, sectionId: turf })).toBe(false);
    expect(await canManageSection(db, { organizationId: orgId, userId: users[0]!.id, sectionId: 'nope' })).toBe(false);
  });
});

describe('setStaffSections (Review Focus 4)', () => {
  it('replaces the sections a staff member runs', async () => {
    const staff = await user();
    await addMember(staff.id, 'staff');
    expect(await setStaffSections(db, { organizationId: orgId, userId: staff.id, sectionIds: [turf, cafe] })).toBe('saved');
    expect(await sectionsOf(staff.id)).toEqual([turf, cafe].sort());
    expect(await setStaffSections(db, { organizationId: orgId, userId: staff.id, sectionIds: [cafe] })).toBe('saved');
    expect(await sectionsOf(staff.id)).toEqual([cafe]);
  });

  it('refuses no sections, another brand\'s section and an owner, changing nothing', async () => {
    const staff = await user();
    await addMember(staff.id, 'staff');
    must(await db.from('section_staff').insert({ organization_id: orgId, section_id: turf, user_id: staff.id }));
    const other = must(await db.from('organizations').insert({ slug: `members-x-${randomUUID().slice(0, 8)}`, name: 'Other', business_type: 'turf' }).select('id').single()).data!;
    otherOrgId = other.id;
    const otherSection = (await db.rpc('add_section', { p_organization_id: other.id, p_kind: 'turf', p_name: 'Turf' })).data as string;
    expect(await setStaffSections(db, { organizationId: orgId, userId: staff.id, sectionIds: [] })).toBe('none_selected');
    expect(await setStaffSections(db, { organizationId: orgId, userId: staff.id, sectionIds: [cafe, otherSection] })).toBe('invalid_section');
    expect(await setStaffSections(db, { organizationId: orgId, userId: staff.id, sectionIds: ['nope'] })).toBe('invalid_section');
    expect(await sectionsOf(staff.id)).toEqual([turf]);
    const owner = (await listMembers(db, orgId)).find((m) => m.role === 'owner')!;
    expect(await setStaffSections(db, { organizationId: orgId, userId: owner.userId, sectionIds: [turf] })).toBe('not_staff');
    expect(await sectionsOf(owner.userId)).toEqual([]);
  });

  it('a signed-in staff member narrowed to Turf can no longer take cash for the café', async () => {
    const staff = await user();
    await addMember(staff.id, 'staff');
    expect(await setStaffSections(db, { organizationId: orgId, userId: staff.id, sectionIds: [turf, cafe] })).toBe('saved');
    const table = must(await db.from('resources').insert({ organization_id: orgId, section_id: cafe, name: 'Table 1', kind: 'table', capacity: 4 }).select('id').single()).data!.id;
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const booking = async (fromH: number) =>
      must(
        await db
          .from('resource_bookings')
          .insert({ organization_id: orgId, resource_id: table, period: `[${at(fromH)},${at(fromH + 1)})`, price_poisha: 50000, guest_name: 'Walk-in', guest_phone: '01712345678' })
          .select('id')
          .single(),
      ).data!.id;
    const [first, second] = [await booking(24), await booking(26)];
    const client = await signedInClient(staff.email, staff.password);
    expect(await recordPayment(client, { kind: 'space', bookingId: first, amountPoisha: 50000 })).toBe('recorded');
    expect(await setStaffSections(db, { organizationId: orgId, userId: staff.id, sectionIds: [turf] })).toBe('saved');
    expect(await recordPayment(client, { kind: 'space', bookingId: second, amountPoisha: 50000 })).toBe('not_found');
    expect((await db.from('payments').select('id').eq('resource_booking_id', second)).data).toEqual([]);
  });
});

function must<T extends { error: unknown }>(result: T): T {
  if (result.error) throw result.error;
  return result;
}
