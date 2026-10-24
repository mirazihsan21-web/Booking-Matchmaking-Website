import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrganization } from '@/lib/orgs/create-organization';
import { publishOrganization, setOrganizationStatus } from '@/lib/orgs/publish';
import { saveProfile, type ProfileInput } from '@/lib/profiles/save-profile';
import { createTestUser, deleteTestUser, serviceDb, signedInClient, type TestUser } from './helpers';

const db = serviceDb();
const users: TestUser[] = [];
const orgIds: string[] = [];
let liveOrg: string;
let onboardingOrg: string;
let suspendedOrg: string;
let activities: string[];
let lounge: string; // the live venue's own section, from onboarding
let turf: string; // a second section there
let foreignSection: string; // another venue's section

async function venue(owner: TestUser, state: 'live' | 'onboarding' | 'suspended'): Promise<string> {
  const created = await createOrganization(db, { userId: owner.id, businessType: 'gaming_lounge', name: `Lounge ${state}`, slug: `p-${state}-${randomUUID().slice(0, 6)}` });
  if (created.status !== 'created') throw new Error(created.status);
  orgIds.push(created.organizationId);
  if (state !== 'onboarding') await publishOrganization(db, created.organizationId);
  if (state === 'suspended') await setOrganizationStatus(db, created.organizationId, 'suspended');
  return created.organizationId;
}

async function player(): Promise<{ user: TestUser; client: SupabaseClient }> {
  const user = await createTestUser(db);
  users.push(user);
  return { user, client: await signedInClient(user.email, user.password) };
}

const input = (overrides: Partial<ProfileInput> = {}): ProfileInput => ({
  displayName: 'Rafi',
  phone: null,
  ratings: {},
  favourites: [],
  availability: [{ weekday: 5, start: '18:00', end: '23:00' }],
  emailOptIn: true,
  ...overrides,
});

beforeAll(async () => {
  const owner = await createTestUser(db);
  users.push(owner);
  liveOrg = await venue(owner, 'live');
  onboardingOrg = await venue(owner, 'onboarding');
  suspendedOrg = await venue(owner, 'suspended');
  const { data } = await db.from('activities').select('id, name').eq('organization_id', liveOrg).order('name');
  activities = data!.map((a) => a.id);
  lounge = (await db.from('sections').select('id').eq('organization_id', liveOrg).single()).data!.id;
  turf = (await db.rpc('add_section', { p_organization_id: liveOrg, p_kind: 'turf', p_name: 'Turf' })).data as string;
  foreignSection = (await db.from('sections').select('id').eq('organization_id', suspendedOrg).single()).data!.id;
});

const ratingsOf = async (client: SupabaseClient, profileId: string) =>
  ((await client.from('profile_section_skills').select('section_id, skill').eq('profile_id', profileId)).data ?? []).sort((x, y) => x.skill - y.skill);

afterAll(async () => {
  await db.from('organizations').delete().in('id', orgIds);
  for (const u of users) await deleteTestUser(db, u.id);
});

describe('saveProfile', () => {
  it('creates and then updates a profile in a live venue', async () => {
    const { user, client } = await player();
    const first = await saveProfile(client, { userId: user.id, organizationId: liveOrg, input: input() });
    expect(first.status).toBe('saved');
    const second = await saveProfile(client, { userId: user.id, organizationId: liveOrg, input: input({ displayName: 'Rafi H.' }) });
    expect(second).toEqual(first);

    const { data } = await client.from('player_profiles').select('*').eq('organization_id', liveOrg).single();
    expect(data).toMatchObject({ display_name: 'Rafi H.' });
    expect(data).not.toHaveProperty('skill'); // levels are per section now
    const { data: avail } = await client.from('availability').select('weekday, start_time, end_time');
    expect(avail).toEqual([{ weekday: 5, start_time: '18:00:00', end_time: '23:00:00' }]);
  });

  it('refuses a venue that is still onboarding (Review Focus 3)', async () => {
    const { user, client } = await player();
    expect(await saveProfile(client, { userId: user.id, organizationId: onboardingOrg, input: input() })).toEqual({ status: 'unavailable' });
  });

  it('refuses new profiles at a suspended venue', async () => {
    const { user, client } = await player();
    expect(await saveProfile(client, { userId: user.id, organizationId: suspendedOrg, input: input() })).toEqual({ status: 'unavailable' });
  });

  it("can't read another player's profile", async () => {
    const a = await player();
    const b = await player();
    await saveProfile(a.client, { userId: a.user.id, organizationId: liveOrg, input: input({ displayName: 'A' }) });
    await saveProfile(b.client, { userId: b.user.id, organizationId: liveOrg, input: input({ displayName: 'B' }) });
    const { data } = await b.client.from('player_profiles').select('display_name');
    expect(data).toEqual([{ display_name: 'B' }]);
  });

  it("keeps one rating per section, each save replacing the last, and ignores other venues' sections", async () => {
    const { user, client } = await player();
    const saved = await saveProfile(client, { userId: user.id, organizationId: liveOrg, input: input({ ratings: { [lounge]: 4, [turf]: 2 } }) });
    if (saved.status !== 'saved') throw new Error(saved.status);
    expect(await ratingsOf(client, saved.profileId)).toEqual([
      { section_id: turf, skill: 2 },
      { section_id: lounge, skill: 4 },
    ]);
    await saveProfile(client, { userId: user.id, organizationId: liveOrg, input: input({ ratings: { [turf]: 5, [foreignSection]: 3 } }) });
    expect(await ratingsOf(client, saved.profileId)).toEqual([{ section_id: turf, skill: 5 }]);
  });

  it('stores favourites in rank order and ignores ids from other venues', async () => {
    const { user, client } = await player();
    const favourites = [activities[2]!, randomUUID(), activities[0]!];
    const saved = await saveProfile(client, { userId: user.id, organizationId: liveOrg, input: input({ favourites }) });
    if (saved.status !== 'saved') throw new Error(saved.status);
    const { data } = await client.from('profile_activities').select('activity_id, rank').eq('profile_id', saved.profileId).order('rank');
    expect(data).toEqual([
      { activity_id: activities[2], rank: 1 },
      { activity_id: activities[0], rank: 2 },
    ]);
  });

  it('reports a phone number another player at the venue already uses', async () => {
    const a = await player();
    const b = await player();
    await saveProfile(a.client, { userId: a.user.id, organizationId: liveOrg, input: input({ phone: '+8801712345601' }) });
    expect(await saveProfile(b.client, { userId: b.user.id, organizationId: liveOrg, input: input({ phone: '+8801712345601' }) })).toEqual({ status: 'phone_taken' });
  });
});
