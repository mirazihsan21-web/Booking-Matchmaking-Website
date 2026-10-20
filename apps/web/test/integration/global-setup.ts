import { supabaseStatus } from '../../scripts/supabase-status.mjs';

/** Points the integration tests at the running local Supabase stack, unless env already says otherwise. */
export default function setup() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return;
  }
  const status = supabaseStatus();
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= status.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= status.PUBLISHABLE_KEY;
  process.env.SUPABASE_SECRET_KEY ??= status.SECRET_KEY;
}
