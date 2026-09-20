import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import {
  useDeleteIncomeSourceRule,
  useDeleteInvestmentPlan,
  useDeleteRecurringExpense,
  usePlanning,
  useSaveSpendingTarget,
  useSetIncomeSourceRuleActive,
  useSetInvestmentPlanActive,
  useSetRecurringExpenseActive,
} from '../../../hooks/use-planning';

/** A single "name + amount, toggle active, delete" row shared by all three
 * list sections below — investment plans, income rules, and recurring
 * expenses all follow the same shape for this pass (no per-item create/edit
 * form yet, see the note at the bottom of the screen). */
function ListRow({
  title,
  subtitle,
  isActive,
  onToggleActive,
  onDelete,
  togglePending,
}: {
  title: string;
  subtitle: string;
  isActive: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
  togglePending: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3">
      <View className="flex-1 pr-3">
        <Text className="font-medium text-neutral-900" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-neutral-500">{subtitle}</Text>
      </View>
      <Switch value={isActive} onValueChange={onToggleActive} disabled={togglePending} />
      <Pressable onPress={onDelete} className="ml-3 rounded-md bg-neutral-100 px-2 py-1">
        <Text className="text-xs text-red-600">Smazat</Text>
      </Pressable>
    </View>
  );
}

export default function PlanningScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = usePlanning();
  const saveSpendingTarget = useSaveSpendingTarget();
  const setPlanActive = useSetInvestmentPlanActive();
  const deletePlan = useDeleteInvestmentPlan();
  const setRuleActive = useSetIncomeSourceRuleActive();
  const deleteRule = useDeleteIncomeSourceRule();
  const setExpenseActive = useSetRecurringExpenseActive();
  const deleteExpense = useDeleteRecurringExpense();

  const [targetInput, setTargetInput] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data?.settings) setTargetInput(data.settings.monthlySpendingTarget ?? '');
  }, [data?.settings]);

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
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Plánování se nepodařilo načíst'}</Text>
      </View>
    );
  }

  function handleSaveTarget(): void {
    setSaveMessage(null);
    saveSpendingTarget.mutate(
      {
        monthlySpendingTarget: targetInput.trim() || null,
        transferHistoryFrom: data?.settings?.transferHistoryFrom ?? null,
        hideHistoricalBrokerTransfers: data?.settings?.hideHistoricalBrokerTransfers ?? false,
      },
      { onSuccess: () => setSaveMessage('Uloženo.') },
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="gap-3 border-b border-neutral-100 p-4">
        <Text className="text-sm font-medium text-neutral-500">Měsíční cíl výdajů (Kč)</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          keyboardType="numbers-and-punctuation"
          value={targetInput}
          onChangeText={setTargetInput}
          placeholder="Bez cíle"
        />
        {saveMessage ? <Text className="text-sm text-emerald-600">{saveMessage}</Text> : null}
        <Pressable onPress={handleSaveTarget} disabled={saveSpendingTarget.isPending} className="items-center rounded-lg bg-neutral-900 py-2.5">
          <Text className="font-medium text-white">{saveSpendingTarget.isPending ? 'Ukládám…' : 'Uložit cíl'}</Text>
        </Pressable>
      </View>

      <Text className="px-4 pb-2 pt-4 text-sm font-medium text-neutral-500">DCA plány</Text>
      {data.plans.length === 0 ? (
        <Text className="px-4 pb-4 text-neutral-500">Žádné plány.</Text>
      ) : (
        data.plans.map((plan) => (
          <ListRow
            key={plan.id}
            title={plan.name}
            subtitle={`${plan.expectedAmount} ${plan.currency} · den ${plan.dueDay} → ${plan.brokerAccountName}`}
            isActive={plan.isActive}
            togglePending={setPlanActive.isPending}
            onToggleActive={() => setPlanActive.mutate({ id: plan.id, isActive: !plan.isActive })}
            onDelete={() => deletePlan.mutate(plan.id)}
          />
        ))
      )}

      <Text className="px-4 pb-2 pt-4 text-sm font-medium text-neutral-500">Pravidla pro příjmy</Text>
      {data.incomeSourceRules.length === 0 ? (
        <Text className="px-4 pb-4 text-neutral-500">Žádná pravidla.</Text>
      ) : (
        data.incomeSourceRules.map((rule) => (
          <ListRow
            key={rule.id}
            title={rule.name}
            subtitle={rule.accountName ?? 'Libovolný účet'}
            isActive={rule.isActive}
            togglePending={setRuleActive.isPending}
            onToggleActive={() => setRuleActive.mutate({ id: rule.id, isActive: !rule.isActive })}
            onDelete={() => deleteRule.mutate(rule.id)}
          />
        ))
      )}

      <Text className="px-4 pb-2 pt-4 text-sm font-medium text-neutral-500">Fixní výdaje</Text>
      {data.expenses.length === 0 ? (
        <Text className="px-4 pb-4 text-neutral-500">Žádné fixní výdaje.</Text>
      ) : (
        data.expenses.map((expense) => (
          <ListRow
            key={expense.id}
            title={expense.name}
            subtitle={`${expense.expectedAmount} ${expense.currency}`}
            isActive={expense.isActive}
            togglePending={setExpenseActive.isPending}
            onToggleActive={() => setExpenseActive.mutate({ id: expense.id, isActive: !expense.isActive })}
            onDelete={() => deleteExpense.mutate(expense.id)}
          />
        ))
      )}

      <Text className="p-4 text-xs text-neutral-400">
        Vytvoření nového DCA plánu, pravidla pro příjmy nebo fixního výdaje zatím není na mobilu k dispozici — použijte webovou appku.
      </Text>
    </ScrollView>
  );
}
