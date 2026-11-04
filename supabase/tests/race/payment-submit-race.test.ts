import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Paying for online bookings: the player sends their payment details at the same moment as something else ends
// the request — the venue cancels it, or its 15-minute hold runs out. Whatever the timing the request ends in one
// clear state: the details are either in (and, if it was cancelled, closed with the reason "cancelled") or were
// refused; never a live "payment to check" on a cancelled booking, and never a pending request with neither a hold
// nor details. Needs the local Supabase stack: `pnpm db:start`.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ROUNDS = 15;

const ids = { owner: randomUUID(), playerUser: randomUUID(), org: randomUUID(), section: randomUUID(), resource: randomUUID(), profile: randomUUID() };
const setup = new pg.Client({ connectionString: DB_URL });
const sending = new pg.Client({ connectionString: DB_URL });
const ending = new pg.Client({ connectionString: DB_URL });

beforeAll(async () => {
  await Promise.all([setup, sending, ending].map((c) => c.connect()));
  const run = (sql: string, params: unknown[]) => setup.query(sql, params);
  await run(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [ids.owner, `${ids.owner}@race.test`, ids.playerUser, `${ids.playerUser}@race.test`]);
  await run(`insert into public.organizations (id, slug, name, business_type, status, bkash_number) values ($1, $2, 'Race Submit', 'turf', 'live', '01712345678')`, [
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
  await run(`insert into public.player_profiles (id, organization_id, user_id, display_name) values ($1, $2, $3, 'Racer S.')`, [ids.profile, ids.org, ids.playerUser]);
});

afterAll(async () => {
  await setup.query(`delete from public.organizations where id = $1`, [ids.org]);
  await setup.query(`delete from auth.users where id in ($1, $2)`, [ids.owner, ids.playerUser]);
  await Promise.all([setup, sending, ending].map((c) => c.end()));
});

/** A request (held, no details yet) for the hour starting `day` days from now. */
async function request(day: number): Promise<string> {
  const booked = await setup.query(
    `select status, booking_id from public.book_resource($1, $2, date_trunc('hour', now()) + make_interval(days => $3), 1, $4, null, null, $5, true)`,
    [ids.org, ids.resource, day, ids.profile, ids.playerUser],
  );
  expect(booked.rows[0].status).toBe('pending');
  return booked.rows[0].booking_id as string;
}

const send = (bookingId: string, n: number) =>
  sending.query(`select public.submit_payment_claim($1, $2, 'bkash', '01911111111', $3) as result`, [bookingId, ids.playerUser, `RS${n}X${ids.org.slice(0, 8)}`.toUpperCase()]);

async function state(bookingId: string) {
  const { rows } = await setup.query(
    `select b.status::text as status, b.hold_until is not null as held_open,
            (select c.status || coalesce(':' || c.reason, '') from public.payment_claims c where c.booking_id = b.id) as claim,
            (select count(*)::int from public.resource_reservations r where r.source = 'booking' and r.source_id = b.id) as slot
     from public.resource_bookings b where b.id = $1`,
    [bookingId],
  );
  return rows[0] as { status: string; held_open: boolean; claim: string | null; slot: number };
}

describe('sending the details while the venue cancels', () => {
  it(`always ends in one clear state (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const bookingId = await request(round + 1);
      const [sent, cancelled] = await Promise.all([
        send(bookingId, round),
        ending.query(`select public.cancel_resource_booking($1, $2) as result`, [bookingId, ids.owner]),
      ]);
      expect(cancelled.rows[0].result).toBe('cancelled');
      const s = await state(bookingId);
      expect({ status: s.status, held_open: s.held_open, slot: s.slot }).toEqual({ status: 'cancelled', held_open: false, slot: 0 });
      // Details in first: closed with the cancel. Cancel first: refused as already handled.
      expect([sent.rows[0].result, s.claim]).toEqual(sent.rows[0].result === 'submitted' ? ['submitted', 'rejected:cancelled'] : ['not_pending', null]);
    }
  });
});

describe('sending the details as the hold runs out', () => {
  it(`always ends in one clear state (${ROUNDS} rounds)`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const bookingId = await request(ROUNDS + round + 1);
      // This hold ends in a minute; the expiry runs as if two had passed (other tests' 15-minute holds aren't due).
      await setup.query(`update public.resource_bookings set hold_until = now() + interval '1 minute' where id = $1`, [bookingId]);
      const [sent] = await Promise.all([send(bookingId, ROUNDS + round), ending.query(`select public.expire_payment_holds(now() + interval '2 minutes')`)]);
      const s = await state(bookingId);
      if (sent.rows[0].result === 'submitted') {
        expect(s).toEqual({ status: 'pending', held_open: false, claim: 'submitted', slot: 1 });
      } else {
        expect(sent.rows[0].result).toBe('hold_over');
        expect(s).toEqual({ status: 'cancelled', held_open: false, claim: null, slot: 0 });
      }
    }
  });
});
