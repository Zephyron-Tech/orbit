import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useDashboard } from '../../hooks/use-dashboard';
import { formatPeriod, offsetPeriod } from '../../lib/period';

function MoneyText({ value, className }: { value: string; className?: string }): React.JSX.Element {
  return <Text className={className}>{value} Kč</Text>;
}

export default function DashboardScreen(): React.JSX.Element {
  // `undefined` means "let the API resolve its own default (current month)".
  // Once data comes back, `data.period.key` is the actual resolved period —
  // prev/next navigate relative to that, not to this local state directly,
  // so the very first render (before any pick) still has a real key to offset from.
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const { data, isPending, isError, error, refetch, isRefetching } = useDashboard({ period });

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
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Přehled se nepodařilo načíst'}</Text>
      </View>
    );
  }

  const currentKey = data.period.key;
  const canGoBack = data.visibleMonths.length === 0 || currentKey > (data.visibleMonths[0] ?? currentKey);
  const canGoForward = currentKey < (data.visibleMonths.at(-1) ?? currentKey);

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => canGoBack && setPeriod(offsetPeriod(currentKey, -1))}
          disabled={!canGoBack}
          className={`rounded-lg border border-neutral-300 px-3 py-2 ${canGoBack ? '' : 'opacity-30'}`}
        >
          <Text>‹</Text>
        </Pressable>
        <Text className="text-base font-medium capitalize text-neutral-900">{formatPeriod(currentKey)}</Text>
        <Pressable
          onPress={() => canGoForward && setPeriod(offsetPeriod(currentKey, 1))}
          disabled={!canGoForward}
          className={`rounded-lg border border-neutral-300 px-3 py-2 ${canGoForward ? '' : 'opacity-30'}`}
        >
          <Text>›</Text>
        </Pressable>
      </View>

      <View className="rounded-xl border border-neutral-200 p-4">
        <Text className="text-sm text-neutral-500">Čisté jmění</Text>
        <MoneyText value={data.netWorth.totalWorth} className="mt-1 text-2xl font-semibold text-neutral-900" />
        <Text className={`mt-1 text-sm ${data.worthDelta.isPositive ? 'text-emerald-600' : data.worthDelta.isNegative ? 'text-red-600' : 'text-neutral-500'}`}>
          {data.worthDelta.formatted} Kč oproti minulému období
        </Text>
      </View>

      <View className="rounded-xl border border-neutral-200 p-4">
        <Text className="text-sm text-neutral-500">Fixní výdaje tohoto období</Text>
        <MoneyText value={data.burnRate.total} className="mt-1 text-xl font-semibold text-neutral-900" />
        {data.burnRate.target ? (
          <Text className="mt-1 text-sm text-neutral-500">Cíl: {data.burnRate.target} Kč</Text>
        ) : null}
      </View>

      {data.actions.some((action) => action.count > 0) ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-neutral-500">Vyžaduje pozornost</Text>
          {data.actions
            .filter((action) => action.count > 0)
            .map((action) => (
              <View key={action.key} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <View className="flex-row items-center justify-between">
                  <Text className="font-medium text-neutral-900">{action.title}</Text>
                  <Text className="font-semibold text-amber-700">{action.count}</Text>
                </View>
                <Text className="mt-1 text-xs text-neutral-600">{action.detail}</Text>
              </View>
            ))}
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-500">Fixní výdaje — plán vs. skutečnost</Text>
        {data.recurringExpenses.map((expense) => (
          <View key={expense.id} className="flex-row items-center justify-between rounded-lg border border-neutral-200 p-3">
            <View className="flex-1 pr-3">
              <Text className="font-medium text-neutral-900">{expense.name}</Text>
              <Text className={`text-xs ${expense.stateTone === 'warning' ? 'text-amber-700' : expense.stateTone === 'success' ? 'text-emerald-700' : 'text-neutral-500'}`}>
                {expense.stateLabel}
              </Text>
            </View>
            <Text className="text-neutral-900">{expense.actualAmount ?? '—'} / {expense.expectedAmount} Kč</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
