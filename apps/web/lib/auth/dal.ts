import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export interface SessionUser {
  id: string;
  email: string | null;
}

/** The signed-in user, verified from the JWT (getClaims — never getSession on the server). */
export async function getUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}

/** The signed-in user, or a redirect to sign in and come back to `next`. */
export async function requireUser(next: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(next)}`);
  return user;
}
