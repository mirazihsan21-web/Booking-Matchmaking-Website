import 'server-only';
import { redirect } from 'next/navigation';
import { userFromClaims, type SessionUser } from '@/lib/account/identity';
import { createClient } from '@/lib/supabase/server';

export type { SessionUser } from '@/lib/account/identity';

/** The signed-in user, verified from the JWT (getClaims — never getSession on the server). */
export async function getUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return userFromClaims(data?.claims as Record<string, unknown> | undefined);
}

/** The signed-in user, or a redirect to sign in and come back to `next`. */
export async function requireUser(next: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(next)}`);
  return user;
}
