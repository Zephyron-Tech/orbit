import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowSquareOutIcon, TrashIcon } from 'phosphor-react-native';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../components/button';
import { useDeleteNotification, useNotifications } from '../../../hooks/use-notifications';
import { haptics } from '../../../lib/haptics';
import { notificationMeta, TONE_STYLES } from '../../../lib/notification-meta';

const FULL_DATE_FORMAT = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function NotificationDetailScreen(): React.JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // The list screen always loads before this one is reachable, so the
  // notification is already in cache — no second GET-by-id endpoint needed.
  const { data } = useNotifications();
  const deleteNotification = useDeleteNotification();

  const notification = data?.notifications.find((row) => row.id === id);

  if (!notification) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-ink-muted">Oznámení už není k dispozici.</Text>
      </View>
    );
  }

  const meta = notificationMeta(notification.type);
  const tone = TONE_STYLES[meta.tone];

  const handleOpen = (): void => {
    haptics.tapLight();
    if (meta.href) {
      router.replace(meta.href as never);
    }
  };

  const handleDelete = (): void => {
    haptics.tapMedium();
    const notificationId = notification.id;
    Alert.alert('Smazat oznámení?', undefined, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: () => {
          deleteNotification.mutate(notificationId, { onSuccess: () => router.back() });
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-4 p-4">
      <View className="items-center gap-3 rounded-2xl border border-line bg-surface p-6">
        <View className={`size-14 items-center justify-center rounded-2xl ${tone.bg}`}>
          <meta.icon color={tone.fg} size={26} weight="regular" />
        </View>
        <Text className="text-center font-sans-semibold text-lg text-ink">{notification.title}</Text>
        <Text className="text-center text-sm leading-relaxed text-ink-muted">{notification.body}</Text>
        <Text className="text-xs text-ink-faint">{FULL_DATE_FORMAT.format(new Date(notification.sentAt))}</Text>
      </View>

      {meta.href ? (
        <Button variant="primary" icon={ArrowSquareOutIcon} onPress={handleOpen}>
          Otevřít
        </Button>
      ) : null}
      <Button variant="destructive" icon={TrashIcon} loading={deleteNotification.isPending} onPress={handleDelete}>
        Smazat oznámení
      </Button>
    </ScrollView>
  );
}
