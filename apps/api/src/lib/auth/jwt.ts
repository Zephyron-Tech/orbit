import { createHash, randomBytes } from 'node:crypto';

import { sign, verify } from 'hono/jwt';

import { prisma } from '@orbit-api/lib/db/prisma';
import type { UserRole } from '@orbit-api/lib/generated/prisma/enums';
import { getEnv } from '@orbit-api/lib/validation/env';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessTokenClaims {
  [key: string]: unknown;
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export async function signAccessToken(user: { id: string; email: string; role: UserRole }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenClaims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };
  return sign(payload, getEnv().AUTH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const payload = await verify(token, getEnv().AUTH_SECRET, 'HS256');
    return payload as unknown as AccessTokenClaims;
  } catch {
    return null;
  }
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Issues a new opaque refresh token, storing only its hash. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return token;
}

export type RefreshResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; error: 'INVALID' | 'EXPIRED' | 'REVOKED' };

/**
 * Verifies a refresh token and rotates it: the presented token is revoked and
 * a fresh one issued in the same call, regardless of outcome path. Rotation
 * means a stolen-and-replayed old token fails distinguishably (REVOKED) from
 * one that was simply never valid (INVALID) — worth telling apart if this
 * ever needs a "someone used your old refresh token" alert, not needed yet.
 */
export async function rotateRefreshToken(presentedToken: string): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(presentedToken);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!row) {
    return { ok: false, error: 'INVALID' };
  }
  if (row.revokedAt) {
    return { ok: false, error: 'REVOKED' };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'EXPIRED' };
  }

  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  const nextToken = await issueRefreshToken(row.userId);

  return { ok: true, userId: row.userId, token: nextToken };
}

export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(presentedToken);
  await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
}
