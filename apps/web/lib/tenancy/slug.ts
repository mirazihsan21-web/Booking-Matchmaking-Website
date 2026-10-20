/** Mirrors the CHECK constraints on organizations.slug (supabase/migrations/*_stage_a_schema.sql). */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Mirrors organizations_slug_reserved_check (supabase/migrations/*_reserved_slugs.sql). Self-serve signup
 * means anyone can claim <slug>.<platform domain>, so phishing-prone names are kept for the platform.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'app', 'admin', 'api', 'manage', 'auth', 'static', 't',
  'help', 'support', 'status', 'docs', 'blog', 'mail',
  'login', 'signin', 'signup', 'register', 'account', 'accounts', 'verify', 'secure', 'security',
  'pay', 'payment', 'payments', 'checkout', 'billing', 'wallet', 'bkash', 'nagad',
  'dev', 'staging', 'cdn', 'assets', 'media', 'onboarding',
]);

/** Browsers display xn-- (punycode) labels as Unicode, which allows look-alike venue addresses. */
const PUNYCODE_PREFIX = 'xn--';

/** What an owner types → a slug candidate: trimmed, lower-case, spaces and underscores to hyphens. */
export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function validateSlug(slug: string): { ok: true } | { ok: false; reason: 'format' | 'reserved' } {
  if (RESERVED_SLUGS.has(slug) || slug.startsWith(PUNYCODE_PREFIX)) return { ok: false, reason: 'reserved' };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, reason: 'format' };
  return { ok: true };
}
