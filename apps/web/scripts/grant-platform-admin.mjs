// Makes an existing user a platform admin. Run: pnpm admin:grant someone@example.com
// Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY when set (e.g. production), else the local stack.
import { createClient } from '@supabase/supabase-js';
import { supabaseStatus } from './supabase-status.mjs';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('usage: pnpm admin:grant <email>');
  process.exit(1);
}

let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
let secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  const status = supabaseStatus();
  url = status.API_URL;
  secret = status.SECRET_KEY;
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 1000) break;
}
if (!user) {
  console.log('no such user');
  process.exit(1);
}

const { error } = await db.from('platform_admins').upsert({ user_id: user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
if (error) throw error;
console.log('granted');
