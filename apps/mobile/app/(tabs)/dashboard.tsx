import {
  BankIcon,
  CarIcon,
  ChartPieSliceIcon,
  ClockCounterClockwiseIcon,
  CreditCardIcon,
  LinkBreakIcon,
  ReceiptIcon,
  TrendDownIcon,
  TrendUpIcon,
  WalletIcon,
  WarningCircleIcon,
  type Icon,
} from 'phosphor-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../components/badge';
import { DashboardMetric } from '../../components/dashboard-metric';
import { ListSkeleton, SkeletonCard } from '../../components/skeleton';
import { useDashboard } from '../../hooks/use-dashboard';
import { colors } from '../../lib/colors';
import { haptics } from '../../lib/haptics';
import { formatMoney } from '../../lib/format-money';
import { formatPeriod, offsetPeriod } from '../../lib/period';

// Matches apps/web/app/(dashboard)/dashboard/page.tsx's ACTION_ICONS map —
// same icon per action key, duotone weight.
const ACTION_ICONS: Record<string, Icon> = {
  uncategorized: ReceiptIcon,
  'unmatched-transfers': LinkBreakIcon,
  'failed-imports': WarningCircleIcon,
  'data-gaps': BankIcon,
  'dca-overdue': ClockCounterClockwiseIcon,
  'overdue-recurring': WarningCircleIcon,
  'cash-buffer': BankIcon,
};

