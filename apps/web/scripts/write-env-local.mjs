// Writes apps/web/.env.local from the running local Supabase stack, and points the database's
// 10-second job tick at this app (Vault: app_url + job_secret). Run: pnpm env:local
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { supabaseStatus } from './supabase-status.mjs';

const status = supabaseStatus();
const jobSecret = randomBytes(32).toString('hex');
// The database runs in Docker; this is how it reaches the dev server on the host (Docker Desktop).
const appUrl = 'http://host.docker.internal:3000';

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${status.SECRET_KEY}`,
  'NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000',
  'NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false',
  `JOB_SECRET=${jobSecret}`,
  'EMAIL_TRANSPORT=smtp',
  'SMTP_HOST=127.0.0.1',
  'SMTP_PORT=54325',
  'EMAIL_FROM=Booking & Matchmaking <bookings@localhost>',
];
const target = fileURLToPath(new URL('../.env.local', import.meta.url));
writeFileSync(target, lines.join('\n') + '\n');
console.log(`wrote ${target}`);

const db = new pg.Client({ connectionString: status.DB_URL });
await db.connect();
try {
  await db.query('begin');
  await db.query("delete from vault.secrets where name in ('app_url', 'job_secret')");
  await db.query("select vault.create_secret($1, 'app_url')", [appUrl]);
  await db.query("select vault.create_secret($1, 'job_secret')", [jobSecret]);
  await db.query('commit');
  console.log(`job tick → ${appUrl}/api/jobs/tick (restart the dev server to pick up the new JOB_SECRET)`);
} finally {
  await db.end();
}
