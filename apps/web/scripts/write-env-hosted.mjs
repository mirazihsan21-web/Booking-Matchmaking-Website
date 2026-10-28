// Writes apps/web/.env.local for the linked hosted Supabase project, so the dev server uses it instead
// of the local stack. Needs `pnpm exec supabase login` + `pnpm exec supabase link --project-ref <ref>`.
// Keys come from the Supabase CLI and are never printed. Run: pnpm env:hosted · back: pnpm env:local
//
// Tests keep using the local stack (they create and delete users and venues). JOB_SECRET and the email
// settings are kept from the current .env.local: while the local stack runs, its every-minute cron keeps
// calling this dev server's /api/jobs/tick, which then works on the hosted database, and app emails
// keep landing in the local Mailpit. (The hosted database's own tick calls the deployed site once
// `pnpm env:vercel` has set its Vault.)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hostedProject } from './hosted-keys.mjs';

const { ref, publishable, secret } = hostedProject();

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
// A brand set while already on hosted is kept; coming from local (demo-brand) it is the client's brand.
const wasHosted = /^https:\/\/[a-z]{20}\.supabase\.co$/.test(current.NEXT_PUBLIC_SUPABASE_URL ?? '');
const brandSlug = (wasHosted && current.BRAND_SLUG) || 'chattoturf';

// The Google button follows whether Google sign-in is switched on for the hosted project.
let googleEnabled = current.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED ?? 'false';
try {
  const res = await fetch(`https://${ref}.supabase.co/auth/v1/settings`, { headers: { apikey: publishable } });
  if (res.ok) googleEnabled = String(Boolean((await res.json()).external?.google));
} catch {
  // offline: keep the current value
}

const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable}`,
  `SUPABASE_SECRET_KEY=${secret}`,
  'NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000',
  `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=${googleEnabled}`,
  `BRAND_SLUG=${brandSlug}`,
  keep('JOB_SECRET', randomBytes(32).toString('hex')),
  keep('EMAIL_TRANSPORT', 'smtp'),
  keep('SMTP_HOST', '127.0.0.1'),
  keep('SMTP_PORT', '54325'),
  keep('EMAIL_FROM', 'Booking & Matchmaking <bookings@localhost>'),
  // Optional: a mail-server login (Gmail) and a Resend key, kept only when already set.
  ...['SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY'].filter((name) => current[name]).map((name) => `${name}=${current[name]}`),
];
writeFileSync(target, lines.join('\n') + '\n');
console.log(`wrote ${target} for the hosted project ${ref}, brand ${brandSlug}, Google sign-in ${googleEnabled === 'true' ? 'on' : 'off'} (restart the dev server)`);
