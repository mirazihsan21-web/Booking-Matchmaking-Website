const root = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
const protocol = () => (root().startsWith('localhost') ? 'http' : 'https');

/** Absolute URL on the platform's root site. */
export function rootUrl(path = '/'): string {
  return `${protocol()}://${root()}${path}`;
}

/** Absolute URL on a venue's subdomain. */
export function tenantUrl(slug: string, path = '/'): string {
  return `${protocol()}://${slug}.${root()}${path === '/' ? '' : path}`;
}

/** Public URL of an uploaded logo (the org-assets bucket is public). */
export function logoUrl(path: string | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-assets/${path}`;
}
