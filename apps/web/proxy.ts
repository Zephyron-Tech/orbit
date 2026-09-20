import { NextResponse, type NextRequest } from 'next/server';

/**
 * Routes reachable without a session.
 *
 * `/setup` and `/invite` must be here by construction: they are how a
 * person gets an account in the first place.
 */
const PUBLIC_PREFIXES = ['/signin', '/setup', '/invite'];

const SESSION_COOKIE = 'orbit_session';

/**
 * Next.js 16 renamed the `middleware` convention to `proxy`; the default
 * export is still the handler.
 *
 * This is a UX-only redirect, not the real security boundary: it only checks
 * that the API's session cookie is *present*, not that it's still valid —
 * the API itself re-verifies the JWT (and re-reads `isActive` from the DB,
 * see `GET /auth/session`) on every real request regardless. Checking here
 * only avoids rendering a page that would immediately fail its own API
 * calls; a stale or expired cookie still gets redirected the first time a
 * page's data fetch 401s.
 */
export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const signInUrl = new URL('/signin', request.nextUrl.origin);
  signInUrl.searchParams.set('callbackUrl', pathname);

  return NextResponse.redirect(signInUrl);
}

export const config = {
  // Skip Next.js internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon).*)'],
};
