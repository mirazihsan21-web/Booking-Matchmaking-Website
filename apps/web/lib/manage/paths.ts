/** Old manage pages (under `/manage/<brand slug>`) and where each lives now. */
const MOVED: Record<string, string> = {
  resources: '/manage/sections',
  activities: '/manage/sections',
  sections: '/manage/sections',
  settings: '/manage/brand',
  bookings: '/manage/bookings',
  schedule: '/manage/schedule',
  staff: '/manage/staff',
};

/**
 * The new address of an old manage page (`/manage/<brandSlug>/…`, from before R3), or null when the path
 * isn't one. A game moves to `/manage/games/<id>`; anything unknown goes to Today.
 */
export function oldManagePath(pathname: string, brandSlug: string): string | null {
  if (!brandSlug) return null;
  const prefix = `/manage/${brandSlug}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  const [page, id] = pathname.slice(prefix.length).split('/').filter(Boolean);
  if (page === 'sessions' && id) return `/manage/games/${id}`;
  return (page && MOVED[page]) ?? '/manage';
}
