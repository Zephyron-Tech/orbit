import { prisma } from '@orbit-api/lib/db/prisma';
import type { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

/**
 * Every check in checks/*.ts calls this pair around a send: check first
 * (skip the send entirely if already sent), send, then mark. The cadence of
 * each notification type — once ever, once/day, once/month, once/week — is
 * entirely a function of how the caller builds `dedupeKey`, never of this
 * table's shape. See the dedupeKey table in the notifications plan for the
 * exact format per type.
 */
export async function wasAlreadySent(userId: string, type: NotificationType, dedupeKey: string): Promise<boolean> {
  const existing = await prisma.sentNotification.findUnique({
    where: { userId_type_dedupeKey: { userId, type, dedupeKey } },
    select: { id: true },
  });
  return existing !== null;
}

export async function markSent(
  userId: string,
  type: NotificationType,
  dedupeKey: string,
  content: { title: string; body: string; data?: Prisma.InputJsonValue },
): Promise<void> {
  await prisma.sentNotification.create({ data: { userId, type, dedupeKey, title: content.title, body: content.body, data: content.data } });
}
