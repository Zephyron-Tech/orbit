import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import {
  useCreateIncomeSourceRule,
  useCreateInvestmentPlan,
  useCreateRecurringExpense,
  useDeleteIncomeSourceRule,
  useDeleteInvestmentPlan,
  useDeleteRecurringExpense,
  usePlanning,
  useSaveSpendingTarget,
  useSetIncomeSourceRuleActive,
  useSetInvestmentPlanActive,
  useSetRecurringExpenseActive,
  useUpdateIncomeSourceRule,
  useUpdateInvestmentPlan,
  useUpdateRecurringExpense,
} from '../../../hooks/use-planning';
import type { IncomeSourceRuleInput, InvestmentPlanInput, RecurringExpenseInput } from '../../../hooks/use-planning';
import type { IncomeSourceRuleRow, InvestmentPlanRow, PlanningAccountOption, RecurringExpenseRow } from '../../../lib/response-types';

function ChoiceRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          className={`rounded-full border px-3 py-1.5 ${value === option.value ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
        >
          <Text className={value === option.value ? 'text-white' : 'text-neutral-700'}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View>
      <Text className="mb-1 text-xs font-medium text-neutral-500">{label}</Text>
      {children}
    </View>
  );
}

/** A single "name + amount, toggle active, delete" row — tapping opens the edit form. */
function ListRow({
  title,
  subtitle,
  isActive,
  onToggleActive,
  onDelete,
  onEdit,
  togglePending,
}: {
  title: string;
  subtitle: string;
  isActive: boolean;
  onToggleActive: () => void;
  onDelete: () => void;
  onEdit: () => void;
  togglePending: boolean;
}): React.JSX.Element {
  return (
    <Pressable onPress={onEdit} className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3">
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
    </Pressable>
  );
}

const EMPTY_PLAN: InvestmentPlanInput = {
  name: '',
  sourceAccountId: null,
  brokerAccountId: '',
  expectedAmount: '',
  currency: 'CZK',
  dueDay: 1,
  graceDays: 3,
  isActive: true,
  startsOn: null,
  endsOn: null,
};

function InvestmentPlanForm({
  accounts,
  initial,
  disabled,
  onCancel,
  onSubmit,
}: {
  accounts: PlanningAccountOption[];
  initial: InvestmentPlanInput;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (values: InvestmentPlanInput) => void;
}): React.JSX.Element {
  const [values, setValues] = useState(initial);
  const brokers = accounts.filter((account) => account.type === 'INVESTMENT' && account.provider === 'TRADING212');
  const sources = accounts.filter((account) => account.type !== 'INVESTMENT');

  return (
    <View className="gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <Field label="Název">
        <TextInput className="rounded-lg border border-neutral-300 px-3 py-2" value={values.name} onChangeText={(name) => setValues({ ...values, name })} />
      </Field>
      <Field label="Účet Trading 212 (kam se investuje)">
        <ChoiceRow
          options={brokers.map((account) => ({ value: account.id, label: account.name }))}
          value={values.brokerAccountId}
          onChange={(brokerAccountId) => setValues({ ...values, brokerAccountId })}
        />
        {brokers.length === 0 ? <Text className="text-xs text-red-600">Žádný Trading 212 účet — vytvořte ho nejdřív v Účtech.</Text> : null}
      </Field>
      <Field label="Zdrojový účet (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Bez zdrojového účtu' }, ...sources.map((account) => ({ value: account.id, label: account.name }))]}
          value={values.sourceAccountId ?? ''}
          onChange={(sourceAccountId) => setValues({ ...values, sourceAccountId: sourceAccountId || null })}
        />
      </Field>
      <Field label="Částka">
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          keyboardType="decimal-pad"
          value={values.expectedAmount}
          onChangeText={(expectedAmount) => setValues({ ...values, expectedAmount })}
        />
      </Field>
      <Field label="Měna">
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          autoCapitalize="characters"
          maxLength={3}
          value={values.currency}
          onChangeText={(currency) => setValues({ ...values, currency })}
        />
      </Field>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Den v měsíci">
            <TextInput
              className="rounded-lg border border-neutral-300 px-3 py-2"
              keyboardType="number-pad"
              value={String(values.dueDay)}
              onChangeText={(text) => setValues({ ...values, dueDay: Number(text) || 1 })}
            />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Tolerance (dní)">
            <TextInput
              className="rounded-lg border border-neutral-300 px-3 py-2"
              keyboardType="number-pad"
              value={String(values.graceDays)}
              onChangeText={(text) => setValues({ ...values, graceDays: Number(text) || 0 })}
            />
          </Field>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-neutral-700">Aktivní</Text>
        <Switch value={values.isActive} onValueChange={(isActive) => setValues({ ...values, isActive })} />
      </View>
      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} disabled={disabled} className="flex-1 items-center rounded-lg border border-neutral-300 py-2.5">
          <Text className="font-medium text-neutral-900">Zrušit</Text>
        </Pressable>
        <Pressable
          onPress={() => onSubmit(values)}
          disabled={disabled || !values.name || !values.brokerAccountId || !values.expectedAmount}
          className="flex-1 items-center rounded-lg bg-neutral-900 py-2.5"
        >
          <Text className="font-medium text-white">{disabled ? 'Ukládám…' : 'Uložit'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const EMPTY_RULE: IncomeSourceRuleInput = { name: '', merchantText: '', accountId: null };

function IncomeSourceRuleForm({
  accounts,
  initial,
  disabled,
  onCancel,
  onSubmit,
}: {
  accounts: PlanningAccountOption[];
  initial: IncomeSourceRuleInput;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (values: IncomeSourceRuleInput) => void;
}): React.JSX.Element {
  const [values, setValues] = useState(initial);

  return (
    <View className="gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <Field label="Zobrazovaný název">
        <TextInput className="rounded-lg border border-neutral-300 px-3 py-2" value={values.name} onChangeText={(name) => setValues({ ...values, name })} />
      </Field>
      <Field label="Text obchodníka (jak se objevuje na výpisu)">
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={values.merchantText}
          onChangeText={(merchantText) => setValues({ ...values, merchantText })}
        />
      </Field>
      <Field label="Účet (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Libovolný účet' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
          value={values.accountId ?? ''}
          onChange={(accountId) => setValues({ ...values, accountId: accountId || null })}
        />
      </Field>
      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} disabled={disabled} className="flex-1 items-center rounded-lg border border-neutral-300 py-2.5">
          <Text className="font-medium text-neutral-900">Zrušit</Text>
        </Pressable>
        <Pressable
          onPress={() => onSubmit(values)}
          disabled={disabled || !values.name || !values.merchantText}
          className="flex-1 items-center rounded-lg bg-neutral-900 py-2.5"
        >
          <Text className="font-medium text-white">{disabled ? 'Ukládám…' : 'Uložit'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const EMPTY_EXPENSE: RecurringExpenseInput = {
  name: '',
  categoryId: null,
  expectedAmount: '',
  currency: 'CZK',
  isShared: false,
  myShareRatio: null,
  isActive: true,
  dueDay: null,
  graceDays: 3,
  startsOn: null,
  endsOn: null,
  paymentAccountId: null,
};

function RecurringExpenseForm({
  accounts,
  categories,
  initial,
  disabled,
  onCancel,
  onSubmit,
}: {
  accounts: PlanningAccountOption[];
  categories: { id: string; name: string }[];
  initial: RecurringExpenseInput;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (values: RecurringExpenseInput) => void;
}): React.JSX.Element {
  const [values, setValues] = useState(initial);

  return (
    <View className="gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <Field label="Název">
        <TextInput className="rounded-lg border border-neutral-300 px-3 py-2" value={values.name} onChangeText={(name) => setValues({ ...values, name })} />
      </Field>
      <Field label="Kategorie (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Bez kategorie' }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
          value={values.categoryId ?? ''}
          onChange={(categoryId) => setValues({ ...values, categoryId: categoryId || null })}
        />
      </Field>
      <Field label="Očekávaná částka">
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          keyboardType="decimal-pad"
          value={values.expectedAmount}
          onChangeText={(expectedAmount) => setValues({ ...values, expectedAmount })}
        />
      </Field>
      <Field label="Platební účet (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Bez účtu' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
          value={values.paymentAccountId ?? ''}
          onChange={(paymentAccountId) => setValues({ ...values, paymentAccountId: paymentAccountId || null })}
        />
      </Field>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-neutral-700">Sdílené s partnerem</Text>
        <Switch
          value={values.isShared}
          onValueChange={(isShared) => setValues({ ...values, isShared, myShareRatio: isShared ? (values.myShareRatio ?? 0.5) : null })}
        />
      </View>
      {values.isShared ? (
        <Field label="Můj podíl (0–1)">
          <TextInput
            className="rounded-lg border border-neutral-300 px-3 py-2"
            keyboardType="decimal-pad"
            value={values.myShareRatio !== null ? String(values.myShareRatio) : ''}
            onChangeText={(text) => setValues({ ...values, myShareRatio: Number(text.replace(',', '.')) || 0 })}
          />
        </Field>
      ) : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Den splatnosti (nepovinné)">
            <TextInput
              className="rounded-lg border border-neutral-300 px-3 py-2"
              keyboardType="number-pad"
              value={values.dueDay !== null ? String(values.dueDay) : ''}
              onChangeText={(text) => setValues({ ...values, dueDay: text ? Number(text) : null })}
            />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Tolerance (dní)">
            <TextInput
              className="rounded-lg border border-neutral-300 px-3 py-2"
              keyboardType="number-pad"
              value={String(values.graceDays)}
              onChangeText={(text) => setValues({ ...values, graceDays: Number(text) || 0 })}
            />
          </Field>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-neutral-700">Aktivní</Text>
        <Switch value={values.isActive} onValueChange={(isActive) => setValues({ ...values, isActive })} />
      </View>
      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} disabled={disabled} className="flex-1 items-center rounded-lg border border-neutral-300 py-2.5">
          <Text className="font-medium text-neutral-900">Zrušit</Text>
        </Pressable>
        <Pressable
          onPress={() => onSubmit(values)}
          disabled={disabled || !values.name || !values.expectedAmount}
          className="flex-1 items-center rounded-lg bg-neutral-900 py-2.5"
        >
          <Text className="font-medium text-white">{disabled ? 'Ukládám…' : 'Uložit'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function planToInput(plan: InvestmentPlanRow): InvestmentPlanInput {
  return {
    name: plan.name,
    sourceAccountId: plan.sourceAccountId,
    brokerAccountId: plan.brokerAccountId,
    expectedAmount: plan.expectedAmount,
    currency: plan.currency,
    dueDay: plan.dueDay,
    graceDays: plan.graceDays,
    isActive: plan.isActive,
    startsOn: plan.startsOn,
    endsOn: plan.endsOn,
  };
}

function ruleToInput(rule: IncomeSourceRuleRow): IncomeSourceRuleInput {
  return { name: rule.name, merchantText: rule.merchantKey, accountId: rule.accountId };
}

function expenseToInput(expense: RecurringExpenseRow): RecurringExpenseInput {
  return {
    name: expense.name,
    categoryId: expense.categoryId,
    expectedAmount: expense.expectedAmount,
    currency: expense.currency,
    isShared: expense.isShared,
    myShareRatio: expense.myShareRatio,
    isActive: expense.isActive,
    dueDay: expense.dueDay,
    graceDays: expense.graceDays,
    startsOn: expense.startsOn,
    endsOn: expense.endsOn,
    paymentAccountId: expense.paymentAccountId,
  };
}

export default function PlanningScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = usePlanning();
  const saveSpendingTarget = useSaveSpendingTarget();

  const createPlan = useCreateInvestmentPlan();
  const updatePlan = useUpdateInvestmentPlan();
  const setPlanActive = useSetInvestmentPlanActive();
  const deletePlan = useDeleteInvestmentPlan();

  const createRule = useCreateIncomeSourceRule();
  const updateRule = useUpdateIncomeSourceRule();
  const setRuleActive = useSetIncomeSourceRuleActive();
  const deleteRule = useDeleteIncomeSourceRule();

  const createExpense = useCreateRecurringExpense();
  const updateExpense = useUpdateRecurringExpense();
  const setExpenseActive = useSetRecurringExpenseActive();
  const deleteExpense = useDeleteRecurringExpense();

  const [targetInput, setTargetInput] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // 'new' | an existing row's id | null (closed) — one editor open at a time per section.
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

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

  const editingPlan = editingPlanId === 'new' ? EMPTY_PLAN : data.plans.find((plan) => plan.id === editingPlanId);
  const editingRule = editingRuleId === 'new' ? EMPTY_RULE : data.incomeSourceRules.find((rule) => rule.id === editingRuleId);
  const editingExpense = editingExpenseId === 'new' ? EMPTY_EXPENSE : data.expenses.find((expense) => expense.id === editingExpenseId);

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

      <View className="flex-row items-center justify-between px-4 pt-4">
        <Text className="text-sm font-medium text-neutral-500">DCA plány</Text>
        {editingPlanId === null ? (
          <Pressable onPress={() => setEditingPlanId('new')} className="rounded-md bg-neutral-100 px-2 py-1">
            <Text className="text-xs text-neutral-900">+ Přidat</Text>
          </Pressable>
        ) : null}
      </View>
      {editingPlan ? (
        <View className="px-4 pb-2 pt-2">
          <InvestmentPlanForm
            accounts={data.accounts}
            initial={editingPlan === EMPTY_PLAN ? EMPTY_PLAN : planToInput(editingPlan as InvestmentPlanRow)}
            disabled={createPlan.isPending || updatePlan.isPending}
            onCancel={() => setEditingPlanId(null)}
            onSubmit={(values) => {
              const onSuccess = () => setEditingPlanId(null);
              if (editingPlanId === 'new') createPlan.mutate(values, { onSuccess });
              else updatePlan.mutate({ id: editingPlanId as string, input: values }, { onSuccess });
            }}
          />
        </View>
      ) : null}
      {data.plans.length === 0 && editingPlanId === null ? (
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
            onEdit={() => setEditingPlanId(plan.id)}
          />
        ))
      )}

      <View className="flex-row items-center justify-between px-4 pt-4">
        <Text className="text-sm font-medium text-neutral-500">Pravidla pro příjmy</Text>
        {editingRuleId === null ? (
          <Pressable onPress={() => setEditingRuleId('new')} className="rounded-md bg-neutral-100 px-2 py-1">
            <Text className="text-xs text-neutral-900">+ Přidat</Text>
          </Pressable>
        ) : null}
      </View>
      {editingRule ? (
        <View className="px-4 pb-2 pt-2">
          <IncomeSourceRuleForm
            accounts={data.accounts}
            initial={editingRule === EMPTY_RULE ? EMPTY_RULE : ruleToInput(editingRule as IncomeSourceRuleRow)}
            disabled={createRule.isPending || updateRule.isPending}
            onCancel={() => setEditingRuleId(null)}
            onSubmit={(values) => {
              const onSuccess = () => setEditingRuleId(null);
              if (editingRuleId === 'new') createRule.mutate(values, { onSuccess });
              else updateRule.mutate({ id: editingRuleId as string, input: values }, { onSuccess });
            }}
          />
        </View>
      ) : null}
      {data.incomeSourceRules.length === 0 && editingRuleId === null ? (
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
            onEdit={() => setEditingRuleId(rule.id)}
          />
        ))
      )}

      <View className="flex-row items-center justify-between px-4 pt-4">
        <Text className="text-sm font-medium text-neutral-500">Fixní výdaje</Text>
        {editingExpenseId === null ? (
          <Pressable onPress={() => setEditingExpenseId('new')} className="rounded-md bg-neutral-100 px-2 py-1">
            <Text className="text-xs text-neutral-900">+ Přidat</Text>
          </Pressable>
        ) : null}
      </View>
      {editingExpense ? (
        <View className="px-4 pb-2 pt-2">
          <RecurringExpenseForm
            accounts={data.accounts}
            categories={data.categories}
            initial={editingExpense === EMPTY_EXPENSE ? EMPTY_EXPENSE : expenseToInput(editingExpense as RecurringExpenseRow)}
            disabled={createExpense.isPending || updateExpense.isPending}
            onCancel={() => setEditingExpenseId(null)}
            onSubmit={(values) => {
              const onSuccess = () => setEditingExpenseId(null);
              if (editingExpenseId === 'new') createExpense.mutate(values, { onSuccess });
              else updateExpense.mutate({ id: editingExpenseId as string, input: values }, { onSuccess });
            }}
          />
        </View>
      ) : null}
      {data.expenses.length === 0 && editingExpenseId === null ? (
        <Text className="px-4 pb-8 text-neutral-500">Žádné fixní výdaje.</Text>
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
            onEdit={() => setEditingExpenseId(expense.id)}
          />
        ))
      )}
      <View className="h-6" />
    </ScrollView>
  );
}
