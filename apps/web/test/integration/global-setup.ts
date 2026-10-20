import pg from 'pg';
import { supabaseStatus } from '../../scripts/supabase-status.mjs';

const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Turns the database's 10-second job tick on or off (it would otherwise race these tests' senders). */
async function setTick(active: boolean): Promise<void> {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query("select cron.alter_job(jobid, active := $1) from cron.job where jobname = 'tick'", [active]);
  } finally {
    await db.end();
  }
}

/**
 * Points the integration tests at the running local Supabase stack (unless env already says otherwise)
 * and pauses the live job tick for the run, so only the tests deliver pending emails.
 */
export default async function setup() {
  // Mailpit's SMTP port (supabase/config.toml [local_smtp] smtp_port).
  process.env.SMTP_HOST ??= '127.0.0.1';
  process.env.SMTP_PORT ??= '54325';
  process.env.EMAIL_FROM ??= 'Booking & Matchmaking <bookings@localhost>';

  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    const status = supabaseStatus();
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= status.API_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= status.PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY ??= status.SECRET_KEY;
  }

  await setTick(false);
  // A tick already in flight finishes within moments; let it land before the first test.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return async () => setTick(true);
}
