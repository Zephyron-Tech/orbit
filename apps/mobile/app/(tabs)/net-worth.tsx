import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useDismissUnmatchedTransfer, useNetWorth } from '../../hooks/use-net-worth';

export default function NetWorthScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = useNetWorth();
  const dismissTransfer = useDismissUnmatchedTransfer();

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
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Čisté jmění se nepodařilo načíst'}</Text>
      </View>
    );
  }

  if (data.empty) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-neutral-500">Zatím žádné aktivní účty.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="rounded-xl border border-neutral-200 p-4">
        <Text className="text-sm text-neutral-500">Celkové čisté jmění</Text>
        <Text className="mt-1 text-2xl font-semibold text-neutral-900">{data.totalWorth.toLocaleString('cs-CZ')} Kč</Text>
        <View className="mt-3 flex-row gap-4">
          <View>
            <Text className="text-xs text-neutral-500">Hotovost</Text>
            <Text className="text-neutral-900">{data.cashValue.toLocaleString('cs-CZ')} Kč</Text>
          </View>
          <View>
            <Text className="text-xs text-neutral-500">Investice</Text>
            <Text className="text-neutral-900">{data.investmentValue.toLocaleString('cs-CZ')} Kč</Text>
          </View>
          <View>
            <Text className="text-xs text-neutral-500">Závazky</Text>
            <Text className="text-neutral-900">{data.liabilityValue.toLocaleString('cs-CZ')} Kč</Text>
          </View>
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-500">Účty</Text>
        {data.cardAccounts.map((account) => (
          <View key={account.id} className="rounded-lg border border-neutral-200 p-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-medium text-neutral-900">{account.name}</Text>
              <Text className="text-neutral-900">{account.balance} Kč</Text>
            </View>
            {account.incomplete ? <Text className="mt-1 text-xs text-amber-700">Neúplná historie — hodnota je jen spodní odhad.</Text> : null}
          </View>
        ))}
      </View>

      {data.unmatchedTransfers.length > 0 ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-neutral-500">Nespárované převody</Text>
          {data.unmatchedTransfers.map((transfer) => (
            <View key={transfer.id} className="rounded-lg border border-neutral-200 p-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="font-medium text-neutral-900">{transfer.accountName}</Text>
                  <Text className="text-xs text-neutral-500">{transfer.date.slice(0, 10)} · {transfer.merchant}</Text>
                </View>
                <Text className="text-neutral-900">{transfer.amount.toLocaleString('cs-CZ')} {transfer.currency}</Text>
              </View>
              <Pressable
                onPress={() => dismissTransfer.mutate(transfer.id)}
                disabled={dismissTransfer.isPending}
                className="mt-2 self-start rounded-md bg-neutral-100 px-3 py-1.5"
              >
                <Text className="text-sm text-neutral-700">Skrýt</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
