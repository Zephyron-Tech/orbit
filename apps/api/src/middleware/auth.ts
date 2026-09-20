import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import type { AccessTokenClaims } from '@orbit-api/lib/auth/jwt';
import { verifyAccessToken } from '@orbit-api/lib/auth/jwt';

export const SESSION_COOKIE = 'orbit_session';

export type AuthEnv = { Variables: { user: AccessTokenClaims } };
type Env = AuthEnv;

/**
 * Serves both transports from one check: a web browser sends the httpOnly
 * `orbit_session` cookie automatically, a mobile client sends `Authorization:
 * Bearer <token>`. Whichever is present wins; only one is ever set by a real
 * client at a time.
 */
export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  const claims = token ? await verifyAccessToken(token) : null;

  if (!claims) {
    return c.json({ error: 'Přihlaste se prosím' }, 401);
  }

  c.set('user', claims);
  await next();
});

export function requireRole(role: AccessTokenClaims['role']) {
  return createMiddleware<Env>(async (c, next) => {
    const user = c.get('user');
    if (user.role !== role) {
      return c.json({ error: 'Nemáte oprávnění' }, 403);
    }
    await next();
  });
}
