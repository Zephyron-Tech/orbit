import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useFuel } from '../../../hooks/use-fuel';

export default function FuelScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = useFuel();

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
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Přehled paliva se nepodařilo načíst'}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-500">Poslední měsíce</Text>
        {data.overview.monthly.map((row) => (
          <View key={row.month} className="flex-row items-center justify-between rounded-lg border border-neutral-200 p-3">
            <Text className="text-neutral-900">{row.month}</Text>
            <Text className="text-neutral-900">
              {row.totalCzk} Kč · {row.liters} l
            </Text>
          </View>
        ))}
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-500">Poslední účtenky</Text>
        {data.receipts.length === 0 ? (
          <Text className="text-neutral-500">Žádné účtenky.</Text>
        ) : (
          data.receipts.map((receipt) => (
            <View key={receipt.id} className="rounded-lg border border-neutral-200 p-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-neutral-900" numberOfLines={1}>
                    {receipt.stationName ?? 'Neznámá stanice'}
                  </Text>
                  <Text className="text-xs text-neutral-500">{new Date(receipt.purchasedAt).toLocaleDateString('cs-CZ')}</Text>
                </View>
                <Text className="text-neutral-900">{receipt.totalAfterDiscount} Kč</Text>
              </View>
              <View className="mt-1.5 flex-row items-center justify-between">
                <View className={`self-start rounded-full px-2 py-0.5 ${receipt.matched ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                  <Text className={`text-xs ${receipt.matched ? 'text-emerald-700' : 'text-amber-700'}`}>{receipt.matched ? 'spárováno' : 'nespárováno'}</Text>
                </View>
                {Number(receipt.discountAmount) > 0 ? <Text className="text-xs text-emerald-700">sleva {receipt.discountAmount} Kč</Text> : null}
              </View>
            </View>
          ))
        )}
      </View>

      <Text className="text-xs text-neutral-400">Nahrávání účtenek a exportů se dělá na obrazovce Import.</Text>
    </ScrollView>
  );
}
