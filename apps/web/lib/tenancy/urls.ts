const root = () => process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000';
const protocol = () => (root().startsWith('localhost') ? 'http' : 'https');

/** Absolute URL on the platform's root site. */
export function rootUrl(path = '/'): string {
  return `${protocol()}://${root()}${path}`;
}

/** Public URL of a file in the org-assets bucket (it is public: logos and section photos). */
export function assetUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/org-assets/${path}`;
}

/** Public URL of an uploaded logo. */
export function logoUrl(path: string | undefined): string | null {
  return path ? assetUrl(path) : null;
}
