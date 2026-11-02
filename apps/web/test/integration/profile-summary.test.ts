import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listMySeats } from '@/lib/open-play/open-play';
import { summariseProfile } from '@/lib/profiles/summary';
import { createTestUser, deleteTestUser, serviceDb, type TestUser } from './helpers';

const db = serviceDb();
let user: TestUser;
let orgId: string;
let profileId: string;

const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
};

const GAMES = 22;

beforeAll(async () => {
  user = await createTestUser(db);
  orgId = must(await db.from('organizations').insert({ slug: `ps-${randomUUID().slice(0, 8)}`, name: 'Profile Turf', business_type: 'turf', status: 'live' }).select('id').single()).id;
  const section = must(await db.from('sections').insert({ organization_id: orgId, name: 'Turf', kind: 'turf', slug: 'turf' }).select('id').single());
  const pitch = must(await db.from('resources').insert({ organization_id: orgId, section_id: section.id, name: 'Pitch 1', kind: 'pitch', capacity: 14 }).select('id').single());
  const activity = must(
    await db
      .from('activities')
      .insert({ organization_id: orgId, section_id: section.id, name: '5-a-side', min_players: 2, max_players: 10, duration_min: 60, team_mode: 'none' })
      .select('id')
      .single(),
  );
  profileId = must(await db.from('player_profiles').insert({ organization_id: orgId, user_id: user.id, display_name: 'Regular' }).select('id').single()).id;
  // A regular: one seat in each of 22 games played over the past 22 days.
  for (let day = 1; day <= GAMES; day += 1) {
    const starts = new Date(Date.now() - day * 86_400_000);
    const session = must(
      await db
        .from('open_play_sessions')
        .insert({
          organization_id: orgId,
          section_id: section.id,
          activity_id: activity.id,
          starts_at: starts.toISOString(),
          ends_at: new Date(starts.getTime() + 3_600_000).toISOString(),
          seat_price_poisha: 30000,
          status: 'closed',
        })
        .select('id')
        .single(),
    );
    const group = must(
      await db.from('groups').insert({ organization_id: orgId, session_id: session.id, resource_id: pitch.id, activity_id: activity.id, capacity: 10 }).select('id').single(),
    );
    must(await db.from('bookings').insert({ organization_id: orgId, session_id: session.id, group_id: group.id, profile_id: profileId, seat_no: 1, price_poisha: 30000 }).select('id'));
  }
});

afterAll(async () => {
  await db.from('organizations').delete().eq('id', orgId);
  await deleteTestUser(db, user.id);
});

describe('the profile counts every game played (final review, Important 1)', () => {
  it('My bookings still lists the 20 most recent past seats', async () => {
    expect((await listMySeats(db, { organizationId: orgId, profileId })).past).toHaveLength(20);
  });

  it('the profile reads all of them, so a regular with 22 games sees 22', async () => {
    const seats = await listMySeats(db, { organizationId: orgId, profileId, pastLimit: null });
    expect(seats.past).toHaveLength(GAMES);
    expect(summariseProfile([], [...seats.upcoming, ...seats.past], new Date()).gamesPlayed).toBe(GAMES);
  });
});
