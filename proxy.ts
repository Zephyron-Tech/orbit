import NextAuth from 'next-auth';

import { authConfig } from '@/lib/auth/config';

const { auth } = NextAuth(authConfig);

/**
 * Routes reachable without a session.
 *
 * `/api/setup` and `/api/invites/accept` must be here by construction: they are
 * how a person gets an account in the first place. `/api/setup` guards itself by
 * refusing once any user exists, and `/api/invites/accept` requires a valid
 * single-use token. `/api/invites` (creating them) stays protected.
 */
const PUBLIC_PREFIXES = [
  '/signin',
  '/setup',
  '/invite',
  '/api/auth',
  '/api/setup',
  '/api/invites/accept',
  '/api/health',
  '/api/cron',
];

// Next.js 16 renamed the `middleware` convention to `proxy`; the default export
// is still the handler. Auth.js wraps it so `request.auth` carries the session.
export default auth((request) => {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return undefined;
  }

  if (request.auth) {
    return undefined;
  }

  // An API client wants a status code, not a login page.
  if (pathname.startsWith('/api/')) {
    return Response.json({ error: 'Přihlaste se prosím' }, { status: 401 });
  }

  const signInUrl = new URL('/signin', request.nextUrl.origin);
  signInUrl.searchParams.set('callbackUrl', pathname);

  return Response.redirect(signInUrl);
});

export const config = {
  // Skip Next.js internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon).*)'],
};
