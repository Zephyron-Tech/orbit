import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { useCloseSettlement, useMarkSettled, useReopenSettlement, useSettlement } from '../../hooks/use-settlement';
import type { SettlementLine } from '../../lib/response-types';

const MONTH_LABELS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = (month - 1 + delta + 12) % 12;
  const yearDelta = Math.floor((month - 1 + delta) / 12);
  return { year: year + yearDelta, month: zeroBased + 1 };
}

function periodLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

const KIND_LABELS: Record<SettlementLine['kind'], string> = {
  EXPENSE: 'Výdaj',
  SETTLEMENT: 'Platba vyrovnání',
  UNCONVERTED: 'Nepřevedeno na CZK',
};

function LineRow({ line }: { line: SettlementLine }): React.JSX.Element {
  return (
    <View className="rounded-lg border border-neutral-200 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 pr-3 font-medium text-neutral-900" numberOfLines={1}>
          {line.merchant}
        </Text>
        <Text className="text-neutral-900">
          {line.total} {line.currency}
        </Text>
      </View>
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="text-xs text-neutral-500">{line.date}</Text>
        <View className="flex-row items-center gap-2">
          {line.kind !== 'EXPENSE' ? (
            <View className={`rounded-full px-2 py-0.5 ${line.kind === 'UNCONVERTED' ? 'bg-amber-100' : 'bg-neutral-100'}`}>
              <Text className={`text-xs ${line.kind === 'UNCONVERTED' ? 'text-amber-700' : 'text-neutral-600'}`}>{KIND_LABELS[line.kind]}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {line.myShare !== null && line.partnerShare !== null ? (
        <Text className="mt-1 text-xs text-neutral-500">
          Já: {line.myShare} {line.currency} · Partner: {line.partnerShare} {line.currency}
        </Text>
      ) : null}
    </View>
  );
}

export default function SettlementScreen(): React.JSX.Element {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const [notes, setNotes] = useState('');
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false);

  const { data, isPending, isError, error, refetch, isRefetching } = useSettlement(period.year, period.month);
  const closeSettlement = useCloseSettlement();
  const reopenSettlement = useReopenSettlement();
  const markSettled = useMarkSettled();

  function jumpToPeriod(monthKey: string): void {
    const [yearPart, monthPart] = monthKey.split('-').map(Number);
    if (!yearPart || !monthPart) return;
    setPeriod({ year: yearPart, month: monthPart });
    setJumpMenuOpen(false);
  }

  function handleClose(): void {
    Alert.alert('Uzavřít vyrovnání?', periodLabel(period.year, period.month), [
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
        <Pressable onPress={() => setJumpMenuOpen(true)}>
          <Text className="font-medium text-neutral-900 underline">{periodLabel(period.year, period.month)}</Text>
        </Pressable>
        <Pressable onPress={() => setPeriod((current) => shiftMonth(current.year, current.month, 1))} className="px-2 py-1">
          <Text className="text-lg text-neutral-900">›</Text>
        </Pressable>
      </View>

      <Modal visible={jumpMenuOpen} transparent animationType="fade" onRequestClose={() => setJumpMenuOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/40" onPress={() => setJumpMenuOpen(false)}>
          <View className="max-h-[70%] w-4/5 rounded-xl bg-white p-2">
            <ScrollView>
              {(data?.months ?? []).map((monthKey) => (
                <Pressable key={monthKey} onPress={() => jumpToPeriod(monthKey)} className="rounded-lg px-4 py-3">
                  <Text className="text-neutral-900">{monthKey}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

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
            {data.unconvertedCount > 0 ? (
              <Text className="mt-2 text-xs text-amber-700">{data.unconvertedCount}× nepřevedeno na CZK, chybí v součtu</Text>
            ) : null}
          </View>

          <View className="gap-2">
            <Text className="text-sm font-medium text-neutral-500">Položky ({data.lines.length})</Text>
            {data.lines.map((line) => (
              <LineRow key={line.id} line={line} />
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

          {data.history.length > 0 ? (
            <View className="gap-2 border-t border-neutral-100 pt-4">
              <Text className="text-sm font-medium text-neutral-500">Historie vyrovnání</Text>
              {data.history.map((entry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => jumpToPeriod(entry.period)}
                  className="flex-row items-center justify-between rounded-lg border border-neutral-200 p-3"
                >
                  <Text className="text-neutral-900">{entry.period}</Text>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-neutral-900">{entry.balance} Kč</Text>
                    {entry.settledAt ? <Text className="text-xs text-emerald-700">zaplaceno</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
