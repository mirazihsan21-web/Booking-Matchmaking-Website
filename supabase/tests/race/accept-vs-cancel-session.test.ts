import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A player takes a seat offer at the moment staff cancel the whole session. Whatever the order, the
// session must not end up cancelled with a confirmed seat in it (nobody could cancel that seat later).
// Needs the local Supabase stack: `pnpm db:start`.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ids = {
  owner: randomUUID(),
  playerUser: randomUUID(),
  org: randomUUID(),
  branch: randomUUID(),
  resource: randomUUID(),
  activity: randomUUID(),
  session: randomUUID(),
  group: randomUUID(),
  profile: randomUUID(),
  entry: randomUUID(),
};
let offerId = '';
const setup = new pg.Client({ connectionString: DB_URL });
const staff = new pg.Client({ connectionString: DB_URL });
const player = new pg.Client({ connectionString: DB_URL });

beforeAll(async () => {
  await Promise.all([setup.connect(), staff.connect(), player.connect()]);
  const run = (sql: string, params: unknown[]) => setup.query(sql, params);
  await run(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [ids.owner, `${ids.owner}@race.test`, ids.playerUser, `${ids.playerUser}@race.test`]);
  await run(`insert into public.organizations (id, slug, name, business_type, created_by) values ($1, $2, 'Race Turf', 'turf', $3)`, [
    ids.org,
    `race-${ids.org.slice(0, 8)}`,
    ids.owner,
  ]);
  await run(`insert into public.branches (id, organization_id, name) values ($1, $2, 'Main')`, [ids.branch, ids.org]);
  await run(`insert into public.resources (id, organization_id, branch_id, name, kind, capacity) values ($1, $2, $3, 'Table 1', 'table', 4)`, [
    ids.resource,
    ids.org,
    ids.branch,
  ]);
  await run(`insert into public.activities (id, organization_id, name, min_players, max_players, duration_min) values ($1, $2, 'Azul', 2, 4, 40)`, [
    ids.activity,
    ids.org,
  ]);
  await run(
    `insert into public.open_play_sessions (id, organization_id, branch_id, starts_at, ends_at, seat_price_poisha, status)
     values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 4 hours', 80000, 'matched')`,
    [ids.session, ids.org, ids.branch],
  );
  await run(`insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity) values ($1, $2, $3, $4, $5, 4)`, [
    ids.group,
    ids.org,
    ids.session,
    ids.resource,
    ids.activity,
  ]);
  await run(`insert into public.player_profiles (id, organization_id, user_id, display_name, skill) values ($1, $2, $3, 'Racer R.', 3)`, [
    ids.profile,
    ids.org,
    ids.playerUser,
  ]);
  await run(`insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position) values ($1, $2, $3, $4, 1)`, [
    ids.entry,
    ids.org,
    ids.session,
    ids.profile,
  ]);
  offerId = (await run(`select public.create_offer($1, 1::smallint, $2) as id`, [ids.group, ids.entry])).rows[0].id;
});

afterAll(async () => {
  await setup.query(`delete from public.organizations where id = $1`, [ids.org]);
  await setup.query(`delete from auth.users where id in ($1, $2)`, [ids.owner, ids.playerUser]);
  await Promise.all([setup.end(), staff.end(), player.end()]);
});

describe('accept_offer against cancel_open_play_session', () => {
  it('never leaves a confirmed seat in a cancelled session', async () => {
    await player.query('begin');
    expect((await player.query('select public.accept_offer($1) as result', [offerId])).rows[0].result).toBe('accepted');

    const cancelled = staff.query('select public.cancel_open_play_session($1) as result', [ids.session]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await player.query('commit');
    expect((await cancelled).rows[0].result).toBe('cancelled');

    const live = await setup.query(`select count(*)::int as n from public.bookings where session_id = $1 and status = 'confirmed'`, [ids.session]);
    expect(live.rows[0].n).toBe(0);
  });
});
