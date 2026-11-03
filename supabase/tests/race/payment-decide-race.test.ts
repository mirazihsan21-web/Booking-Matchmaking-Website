import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Paying for online bookings: two people on the team (and a cancel) act on the same payment at the same moment —
// one confirms, one rejects, one cancels. Whatever the timing the booking ends booked with exactly one live
// payment and its slot held, or cancelled with no live payment and its slot free; never both, never neither.
// Needs the local Supabase stack: `pnpm db:start`.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ROUNDS = 15; // 5 rounds of each pair; each round can leave a booked hour, and the limit tops out at 20

const ids = { owner: randomUUID(), playerUser: randomUUID(), org: randomUUID(), section: randomUUID(), resource: randomUUID(), profile: randomUUID() };
const setup = new pg.Client({ connectionString: DB_URL });
const confirming = new pg.Client({ connectionString: DB_URL });
const rejecting = new pg.Client({ connectionString: DB_URL });
const cancelling = new pg.Client({ connectionString: DB_URL });

beforeAll(async () => {
  await Promise.all([setup, confirming, rejecting, cancelling].map((c) => c.connect()));
  const run = (sql: string, params: unknown[]) => setup.query(sql, params);
  await run(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [ids.owner, `${ids.owner}@race.test`, ids.playerUser, `${ids.playerUser}@race.test`]);
  await run(`insert into public.organizations (id, slug, name, business_type, status, bkash_number) values ($1, $2, 'Race Decide', 'turf', 'live', '01712345678')`, [
    ids.org,
    `race-${ids.org.slice(0, 8)}`,
  ]);
  await run(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [ids.org, ids.owner]);
  await run(`insert into public.sections (id, organization_id, name, kind, slug, max_upcoming_bookings) values ($1, $2, 'Turf', 'turf', 'turf', 20)`, [ids.section, ids.org]);
  await run(`insert into public.resources (id, organization_id, section_id, name, kind, capacity, price_per_hour_poisha) values ($1, $2, $3, 'Pitch 1', 'pitch', 14, 250000)`, [
    ids.resource,
    ids.org,
    ids.section,
  ]);
  await run(`insert into public.player_profiles (id, organization_id, user_id, display_name) values ($1, $2, $3, 'Racer R.')`, [ids.profile, ids.org, ids.playerUser]);
});

afterAll(async () => {
  await setup.query(`delete from public.organizations where id = $1`, [ids.org]);
  await setup.query(`delete from auth.users where id in ($1, $2)`, [ids.owner, ids.playerUser]);
  await Promise.all([setup, confirming, rejecting, cancelling].map((c) => c.end()));
});

/** A request for the hour starting `round` days from now, with its details sent. */
async function request(round: number): Promise<string> {
  const booked = await setup.query(
    `select booking_id from public.book_resource($1, $2, date_trunc('hour', now()) + make_interval(days => $3), 1, $4, null, null, $5, true)`,
    [ids.org, ids.resource, round + 1, ids.profile, ids.playerUser],
  );
  const bookingId = booked.rows[0].booking_id as string;
  const sent = await setup.query(`select public.submit_payment_claim($1, $2, 'bkash', '01911111111', $3) as s`, [bookingId, ids.playerUser, `RACE${round}X${ids.org.slice(0, 6)}`.toUpperCase()]);
  expect(sent.rows[0].s).toBe('submitted');
  return bookingId;
}

describe('confirm, reject and cancel on one payment at once', () => {
  it(`always ends in one clear state (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const bookingId = await request(round);
      const confirm = () => confirming.query(`select public.decide_payment_claim($1, $2, 'confirm')`, [bookingId, ids.owner]);
      const reject = () => rejecting.query(`select public.decide_payment_claim($1, $2, 'reject', 'Payment not found')`, [bookingId, ids.owner]);
      const cancel = () => cancelling.query(`select public.cancel_resource_booking($1, $2)`, [bookingId, ids.owner]);
      // Two at a time, each pair in turn: confirm/reject, confirm/cancel, reject/cancel.
      const pairs = [[confirm, reject], [confirm, cancel], [reject, cancel]] as const;
      await Promise.all(pairs[round % 3]!.map((act) => act()));
      const state = await setup.query(
        `select b.status::text as status,
                (select count(*)::int from public.payments p where p.resource_booking_id = b.id and p.voided_at is null) as live,
                (select count(*)::int from public.resource_reservations r where r.source = 'booking' and r.source_id = b.id) as held
         from public.resource_bookings b where b.id = $1`,
        [bookingId],
      );
      const { status, live, held } = state.rows[0] as { status: string; live: number; held: number };
      expect(['confirmed', 'cancelled']).toContain(status);
      expect({ live, held }).toEqual(status === 'confirmed' ? { live: 1, held: 1 } : { live: 0, held: 0 });
    }
  });
});
