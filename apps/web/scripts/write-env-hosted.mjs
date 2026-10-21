// Writes apps/web/.env.local for the linked hosted Supabase project, so the dev server uses it instead
// of the local stack. Needs `pnpm exec supabase login` + `pnpm exec supabase link --project-ref <ref>`.
// Keys come from the Supabase CLI and are never printed. Run: pnpm env:hosted · back: pnpm env:local
//
// Tests keep using the local stack (they create and delete users and venues). JOB_SECRET and the email
// settings are kept from the current .env.local: while the local stack runs, its 10-second cron keeps
// calling this dev server's /api/jobs/tick, which then works on the hosted database, and app emails
// keep landing in the local Mailpit. (The hosted database can't reach localhost, so its own tick is idle
// until the app is deployed.)
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './supabase-status.mjs';

const refFile = join(repoRoot, 'supabase', '.temp', 'project-ref');
if (!existsSync(refFile)) {
  throw new Error('No linked project. Run: pnpm exec supabase link --project-ref <your-project-ref>');
}
const ref = readFileSync(refFile, 'utf8').trim();
// The ref goes into a shell command below (pnpm is a .cmd on Windows), so accept only a real ref.
if (!/^[a-z]{20}$/.test(ref)) throw new Error(`Unexpected project ref in ${refFile}`);

const out = execSync(`pnpm exec supabase projects api-keys --project-ref ${ref} --reveal -o json`, {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const keys = JSON.parse(out.slice(out.indexOf('[')));
const key = (type) => keys.find((k) => k.type === type)?.api_key;
const publishable = key('publishable');
const secret = key('secret');
if (!publishable || !secret?.startsWith('sb_secret_')) {
  throw new Error('The project needs a publishable and a secret API key (Project Settings → API Keys).');
}

const target = fileURLToPath(new URL('../.env.local', import.meta.url));
const current = existsSync(target)
  ? Object.fromEntries(
      readFileSync(target, 'utf8')
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
  : {};
const keep = (name, fallback) => `${name}=${current[name] ?? fallback}`;

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
  `SUPABASE_SECRET_KEY=${secret}`,
  'NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000',
  keep('NEXT_PUBLIC_GOOGLE_AUTH_ENABLED', 'false'),
  keep('JOB_SECRET', randomBytes(32).toString('hex')),
  keep('EMAIL_TRANSPORT', 'smtp'),
  keep('SMTP_HOST', '127.0.0.1'),
  keep('SMTP_PORT', '54325'),
  keep('EMAIL_FROM', 'Booking & Matchmaking <bookings@localhost>'),
];
writeFileSync(target, lines.join('\n') + '\n');
console.log(`wrote ${target} for the hosted project ${ref} (restart the dev server)`);
