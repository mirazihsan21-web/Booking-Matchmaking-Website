/** Mirrors the CHECK constraints on organizations.slug (supabase/migrations/*_stage_a_schema.sql). */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'app', 'admin', 'api', 'manage', 'auth', 'static', 't',
  'help', 'support', 'status', 'docs', 'blog', 'mail',
]);

/** What an owner types → a slug candidate: trimmed, lower-case, spaces and underscores to hyphens. */
export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function validateSlug(slug: string): { ok: true } | { ok: false; reason: 'format' | 'reserved' } {
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: 'reserved' };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, reason: 'format' };
  return { ok: true };
}
