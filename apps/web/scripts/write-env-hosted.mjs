// Writes apps/web/.env.local for the linked hosted Supabase project, so the dev server uses it instead
// of the local stack. Needs `pnpm exec supabase login` + `pnpm exec supabase link --project-ref <ref>`.
// Keys come from the Supabase CLI and are never printed. Run: pnpm env:hosted · back: pnpm env:local
//
// Tests keep using the local stack (they create and delete users and venues). The email settings are kept
// from the current .env.local; JOB_SECRET is always new, so the local stack's tick is turned away (401) and
// never works on the hosted database — the deployed site's own tick does that (Vault set by
// `pnpm env:vercel`), and real players' emails must not end up in the local Mailpit.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hostedEnvLines } from './hosted-env-core.mjs';
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

const lines = hostedEnvLines({ ref, publishable, secret, googleEnabled, brandSlug, current, jobSecret: randomBytes(32).toString('hex') });
writeFileSync(target, lines.join('\n') + '\n');
console.log(`wrote ${target} for the hosted project ${ref}, brand ${brandSlug}, Google sign-in ${googleEnabled === 'true' ? 'on' : 'off'} (restart the dev server)`);
