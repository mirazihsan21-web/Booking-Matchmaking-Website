import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';
import { resolveHost } from '@/lib/tenancy/host';

// Headers @supabase/ssr sets so responses carrying a refreshed session are never cached.
const CARRIED_HEADERS = ['cache-control', 'expires', 'pragma'];

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
 * 1. Refreshes the Supabase session.
 * 2. Routes by host: `<slug>.<root>` is rewritten to the internal tenant routes `/t/<slug>/…`;
 *    unknown hosts and direct `/t/…` requests on the root host get a 404.
 */
export async function proxy(request: NextRequest) {
  const session = await updateSession(request);
  const target = resolveHost(request.headers.get('host'), process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000');
  const { pathname } = request.nextUrl;

  const rewriteTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    return carrySession(session, NextResponse.rewrite(url, { request: { headers: request.headers } }));
  };

  if (target.kind === 'tenant') {
    if (pathname.startsWith('/auth/')) return session;
    return rewriteTo(`/t/${target.slug}${pathname === '/' ? '' : pathname}`);
  }
  if (target.kind === 'unknown') return rewriteTo('/unavailable-host');
  if (pathname === '/t' || pathname.startsWith('/t/')) return rewriteTo('/unavailable-host');
  return session;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
