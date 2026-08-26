import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

/** How long an unused invitation stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface GeneratedInvite {
  /** Handed to the invitee exactly once; never stored. */
  token: string;
  /** Stored in the database in place of the token. */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Invitation tokens are bearer credentials, so only their hash is persisted.
 * A database dump then contains nothing that can be used to join.
 */
export function generateInvite(now: Date = new Date()): GeneratedInvite {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  };
}

/** SHA-256 is enough here: the token is 256 bits of entropy, not a password. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison, so lookups cannot be timed to recover a token. */
export function inviteTokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashInviteToken(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');

  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function isInviteUsable(invite: { expiresAt: Date; acceptedAt: Date | null }, now: Date = new Date()): boolean {
  return invite.acceptedAt === null && invite.expiresAt.getTime() > now.getTime();
}
