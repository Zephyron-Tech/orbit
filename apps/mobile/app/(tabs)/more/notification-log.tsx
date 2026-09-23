import { BellIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Pressable } from '../../../components/pressable';
import { Skeleton } from '../../../components/skeleton';
import { useMarkNotificationRead, useNotifications } from '../../../hooks/use-notifications';
import { colors } from '../../../lib/colors';
import type { NotificationRow } from '../../../lib/response-types';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'právě teď';
  if (minutes < 60) return `před ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `před ${days} dny`;
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function NotificationCard({ notification, onPress }: { notification: NotificationRow; onPress: () => void }): React.JSX.Element {
  const unread = !notification.readAt;
  return (
    <Pressable
      accessibilityLabel={notification.title}
      onPress={onPress}
      className={`flex-row gap-3 rounded-xl border p-4 active:bg-surface-subtle ${unread ? 'border-accent/25 bg-accent-soft' : 'border-line bg-surface'}`}
    >
      {unread ? <View className="mt-1.5 size-2 rounded-full bg-accent" /> : <View className="mt-1.5 size-2" />}
      <View className="flex-1">
        <View className="flex-row items-start justify-between gap-2">
          <Text className={`flex-1 text-sm text-ink ${unread ? 'font-sans-semibold' : 'font-sans-medium'}`}>{notification.title}</Text>
          <Text className="text-xs text-ink-faint">{relativeTime(notification.sentAt)}</Text>
        </View>
        <Text className="mt-1 text-sm text-ink-muted">{notification.body}</Text>
      </View>
    </Pressable>
  );
}

export default function NotificationLogScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  // Deliberately local, not tied to isRefetching — same fix as every other
  // screen's RefreshControl in this app: a pull only ever sets this itself,
  // never a background refetch triggered elsewhere (e.g. mark-as-read's own
  // invalidateQueries).
  const [pulling, setPulling] = useState(false);

  function handlePress(notification: NotificationRow): void {
    if (!notification.readAt) markRead.mutate(notification.id);
  }

  async function handlePullRefresh(): Promise<void> {
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  }

  if (isPending) {
    return (
      <View className="flex-1 gap-3 bg-canvas p-4">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Oznámení se nepodařilo načíst'}</Text>
      </View>
    );
  }

  if (data.notifications.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-canvas px-6">
        <BellIcon color={colors.inkFaint} size={32} weight="regular" />
        <Text className="text-center text-ink-muted">Zatím žádná oznámení.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-2 p-4"
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void handlePullRefresh()} tintColor={colors.accent} />}
    >
      {data.notifications.map((notification) => (
        <NotificationCard key={notification.id} notification={notification} onPress={() => handlePress(notification)} />
      ))}
    </ScrollView>
  );
}
