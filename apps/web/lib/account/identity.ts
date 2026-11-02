/**
 * Who is signed in, as the site shows them: the name, photo and sign-in methods Google and Supabase put in
 * the verified token. Pure, so it can be tested without a request.
 */

export interface SessionUser {
  id: string;
  email: string | null;
  /** Google's full name (or name); null for email-link accounts. */
  name: string | null;
  /** Google's photo; null without one. */
  avatarUrl: string | null;
  /** How the account signs in (`google`, `email`), from the token's app_metadata. */
  providers: string[];
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

/** The person in a verified token's claims, or null without a subject. */
export function userFromClaims(claims: Record<string, unknown> | null | undefined): SessionUser | null {
  const id = str(claims?.sub);
  if (!claims || !id) return null;
  const meta = record(claims.user_metadata);
  const providers = record(claims.app_metadata).providers;
  return {
    id,
    email: str(claims.email),
    name: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
    providers: Array.isArray(providers) ? providers.filter((p): p is string => typeof p === 'string') : [],
  };
}

/** Up to two capital letters for a photo-less avatar: the first and last words; "?" for a blank name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** How someone signs in, in words. An account with no providers listed signs in by email link. */
export function signInMethods(providers: string[]): 'Google' | 'Email link' | 'Google and email link' {
  const google = providers.includes('google');
  const email = providers.includes('email') || !google;
  if (google && email) return 'Google and email link';
  return google ? 'Google' : 'Email link';
}
