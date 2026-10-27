/** A section's page: its slug at the root (`/turf`, `/cafe`, `/turf-2`). */
export function sectionPath(slug: string): string {
  return `/${slug}`;
}

/** A section's booking page, optionally on a space and a day. */
export function bookPath(slug: string, q: { resource?: string; date?: string } = {}): string {
  const params = new URLSearchParams();
  if (q.resource) params.set('resource', q.resource);
  if (q.date) params.set('date', q.date);
  const query = params.toString();
  return `/${slug}/book${query ? `?${query}` : ''}`;
}
