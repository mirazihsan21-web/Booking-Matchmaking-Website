import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Two real connections replying YES to the same offer at once (a Twilio webhook retry racing the
// simulated-phone button). Needs the local Supabase stack: `pnpm db:start`.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ids = {
  owner: randomUUID(),
  venue: randomUUID(),
  table: randomUUID(),
  game: randomUUID(),
  session: randomUUID(),
  group: randomUUID(),
  player: randomUUID(),
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
  await run(`insert into auth.users (id, email) values ($1, $2)`, [ids.owner, `${ids.owner}@race.test`]);
  await run(`insert into public.venues (id, name, owner_id) values ($1, 'Race Café', $2)`, [ids.venue, ids.owner]);
  await run(`insert into public.venue_tables (id, venue_id, name, capacity) values ($1, $2, 'Table 1', 4)`, [ids.table, ids.venue]);
  await run(
    `insert into public.games (id, venue_id, name, min_players, max_players, duration_min) values ($1, $2, 'Azul', 2, 4, 40)`,
    [ids.game, ids.venue],
  );
  await run(
    `insert into public.sessions (id, venue_id, starts_at, ends_at, seat_price_cents)
     values ($1, $2, now() + interval '1 day', now() + interval '1 day 4 hours', 800)`,
    [ids.session, ids.venue],
  );
  await run(
    `insert into public.groups (id, venue_id, session_id, table_id, game_id, capacity) values ($1, $2, $3, $4, $5, 4)`,
    [ids.group, ids.venue, ids.session, ids.table, ids.game],
  );
  await run(
    `insert into public.players (id, venue_id, name, phone, skill) values ($1, $2, 'Racer R.', '+447700900999', 3)`,
    [ids.player, ids.venue],
  );
  await run(
    `insert into public.waitlist_entries (id, venue_id, session_id, player_id, queue_position) values ($1, $2, $3, $4, 1)`,
    [ids.entry, ids.venue, ids.session, ids.player],
  );
  const offer = await run(`select public.create_offer($1, 1::smallint, $2) as id`, [ids.group, ids.entry]);
  offerId = offer.rows[0].id;
});

afterAll(async () => {
  await setup.query(`delete from auth.users where id = $1`, [ids.owner]); // cascades to the venue
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
      `select count(*)::int as n from public.bookings where session_id = $1 and player_id = $2 and status <> 'cancelled'`,
      [ids.session, ids.player],
    );
    expect(live.rows[0].n).toBe(1);
  });
});
