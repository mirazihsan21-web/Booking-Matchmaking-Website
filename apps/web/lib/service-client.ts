import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Bypasses RLS. Server code only, and only after an explicit role check — for writes that span
 * tables (onboarding, scheduling, the booking flow) and for platform-admin reads.
 */
export function createServiceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
