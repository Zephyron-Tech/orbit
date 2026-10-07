import { useScrollToTop } from 'expo-router';
import { CalendarBlankIcon, CaretDownIcon, ChartLineUpIcon, TagIcon, WalletIcon, WarningCircleIcon, type Icon } from 'phosphor-react-native';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Badge } from '../../components/badge';
import { Pressable } from '../../components/pressable';
import { ListSkeleton, SkeletonCard } from '../../components/skeleton';
import { useFuel } from '../../hooks/use-fuel';
import { colors } from '../../lib/colors';
import { haptics } from '../../lib/haptics';
import { formatDate } from '../../lib/format-date';
import { formatMoney } from '../../lib/format-money';
import { formatPeriod } from '../../lib/period';
import type { FuelMonthlyRow } from '../../lib/response-types';

/** "1 účtenka" / "2 účtenky" / "5 účtenek" — same rule apps/web's fuel page follows. */
function pluralizeReceipt(count: number): string {
  if (count === 1) return `${count} účtenka`;
  if (count >= 2 && count <= 4) return `${count} účtenky`;
  return `${count} účtenek`;
}

function StatCard({
  icon: IconComponent,
  label,
  value,
  detail,
  tone = 'default',
  fullWidth = false,
}: {
  icon: Icon;
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'positive' | 'critical';
  fullWidth?: boolean;
}): React.JSX.Element {
  const valueColor = tone === 'positive' ? 'text-positive' : tone === 'critical' ? 'text-critical' : 'text-ink';
  return (
    <View className="gap-1 rounded-lg border border-line bg-surface p-3" style={{ width: fullWidth ? '100%' : '47%' }}>
      <View className="flex-row items-center gap-1.5">
        <IconComponent color={colors.inkMuted} size={14} weight="regular" />
        <Text className="text-xs text-ink-muted" numberOfLines={1}>{label}</Text>
      </View>
      <Text className={`font-sans-semibold text-lg ${valueColor}`} numberOfLines={1}>{value}</Text>
      <Text className="text-xs text-ink-faint" numberOfLines={1}>{detail}</Text>
    </View>
  );
}

/**
 * The rotation lives on a plain RN Animated.View wrapper, not on the SVG
 * icon's own `style` prop — applying an array style (marginLeft +
 * conditional transform) directly to react-native-svg's icon component was
 * what made it vanish after the first rotation instead of just rotating.
 */
function ExpandChevronIcon({ open }: { open: boolean }): React.JSX.Element {
  const rotation = useSharedValue(0);
  rotation.value = withTiming(open ? 180 : 0, { duration: 200 });
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  return (
    <Animated.View style={[{ marginLeft: 8 }, style]}>
      <CaretDownIcon color={colors.inkMuted} size={16} weight="regular" />
    </Animated.View>
  );
}

