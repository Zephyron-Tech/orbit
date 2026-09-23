import { prisma } from '@orbit-api/lib/db/prisma';
import type { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { wasAlreadySent, markSent } from './dedupe';
import { PREFERENCE_KEY_BY_TYPE, parseNotificationPreferences } from './preferences';
import { sendPushToUser, type PushNotification } from './push';

/**
 * The one place every check in checks/*.ts funnels through: loads every
 * active user with a registered device, skips anyone with this type turned
 * off or who's already had this exact `dedupeKey` sent, otherwise sends and
 * records it. Household-wide conditions (most of the 14 — this is a 2-user
 * shared-data household, not multi-tenant) call this once per check with the
 * same dedupeKey; each user gets their own preference check and their own
 * `SentNotification` row, so one partner opting out never affects the other.
 */
export async function notifyEligibleUsers(type: NotificationType, dedupeKey: string, notification: PushNotification): Promise<number> {
  const users = await prisma.user.findMany({
    where: { isActive: true, expoPushToken: { not: null } },
    select: { id: true, notificationPreferences: true },
  });

  const preferenceKey = PREFERENCE_KEY_BY_TYPE[type];
  let sent = 0;

  for (const user of users) {
    const preferences = parseNotificationPreferences(user.notificationPreferences);
    if (!preferences[preferenceKey]) continue;
    if (await wasAlreadySent(user.id, type, dedupeKey)) continue;

    await sendPushToUser(user.id, notification);
    await markSent(user.id, type, dedupeKey);
    sent += 1;
  }

  return sent;
}

/** Cheap short-circuit for a check whose own data-gathering is expensive: true only if at least one eligible user could receive this type. */
export async function anyUserWantsType(type: NotificationType): Promise<boolean> {
  const users = await prisma.user.findMany({
    where: { isActive: true, expoPushToken: { not: null } },
    select: { notificationPreferences: true },
  });

  const preferenceKey = PREFERENCE_KEY_BY_TYPE[type];
  return users.some((user) => parseNotificationPreferences(user.notificationPreferences)[preferenceKey]);
}
