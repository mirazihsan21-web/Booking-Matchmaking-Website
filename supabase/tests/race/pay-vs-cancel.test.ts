import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Two people at the desk (Review Focus 1): one cancels a booking or the whole game while the other records
// cash for it. Whatever the timing, no live payment may be left on a cancelled booking or seat — it would be
// counted in Takings and nobody could undo it. Needs the local Supabase stack: `pnpm db:start`.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ids = {
  owner: randomUUID(),
  playerUser: randomUUID(),
  org: randomUUID(),
  section: randomUUID(),
  resource: randomUUID(),
  activity: randomUUID(),
  session: randomUUID(),
  group: randomUUID(),
  profile: randomUUID(),
  walkIn: randomUUID(),
  seat: randomUUID(),
};
const setup = new pg.Client({ connectionString: DB_URL });
const cancelling = new pg.Client({ connectionString: DB_URL });
const paying = new pg.Client({ connectionString: DB_URL });

beforeAll(async () => {
  await Promise.all([setup.connect(), cancelling.connect(), paying.connect()]);
  const run = (sql: string, params: unknown[]) => setup.query(sql, params);
  await run(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [ids.owner, `${ids.owner}@race.test`, ids.playerUser, `${ids.playerUser}@race.test`]);
  await run(`insert into public.organizations (id, slug, name, business_type, created_by) values ($1, $2, 'Race Pay', 'turf', $3)`, [ids.org, `race-${ids.org.slice(0, 8)}`, ids.owner]);
  await run(`insert into public.sections (id, organization_id, name, kind, slug) values ($1, $2, 'Turf', 'turf', 'turf')`, [ids.section, ids.org]);
  await run(`insert into public.resources (id, organization_id, section_id, name, kind, capacity) values ($1, $2, $3, 'Pitch 1', 'pitch', 14)`, [ids.resource, ids.org, ids.section]);
  await run(
    `insert into public.resource_bookings (id, organization_id, resource_id, guest_name, guest_phone, period, price_poisha)
     values ($1, $2, $3, 'Walk-in', '01712345678', tstzrange(now() + interval '1 day', now() + interval '25 hours'), 60000)`,
    [ids.walkIn, ids.org, ids.resource],
  );
  await run(`insert into public.activities (id, organization_id, section_id, name, min_players, max_players, duration_min) values ($1, $2, $3, '5-a-side', 2, 10, 60)`, [
    ids.activity,
    ids.org,
    ids.section,
  ]);
  await run(
    `insert into public.open_play_sessions (id, organization_id, section_id, activity_id, starts_at, ends_at, seat_price_poisha, status)
     values ($1, $2, $3, $4, now() + interval '2 days', now() + interval '49 hours', 30000, 'matched')`,
    [ids.session, ids.org, ids.section, ids.activity],
  );
  await run(`insert into public.groups (id, organization_id, session_id, resource_id, activity_id, capacity) values ($1, $2, $3, $4, $5, 10)`, [
    ids.group,
    ids.org,
    ids.session,
    ids.resource,
    ids.activity,
  ]);
  await run(`insert into public.player_profiles (id, organization_id, user_id, display_name) values ($1, $2, $3, 'Racer R.')`, [ids.profile, ids.org, ids.playerUser]);
  await run(`insert into public.bookings (id, organization_id, session_id, group_id, profile_id, seat_no, price_poisha) values ($1, $2, $3, $4, $5, 1, 30000)`, [
    ids.seat,
    ids.org,
    ids.session,
    ids.group,
    ids.profile,
  ]);
});

afterAll(async () => {
  await setup.query(`delete from public.organizations where id = $1`, [ids.org]);
  await setup.query(`delete from auth.users where id in ($1, $2)`, [ids.owner, ids.playerUser]);
  await Promise.all([setup.end(), cancelling.end(), paying.end()]);
});

/**
 * Runs `cancel` in an open transaction, then starts `pay` while the cancel is still uncommitted, commits the
 * cancel and returns how the payment ended: refused, or the number of live payments it left on `bookingColumn`.
 */
async function race(cancel: string, cancelParams: unknown[], bookingColumn: 'resource_booking_id' | 'seat_booking_id', bookingId: string) {
  await cancelling.query('begin');
  await cancelling.query(cancel, cancelParams);
  const payment = paying
    .query(`insert into public.payments (${bookingColumn}, amount_poisha) values ($1, 30000)`, [bookingId])
    .then(() => 'recorded' as const)
    .catch((e: Error) => e.message);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await cancelling.query('commit');
  const outcome = await payment;
  const { rows } = await setup.query(`select count(*)::int as live from public.payments where ${bookingColumn} = $1 and voided_at is null`, [bookingId]);
  return { outcome, live: rows[0].live as number };
}

describe('recording cash while the booking is being cancelled', () => {
  it('a space booking: the payment is refused, never left live', async () => {
    const result = await race(`select public.cancel_resource_booking($1, $2)`, [ids.walkIn, ids.owner], 'resource_booking_id', ids.walkIn);
    expect(result).toEqual({ outcome: 'booking_not_payable', live: 0 });
  });

  it('a seat in a game being cancelled: the payment is refused, never left live', async () => {
    const result = await race(`select public.cancel_open_play_session($1)`, [ids.session], 'seat_booking_id', ids.seat);
    expect(result).toEqual({ outcome: 'booking_not_payable', live: 0 });
  });
});
