import { describe, expect, it } from 'vitest';

import { generateInvite, hashInviteToken, inviteTokenMatches, isInviteUsable, INVITE_TTL_MS } from './invites';

const now = new Date('2026-08-18T10:00:00.000Z');

describe('invites', () => {
  it('never stores the raw token', () => {
    const invite = generateInvite(now);

    expect(invite.tokenHash).not.toContain(invite.token);
    expect(invite.tokenHash).toBe(hashInviteToken(invite.token));
  });

  it('issues a unique token each time', () => {
    expect(generateInvite(now).token).not.toBe(generateInvite(now).token);
  });

  it('expires after the configured window', () => {
    const invite = generateInvite(now);

    expect(invite.expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
  });

  it('matches only the issued token', () => {
    const invite = generateInvite(now);

    expect(inviteTokenMatches(invite.token, invite.tokenHash)).toBe(true);
    expect(inviteTokenMatches('forged-token', invite.tokenHash)).toBe(false);
  });

  it('rejects a malformed stored hash without throwing', () => {
    expect(inviteTokenMatches('anything', 'zz')).toBe(false);
  });

  it('is unusable once accepted or expired', () => {
    const invite = generateInvite(now);

    expect(isInviteUsable({ expiresAt: invite.expiresAt, acceptedAt: null }, now)).toBe(true);
    expect(isInviteUsable({ expiresAt: invite.expiresAt, acceptedAt: now }, now)).toBe(false);
    expect(
      isInviteUsable({ expiresAt: invite.expiresAt, acceptedAt: null }, new Date(now.getTime() + INVITE_TTL_MS + 1)),
    ).toBe(false);
  });
});
