import { createBrowserClient } from '@supabase/ssr';

/** Browser Supabase client acting as the signed-in user (RLS applies). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
