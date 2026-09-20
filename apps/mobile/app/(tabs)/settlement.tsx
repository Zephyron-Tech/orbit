import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { useCloseSettlement, useMarkSettled, useReopenSettlement, useSettlement } from '../../hooks/use-settlement';

const MONTH_LABELS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = (month - 1 + delta + 12) % 12;
  const yearDelta = Math.floor((month - 1 + delta) / 12);
  return { year: year + yearDelta, month: zeroBased + 1 };
}

export default function SettlementScreen(): React.JSX.Element {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const [notes, setNotes] = useState('');

  const { data, isPending, isError, error, refetch, isRefetching } = useSettlement(period.year, period.month);
  const closeSettlement = useCloseSettlement();
  const reopenSettlement = useReopenSettlement();
  const markSettled = useMarkSettled();

  function handleClose(): void {
    Alert.alert('Uzavřít vyrovnání?', `${MONTH_LABELS[period.month - 1]} ${period.year}`, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Uzavřít',
        onPress: () =>
          closeSettlement.mutate(
            { year: period.year, month: period.month, notes: notes.trim() || null },
            { onError: (mutationError) => Alert.alert('Nepodařilo se uzavřít', mutationError instanceof Error ? mutationError.message : 'Zkuste to znovu.') },
          ),
      },
    ]);
  }

  function handleReopen(id: string): void {
    Alert.alert('Znovu otevřít vyrovnání?', 'Vrátí transakce zpět do editovatelného stavu.', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Otevřít', onPress: () => reopenSettlement.mutate({ id, year: period.year, month: period.month }) },
    ]);
  }

  return (
    <View className="flex-1 bg-white">
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3">
        <Pressable onPress={() => setPeriod((current) => shiftMonth(current.year, current.month, -1))} className="px-2 py-1">
          <Text className="text-lg text-neutral-900">‹</Text>
        </Pressable>
        <Text className="font-medium text-neutral-900">
          {MONTH_LABELS[period.month - 1]} {period.year}
        </Text>
        <Pressable onPress={() => setPeriod((current) => shiftMonth(current.year, current.month, 1))} className="px-2 py-1">
          <Text className="text-lg text-neutral-900">›</Text>
        </Pressable>
      </View>

      {isPending ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Vyrovnání se nepodařilo načíst'}</Text>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-4 p-4" refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}>
          <View className="rounded-xl border border-neutral-200 p-4">
            <Text className="text-sm text-neutral-500">Zaplaceno mnou / partnerem</Text>
            <Text className="mt-1 text-neutral-900">
              {data.summary.paidByMe} Kč / {data.summary.paidByPartner} Kč
            </Text>
            <Text className="mt-3 text-sm text-neutral-500">Bilance</Text>
            <Text className="mt-1 text-xl font-semibold text-neutral-900">
              {data.summary.balance} Kč — {data.summary.direction}
            </Text>
            {data.isClosed ? <Text className="mt-2 text-xs text-emerald-700">Uzavřeno{data.settledAt ? ' · zaplaceno' : ''}</Text> : null}
          </View>

          <View className="gap-2">
            <Text className="text-sm font-medium text-neutral-500">Položky ({data.lines.length})</Text>
            {data.lines.map((line) => (
              <View key={line.id} className="flex-row items-center justify-between rounded-lg border border-neutral-200 p-3">
                <View className="flex-1 pr-3">
                  <Text className="font-medium text-neutral-900" numberOfLines={1}>
                    {line.merchant}
                  </Text>
                  <Text className="text-xs text-neutral-500">{line.date}</Text>
                </View>
                <Text className="text-neutral-900">
                  {line.total} {line.currency}
                </Text>
              </View>
            ))}
          </View>

          {data.isClosed ? (
            <View className="gap-2">
              {data.closedId ? (
                <Pressable
                  onPress={() => handleReopen(data.closedId as string)}
                  disabled={reopenSettlement.isPending}
                  className="items-center rounded-lg border border-neutral-300 py-3"
                >
                  <Text className="font-medium text-neutral-900">Znovu otevřít</Text>
                </Pressable>
              ) : null}
              {data.closedId ? (
                <Pressable
                  onPress={() => markSettled.mutate({ id: data.closedId as string, settled: !data.settledAt, year: period.year, month: period.month })}
                  disabled={markSettled.isPending}
                  className="items-center rounded-lg bg-neutral-900 py-3"
                >
                  <Text className="font-medium text-white">{data.settledAt ? 'Odznačit jako zaplaceno' : 'Označit jako zaplaceno'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View className="gap-2">
              <TextInput
                className="rounded-lg border border-neutral-300 px-3 py-2"
                placeholder="Poznámka (nepovinné)"
                value={notes}
                onChangeText={setNotes}
              />
              <Pressable onPress={handleClose} disabled={closeSettlement.isPending || data.lines.length === 0} className="items-center rounded-lg bg-neutral-900 py-3">
                <Text className="font-medium text-white">{closeSettlement.isPending ? 'Uzavírám…' : 'Uzavřít vyrovnání'}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
