import { prisma } from '@orbit-api/lib/db/prisma';
import type { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { wasAlreadySent, markSent } from './dedupe';
import { PREFERENCE_KEY_BY_TYPE, parseNotificationPreferences } from './preferences';
import { sendPushToUser, type PushNotification } from './push';

/**
 * The one place every check in checks/*.ts funnels through: loads every
 * active user, skips anyone with this type turned off or who's already had
 * this exact `dedupeKey` sent, otherwise records it in SentNotification (so
 * it shows up in the in-app notification center regardless of device) and
 * pushes it (a no-op inside sendPushToUser if the user has no registered
 * token — that must never block the in-app record). Household-wide
 * conditions (most of the 14 — this is a 2-user shared-data household, not
 * multi-tenant) call this once per check with the same dedupeKey; each user
 * gets their own preference check and their own `SentNotification` row, so
 * one partner opting out never affects the other.
 */
export async function notifyEligibleUsers(type: NotificationType, dedupeKey: string, notification: PushNotification): Promise<number> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, notificationPreferences: true },
  });

  const preferenceKey = PREFERENCE_KEY_BY_TYPE[type];
  let sent = 0;

  for (const user of users) {
    const preferences = parseNotificationPreferences(user.notificationPreferences);
    if (!preferences[preferenceKey]) continue;
    if (await wasAlreadySent(user.id, type, dedupeKey)) continue;

    await sendPushToUser(user.id, notification);
    await markSent(user.id, type, dedupeKey, { title: notification.title, body: notification.body, data: notification.data as Prisma.InputJsonValue | undefined });
    sent += 1;
  }

  return sent;
}

export interface NotifiableEntity {
  dedupeKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Same gating as notifyEligibleUsers, but for a check whose condition can
 * match an unbounded number of rows (fuel-receipt-missing fired 340
 * individual pushes in one run on real data — every one of these once-ever
 * checks has the same unbounded shape). Every entity still gets its own
 * SentNotification row with its own title/body — the in-app notification
 * center shows each one individually, with its own "open"/"delete" — but
 * the user is only interrupted with **one** push per run: their own real
 * content if there's exactly one new entity, otherwise `summarize`'s count.
 */
export async function notifyEligibleUsersBatch(type: NotificationType, entities: readonly NotifiableEntity[], summarize: (entities: readonly NotifiableEntity[]) => PushNotification): Promise<number> {
  if (entities.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, notificationPreferences: true },
  });

  const preferenceKey = PREFERENCE_KEY_BY_TYPE[type];
  let batchesSent = 0;

  for (const user of users) {
    const preferences = parseNotificationPreferences(user.notificationPreferences);
    if (!preferences[preferenceKey]) continue;

    const newEntities: NotifiableEntity[] = [];
    for (const entity of entities) {
      if (!(await wasAlreadySent(user.id, type, entity.dedupeKey))) newEntities.push(entity);
    }
    if (newEntities.length === 0) continue;

    const notification = newEntities.length === 1 ? { title: newEntities[0]!.title, body: newEntities[0]!.body, data: newEntities[0]!.data } : summarize(newEntities);
    await sendPushToUser(user.id, notification);

    for (const entity of newEntities) {
      await markSent(user.id, type, entity.dedupeKey, { title: entity.title, body: entity.body, data: entity.data as Prisma.InputJsonValue | undefined });
    }
    batchesSent += 1;
  }

  return batchesSent;
}
