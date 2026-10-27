// Quick check that site pages render what they should, on the running dev server.
//   node apps/web/scripts/smoke-site.mjs "/|Coming up;Join match" "/turf|Book a space"
//   node apps/web/scripts/smoke-site.mjs --as player@example.test "/turf/book|Pitch 1"
// Each argument is `path|text1;text2`: the page (redirects followed) must contain every text.
// Signed out unless `--as <email>`: that local user is signed in through the admin API (a magic link
// turned into a session cookie, keys from apps/web/.env.local); never point it at the hosted project.
// Status codes are not checked: pages stream inside Suspense, so a not-found can arrive with 200.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const base = process.env.SITE_URL ?? 'http://localhost:3000';
const decode = (html) => html.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');

/** The auth cookie header for a local user, chunked the way @supabase/ssr writes it. */
async function sessionCookie(email) {
  const env = Object.fromEntries(
    readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error('--as only works against the local Supabase stack');
  const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const { data, error: verifyError } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (verifyError) throw verifyError;
  const name = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url');
  const size = 3180;
  if (value.length <= size) return `${name}=${value}`;
  return Array.from({ length: Math.ceil(value.length / size) }, (_, i) => `${name}.${i}=${value.slice(i * size, (i + 1) * size)}`).join('; ');
}

const args = process.argv.slice(2);
const asIndex = args.indexOf('--as');
const cookie = asIndex >= 0 ? await sessionCookie(args.splice(asIndex, 2)[1]) : null;

for (const arg of args) {
  const [path, texts = ''] = arg.split('|');
  const res = await fetch(base + path, { redirect: 'follow', headers: cookie ? { cookie } : {} });
  const html = decode(await res.text());
  const missing = texts.split(';').filter((t) => t && !html.includes(t));
  if (missing.length) {
    console.error(`FAIL ${path} (${res.status}): missing ${missing.map((t) => `"${t}"`).join(', ')}`);
    process.exit(1);
  }
}
console.log('ok');
