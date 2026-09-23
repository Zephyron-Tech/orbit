import { useRouter } from 'expo-router';
import {
  BankIcon,
  BellIcon,
  CarIcon,
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  CreditCardIcon,
  GasPumpIcon,
  HandshakeIcon,
  LinkBreakIcon,
  PiggyBankIcon,
  ReceiptIcon,
  TagIcon,
  TrashIcon,
  TrendUpIcon,
  WarningCircleIcon,
  type Icon,
} from 'phosphor-react-native';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { Pressable } from '../../../components/pressable';
import { Skeleton } from '../../../components/skeleton';
import { FadeInView } from '../../../components/fade-in';
import { useDeleteAllNotifications, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../../../hooks/use-notifications';
import { colors } from '../../../lib/colors';
import { haptics } from '../../../lib/haptics';
import type { NotificationRow } from '../../../lib/response-types';

type Tone = 'accent' | 'warning' | 'danger' | 'positive';

const TONE_STYLES: Record<Tone, { bg: string; fg: string }> = {
  accent: { bg: 'bg-accent-soft', fg: colors.accent },
  warning: { bg: 'bg-warning-soft', fg: colors.warning },
  danger: { bg: 'bg-critical-soft', fg: colors.critical },
  positive: { bg: 'bg-positive-soft', fg: colors.positive },
};

// One entry per NotificationType (apps/api's enum) — icon, tone, and where
// tapping the card should take the user. Reuses the same icon vocabulary as
// dashboard.tsx's ACTION_ICONS / net-worth.tsx's TYPE_ICON rather than
// inventing a second one.
const NOTIFICATION_META: Record<string, { icon: Icon; tone: Tone; href: string }> = {
  INSURANCE_RENEWAL: { icon: CarIcon, tone: 'warning', href: '/(tabs)/more/insurance' },
  PORTFOLIO_DIGEST: { icon: ChartLineUpIcon, tone: 'accent', href: '/(tabs)/portfolio' },
  DCA_OVERDUE: { icon: ClockCounterClockwiseIcon, tone: 'warning', href: '/(tabs)/more/planning' },
  RECURRING_EXPENSE_OVERDUE: { icon: ReceiptIcon, tone: 'warning', href: '/(tabs)/more/planning' },
  UNMATCHED_TRANSFER_STUCK: { icon: LinkBreakIcon, tone: 'warning', href: '/(tabs)/net-worth' },
  STATEMENT_COVERAGE_GAP: { icon: BankIcon, tone: 'warning', href: '/(tabs)/net-worth' },
  FAILED_IMPORT_ROW: { icon: WarningCircleIcon, tone: 'danger', href: '/(tabs)/more/import' },
  SETTLEMENT_NOT_CLOSED: { icon: HandshakeIcon, tone: 'warning', href: '/(tabs)/more/settlement' },
  DIVIDEND_RECEIVED: { icon: TrendUpIcon, tone: 'positive', href: '/(tabs)/portfolio' },
  UNCATEGORIZED_PILEUP: { icon: TagIcon, tone: 'warning', href: '/(tabs)/more/transactions' },
  BIG_PORTFOLIO_MOVE: { icon: ChartLineUpIcon, tone: 'accent', href: '/(tabs)/portfolio' },
  CASH_BUFFER_LOW: { icon: PiggyBankIcon, tone: 'danger', href: '/(tabs)/net-worth' },
  CREDIT_UTILIZATION_HIGH: { icon: CreditCardIcon, tone: 'danger', href: '/(tabs)/more/accounts' },
  FUEL_RECEIPT_MISSING: { icon: GasPumpIcon, tone: 'warning', href: '/(tabs)/fuel' },
};
const DEFAULT_META: { icon: Icon; tone: Tone; href: string | null } = { icon: BellIcon, tone: 'accent', href: null };

function pluralizeDays(count: number): string {
  if (count === 1) return '1 den';
  if (count >= 2 && count <= 4) return `${count} dny`;
  return `${count} dní`;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'právě teď';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return pluralizeDays(days);
  return new Date(iso).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

/** "Dnes" / "Včera" / "Starší" — compared on the local calendar day, not a 24h rolling window. */
function dayBucket(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Dnes';
  if (sameDay(date, yesterday)) return 'Včera';
  return 'Starší';
}

function groupByDay(notifications: NotificationRow[]): { bucket: string; rows: NotificationRow[] }[] {
  const order = ['Dnes', 'Včera', 'Starší'];
  const groups = new Map<string, NotificationRow[]>();
  for (const notification of notifications) {
    const bucket = dayBucket(notification.sentAt);
    groups.set(bucket, [...(groups.get(bucket) ?? []), notification]);
  }
  return order.flatMap((bucket) => {
    const rows = groups.get(bucket);
    return rows ? [{ bucket, rows }] : [];
  });
}

function NotificationCard({ notification, onPress, index }: { notification: NotificationRow; onPress: () => void; index: number }): React.JSX.Element {
  const unread = !notification.readAt;
  const meta = NOTIFICATION_META[notification.type] ?? DEFAULT_META;
  const tone = TONE_STYLES[meta.tone];

  return (
    <FadeInView delay={Math.min(index, 8) * 30}>
      <Animated.View layout={LinearTransition.duration(200)}>
        <Pressable
          accessibilityLabel={notification.title}
          onPress={onPress}
          className={`flex-row gap-3 rounded-xl border p-4 active:bg-surface-subtle ${unread ? 'border-accent/25 bg-accent-soft' : 'border-line bg-surface'}`}
        >
          <View className={`size-10 shrink-0 items-center justify-center rounded-xl ${tone.bg}`}>
            <meta.icon color={tone.fg} size={19} weight="regular" />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text className={`flex-1 text-sm text-ink ${unread ? 'font-sans-semibold' : 'font-sans-medium'}`}>{notification.title}</Text>
              <Text className="text-xs text-ink-faint">{relativeTime(notification.sentAt)}</Text>
            </View>
            <Text className="mt-1 text-sm leading-relaxed text-ink-muted">{notification.body}</Text>
          </View>
          {unread ? <View className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" /> : null}
        </Pressable>
      </Animated.View>
    </FadeInView>
  );
}

export default function NotificationLogScreen(): React.JSX.Element {
  const router = useRouter();
  const { data, isPending, isError, error, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteAll = useDeleteAllNotifications();
  // Deliberately local, not tied to isRefetching — same fix as every other
  // screen's RefreshControl in this app: a pull only ever sets this itself,
  // never a background refetch triggered elsewhere (e.g. mark-as-read's own
  // invalidateQueries).
  const [pulling, setPulling] = useState(false);

  function handlePress(notification: NotificationRow): void {
    haptics.tapLight();
    if (!notification.readAt) markRead.mutate(notification.id);
    const href = NOTIFICATION_META[notification.type]?.href;
    if (href) router.push(href as never);
  }

  function handleMarkAllRead(): void {
    haptics.tapLight();
    markAllRead.mutate();
  }

  function handleDeleteAll(): void {
    haptics.tapLight();
    Alert.alert('Smazat všechna oznámení?', 'Historii oznámení nejde vrátit zpět.', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Smazat vše', style: 'destructive', onPress: () => deleteAll.mutate() },
    ]);
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
        <View className="size-14 items-center justify-center rounded-2xl bg-accent-soft">
          <BellIcon color={colors.accent} size={26} weight="regular" />
        </View>
        <Text className="mt-2 text-center font-sans-semibold text-base text-ink">Zatím žádná oznámení</Text>
        <Text className="text-center text-sm text-ink-muted">Push notifikace, které dostaneš, se tu objeví i se zpětnou historií.</Text>
      </View>
    );
  }

  const groups = groupByDay(data.notifications);

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-2 p-4"
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void handlePullRefresh()} tintColor={colors.accent} />}
    >
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-sm text-ink-muted">
          {data.unreadCount > 0 ? `${data.unreadCount} ${data.unreadCount === 1 ? 'nepřečtené' : data.unreadCount < 5 ? 'nepřečtená' : 'nepřečtených'}` : 'Vše přečteno'}
        </Text>
        <View className="flex-row items-center gap-4">
          {data.unreadCount > 0 ? (
            <Pressable accessibilityLabel="Označit vše jako přečtené" onPress={handleMarkAllRead} hitSlop={8}>
              <Text className="font-sans-medium text-sm text-accent">Označit vše</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityLabel="Smazat všechna oznámení" onPress={handleDeleteAll} hitSlop={8}>
            <TrashIcon color={colors.critical} size={18} weight="regular" />
          </Pressable>
        </View>
      </View>

      {groups.map((group) => (
        <View key={group.bucket} className="gap-2">
          <Text className="mt-2 font-sans-semibold text-xs uppercase tracking-wide text-ink-faint">{group.bucket}</Text>
          {group.rows.map((notification, index) => (
            <NotificationCard key={notification.id} notification={notification} index={index} onPress={() => handlePress(notification)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
