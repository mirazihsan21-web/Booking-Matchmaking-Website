import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client (bypasses RLS) — fixtures and assertions only. */
export function serviceDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, options);
}

/** A client acting as an anonymous visitor. */
export function anonClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** A confirmed auth user. Password sign-in exists only so tests can act as real users. */
export async function createTestUser(db: SupabaseClient, opts: { email?: string; password?: string } = {}): Promise<TestUser> {
  const email = opts.email ?? `${randomUUID()}@stage-a.test`;
  const password = opts.password ?? `pw-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser returned no user');
  return { id: data.user.id, email, password };
}

/** A client signed in as that user, so RLS applies exactly as in the app. */
export async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export async function deleteTestUser(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) throw error;
}