export default function FuelScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch } = useFuel();
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [discountExpanded, setDiscountExpanded] = useState(false);
  // Deliberately local, not tied to isRefetching — same fix as dashboard.tsx
  // and net-worth.tsx: a pull only ever sets this itself, so it can never
  // react to a background refetch of this query triggered elsewhere.
  const [pulling, setPulling] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);

  async function handlePullRefresh(): Promise<void> {
    haptics.tapLight();
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  }

  if (isPending) {
    return (
      <View className="flex-1 gap-4 bg-canvas p-4">
        <SkeletonCard />
        <ListSkeleton rows={4} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Přehled paliva se nepodařilo načíst'}</Text>
      </View>
    );
  }

  // API returns oldest-first (apps/web's FuelManager relies on that order) —
  // newest-first is what makes sense to read on mobile, so reverse here.
  const monthsNewestFirst: FuelMonthlyRow[] = [...data.overview.monthly].reverse();

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const currentMonthRow = data.overview.monthly.find((row) => row.month === currentMonthKey) ?? null;

  // Average over the last up to 3 months actually present — not all-time,
  // per the user's own framing ("průměr za poslední 3 měsíce, teď máme jen 2").
  const recentMonths = data.overview.monthly.slice(-3);
  const averageCzk = recentMonths.length > 0 ? recentMonths.reduce((sum, row) => sum + Number(row.totalCzk), 0) / recentMonths.length : 0;

  const unmatchedCount = data.overview.unmatchedReceiptCount;

  const monthlyDiscount = data.overview.monthlyDiscount;
  const averageDiscountCzk =
    monthlyDiscount.length > 0 ? monthlyDiscount.reduce((sum, row) => sum + Number(row.discountCzk), 0) / monthlyDiscount.length : 0;

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void handlePullRefresh()} tintColor={colors.accent} />}
    >
      <View className="flex-row flex-wrap justify-between gap-y-3">
        <StatCard
          icon={CalendarBlankIcon}
          label="Aktuální měsíc"
          value={currentMonthRow ? formatMoney(currentMonthRow.totalCzk) : '—'}
          detail={formatPeriod(currentMonthKey)}
        />
        <StatCard
          icon={ChartLineUpIcon}
          label="Průměr"
          value={recentMonths.length > 0 ? formatMoney(String(averageCzk)) : '—'}
          detail={`za posledních ${recentMonths.length} ${recentMonths.length === 1 ? 'měsíc' : 'měsíce'}`}
        />
        <StatCard
          icon={WalletIcon}
          label="Zůstatek na kartě"
          value={formatMoney(data.overview.walletBalanceCzk)}
          detail={`${data.overview.topUpCount} dobití · ${data.overview.purchaseCount} nákupů`}
        />
        <Pressable
          accessibilityLabel="Sleva díky Tankartě — zobrazit rozpad podle měsíce"
          accessibilityState={{ expanded: discountExpanded }}
          onPress={() => { setDiscountExpanded((open) => !open); }}
          style={{ width: '47%' }}
        >
          <StatCard
            icon={TagIcon}
            label="Sleva díky Tankartě"
            value={formatMoney(data.overview.totalDiscountCzk)}
            detail={pluralizeReceipt(data.overview.receiptCount)}
            tone="positive"
            fullWidth
          />
        </Pressable>
        {unmatchedCount > 0 ? (
          <StatCard
            icon={WarningCircleIcon}
            label="Nespárované účtenky"
            value={String(unmatchedCount)}
            detail="Vyžadují kontrolu"
            tone="critical"
            fullWidth
          />
        ) : null}
      </View>

      {discountExpanded ? (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} className="gap-2 rounded-lg border border-line bg-surface p-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-sans-semibold text-sm text-ink">Sleva podle měsíce</Text>
            <Text className="text-xs text-ink-muted">Průměr {formatMoney(String(averageDiscountCzk))}/měsíc</Text>
          </View>
          {monthlyDiscount.length === 0 ? (
            <Text className="text-sm text-ink-muted">Zatím žádná data.</Text>
          ) : (
            [...monthlyDiscount].reverse().map((row) => (
              <View key={row.month} className="flex-row items-center justify-between">
                <Text className="text-sm capitalize text-ink-muted">{formatPeriod(row.month)}</Text>
                <Text className="text-sm font-sans-medium text-ink">{formatMoney(row.discountCzk)}</Text>
              </View>
            ))
          )}
        </Animated.View>
      ) : null}

      <View className="gap-2">
        <Text className="font-sans-semibold text-base text-ink">Přehled podle měsíce</Text>
        {monthsNewestFirst.length === 0 ? (
          <Text className="text-ink-muted">Zatím žádná data.</Text>
        ) : (
          monthsNewestFirst.map((row) => {
            const isOpen = expandedMonth === row.month;
            const missingCount = row.purchases.filter((p) => p.missingReceipt).length;
            return (
              <Animated.View key={row.month} layout={LinearTransition.duration(200)} className="overflow-hidden rounded-lg border border-line bg-surface">
                <Pressable
                  onPress={() => { setExpandedMonth(isOpen ? null : row.month); }}
                  accessibilityLabel={formatPeriod(row.month)}
                  accessibilityState={{ expanded: isOpen }}
                  className="flex-row items-center justify-between p-3 active:bg-surface-subtle"
                >
                  <View className="flex-1 pr-2">
                    <Text className="font-sans-medium capitalize text-ink">{formatPeriod(row.month)}</Text>
                    {missingCount > 0 ? (
                      <View className="mt-1 flex-row items-center gap-1 self-start">
                        <Badge tone="warning">{`${missingCount}× chybí účtenka`}</Badge>
                      </View>
                    ) : null}
                  </View>
                  <Text className="font-sans-medium text-ink">
                    {formatMoney(row.totalCzk)} · {row.liters} l
                  </Text>
                  <ExpandChevronIcon open={isOpen} />
                </Pressable>
                {isOpen ? (
                  <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} className="border-t border-line bg-surface-subtle">
                    {row.purchases.length === 0 ? (
                      <Text className="p-3 text-sm text-ink-muted">Žádné nákupy.</Text>
                    ) : (
                      [...row.purchases].reverse().map((purchase, index) => (
                        <View
                          key={purchase.id}
                          className={`flex-row items-center justify-between p-3 ${index < row.purchases.length - 1 ? 'border-b border-line' : ''}`}
                        >
                          <View className="flex-1 pr-3">
                            <View className="flex-row items-center gap-1.5">
                              <Text className="text-sm text-ink" numberOfLines={1}>
                                {purchase.stationName}
                              </Text>
                              {purchase.missingReceipt ? <WarningCircleIcon color="#8a5a13" size={14} weight="fill" /> : null}
                            </View>
                            <Text className="text-xs text-ink-muted">
                              {formatDate(purchase.purchasedAt)} · {purchase.quantityLiters} l
                            </Text>
                          </View>
                          <Text className="text-sm font-sans-medium text-ink">{formatMoney(purchase.amountCzk)}</Text>
                        </View>
                      ))
                    )}
                  </Animated.View>
                ) : null}
              </Animated.View>
            );
          })
        )}
      </View>

      <Text className="text-xs text-ink-faint">Nahrávání účtenek a exportů se dělá na obrazovce Import.</Text>
    </ScrollView>
  );
}
