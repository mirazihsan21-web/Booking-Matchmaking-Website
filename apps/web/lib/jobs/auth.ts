import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a request to /api/jobs/* carries the shared job secret (`Authorization: Bearer <secret>`).
 * Constant-time comparison; with no secret configured on the server, nothing is authorized.
 */
export function authorizeJob(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
