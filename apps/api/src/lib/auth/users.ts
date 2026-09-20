import { prisma } from '@orbit-api/lib/db/prisma';
import type { UserRole } from '@orbit-api/lib/generated/prisma/enums';

import { generateInvite, hashInviteToken, isInviteUsable } from './invites';
import { hashPassword } from './password';

export class InviteError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_TOKEN' | 'EMAIL_TAKEN' | 'PENDING_INVITE',
  ) {
    super(message);
    this.name = 'InviteError';
  }
}

export interface CreatedInvite {
  id: string;
  email: string;
  /** Full URL handed to the invitee. Shown once and never stored. */
  url: string;
  expiresAt: Date;
}

/** Creates an invitation and returns the one-time link for it. */
export async function createInvite(params: {
  email: string;
  role: UserRole;
  createdById: string;
  origin: string;
}): Promise<CreatedInvite> {
  const email = params.email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    throw new InviteError('Uživatel s tímto e-mailem už existuje', 'EMAIL_TAKEN');
  }

  const pendingInvite = await prisma.invite.findFirst({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });

  if (pendingInvite) {
    throw new InviteError('Pro tento e-mail už existuje platná pozvánka. Nejdřív ji zrušte.', 'PENDING_INVITE');
  }

  const invite = generateInvite();

  const created = await prisma.invite.create({
    data: {
      email,
      role: params.role,
      tokenHash: invite.tokenHash,
      expiresAt: invite.expiresAt,
      createdById: params.createdById,
    },
  });

  return {
    id: created.id,
    email,
    url: `${params.origin}/invite/${invite.token}`,
    expiresAt: invite.expiresAt,
  };
}

/** Looks an invitation up by its raw token. Returns null when unusable. */
export async function findUsableInvite(token: string): Promise<{ id: string; email: string; role: UserRole } | null> {
  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashInviteToken(token) } });

  if (!invite || !isInviteUsable(invite)) {
    return null;
  }

  return { id: invite.id, email: invite.email, role: invite.role };
}

/**
 * Turns an invitation into a user. The invite is marked accepted in the same
 * transaction as the insert, so a link cannot be redeemed twice.
 */
export async function acceptInvite(params: { token: string; name: string; password: string }): Promise<void> {
  const invite = await findUsableInvite(params.token);

  if (!invite) {
    throw new InviteError('Pozvánka je neplatná nebo vypršela', 'INVALID_TOKEN');
  }

  const passwordHash = await hashPassword(params.password);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new InviteError('Pozvánka už byla použita', 'INVALID_TOKEN');
    }

    await tx.user.create({
      data: {
        email: invite.email,
        name: params.name.trim() || null,
        passwordHash,
        role: invite.role,
      },
    });
  });
}

/** True when nobody can sign in yet, so the first account may be created freely. */
export async function needsFirstUser(): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}
