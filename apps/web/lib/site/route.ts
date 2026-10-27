import { safeNext } from '@/lib/auth/redirect';

export type Route = { kind: 'next' } | { kind: 'redirect'; location: string } | { kind: 'not_found' };

/**
 * Where a request goes on the one-site setup:
 *   <root> or www.<root>   → served (the brand's site)
 *   any <labels>.<root>    → redirected to the same page on <root> (old venue links keep working)
 *   /t or /t/…             → not found (the old internal venue routes)
 *   hosts outside <root>   → served, so preview deployments still work
 */
export function routeRequest(host: string | null, url: URL, rootDomain: string): Route {
  const root = rootDomain.toLowerCase();
  const h = host?.toLowerCase() ?? null;
  if (h && h !== root && h !== `www.${root}` && h.endsWith(`.${root}`)) {
    return { kind: 'redirect', location: movedTo(`${url.pathname}${url.search}`, rootDomain) };
  }
  if (url.pathname === '/t' || url.pathname.startsWith('/t/')) return { kind: 'not_found' };
  return { kind: 'next' };
}

/** The absolute address on the site for a path from an old venue link; anything off-site becomes the home page. */
export function movedTo(path: string | null, rootDomain: string): string {
  const root = rootDomain.toLowerCase();
  const protocol = root.startsWith('localhost') ? 'http' : 'https';
  return `${protocol}://${root}${safeNext(path)}`;
}

/**
 * Where an old venue booking link (`/book?section=…&resource=…&date=…`) goes on the site: its section's
 * booking page with the same space and day, or home when the section is unknown (`/book` is no page now).
 */
export function movedBookPath(search: string, sectionSlug: string | null): string {
  if (!sectionSlug) return '/';
  const old = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of ['resource', 'date']) {
    const value = old.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return `/${sectionSlug}/book${query ? `?${query}` : ''}`;
}