export default function DashboardScreen(): React.JSX.Element {
  // `undefined` means "let the API resolve its own default (current month)".
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const { data, isPending, isError, error, refetch, isRefetching } = useDashboard({ period });

  if (isPending) {
    return (
      <View className="flex-1 gap-4 bg-canvas p-4">
        <SkeletonCard />
        <SkeletonCard />
        <ListSkeleton rows={3} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Přehled se nepodařilo načíst'}</Text>
      </View>
    );
  }

  const currentKey = data.period.key;
  // visibleMonths is returned newest-first (apps/api/src/routes/dashboard.ts),
  // so the oldest bound is the last entry and the newest is the first.
  const canGoBack = data.visibleMonths.length === 0 || currentKey > (data.visibleMonths.at(-1) ?? currentKey);
  const canGoForward = data.visibleMonths.length === 0 || currentKey < (data.visibleMonths[0] ?? currentKey);
  const asOf = new Date(data.asOf);
  const previousAsOf = new Date(data.previousAsOf);
  const visibleActions = data.actions.filter((action) => action.count > 0);
  const resolvedActions = data.actions.filter((action) => action.count === 0);

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { haptics.tapLight(); void refetch(); }} tintColor={colors.accent} />}
    >
      {/* Period picker */}
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => canGoBack && setPeriod(offsetPeriod(currentKey, -1))}
          disabled={!canGoBack}
          hitSlop={8}
          className={`rounded-lg border border-line bg-surface px-3 py-2 active:bg-surface-subtle ${canGoBack ? '' : 'opacity-30'}`}
        >
          <Text className="text-ink">‹</Text>
        </Pressable>
        <Text className="font-sans-medium text-base capitalize text-ink">{formatPeriod(currentKey)}</Text>
        <Pressable
          onPress={() => canGoForward && setPeriod(offsetPeriod(currentKey, 1))}
          disabled={!canGoForward}
          hitSlop={8}
          className={`rounded-lg border border-line bg-surface px-3 py-2 active:bg-surface-subtle ${canGoForward ? '' : 'opacity-30'}`}
        >
          <Text className="text-ink">›</Text>
        </Pressable>
      </View>

      {/* Net worth hero card */}
      <View className="overflow-hidden rounded-lg border border-line bg-surface">
        <View className="p-5">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="font-sans-semibold flex-1 text-xs uppercase tracking-wide text-ink-muted">
              Čisté jmění k {asOf.toLocaleDateString('cs-CZ')}
            </Text>
            <View className="size-9 items-center justify-center rounded-xl bg-accent-soft">
              <WalletIcon color="#17647c" size={20} weight="duotone" />
            </View>
          </View>
          <Text className="font-sans-semibold mt-3 text-4xl text-ink">{formatMoney(data.netWorth.totalWorth)}</Text>
          <Text className="mt-2 text-sm text-ink-muted">
            {data.netWorth.incompleteAccountsCount > 0
              ? `${data.netWorth.incompleteAccountsCount} účtů má neúplný podklad; hodnota nemusí být úplná.`
              : 'Součet hotovosti, investic a evidovaných závazků.'}
          </Text>
        </View>
        <View className="border-t border-line bg-surface-subtle px-5 py-4">
          <View className="h-2 flex-row overflow-hidden rounded-full bg-line">
            {data.composition.cashShare > 0 ? <View className="h-full bg-accent" style={{ width: `${data.composition.cashShare}%` }} /> : null}
            {data.composition.investmentShare > 0 ? <View className="h-full bg-positive" style={{ width: `${data.composition.investmentShare}%` }} /> : null}
            {data.composition.liabilityShare > 0 ? <View className="h-full bg-critical" style={{ width: `${data.composition.liabilityShare}%` }} /> : null}
          </View>
          <View className="mt-3 gap-2">
            <View className="flex-row items-center gap-2">
              <View className="size-2 rounded-full bg-accent" />
              <Text className="flex-1 text-xs text-ink-muted">Hotovost</Text>
              <Text className="font-sans-semibold text-xs text-ink">{formatMoney(data.netWorth.cashValue)}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="size-2 rounded-full bg-positive" />
              <Text className="flex-1 text-xs text-ink-muted">Investice</Text>
              <Text className="font-sans-semibold text-xs text-ink">{formatMoney(data.netWorth.investmentValue)}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="size-2 rounded-full bg-critical" />
              <Text className="flex-1 text-xs text-ink-muted">Závazky</Text>
              <Text className="font-sans-semibold text-xs text-ink">{formatMoney(data.netWorth.liabilityValue)}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Delta + ratio cards */}
      <Pressable className="rounded-lg border border-line bg-surface p-5 active:bg-surface-subtle">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="font-sans-medium flex-1 text-sm text-ink-muted">Změna proti minulému měsíci</Text>
          {data.worthDelta.isNegative ? <TrendDownIcon color="#a43c3c" size={20} weight="duotone" /> : <TrendUpIcon color="#1c6b4c" size={20} weight="duotone" />}
        </View>
        <Text className={`font-sans-semibold mt-3 text-2xl ${data.worthDelta.isNegative ? 'text-critical' : 'text-positive'}`}>{formatMoney(data.worthDelta.formatted)}</Text>
        <Text className="mt-2 text-xs leading-relaxed text-ink-muted">
          {data.worthDeltaPercent === null ? 'Procento nelze spočítat z nulového minulého základu.' : `${data.worthDeltaPercent.formatted} % proti ${previousAsOf.toLocaleDateString('cs-CZ')}`}
        </Text>
      </Pressable>

      <Pressable className="rounded-lg border border-line bg-surface p-5 active:bg-surface-subtle">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="font-sans-medium flex-1 text-sm text-ink-muted">Hotovost : investice</Text>
          <ChartPieSliceIcon color="#17647c" size={20} weight="duotone" />
        </View>
        <Text className="font-sans-semibold mt-3 text-2xl text-ink">{data.cashInvestmentRatio === null ? 'Bez investic' : `${data.cashInvestmentRatio} : 1`}</Text>
        <Text className="mt-2 text-xs leading-relaxed text-ink-muted">Kreditní limity nejsou závazek ani součást hotovosti.</Text>
      </Pressable>

      {/* Rezervy a krytí */}
      <View className="gap-1">
        <Text className="font-sans-semibold text-base text-ink">Rezervy a krytí</Text>
        <Text className="text-sm text-ink-muted">Zdroje příjmů, dostupné rezervy a závazky mimo běžné fixní výdaje.</Text>
      </View>
      <DashboardMetric
        href="/(tabs)/more/planning"
        icon={<TrendUpIcon color="#17647c" size={19} weight="duotone" />}
        label="Označené příjmy"
        value={formatMoney(data.fixedIncome)}
        detail="Platby ručně nebo pravidlem označené kategorií Příjmy."
      />
      <DashboardMetric
        href="/(tabs)/more/accounts"
        icon={<CreditCardIcon color="#17647c" size={19} weight="duotone" />}
        label="Využití kreditních limitů"
        value={data.credit.utilization === null ? 'Bez podkladu' : `${data.credit.utilization} %`}
        progress={data.credit.utilization === null ? null : Number(data.credit.utilization)}
        progressGradient
        detail={data.credit.accountsCount === 0 ? 'Není nastaven CZK kreditní účet s limitem.' : `${formatMoney(data.credit.used)} z ${formatMoney(data.credit.limit)}.`}
      />
      <DashboardMetric
        href="/(tabs)/more/planning"
        icon={<BankIcon color="#17647c" size={19} weight="duotone" />}
        label="DCA financování"
        value={data.dca.plansCount === 0 ? 'Bez plánů' : `${data.dca.plansCount - data.dca.unmatchedCount}/${data.dca.plansCount}`}
        progress={data.dca.plansCount ? ((data.dca.plansCount - data.dca.unmatchedCount) / data.dca.plansCount) * 100 : null}
        progressColor={data.dca.overdueCount > 0 ? 'bg-critical' : 'bg-positive'}
        detail={
          data.dca.plansCount === 0
            ? 'Aktivní pravidelný vklad není nastaven.'
            : data.dca.unmatchedCount === 0
              ? 'Financování všech aktivních plánů má spárovaný převod.'
              : data.dca.overdueCount > 0
                ? `${data.dca.overdueCount} plánů je po toleranci bez spárovaného převodu na brokera.`
                : `${data.dca.pendingCount} plánů čeká na splatnost nebo doplnění financování.`
        }
      />
      <DashboardMetric
        href="/(tabs)/more/insurance"
        icon={<CarIcon color="#17647c" size={19} weight="duotone" />}
        label="Pojistky vozidel"
        value={formatMoney(data.insurance.annualCostTotal)}
        valueCaption={`ročně · ${formatMoney(data.insurance.monthlyAccrualCost)}/měsíc · ${data.insurance.upcomingRenewals.length > 0 ? `${data.insurance.upcomingRenewals.length} obnova do 30 dnů` : 'žádná obnova do 30 dnů'}`}
        detail={data.insurance.sinkingFundCovered ? 'Rezerva na spořáku pokrývá cíl k dnešku.' : `Rezerva na spořáku nestačí — chybí ${formatMoney(data.insurance.sinkingFundShortfall)} do cíle k dnešku.`}
        detailTone={data.insurance.sinkingFundCovered ? 'positive' : 'warning'}
      />

      {/* Akční centrum */}
      <View className="gap-1">
        <Text className="font-sans-semibold text-base text-ink">Akční centrum</Text>
        <Text className="text-sm text-ink-muted">Jen položky vyžadující zásah.</Text>
      </View>
      <View className="overflow-hidden rounded-lg border border-line bg-surface">
        {visibleActions.map((action, index) => {
          const ActionIcon = ACTION_ICONS[action.key] ?? WarningCircleIcon;
          return (
            <Pressable
              key={action.key}
              className={`flex-row items-start gap-3 p-4 active:bg-surface-subtle ${index < data.actions.length - 1 ? 'border-b border-line' : ''}`}
            >
              <ActionIcon color="#8a5a13" size={19} weight="duotone" />
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-sm text-ink">{action.title}</Text>
                <Text className="mt-1 text-xs leading-relaxed text-ink-muted">{action.detail}</Text>
              </View>
              <Badge tone="warning">{action.count}</Badge>
            </Pressable>
          );
        })}
        {resolvedActions.map((action, index) => {
          const ActionIcon = ACTION_ICONS[action.key] ?? WarningCircleIcon;
          return (
            <View key={action.key} className={`flex-row items-start gap-3 p-4 ${index < resolvedActions.length - 1 ? 'border-b border-line' : ''}`}>
              <ActionIcon color="#1c6b4c" size={19} weight="duotone" />
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-sm text-ink">{action.title}</Text>
                <Text className="mt-1 text-xs leading-relaxed text-ink-muted">Bez aktuálního problému.</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Fixní výdaje */}
      <View className="gap-1">
        <Text className="font-sans-semibold text-base text-ink">Fixní výdaje</Text>
        <Text className="text-sm text-ink-muted">Celkový měsíční náklad a přiřazené platby vůči očekávání.</Text>
      </View>
      <DashboardMetric
        href="/(tabs)/more/planning"
        icon={<ReceiptIcon color="#17647c" size={19} weight="duotone" />}
        label="Celkem tento měsíc"
        value={formatMoney(data.burnRate.total)}
        progress={data.burnRate.spendingTargetProgress}
        progressColor={data.burnRate.targetDifference?.isPositive ? 'bg-warning' : 'bg-accent'}
        detail={data.burnRate.target ? `${formatMoney(data.burnRate.targetDifference?.formatted ?? '0')} proti cíli ${formatMoney(data.burnRate.target)}.` : 'Měsíční cíl fixních výdajů není nastaven.'}
      />

      {data.recurringExpenses.length > 0 ? (
        <View className="overflow-hidden rounded-lg border border-line bg-surface">
          {data.recurringExpenses.map((expense, index) => (
            <View key={expense.id} className={`p-4 ${index < data.recurringExpenses.length - 1 ? 'border-b border-line' : ''}`}>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-sans-semibold flex-1 text-sm text-ink">{expense.name}</Text>
                <Badge tone={expense.stateTone === 'success' ? 'success' : expense.stateTone === 'warning' ? 'warning' : 'info'}>{expense.stateLabel}</Badge>
              </View>
              {expense.difference ? (
                <Text className={`mt-1 text-xs ${expense.difference.isZero ? 'text-ink' : expense.difference.isPositive ? 'text-critical' : 'text-positive'}`}>
                  {formatMoney(expense.difference.formatted)} proti očekávání
                </Text>
              ) : null}
              <View className="mt-2 flex-row items-center justify-between">
                <Text className="text-xs text-ink-muted">Očekáváno: {formatMoney(expense.expectedAmount, expense.currency)}</Text>
                <Text className="font-sans-medium text-xs text-ink">{expense.actualAmount ? `Zaplaceno: ${formatMoney(expense.actualAmount)}` : 'Nenalezena platba'}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View className="rounded-lg border border-line bg-accent-soft p-4">
          <Text className="font-sans-semibold text-sm text-ink">Fixní výdaje nejsou nastavené</Text>
          <Text className="mt-1 text-sm text-ink-muted">Bez očekávaných položek nelze kontrolovat označení pravidelných plateb.</Text>
        </View>
      )}
    </ScrollView>
  );
}
