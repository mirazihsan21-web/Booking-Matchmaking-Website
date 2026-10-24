// Sets up (or tops up) this site's brand: BRAND_SLUG in apps/web/.env.local, on the database that file
// points at (local, or hosted after `pnpm env:hosted`). Safe to repeat; it only adds what is missing.
//   pnpm brand:setup [--name "<brand name>"] [--owner <email>] [--demo]
// --name is needed the first time. --demo (local only) adds 12 rated players and an open game per section.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { boardgame } from '../presets/boardgame.ts';
import { lounge } from '../presets/lounge.ts';
import { turf } from '../presets/turf.ts';
import { setupBrand } from './brand-setup-core.mjs';

const { values } = parseArgs({
  options: { name: { type: 'string' }, owner: { type: 'string' }, demo: { type: 'boolean', default: false } },
});

const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
const slug = env.BRAND_SLUG;
if (!url || !secret || !slug) {
  console.error(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and BRAND_SLUG (pnpm env:local or pnpm env:hosted).`);
  process.exit(1);
}
const host = new URL(url).hostname;
if (values.demo && host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`--demo only runs against the local stack, not ${host}: it creates made-up players.`);
  process.exit(1);
}

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const report = await setupBrand(db, { slug, name: values.name, presets: [turf, boardgame, lounge], ownerEmail: values.owner, demo: values.demo });

console.log(`brand ${slug} on ${host}: ${report.brand}`);
console.log(`sections added: ${report.sectionsAdded.length ? report.sectionsAdded.join(', ') : 'none'}`);
if (report.owner) console.log(`owner ${values.owner}: ${{ member: 'is now an owner', invited: 'invited (an owner once they sign in)', already: 'already set' }[report.owner]}`);
if (report.demo) console.log(`demo: ${report.demo.players} new players, ${report.demo.sessions} new open games`);
