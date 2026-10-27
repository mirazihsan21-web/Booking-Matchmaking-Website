const SAME_SITE = 'http://next.invalid';

/**
 * Only same-site relative paths are allowed after sign-in, so a crafted link can't bounce users elsewhere.
 * Control characters and spaces are refused outright: URL parsers strip tab/CR/LF, which turns
 * "/\t/evil.com" into "//evil.com". The result is also resolved to prove it stays on the same origin.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(next)) return '/';
  const url = new URL(next, SAME_SITE);
  if (url.origin !== SAME_SITE) return '/';
  return url.pathname + url.search + url.hash;
}

/**
 * The origin the browser actually used. Next builds request.url from its own hostname, so the Host
 * header is preferred — but only when it is the site's own host (the root domain or www.<root>);
 * anything else falls back to request.url's origin, so a forged Host can't redirect elsewhere.
 */
export function requestOrigin(host: string | null, requestUrl: string, rootDomain: string): string {
  const fallback = new URL(requestUrl);
  if (!host) return fallback.origin;
  const h = host.toLowerCase();
  const root = rootDomain.toLowerCase();
  if (h !== root && h !== `www.${root}`) return fallback.origin;
  return `${fallback.protocol}//${h}`;
}
