import { useScrollToTop } from 'expo-router';
import { ArrowsClockwiseIcon, MagnifyingGlassIcon, TrendDownIcon, TrendUpIcon } from 'phosphor-react-native';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { LineChart } from '../../components/line-chart';
import { Pressable } from '../../components/pressable';
import { ListSkeleton, SkeletonCard } from '../../components/skeleton';
import { TextField } from '../../components/text-field';
import { usePortfolio, useRefreshPortfolio } from '../../hooks/use-portfolio';
import { colors } from '../../lib/colors';
import { haptics } from '../../lib/haptics';
import { formatMoney } from '../../lib/format-money';
import { parseSnapshotRawData, type PortfolioPosition } from '../../lib/portfolio-parse';

const QUANTITY_FORMAT = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 4 });

// Same set Trading 212's own app uses (1D/1W/1M/3M/YTD/1Y/MAX), Czech-labeled.
const CHART_PERIODS: { label: string; cutoff: () => number | null }[] = [
  { label: '1D', cutoff: () => Date.now() - 1 * 24 * 60 * 60 * 1000 },
  { label: '1T', cutoff: () => Date.now() - 7 * 24 * 60 * 60 * 1000 },
  { label: '1M', cutoff: () => Date.now() - 30 * 24 * 60 * 60 * 1000 },
  { label: '3M', cutoff: () => Date.now() - 90 * 24 * 60 * 60 * 1000 },
  { label: 'YTD', cutoff: () => new Date(new Date().getFullYear(), 0, 1).getTime() },
  { label: '1R', cutoff: () => Date.now() - 365 * 24 * 60 * 60 * 1000 },
  { label: 'Vše', cutoff: () => null },
];

type PositionSortKey = 'value' | 'name' | 'pnl';

const SORT_OPTIONS: { key: PositionSortKey; label: string }[] = [
  { key: 'value', label: 'Hodnota' },
  { key: 'pnl', label: 'Zisk/ztráta' },
  { key: 'name', label: 'Název' },
];

function Chip({ label, active, onPress, className = '' }: { label: string; active: boolean; onPress: () => void; className?: string }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      className={`items-center rounded-full border px-3 py-1.5 active:bg-surface-subtle ${active ? 'border-accent bg-accent-soft' : 'border-line bg-surface'} ${className}`}
    >
      <Text className={`text-xs font-sans-medium ${active ? 'text-accent' : 'text-ink-muted'}`}>{label}</Text>
    </Pressable>
  );
}

/** Icon spins while `pending` — the button's own layout (icon + label) never changes shape or collapses into a bare spinner. */
function RefreshButton({ pending, onPress }: { pending: boolean; onPress: () => void }): React.JSX.Element {
  const rotation = useSharedValue(0);
  rotation.value = pending ? withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1) : withTiming(0, { duration: 150 });
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityLabel="Obnovit"
      className={`flex-row items-center justify-center gap-2 rounded-lg bg-accent py-3 ${pending ? 'opacity-70' : 'active:bg-accent-hover'}`}
    >
      <Animated.View style={iconStyle}>
        <ArrowsClockwiseIcon color={colors.accentForeground} size={16} weight="bold" />
      </Animated.View>
      <Text className="font-sans-medium text-accent-foreground">Obnovit</Text>
    </Pressable>
  );
}

function positionMatches(position: PortfolioPosition, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return position.name.toLowerCase().includes(q) || position.ticker.toLowerCase().includes(q);
}

