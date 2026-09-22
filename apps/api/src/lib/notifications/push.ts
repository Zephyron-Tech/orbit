import { Expo } from 'expo-server-sdk';

import { prisma } from '@orbit-api/lib/db/prisma';

const expo = new Expo();

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Sends a push notification to one user's registered device, if any. A
 * no-op (not an error) when the user has no expoPushToken — most users
 * won't have granted notification permission yet, and that's a normal
 * state, not a failure. Clears a token Expo reports as no longer
 * registered (app uninstalled, permission revoked at the OS level) so a
 * dead token doesn't keep getting retried on every future send.
 */
export async function sendPushToUser(userId: string, notification: PushNotification): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } });
  const token = user?.expoPushToken;
  if (!token || !Expo.isExpoPushToken(token)) return;

  const [ticket] = await expo.sendPushNotificationsAsync([
    { to: token, title: notification.title, body: notification.body, data: notification.data, sound: 'default' },
  ]);

  if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
    await prisma.user.update({ where: { id: userId }, data: { expoPushToken: null } });
  }
}
