import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { LineChart } from '../../../components/line-chart';
import { usePortfolio, useRefreshPortfolio } from '../../../hooks/use-portfolio';
import { parseSnapshotRawData } from '../../../lib/portfolio-parse';

const QUANTITY_FORMAT = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 4 });

export default function PortfolioScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = usePortfolio();
  const refresh = useRefreshPortfolio();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Portfolio se nepodařilo načíst'}</Text>
      </View>
    );
  }

  const latest = data.snapshots.at(-1) ?? null;
  const currency = latest?.currency.trim().toUpperCase() ?? '';
  const parsed = latest ? parseSnapshotRawData(latest.rawData) : null;
  const sortedPositions = parsed ? [...parsed.positions].sort((a, b) => b.value - a.value) : [];

  // Only include snapshots in the same currency as the latest one — the
  // same guard apps/web's portfolio page applies before plotting history.
  const historyPoints = data.snapshots
    .filter((snapshot) => snapshot.currency.trim().toUpperCase() === currency)
    .map((snapshot) => ({
      x: new Date(snapshot.capturedAt).getTime(),
      y: Number(snapshot.balance),
      label: new Date(snapshot.capturedAt).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }),
    }));

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <Pressable onPress={() => refresh.mutate()} disabled={refresh.isPending} className="items-center rounded-lg bg-neutral-900 py-3">
        <Text className="font-medium text-white">{refresh.isPending ? 'Synchronizuji…' : 'Obnovit'}</Text>
      </Pressable>

      {refresh.isError ? <Text className="text-sm text-red-600">{refresh.error instanceof Error ? refresh.error.message : 'Synchronizace selhala'}</Text> : null}

      {latest && parsed ? (
        <>
          {parsed.integrityIssues.length > 0 ? (
            <View className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <Text className="text-sm text-amber-800">
                Poskytovatel uložil neplatný {parsed.integrityIssues.join(' a ')}. Základní hodnoty níže pocházejí z databáze, ale podrobnosti nepovažujte za spolehlivé.
              </Text>
            </View>
          ) : null}

          <View className="rounded-xl border border-neutral-200 p-4">
            <Text className="text-sm text-neutral-500">{latest.accountName}</Text>
            <Text className="mt-1 text-2xl font-semibold text-neutral-900">
              {latest.balance} {currency}
            </Text>
            <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-2">
              {latest.investedValue ? (
                <View>
                  <Text className="text-xs text-neutral-500">Hodnota pozic</Text>
                  <Text className="text-neutral-900">{latest.investedValue} {currency}</Text>
                </View>
              ) : null}
              {latest.unrealizedPnl ? (
                <View>
                  <Text className="text-xs text-neutral-500">Nerealizovaný zisk/ztráta</Text>
                  <Text className={Number(latest.unrealizedPnl) < 0 ? 'text-red-600' : 'text-emerald-600'}>
                    {latest.unrealizedPnl} {currency}
                  </Text>
                </View>
              ) : null}
              <View>
                <Text className="text-xs text-neutral-500">Hotovost</Text>
                <Text className="text-neutral-900">{latest.cashBalance ?? '0'} {currency}</Text>
              </View>
            </View>
            <Text className="mt-2 text-xs text-neutral-400">Aktualizováno {new Date(latest.capturedAt).toLocaleString('cs-CZ')}</Text>
          </View>

          <View className="gap-2">
            <Text className="text-sm font-medium text-neutral-500">Vývoj hodnoty</Text>
            <LineChart points={historyPoints} currency={currency} />
          </View>

          {sortedPositions.length > 0 ? (
            <View className="gap-2">
              <Text className="text-sm font-medium text-neutral-500">Otevřené pozice ({sortedPositions.length})</Text>
              {sortedPositions.map((position) => (
                <View key={position.id} className="rounded-lg border border-neutral-200 p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <Text className="font-medium text-neutral-900">{position.ticker}</Text>
                      <Text className="text-xs text-neutral-500" numberOfLines={1}>{position.name}</Text>
                    </View>
                    <Text className="font-medium text-neutral-900">{position.value.toLocaleString('cs-CZ')} {currency}</Text>
                  </View>
                  <View className="mt-2 flex-row justify-between">
                    <Text className="text-xs text-neutral-500">Množství: {QUANTITY_FORMAT.format(position.quantity)}</Text>
                    <Text className={`text-xs font-medium ${position.unrealizedProfitLoss < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {position.unrealizedProfitLoss.toLocaleString('cs-CZ')} {currency}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text className="text-center text-neutral-500">Zatím žádná data portfolia.</Text>
      )}
    </ScrollView>
  );
}
