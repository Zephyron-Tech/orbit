import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken, signAccessToken } from '@orbit-api/lib/auth/jwt';
import { hashPassword, verifyPassword, WeakPasswordError } from '@orbit-api/lib/auth/password';
import { needsFirstUser } from '@orbit-api/lib/auth/users';
import { prisma } from '@orbit-api/lib/db/prisma';
import { SESSION_COOKIE, requireAuth } from '@orbit-api/middleware/auth';
import { getEnv } from '@orbit-api/lib/validation/env';

const REFRESH_COOKIE = 'orbit_refresh';
const isProd = process.env.NODE_ENV === 'production';

function setSessionCookies(c: Context, access: string, refresh: string): void {
  const domain = getEnv().COOKIE_DOMAIN;
  setCookie(c, SESSION_COOKIE, access, { httpOnly: true, secure: isProd, sameSite: 'Lax', path: '/', domain, maxAge: 15 * 60 });
  setCookie(c, REFRESH_COOKIE, refresh, { httpOnly: true, secure: isProd, sameSite: 'Lax', path: '/', domain, maxAge: 30 * 24 * 60 * 60 });
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export const auth = new Hono()
  .post('/login', async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Zadejte e-mail a heslo' }, 400);

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    // Always calls verifyPassword, even for a missing user, so a nonexistent
    // account doesn't respond measurably faster than a wrong password.
    const passwordOk = await verifyPassword(parsed.data.password, user?.passwordHash ?? '');

    if (!user || !passwordOk || !user.isActive) {
      return c.json({ error: 'Nesprávný e-mail nebo heslo' }, 401);
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

    const access = await signAccessToken(user);
    const refresh = await issueRefreshToken(user.id);
    const isMobile = c.req.header('X-Client') === 'mobile';

    if (isMobile) {
      return c.json({ user: { id: user.id, email: user.email, role: user.role }, accessToken: access, refreshToken: refresh });
    }

    setSessionCookies(c, access, refresh);
    return c.json({ user: { id: user.id, email: user.email, role: user.role } });
  })
  .post('/refresh', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const presented = (typeof body?.refreshToken === 'string' && body.refreshToken) || getCookie(c, REFRESH_COOKIE);
    if (!presented) return c.json({ error: 'Chybí refresh token' }, 401);

    const result = await rotateRefreshToken(presented);
    if (!result.ok) return c.json({ error: 'Neplatný refresh token' }, 401);

    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    if (!user || !user.isActive) return c.json({ error: 'Neplatný refresh token' }, 401);

    const access = await signAccessToken(user);
    const isMobile = c.req.header('X-Client') === 'mobile';

    if (isMobile) {
      return c.json({ accessToken: access, refreshToken: result.token });
    }

    setSessionCookies(c, access, result.token);
    return c.json({ ok: true });
  })
  .post('/logout', async (c) => {
    const presented = getCookie(c, REFRESH_COOKIE);
    if (presented) await revokeRefreshToken(presented);
    const domain = getEnv().COOKIE_DOMAIN;
    deleteCookie(c, SESSION_COOKIE, { path: '/', domain });
    deleteCookie(c, REFRESH_COOKIE, { path: '/', domain });
    return c.json({ ok: true });
  })
  .get('/session', requireAuth, async (c) => {
    const claims = c.get('user');
    // Re-checked against the DB (not just the JWT claims) so a deactivated
    // account is rejected here even before its access token expires — the
    // same guard `apps/web`'s old dashboard layout used to run itself.
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, name: true, role: true, isActive: true } });
    if (!user || !user.isActive) return c.json({ error: 'Přihlaste se prosím' }, 401);
    return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  })
  .get('/setup', async (c) => {
    return c.json({ needsFirstUser: await needsFirstUser() });
  })
  .post('/setup', async (c) => {
    if (!(await needsFirstUser())) {
      return c.json({ error: 'Účet už existuje' }, 409);
    }

    const parsed = z
      .object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(120), password: z.string() })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatná data' }, 400);

    let passwordHash: string;
    try {
      passwordHash = await hashPassword(parsed.data.password);
    } catch (error: unknown) {
      if (error instanceof WeakPasswordError) return c.json({ error: error.message }, 400);
      throw error;
    }

    const user = await prisma.user.create({
      data: { email: parsed.data.email, name: parsed.data.name, passwordHash, role: 'OWNER' },
    });

    const access = await signAccessToken(user);
    const refresh = await issueRefreshToken(user.id);
    setSessionCookies(c, access, refresh);

    return c.json({ user: { id: user.id, email: user.email, role: user.role } }, 201);
  });
