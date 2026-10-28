// The linked hosted Supabase project and its API keys, from the Supabase CLI (never printed). Used by
// `pnpm env:hosted` and `pnpm env:vercel`. Needs `pnpm exec supabase login` + `supabase link --project-ref <ref>`.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './supabase-status.mjs';

/** @returns {{ ref: string, url: string, publishable: string, secret: string }} */
export function hostedProject() {
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
  return { ref, url: `https://${ref}.supabase.co`, publishable, secret };
}
