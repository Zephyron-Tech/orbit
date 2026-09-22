import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../../components/badge';
import { ListSkeleton, SkeletonCard } from '../../../components/skeleton';
import { useFuel } from '../../../hooks/use-fuel';
import { formatMoney } from '../../../lib/format-money';

export default function FuelScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = useFuel();

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

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#17647c" />}
    >
      <View className="gap-2">
        <Text className="font-sans-semibold text-base text-ink">Poslední měsíce</Text>
        {data.overview.monthly.map((row) => (
          <View key={row.month} className="flex-row items-center justify-between rounded-lg border border-line bg-surface p-3">
            <Text className="text-ink">{row.month}</Text>
            <Text className="font-sans-medium text-ink">
              {formatMoney(row.totalCzk)} · {row.liters} l
            </Text>
          </View>
        ))}
      </View>

      <View className="gap-2">
        <Text className="font-sans-semibold text-base text-ink">Poslední účtenky</Text>
        {data.receipts.length === 0 ? (
          <Text className="text-ink-muted">Žádné účtenky.</Text>
        ) : (
          data.receipts.map((receipt) => (
            <View key={receipt.id} className="rounded-lg border border-line bg-surface p-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-ink" numberOfLines={1}>
                    {receipt.stationName ?? 'Neznámá stanice'}
                  </Text>
                  <Text className="text-xs text-ink-muted">{new Date(receipt.purchasedAt).toLocaleDateString('cs-CZ')}</Text>
                </View>
                <Text className="font-sans-medium text-ink">{formatMoney(receipt.totalAfterDiscount)}</Text>
              </View>
              <View className="mt-1.5 flex-row items-center justify-between">
                {receipt.matched ? <Badge tone="success">Spárováno</Badge> : <Badge tone="warning">Čeká</Badge>}
                {Number(receipt.discountAmount) > 0 ? <Text className="text-xs text-positive">sleva {formatMoney(receipt.discountAmount)}</Text> : null}
              </View>
            </View>
          ))
        )}
      </View>

      <Text className="text-xs text-ink-faint">Nahrávání účtenek a exportů se dělá na obrazovce Import.</Text>
    </ScrollView>
  );
}
