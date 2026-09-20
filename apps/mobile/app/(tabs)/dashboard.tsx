import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useDashboard } from '../../hooks/use-dashboard';

function MoneyText({ value, className }: { value: string; className?: string }): React.JSX.Element {
  return <Text className={className}>{value} Kč</Text>;
}

export default function DashboardScreen(): React.JSX.Element {
  // Local UI state, not a route param — matches the plan's note that the
  // period picker doesn't need to be shareable/deep-linkable on mobile.
  const [period] = useState<string | undefined>(undefined);
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

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
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
