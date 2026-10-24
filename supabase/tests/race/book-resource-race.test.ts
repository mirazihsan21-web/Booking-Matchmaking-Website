import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Two real connections booking at the same moment. Connection A holds its transaction open while B
// tries; B must wait for A and then lose cleanly. Needs the local Supabase stack: `pnpm db:start`.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ids = {
  user1: randomUUID(),
  user2: randomUUID(),
  org: randomUUID(),
  branch: randomUUID(),
  pitch: randomUUID(),
  profile1: randomUUID(),
  profile2: randomUUID(),
};
/** HH:MM in Dhaka on a day 30 days ahead, so the fixtures never age out (the limit counts against now()). */
const day = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
const at = (hhmm: string) => `${day} ${hhmm}+06`;

const setup = new pg.Client({ connectionString: DB_URL });
const a = new pg.Client({ connectionString: DB_URL });
const b = new pg.Client({ connectionString: DB_URL });

const book = (client: pg.Client, profile: string, at: string, by: string) =>
  client
    .query(`select status from public.book_resource($1, $2, $3::timestamptz, 1, $4, null, null, $5)`, [ids.org, ids.pitch, at, profile, by])
    .then((r) => r.rows[0].status as string);

/** Starts B's call, checks it is still waiting on A after 200 ms, then lets A commit and returns B's answer. */
async function raceAgainstOpenTransaction(first: () => Promise<string>, second: () => Promise<string>) {
  await a.query('begin');
  expect(await first()).toBe('booked');
  let settled = false;
  const pending = second().then((status) => {
    settled = true;
    return status;
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(settled).toBe(false); // B waits for A
  await a.query('commit');
  return pending;
}

beforeAll(async () => {
  await Promise.all([setup.connect(), a.connect(), b.connect()]);
  const run = (sql: string, params: unknown[]) => setup.query(sql, params);
  await run(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [ids.user1, `${ids.user1}@race.test`, ids.user2, `${ids.user2}@race.test`]);
  await run(
    `insert into public.organizations (id, slug, name, business_type, status) values ($1, $2, 'Race Turf', 'turf', 'live')`,
    [ids.org, `race-${ids.org.slice(0, 8)}`],
  );
  await run(`insert into public.sections (id, organization_id, name, kind, slug, max_upcoming_bookings) values ($1, $2, 'Main', 'turf', 'main', 1)`, [ids.branch, ids.org]);
  await run(
    `insert into public.resources (id, organization_id, section_id, name, kind, capacity, price_per_hour_poisha) values ($1, $2, $3, 'Pitch 1', 'pitch', 14, 250000)`,
    [ids.pitch, ids.org, ids.branch],
  );
  await run(
    `insert into public.player_profiles (id, organization_id, user_id, display_name) values ($1, $2, $3, 'One'), ($4, $2, $5, 'Two')`,
    [ids.profile1, ids.org, ids.user1, ids.profile2, ids.user2],
  );
});

afterAll(async () => {
  await setup.query(`delete from public.organizations where id = $1`, [ids.org]);
  await setup.query(`delete from auth.users where id in ($1, $2)`, [ids.user1, ids.user2]);
  await Promise.all([setup.end(), a.end(), b.end()]);
});

describe('book_resource under concurrency', () => {
  it('gives a slot to exactly one of two players booking at once', async () => {
    const second = await raceAgainstOpenTransaction(
      () => book(a, ids.profile1, at('20:00'), ids.user1),
      () => book(b, ids.profile2, at('20:00'), ids.user2),
    );
    expect(second).toBe('taken');
  });

  it('cannot beat the upcoming-bookings limit with two bookings at once', async () => {
    // The venue allows 1 upcoming booking; player two has none yet and tries two slots at once.
    const second = await raceAgainstOpenTransaction(
      () => book(a, ids.profile2, at('21:00'), ids.user2),
      () => book(b, ids.profile2, at('22:00'), ids.user2),
    );
    expect(second).toBe('limit_reached');
  });
});
