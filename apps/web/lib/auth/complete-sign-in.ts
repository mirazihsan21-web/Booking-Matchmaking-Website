import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js';

/** One-time token types our email templates send (see supabase/templates). */
const TOKEN_TYPES: ReadonlySet<string> = new Set<EmailOtpType>(['invite', 'magiclink', 'email']);

/**
 * Whether the link is the staff invite email's ("Accept the invite"): clicking it is saying yes, so the callback
 * accepts the invite. Any other sign-in (Google, an email sign-in link) leaves the invite waiting on the site.
 */
export function isInviteLink(params: URLSearchParams): boolean {
  return Boolean(params.get('token_hash')) && params.get('type') === 'invite';
}

/**
 * Finishes a sign-in from the link a person clicked:
 * - `?code=` — the PKCE flow (sign-in links the browser asked for), or
 * - `?token_hash=&type=` — links Supabase sends on our behalf (staff invites), which can't use PKCE.
 * Returns whether a session was established.
 */
export async function completeSignIn(supabase: SupabaseClient, params: URLSearchParams): Promise<boolean> {
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && type && TOKEN_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    return !error;
  }
  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return !error;
  }
  return false;
}
