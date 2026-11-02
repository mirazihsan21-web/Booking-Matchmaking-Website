import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Two real connections on one "Need players" card at the same moment. Connection A holds its transaction open
// while B tries; B must wait for A and then lose cleanly. Needs the local Supabase stack: `pnpm db:start`.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ids = {
  poster: randomUUID(),
  one: randomUUID(),
  two: randomUUID(),
  org: randomUUID(),
  section: randomUUID(),
  pitch: randomUUID(),
  posterProfile: randomUUID(),
  oneProfile: randomUUID(),
  twoProfile: randomUUID(),
  booking: randomUUID(),
  otherBooking: randomUUID(),
  card: randomUUID(),
  otherCard: randomUUID(),
};

const setup = new pg.Client({ connectionString: DB_URL });
const a = new pg.Client({ connectionString: DB_URL });
const b = new pg.Client({ connectionString: DB_URL });

const accept = (client: pg.Client, profile: string) =>
  client
    .query(`select public.decide_join_request($1, $2, $3, true) as status`, [ids.card, ids.poster, profile])
    .then((r) => r.rows[0].status as string);
const ask = (client: pg.Client, card: string, user: string) =>
  client.query(`select public.request_to_join($1, $2) as status`, [card, user]).then((r) => r.rows[0].status as string);

/** Starts B's call, checks it is still waiting on A after 200 ms, then lets A commit and returns both answers. */
async function raceAgainstOpenTransaction(first: () => Promise<string>, second: () => Promise<string>) {
  await a.query('begin');
  const firstStatus = await first();
  let settled = false;
  const pending = second().then((status) => {
    settled = true;
    return status;
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(settled).toBe(false); // B waits for A
  await a.query('commit');
  return [firstStatus, await pending];
}

beforeAll(async () => {
  await Promise.all([setup.connect(), a.connect(), b.connect()]);
  const run = (sql: string, params: unknown[]) => setup.query(sql, params);
  await run(`insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)`, [
    ids.poster, `${ids.poster}@race.test`, ids.one, `${ids.one}@race.test`, ids.two, `${ids.two}@race.test`,
  ]);
  await run(`insert into public.organizations (id, slug, name, business_type, status) values ($1, $2, 'Race Chat', 'turf', 'live')`, [
    ids.org, `race-chat-${ids.org.slice(0, 8)}`,
  ]);
  await run(`insert into public.sections (id, organization_id, name, kind, slug) values ($1, $2, 'Turf', 'turf', 'turf')`, [ids.section, ids.org]);
  await run(`insert into public.resources (id, organization_id, section_id, name, kind, capacity) values ($1, $2, $3, 'Pitch 1', 'pitch', 14)`, [
    ids.pitch, ids.org, ids.section,
  ]);
  await run(
    `insert into public.player_profiles (id, organization_id, user_id, display_name) values ($1, $2, $3, 'Poster'), ($4, $2, $5, 'One'), ($6, $2, $7, 'Two')`,
    [ids.posterProfile, ids.org, ids.poster, ids.oneProfile, ids.one, ids.twoProfile, ids.two],
  );
  for (const [booking, hours] of [[ids.booking, 48], [ids.otherBooking, 72]] as const) {
    await run(
      `insert into public.resource_bookings (id, organization_id, resource_id, profile_id, period, price_poisha)
       values ($1, $2, $3, $4, tstzrange(now() + $5 * interval '1 hour', now() + ($5 + 1) * interval '1 hour'), 0)`,
      [booking, ids.org, ids.pitch, ids.posterProfile, hours],
    );
  }
  for (const [card, booking, spots] of [[ids.card, ids.booking, 1], [ids.otherCard, ids.otherBooking, 3]] as const) {
    await run(
      `insert into public.chat_cards (id, organization_id, kind, resource_booking_id, poster_user_id, poster_profile_id, poster_name,
         section_id, section_name, section_kind, section_accent, title, starts_at, ends_at, spots_needed)
       select $1, $2, 'booking', $3, $4, $5, 'Poster', $6, 'Turf', 'turf', '#43a66b', 'Pitch 1', lower(r.period), upper(r.period), $7
       from public.resource_bookings r where r.id = $3`,
      [card, ids.org, booking, ids.poster, ids.posterProfile, ids.section, spots],
    );
  }
  await run(`insert into public.chat_join_requests (organization_id, card_id, profile_id) values ($1, $2, $3), ($1, $2, $4)`, [
    ids.org, ids.card, ids.oneProfile, ids.twoProfile,
  ]);
});

afterAll(async () => {
  await setup.query(`delete from public.organizations where id = $1`, [ids.org]);
  await setup.query(`delete from auth.users where id in ($1, $2, $3)`, [ids.poster, ids.one, ids.two]);
  await Promise.all([setup.end(), a.end(), b.end()]);
});

describe('chat cards under concurrency', () => {
  it('never accepts past the spots when the poster taps Accept twice at once', async () => {
    const [first, second] = await raceAgainstOpenTransaction(() => accept(a, ids.oneProfile), () => accept(b, ids.twoProfile));
    expect([first, second]).toEqual(['accepted', 'full']);
    const { rows } = await setup.query(`select spots_taken, status from public.chat_cards where id = $1`, [ids.card]);
    expect(rows[0]).toEqual({ spots_taken: 1, status: 'full' });
  });

  it('keeps one request when a player taps I\'m in twice at once', async () => {
    const [first, second] = await raceAgainstOpenTransaction(() => ask(a, ids.otherCard, ids.one), () => ask(b, ids.otherCard, ids.one));
    expect([first, second]).toEqual(['requested', 'already_asked']);
    const { rows } = await setup.query(`select count(*)::int as n from public.chat_join_requests where card_id = $1`, [ids.otherCard]);
    expect(rows[0].n).toBe(1);
  });
});
