import { ArrowsClockwiseIcon, TrendDownIcon, TrendUpIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../components/button';
import { LineChart } from '../../../components/line-chart';
import { ListSkeleton, SkeletonCard } from '../../../components/skeleton';
import { usePortfolio, useRefreshPortfolio } from '../../../hooks/use-portfolio';
import { formatMoney } from '../../../lib/format-money';
import { parseSnapshotRawData } from '../../../lib/portfolio-parse';

const QUANTITY_FORMAT = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 4 });

const CHART_PERIODS: { label: string; days: number | null }[] = [
  { label: '7D', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '1R', days: 365 },
  { label: 'Vše', days: null },
];

function PeriodChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} className={`rounded-full border px-3 py-1 active:bg-surface-subtle ${active ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
      <Text className={`text-xs font-sans-medium ${active ? 'text-accent' : 'text-ink-muted'}`}>{label}</Text>
    </Pressable>
  );
}

export default function PortfolioScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = usePortfolio();
  const refresh = useRefreshPortfolio();
  const [chartDays, setChartDays] = useState<number | null>(null);

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
  const sortedPositions = parsed ? [...parsed.positions].sort((a, b) => b.value - a.value) : [];
  const unrealized = latest?.unrealizedPnl ? Number(latest.unrealizedPnl) : 0;

  // Only include snapshots in the same currency as the latest one — the
  // same guard apps/web's portfolio page applies before plotting history.
  // Period filtering is client-side only — the API has no date-range
  // param and already returns the full (bounded) history in one call.
  const chartCutoff = chartDays === null ? null : Date.now() - chartDays * 24 * 60 * 60 * 1000;
  const historyPoints = data.snapshots
    .filter((snapshot) => snapshot.currency.trim().toUpperCase() === currency)
    .filter((snapshot) => chartCutoff === null || new Date(snapshot.capturedAt).getTime() >= chartCutoff)
    .map((snapshot) => ({
      x: new Date(snapshot.capturedAt).getTime(),
      y: Number(snapshot.balance),
      label: new Date(snapshot.capturedAt).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }),
    }));

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#17647c" />}
    >
      <Button variant="primary" icon={ArrowsClockwiseIcon} loading={refresh.isPending} onPress={() => refresh.mutate()}>
        Obnovit
      </Button>

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

          <View className="rounded-lg border border-line bg-surface p-5">
            <Text className="text-sm text-ink-muted">{latest.accountName}</Text>
            <Text className="font-sans-semibold mt-1 text-3xl text-ink">
              {formatMoney(latest.balance, currency)}
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-2">
              {latest.investedValue ? (
                <View>
                  <Text className="text-xs text-ink-muted">Hodnota pozic</Text>
                  <Text className="font-sans-medium text-ink">{formatMoney(latest.investedValue, currency)}</Text>
                </View>
              ) : null}
              {latest.unrealizedPnl ? (
                <View>
                  <Text className="text-xs text-ink-muted">Nerealizovaný zisk/ztráta</Text>
                  <View className="flex-row items-center gap-1">
                    {unrealized < 0 ? <TrendDownIcon color="#a43c3c" size={13} weight="regular" /> : <TrendUpIcon color="#1c6b4c" size={13} weight="regular" />}
                    <Text className={`font-sans-medium ${unrealized < 0 ? 'text-critical' : 'text-positive'}`}>{formatMoney(latest.unrealizedPnl, currency)}</Text>
                  </View>
                </View>
              ) : null}
              <View>
                <Text className="text-xs text-ink-muted">Hotovost</Text>
                <Text className="font-sans-medium text-ink">{formatMoney(latest.cashBalance ?? '0', currency)}</Text>
              </View>
            </View>
            <Text className="mt-2 text-xs text-ink-faint">Aktualizováno {new Date(latest.capturedAt).toLocaleString('cs-CZ')}</Text>
          </View>

          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-semibold text-base text-ink">Vývoj hodnoty</Text>
              <View className="flex-row gap-1.5">
                {CHART_PERIODS.map((period) => (
                  <PeriodChip key={period.label} label={period.label} active={chartDays === period.days} onPress={() => setChartDays(period.days)} />
                ))}
              </View>
            </View>
            <LineChart points={historyPoints} currency={currency} />
          </View>

          {sortedPositions.length > 0 ? (
            <View className="gap-2">
              <Text className="font-sans-semibold text-base text-ink">Otevřené pozice ({sortedPositions.length})</Text>
              {sortedPositions.map((position) => (
                <View key={position.id} className="rounded-lg border border-line bg-surface p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="font-sans-semibold text-ink">{position.ticker}</Text>
                      <Text className="text-xs text-ink-muted" numberOfLines={1}>{position.name}</Text>
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
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text className="text-center text-ink-muted">Zatím žádná data portfolia.</Text>
      )}
    </ScrollView>
  );
}
