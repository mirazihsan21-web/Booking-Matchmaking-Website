import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** Reads the local Supabase stack's URLs and keys (`supabase status -o json`). Requires `pnpm db:start`. */
export function supabaseStatus() {
  const out = execSync('pnpm exec supabase status -o json', {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.slice(out.indexOf('{')));
}
