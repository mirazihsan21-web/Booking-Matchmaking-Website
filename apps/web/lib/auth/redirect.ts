import { resolveHost } from '@/lib/tenancy/host';

/** Only same-site relative paths are allowed after sign-in, so a crafted link can't bounce users elsewhere. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next;
}

/**
 * The origin the browser actually used. Next builds request.url from its own hostname, so a venue
 * subdomain would come back as the root host. The Host header is trusted only when it is the root
 * domain or a valid venue subdomain of it — anything else falls back to request.url's origin.
 */
export function requestOrigin(host: string | null, requestUrl: string, rootDomain: string): string {
  const fallback = new URL(requestUrl);
  if (!host) return fallback.origin;
  const h = host.toLowerCase();
  const root = rootDomain.toLowerCase();
  const onPlatform = h === root || h.endsWith(`.${root}`);
  if (!onPlatform || resolveHost(h, root).kind === 'unknown') return fallback.origin;
  return `${fallback.protocol}//${h}`;
}
