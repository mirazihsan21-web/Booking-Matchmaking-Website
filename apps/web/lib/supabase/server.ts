import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { connection } from 'next/server';

/** Per-request Supabase client acting as the signed-in user (RLS applies). Official @supabase/ssr pattern. */
export async function createClient() {
  // supabase-js reads the clock (Date.now()) while loading the session. Under Cache Components that's
  // only allowed at request time, so stop prerendering here explicitly.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only. Safe to ignore:
            // proxy.ts refreshes the session on every request.
          }
        },
      },
    },
  );
}