export default function PortfolioScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch } = usePortfolio();
  const refresh = useRefreshPortfolio();
  const [chartPeriod, setChartPeriod] = useState('Vše');
  const [positionQuery, setPositionQuery] = useState('');
  const [sortKey, setSortKey] = useState<PositionSortKey>('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Deliberately local, not tied to isRefetching: that flag also flips true
  // for the background refetch the "Obnovit" button's own invalidateQueries
  // triggers, which raced with refresh.isPending clearing and made the pull
  // spinner pop in right after the button's spinner stopped — two spins for
  // one tap. A pull only ever sets this itself, so it can never react to
  // anything the button does.
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
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Portfolio se nepodařilo načíst'}</Text>
      </View>
    );
  }

  const latest = data.snapshots.at(-1) ?? null;
  const currency = latest?.currency.trim().toUpperCase() ?? '';
  const parsed = latest ? parseSnapshotRawData(latest.rawData) : null;
  const unrealized = latest?.unrealizedPnl ? Number(latest.unrealizedPnl) : 0;

  const activePeriod = CHART_PERIODS.find((period) => period.label === chartPeriod) ?? CHART_PERIODS[CHART_PERIODS.length - 1];
  const chartCutoff = activePeriod?.cutoff() ?? null;
  // Only include snapshots in the same currency as the latest one — the
  // same guard apps/web's portfolio page applies before plotting history.
  // Period filtering is client-side only — the API has no date-range
  // param and already returns the full (bounded) history in one call.
  const historyPoints = data.snapshots
    .filter((snapshot) => snapshot.currency.trim().toUpperCase() === currency)
    .filter((snapshot) => chartCutoff === null || new Date(snapshot.capturedAt).getTime() >= chartCutoff)
    .map((snapshot) => ({
      x: new Date(snapshot.capturedAt).getTime(),
      y: Number(snapshot.balance),
      label: new Date(snapshot.capturedAt).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }),
    }));

  const filteredPositions = parsed ? parsed.positions.filter((position) => positionMatches(position, positionQuery)) : [];
  const sortedPositions = [...filteredPositions].sort((a, b) => {
    const factor = sortDir === 'desc' ? -1 : 1;
    if (sortKey === 'name') return factor * a.name.localeCompare(b.name, 'cs');
    if (sortKey === 'pnl') return factor * (a.unrealizedProfitLoss - b.unrealizedProfitLoss);
    return factor * (a.value - b.value);
  });

  function handleSortPress(key: PositionSortKey): void {
    haptics.tapLight();
    if (key === sortKey) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void handlePullRefresh()} tintColor={colors.accent} />}
    >
      <RefreshButton pending={refresh.isPending} onPress={() => refresh.mutate()} />

      {refresh.isError ? <Text className="text-sm text-critical">{refresh.error instanceof Error ? refresh.error.message : 'Synchronizace selhala'}</Text> : null}

      {latest && parsed ? (
        <>
          {parsed.integrityIssues.length > 0 ? (
            <View className="rounded-lg border border-warning/25 bg-warning-soft p-3">
              <Text className="text-sm text-warning">
                Poskytovatel uložil neplatný {parsed.integrityIssues.join(' a ')}. Základní hodnoty níže pocházejí z databáze, ale podrobnosti nepovažujte za spolehlivé.
              </Text>
            </View>
          ) : null}

          <View className="rounded-2xl border border-line bg-surface p-6">
            <Text className="text-sm text-ink-muted">{latest.accountName}</Text>
            <Text className="font-sans-semibold mt-1 text-4xl text-ink">{formatMoney(latest.balance, currency)}</Text>

            {latest.unrealizedPnl ? (
              <View className="mt-3 flex-row items-center gap-1.5">
                {unrealized < 0 ? <TrendDownIcon color={colors.critical} size={22} weight="bold" /> : <TrendUpIcon color={colors.positive} size={22} weight="bold" />}
                <Text className={`font-sans-semibold text-lg ${unrealized < 0 ? 'text-critical' : 'text-positive'}`}>{formatMoney(latest.unrealizedPnl, currency)}</Text>
                <Text className="text-sm text-ink-muted">nerealizovaný zisk/ztráta</Text>
              </View>
            ) : null}

            <View className="mt-4 flex-row gap-x-6 gap-y-2 border-t border-line pt-4">
              <View className="flex-1">
                <Text className="text-xs text-ink-muted">Hodnota pozic</Text>
                <Text className="font-sans-medium text-ink">{formatMoney(latest.investedValue ?? '0', currency)}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-ink-muted">Hotovost</Text>
                <Text className="font-sans-medium text-ink">{formatMoney(latest.cashBalance ?? '0', currency)}</Text>
              </View>
            </View>
            <Text className="mt-3 text-xs text-ink-faint">
              Aktualizováno {new Date(latest.updatedAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>

          <View className="gap-2">
            <Text className="font-sans-semibold text-base text-ink">Vývoj hodnoty</Text>
            <LineChart points={historyPoints} currency={currency} />
            <View className="flex-row gap-1.5">
              {CHART_PERIODS.map((period) => (
                <Chip key={period.label} label={period.label} active={chartPeriod === period.label} onPress={() => setChartPeriod(period.label)} className="flex-1" />
              ))}
            </View>
          </View>

          {parsed.positions.length > 0 ? (
            <View className="gap-2">
              <Text className="font-sans-semibold text-base text-ink">Otevřené pozice ({parsed.positions.length})</Text>

              <View className="flex-row items-center gap-2 rounded-lg border border-line bg-surface px-3">
                <MagnifyingGlassIcon color={colors.inkMuted} size={16} weight="regular" />
                <TextField
                  className="flex-1 border-0 bg-transparent px-0 py-2"
                  placeholder="Hledat pozici…"
                  value={positionQuery}
                  onChangeText={setPositionQuery}
                  returnKeyType="search"
                />
              </View>

              <View className="flex-row flex-wrap gap-1.5">
                {SORT_OPTIONS.map((option) => (
                  <Chip
                    key={option.key}
                    label={sortKey === option.key ? `${option.label} ${sortDir === 'desc' ? '↓' : '↑'}` : option.label}
                    active={sortKey === option.key}
                    onPress={() => handleSortPress(option.key)}
                  />
                ))}
              </View>

              {sortedPositions.length === 0 ? (
                <Text className="py-4 text-center text-sm text-ink-muted">Žádná pozice neodpovídá hledání.</Text>
              ) : (
                sortedPositions.map((position) => (
                  <View key={position.id} className="rounded-lg border border-line bg-surface p-3">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="font-sans-semibold text-ink" numberOfLines={1}>{position.name}</Text>
                        <Text className="text-xs text-ink-muted">{position.ticker}</Text>
                      </View>
                      <Text className="font-sans-medium text-ink">{formatMoney(String(position.value), currency)}</Text>
                    </View>
                    <View className="mt-2 flex-row justify-between">
                      <Text className="text-xs text-ink-muted">Množství: {QUANTITY_FORMAT.format(position.quantity)}</Text>
                      <Text className={`font-sans-medium text-xs ${position.unrealizedProfitLoss < 0 ? 'text-critical' : 'text-positive'}`}>
                        {formatMoney(String(position.unrealizedProfitLoss), currency)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </>
      ) : (
        <Text className="text-center text-ink-muted">Zatím žádná data portfolia.</Text>
      )}
    </ScrollView>
  );
}
