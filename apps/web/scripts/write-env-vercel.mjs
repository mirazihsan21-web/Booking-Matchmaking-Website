// Launch runbook step 3 (spec docs/superpowers/specs/2026-10-29-vercel-launch-design.md §2, §4): fills the linked
// Vercel project's production variables and points the hosted job tick at the site through the Vault.
//
//   pnpm env:vercel --host <the site's *.vercel.app host> --gmail <the brand Gmail>
//
// Needs `vercel link` done in apps/web and the Supabase CLI linked to the hosted project. Secrets come from the
// Supabase CLI, a new random JOB_SECRET, and a hidden prompt for the Gmail App Password (only in a real terminal;
// otherwise SMTP_PASS is left for the Vercel dashboard). No secret is printed, logged or put on a command line:
// values go to the Vercel CLI on stdin, and the Vault SQL through a temp file that is deleted afterwards.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { hostedProject } from './hosted-keys.mjs';
import { repoRoot } from './supabase-status.mjs';
import { envSummary, vaultSql, vercelAddArgs, vercelEnvironment } from './vercel-env-core.mjs';

const VERCEL = ['dlx', 'vercel@65.4.0'];
const webDir = fileURLToPath(new URL('..', import.meta.url));

function flag(name) {
  const at = process.argv.indexOf(`--${name}`);
  const value = at > -1 ? process.argv[at + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}. Run: pnpm env:vercel --host <host> --gmail <address>`);
  return value;
}

/** Asks without echoing what is typed. */
async function hidden(question) {
  process.stdout.write(question);
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await new Promise((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

/** Runs pnpm with fixed arguments; `input` (a secret) goes on stdin. Fails loudly, without echoing input. */
function pnpm(args, { cwd, input, allowFailure = false } = {}) {
  const run = spawnSync('pnpm', args, { cwd, input, shell: true, encoding: 'utf8', stdio: ['pipe', 'ignore', 'pipe'] });
  if (run.status !== 0 && !allowFailure) throw new Error(`pnpm ${args.join(' ')} failed:\n${run.stderr}`);
  return run.status === 0;
}

const host = flag('host');
const gmail = flag('gmail');
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/.test(host)) throw new Error('--host must be the site\'s *.vercel.app host');
if (!/^[^\s@'"<>]+@gmail\.com$/.test(gmail)) throw new Error('--gmail must be a gmail.com address');
if (!existsSync(join(webDir, '.vercel', 'project.json'))) throw new Error('Link the Vercel project first: cd apps/web && pnpm dlx vercel@65.4.0 link');

const project = hostedProject();
const gmailAppPassword = process.stdin.isTTY ? (await hidden(`Gmail App Password for ${gmail}: `)).replace(/\s+/g, '') : '';
const jobSecret = randomBytes(32).toString('hex');
const vars = vercelEnvironment({
  supabaseUrl: project.url,
  publishableKey: project.publishable,
  secretKey: project.secret,
  jobSecret,
  host,
  brandSlug: 'chattoturf',
  gmail,
  gmailAppPassword,
}).filter((v) => v.name !== 'SMTP_PASS' || v.value);

for (const v of vars) {
  pnpm([...VERCEL, 'env', 'rm', v.name, 'production', '--yes'], { cwd: webDir, allowFailure: true });
  pnpm([...VERCEL, ...vercelAddArgs(v)], { cwd: webDir, input: v.value });
}
console.log(`Vercel production variables set:\n${envSummary(vars)}`);
if (!gmailAppPassword) console.log('SMTP_PASS not set (no terminal to ask in): add it in Vercel → Settings → Environment Variables, Production, Sensitive.');

const dir = mkdtempSync(join(tmpdir(), 'env-vercel-'));
try {
  const file = join(dir, 'vault.sql');
  writeFileSync(file, vaultSql({ appUrl: `https://${host}`, jobSecret }), { mode: 0o600 });
  // Quoted: the shell joins arguments with spaces, and a temp folder may contain one.
  pnpm(['exec', 'supabase', 'db', 'query', '--linked', '-f', `"${file}"`], { cwd: repoRoot });
  console.log(`Vault: app_url, job_secret set (the tick now calls https://${host}/api/jobs/tick every minute)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
