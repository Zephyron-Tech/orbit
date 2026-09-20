import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { usePortfolio, useRefreshPortfolio } from '../../../hooks/use-portfolio';

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

      {latest ? (
        <View className="rounded-xl border border-neutral-200 p-4">
          <Text className="text-sm text-neutral-500">{latest.accountName}</Text>
          <Text className="mt-1 text-2xl font-semibold text-neutral-900">
            {latest.balance} {latest.currency}
          </Text>
          {latest.investedValue ? <Text className="mt-2 text-sm text-neutral-500">Vloženo: {latest.investedValue}</Text> : null}
          {latest.unrealizedPnl ? <Text className="text-sm text-neutral-500">Nerealizovaný zisk/ztráta: {latest.unrealizedPnl}</Text> : null}
          <Text className="mt-2 text-xs text-neutral-400">Aktualizováno {new Date(latest.capturedAt).toLocaleString('cs-CZ')}</Text>
        </View>
      ) : (
        <Text className="text-center text-neutral-500">Zatím žádná data portfolia.</Text>
      )}
    </ScrollView>
  );
}
