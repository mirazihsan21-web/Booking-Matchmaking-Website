import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';
import { routeRequest } from '@/lib/site/route';

// Headers @supabase/ssr sets so responses carrying a refreshed session are never cached.
const CARRIED_HEADERS = ['cache-control', 'expires', 'pragma'];
// A path with no page, so Next answers with the site's 404.
const NOT_FOUND = '/__not-found';
// Old venue hosts are answered by this route handler: a redirect sent from the proxy to the site's own
// host is turned into a relative one by Next when that host is also Next's own (local dev), which
// would send the browser back to the old host forever.
const MOVED = '/api/moved';

/** Copies the refreshed session cookies (and their no-cache headers) onto the response we return. */
function carrySession(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  for (const name of CARRIED_HEADERS) {
    const value = from.headers.get(name);
    if (value) to.headers.set(name, value);
  }
  return to;
}

/**
 * 1. Old venue hosts (`<slug>.<root>`) are sent to the same page on the one site.
 * 2. Refreshes the Supabase session.
 * 3. The old internal venue routes (`/t/…`) are a 404.
 */
export async function proxy(request: NextRequest) {
  // The job tick: called by the database (as host.docker.internal locally) and authorized by its own
  // secret, so it needs neither a session nor host routing.
  if (request.nextUrl.pathname.startsWith('/api/jobs/')) return NextResponse.next();

  const route = routeRequest(request.headers.get('host'), request.nextUrl, process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000');
  if (route.kind === 'redirect') {
    const url = request.nextUrl.clone();
    url.pathname = MOVED;
    url.search = '';
    const headers = new Headers(request.headers);
    headers.set('x-moved-to', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  const session = await updateSession(request);
  if (route.kind === 'not_found') {
    const url = request.nextUrl.clone();
    url.pathname = NOT_FOUND;
    return carrySession(session, NextResponse.rewrite(url, { request: { headers: request.headers } }));
  }
  return session;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
