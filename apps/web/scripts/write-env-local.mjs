// Writes apps/web/.env.local from the running local Supabase stack. Run: pnpm env:local
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supabaseStatus } from './supabase-status.mjs';

const status = supabaseStatus();
const lines = [
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
  `SUPABASE_SECRET_KEY=${status.SECRET_KEY}`,
  'NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000',
  'NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false',
];
const target = fileURLToPath(new URL('../.env.local', import.meta.url));
writeFileSync(target, lines.join('\n') + '\n');
console.log(`wrote ${target}`);
