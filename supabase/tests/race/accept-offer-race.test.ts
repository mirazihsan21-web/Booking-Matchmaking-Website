import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Two real connections accepting the same offer at once (an email-link retry racing an in-app tap).
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
const a = new pg.Client({ connectionString: DB_URL });
const b = new pg.Client({ connectionString: DB_URL });

beforeAll(async () => {
  await Promise.all([setup.connect(), a.connect(), b.connect()]);
  // Parameterised queries must be single statements, so fixtures go in one at a time.
  const run = (sql: string, params: unknown[]) => setup.query(sql, params);
  await run(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [
    ids.owner,
    `${ids.owner}@race.test`,
    ids.playerUser,
    `${ids.playerUser}@race.test`,
  ]);
  await run(
    `insert into public.organizations (id, slug, name, business_type, created_by) values ($1, $2, 'Race Café', 'boardgame_cafe', $3)`,
    [ids.org, `race-${ids.org.slice(0, 8)}`, ids.owner],
  );
  await run(`insert into public.sections (id, organization_id, name, kind, slug) values ($1, $2, 'Main', 'turf', 'main')`, [ids.branch, ids.org]);
  await run(
    `insert into public.resources (id, organization_id, section_id, name, kind, capacity) values ($1, $2, $3, 'Table 1', 'table', 4)`,
    [ids.resource, ids.org, ids.branch],
  );
  await run(
    `insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min) values ($1, $2, $3, 'Azul', 2, 4, 40)`,
    [ids.activity, ids.org, ids.branch],
  );
  await run(
    `insert into public.open_play_sessions (id, organization_id, section_id, starts_at, ends_at, seat_price_poisha)
     values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 4 hours', 80000)`,
    [ids.session, ids.org, ids.branch],
  );
  await run(
    `insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity) values ($1, $2, $3, $4, $5, 4)`,
    [ids.group, ids.org, ids.session, ids.resource, ids.activity],
  );
  await run(
    `insert into public.player_profiles (id, organization_id, user_id, display_name) values ($1, $2, $3, 'Racer R.')`,
    [ids.profile, ids.org, ids.playerUser],
  );
  await run(
    `insert into public.waitlist_entries (id, organization_id, session_id, profile_id, queue_position) values ($1, $2, $3, $4, 1)`,
    [ids.entry, ids.org, ids.session, ids.profile],
  );
  const offer = await run(`select public.create_offer($1, 1::smallint, $2) as id`, [ids.group, ids.entry]);
  offerId = offer.rows[0].id;
});

afterAll(async () => {
  await setup.query(`delete from public.organizations where id = $1`, [ids.org]); // cascades to everything else
  await setup.query(`delete from auth.users where id in ($1, $2)`, [ids.owner, ids.playerUser]);
  await Promise.all([setup.end(), a.end(), b.end()]);
});

describe('accept_offer under concurrency', () => {
  it('serialises concurrent YES replies into exactly one booking', async () => {
    await a.query('begin');
    const first = await a.query('select public.accept_offer($1) as result', [offerId]);
    expect(first.rows[0].result).toBe('accepted');

    let settled = false;
    const second = b.query('select public.accept_offer($1) as result', [offerId]).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(settled).toBe(false); // B is blocked on A's row lock

    await a.query('commit');
    expect((await second).rows[0].result).toBe('already_accepted');

    const live = await setup.query(
      `select count(*)::int as n from public.bookings where session_id = $1 and profile_id = $2 and status <> 'cancelled'`,
      [ids.session, ids.profile],
    );
    expect(live.rows[0].n).toBe(1);
  });
});
