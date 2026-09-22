import { PlusIcon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../components/button';
import { Switch } from '../../../components/switch';
import { TextField } from '../../../components/text-field';
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
import { formatMoney } from '../../../lib/format-money';
import type { IncomeSourceRuleRow, InvestmentPlanRow, PlanningAccountOption, RecurringExpenseRow } from '../../../lib/response-types';

function ChoiceRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          className={`rounded-full border px-3 py-1.5 active:bg-surface-subtle ${value === option.value ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
        >
          <Text className={value === option.value ? 'font-sans-medium text-accent' : 'text-ink-muted'}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View>
      <Text className="font-sans-medium mb-1 text-xs text-ink-muted">{label}</Text>
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
    <Pressable onPress={onEdit} className="flex-row items-center justify-between border-b border-line bg-surface px-4 py-3 active:bg-surface-subtle">
      <View className="flex-1 pr-3">
        <Text className="font-sans-semibold text-ink" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-ink-muted">{subtitle}</Text>
      </View>
      <Switch value={isActive} onValueChange={onToggleActive} disabled={togglePending} />
      <Button variant="destructive" size="chip" className="ml-3" onPress={onDelete}>
        Smazat
      </Button>
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
    <View className="gap-3 rounded-lg border border-line bg-surface-subtle p-3">
      <Field label="Název">
        <TextField value={values.name} onChangeText={(name) => setValues({ ...values, name })} returnKeyType="next" />
      </Field>
      <Field label="Účet Trading 212 (kam se investuje)">
        <ChoiceRow
          options={brokers.map((account) => ({ value: account.id, label: account.name }))}
          value={values.brokerAccountId}
          onChange={(brokerAccountId) => setValues({ ...values, brokerAccountId })}
        />
        {brokers.length === 0 ? <Text className="text-xs text-critical">Žádný Trading 212 účet — vytvořte ho nejdřív v Účtech.</Text> : null}
      </Field>
      <Field label="Zdrojový účet (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Bez zdrojového účtu' }, ...sources.map((account) => ({ value: account.id, label: account.name }))]}
          value={values.sourceAccountId ?? ''}
          onChange={(sourceAccountId) => setValues({ ...values, sourceAccountId: sourceAccountId || null })}
        />
      </Field>
      <Field label="Částka">
        <TextField variant="money" value={values.expectedAmount} onChangeText={(expectedAmount) => setValues({ ...values, expectedAmount })} returnKeyType="next" />
      </Field>
      <Field label="Měna">
        <TextField autoCapitalize="characters" maxLength={3} value={values.currency} onChangeText={(currency) => setValues({ ...values, currency })} returnKeyType="next" />
      </Field>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Den v měsíci">
            <TextField
              variant="integer"
              value={String(values.dueDay)}
              onChangeText={(text) => setValues({ ...values, dueDay: Number(text) || 1 })}
              returnKeyType="next"
            />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Tolerance (dní)">
            <TextField
              variant="integer"
              value={String(values.graceDays)}
              onChangeText={(text) => setValues({ ...values, graceDays: Number(text) || 0 })}
              returnKeyType="done"
            />
          </Field>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-ink-muted">Aktivní</Text>
        <Switch value={values.isActive} onValueChange={(isActive) => setValues({ ...values, isActive })} />
      </View>
      <View className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={disabled} onPress={onCancel}>
          Zrušit
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          loading={disabled}
          disabled={!values.name || !values.brokerAccountId || !values.expectedAmount}
          onPress={() => onSubmit(values)}
        >
          Uložit
        </Button>
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
    <View className="gap-3 rounded-lg border border-line bg-surface-subtle p-3">
      <Field label="Zobrazovaný název">
        <TextField value={values.name} onChangeText={(name) => setValues({ ...values, name })} returnKeyType="next" />
      </Field>
      <Field label="Text obchodníka (jak se objevuje na výpisu)">
        <TextField value={values.merchantText} onChangeText={(merchantText) => setValues({ ...values, merchantText })} returnKeyType="done" />
      </Field>
      <Field label="Účet (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Libovolný účet' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
          value={values.accountId ?? ''}
          onChange={(accountId) => setValues({ ...values, accountId: accountId || null })}
        />
      </Field>
      <View className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={disabled} onPress={onCancel}>
          Zrušit
        </Button>
        <Button variant="primary" className="flex-1" loading={disabled} disabled={!values.name || !values.merchantText} onPress={() => onSubmit(values)}>
          Uložit
        </Button>
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
    <View className="gap-3 rounded-lg border border-line bg-surface-subtle p-3">
      <Field label="Název">
        <TextField value={values.name} onChangeText={(name) => setValues({ ...values, name })} returnKeyType="next" />
      </Field>
      <Field label="Kategorie (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Bez kategorie' }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
          value={values.categoryId ?? ''}
          onChange={(categoryId) => setValues({ ...values, categoryId: categoryId || null })}
        />
      </Field>
      <Field label="Očekávaná částka">
        <TextField variant="money" value={values.expectedAmount} onChangeText={(expectedAmount) => setValues({ ...values, expectedAmount })} returnKeyType="next" />
      </Field>
      <Field label="Platební účet (nepovinné)">
        <ChoiceRow
          options={[{ value: '', label: 'Bez účtu' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
          value={values.paymentAccountId ?? ''}
          onChange={(paymentAccountId) => setValues({ ...values, paymentAccountId: paymentAccountId || null })}
        />
      </Field>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-ink-muted">Sdílené s partnerem</Text>
        <Switch
          value={values.isShared}
          onValueChange={(isShared) => setValues({ ...values, isShared, myShareRatio: isShared ? (values.myShareRatio ?? 0.5) : null })}
        />
      </View>
      {values.isShared ? (
        <Field label="Můj podíl (0–1)">
          <TextField
            variant="money"
            value={values.myShareRatio !== null ? String(values.myShareRatio) : ''}
            onChangeText={(text) => setValues({ ...values, myShareRatio: Number(text.replace(',', '.')) || 0 })}
            returnKeyType="next"
          />
        </Field>
      ) : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Den splatnosti (nepovinné)">
            <TextField
              variant="integer"
              value={values.dueDay !== null ? String(values.dueDay) : ''}
              onChangeText={(text) => setValues({ ...values, dueDay: text ? Number(text) : null })}
              returnKeyType="next"
            />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Tolerance (dní)">
            <TextField
              variant="integer"
              value={String(values.graceDays)}
              onChangeText={(text) => setValues({ ...values, graceDays: Number(text) || 0 })}
              returnKeyType="done"
            />
          </Field>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-ink-muted">Aktivní</Text>
        <Switch value={values.isActive} onValueChange={(isActive) => setValues({ ...values, isActive })} />
      </View>
      <View className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={disabled} onPress={onCancel}>
          Zrušit
        </Button>
        <Button variant="primary" className="flex-1" loading={disabled} disabled={!values.name || !values.expectedAmount} onPress={() => onSubmit(values)}>
          Uložit
        </Button>
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

function SectionHeaderRow({ title, onAdd }: { title: string; onAdd?: () => void }): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between px-4 pt-4">
      <Text className="font-sans-semibold text-base text-ink">{title}</Text>
      {onAdd ? (
        <Pressable onPress={onAdd} className="flex-row items-center gap-1 rounded-md bg-accent-soft px-2 py-1 active:bg-line">
          <PlusIcon color="#17647c" size={13} weight="bold" />
          <Text className="text-xs text-accent">Přidat</Text>
        </Pressable>
      ) : null}
    </View>
  );
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
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#17647c" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Plánování se nepodařilo načíst'}</Text>
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
      className="flex-1 bg-canvas"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#17647c" />}
    >
      <View className="gap-3 border-b border-line bg-surface p-4">
        <Text className="font-sans-medium text-sm text-ink-muted">Měsíční cíl výdajů (Kč)</Text>
        <TextField variant="money" value={targetInput} onChangeText={setTargetInput} placeholder="Bez cíle" returnKeyType="done" onSubmitEditing={handleSaveTarget} />
        {saveMessage ? <Text className="text-sm text-positive">{saveMessage}</Text> : null}
        <Button variant="primary" loading={saveSpendingTarget.isPending} onPress={handleSaveTarget}>
          Uložit cíl
        </Button>
      </View>

      <SectionHeaderRow title="DCA plány" onAdd={editingPlanId === null ? () => setEditingPlanId('new') : undefined} />
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
        <Text className="px-4 pb-4 text-ink-muted">Žádné plány.</Text>
      ) : (
        data.plans.map((plan) => (
          <ListRow
            key={plan.id}
            title={plan.name}
            subtitle={`${formatMoney(plan.expectedAmount, plan.currency)} · den ${plan.dueDay} → ${plan.brokerAccountName}`}
            isActive={plan.isActive}
            togglePending={setPlanActive.isPending}
            onToggleActive={() => setPlanActive.mutate({ id: plan.id, isActive: !plan.isActive })}
            onDelete={() => deletePlan.mutate(plan.id)}
            onEdit={() => setEditingPlanId(plan.id)}
          />
        ))
      )}

      <SectionHeaderRow title="Pravidla pro příjmy" onAdd={editingRuleId === null ? () => setEditingRuleId('new') : undefined} />
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
        <Text className="px-4 pb-4 text-ink-muted">Žádná pravidla.</Text>
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

      <SectionHeaderRow title="Fixní výdaje" onAdd={editingExpenseId === null ? () => setEditingExpenseId('new') : undefined} />
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
        <Text className="px-4 pb-8 text-ink-muted">Žádné fixní výdaje.</Text>
      ) : (
        data.expenses.map((expense) => (
          <ListRow
            key={expense.id}
            title={expense.name}
            subtitle={formatMoney(expense.expectedAmount, expense.currency)}
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
