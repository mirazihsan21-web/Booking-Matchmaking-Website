import { validateSlug } from './slug';

export type HostTarget = { kind: 'root' } | { kind: 'tenant'; slug: string } | { kind: 'unknown' };

/**
 * Which site a request is for:
 *   <root> or www.<root>      → the platform site
 *   <slug>.<root>             → that venue's site (slug must be valid and not reserved)
 *   deeper or invalid labels  → unknown (404)
 *   any host outside <root>   → the platform site, so preview deployments still work
 */
export function resolveHost(host: string | null, rootDomain: string): HostTarget {
  if (!host) return { kind: 'root' };
  const h = host.toLowerCase();
  const root = rootDomain.toLowerCase();
  if (h === root || h === `www.${root}`) return { kind: 'root' };
  if (!h.endsWith(`.${root}`)) return { kind: 'root' };

  const label = h.slice(0, -(root.length + 1));
  if (label.includes('.')) return { kind: 'unknown' };
  return validateSlug(label).ok ? { kind: 'tenant', slug: label } : { kind: 'unknown' };
}
