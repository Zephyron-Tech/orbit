import {
  ArrowRight,
  Bank,
  CarIcon as Car,
  ChartPieSlice,
  ClockCounterClockwise,
  CreditCard,
  LinkBreak,
  Receipt,
  TrendDown,
  TrendUp,
  Wallet,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { MonthPicker } from '@/components/dashboard/month-picker';
import { MoneyValue } from '@/components/ui/money-value';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { Badge, StatusNotice } from '@/components/ui/status';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/format-money';
import { isPeriod, PERIOD_COOKIE } from '@/lib/ui/period';

export const dynamic = 'force-dynamic';

const ACTION_ICONS: Record<string, React.ReactNode> = {
  uncategorized: <Receipt size={19} weight="duotone" />,
  'unmatched-transfers': <LinkBreak size={19} weight="duotone" />,
  'failed-imports': <WarningCircle size={19} weight="duotone" />,
  'data-gaps': <Bank size={19} weight="duotone" />,
  'dca-overdue': <ClockCounterClockwise size={19} weight="duotone" />,
  'overdue-recurring': <WarningCircle size={19} weight="duotone" />,
  'cash-buffer': <Bank size={19} weight="duotone" />,
};

interface DashboardResponse {
  period: { year: number; month: number; key: string; transactionPeriod: string };
  asOf: string;
  previousAsOf: string;
  visibleMonths: string[];
  netWorth: { totalWorth: string; cashValue: string; investmentValue: string; liabilityValue: string; incompleteAccountsCount: number };
  worthDelta: { formatted: string; isNegative: boolean; isPositive: boolean; isZero: boolean };
  worthDeltaPercent: { formatted: string; isPositive: boolean } | null;
  cashInvestmentRatio: string | null;
  composition: { cashShare: number; investmentShare: number; liabilityShare: number };
  zeroCashAndInvestment: boolean;
  fixedIncome: string;
  credit: { utilization: string | null; used: string; limit: string; accountsCount: number };
  dca: { plansCount: number; unmatchedCount: number; overdueCount: number; pendingCount: number };
  insurance: { annualCostTotal: string; monthlyAccrualCost: string; upcomingRenewals: unknown[]; sinkingFundCovered: boolean; sinkingFundShortfall: string };
  actions: { key: string; title: string; count: number; detail: string; href: string }[];
  burnRate: { total: string; target: string | null; targetDifference: { formatted: string; isNegative: boolean; isPositive: boolean; isZero: boolean } | null; spendingTargetProgress: number | null };
  recurringExpenses: {
    id: string;
    name: string;
    expectedAmount: string;
    currency: string;
    isMissing: boolean;
    stateLabel: string;
    stateTone: 'info' | 'warning' | 'success';
    actualAmount: string | null;
    difference: { formatted: string; isNegative: boolean; isPositive: boolean; isZero: boolean } | null;
  }[];
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const preferredMonth = (await cookies()).get(PERIOD_COOKIE)?.value;
  const cookieHeader = (await headers()).get('cookie') ?? undefined;

  const query: Record<string, string> = {};
  if (params.period) query.period = params.period;
  if (isPeriod(preferredMonth)) query.preferredMonth = preferredMonth;

  const response = await apiClient(cookieHeader).dashboard.$get({ query });
  if (!response.ok) redirect('/signin');
  const data = (await response.json()) as DashboardResponse;

  const asOf = new Date(data.asOf);
  const previousAsOf = new Date(data.previousAsOf);

  return (
    <PageShell>
      <PageHeader
        title="Řídicí centrum domácnosti"
        description="Stav majetku, fixní provoz a úkoly, které vyžadují kontrolu."
        actions={<MonthPicker current={data.period.key} months={data.visibleMonths} />}
      />

      <section aria-label="Hlavní telemetrie" className="grid gap-3 lg:grid-cols-12">
        <div className="surface overflow-hidden lg:col-span-8">
          <div className="p-5 md:p-7">
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Čisté jmění k {asOf.toLocaleDateString('cs-CZ')}</p>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-accent"><Wallet size={20} weight="duotone" aria-hidden="true" /></span>
            </div>
            <p className="money-value mt-3 text-[clamp(2.1rem,5vw,3.35rem)] font-semibold tracking-[-0.05em]"><MoneyValue>{formatMoney(data.netWorth.totalWorth)}</MoneyValue></p>
            <p className="mt-2 text-sm text-ink-muted">{data.netWorth.incompleteAccountsCount > 0 ? `${data.netWorth.incompleteAccountsCount} účtů má neúplný podklad; hodnota nemusí být úplná.` : 'Součet hotovosti, investic a evidovaných závazků.'}</p>
          </div>
          <div className="border-t border-line bg-surface-subtle px-5 py-4 md:px-7">
            <div className="flex h-2 overflow-hidden rounded-full bg-line" aria-label="Složení aktiv">
              {data.composition.cashShare > 0 ? <span className="bg-accent" style={{ width: `${data.composition.cashShare}%` }} /> : null}
              {data.composition.investmentShare > 0 ? <span className="bg-positive" style={{ width: `${data.composition.investmentShare}%` }} /> : null}
              {data.composition.liabilityShare > 0 ? <span className="bg-critical" style={{ width: `${data.composition.liabilityShare}%` }} /> : null}
            </div>
            <div className="mt-3 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-3">
              <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ink-muted"><i className="size-2 rounded-full bg-accent" /><span>Hotovost</span><strong className="font-semibold text-ink"><MoneyValue>{formatMoney(data.netWorth.cashValue)}</MoneyValue></strong></span>
              <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ink-muted"><i className="size-2 rounded-full bg-positive" /><span>Investice</span><strong className="font-semibold text-ink"><MoneyValue>{formatMoney(data.netWorth.investmentValue)}</MoneyValue></strong></span>
              <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ink-muted"><i className="size-2 rounded-full bg-critical" /><span>Závazky</span><strong className="font-semibold text-ink"><MoneyValue>{formatMoney(data.netWorth.liabilityValue)}</MoneyValue></strong></span>
            </div>
          </div>
        </div>
        <div className="grid gap-3 lg:col-span-4">
          <Link href="/net-worth" className="surface block p-5 transition-colors hover:bg-surface-subtle">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-ink-muted">Změna proti minulému měsíci</p>
              {data.worthDelta.isNegative ? <TrendDown size={20} weight="duotone" className="text-critical" aria-hidden="true" /> : <TrendUp size={20} weight="duotone" className="text-positive" aria-hidden="true" />}
            </div>
            <p className={`money-value mt-3 text-2xl font-semibold tracking-[-0.04em] ${data.worthDelta.isNegative ? 'text-critical' : 'text-positive'}`}><MoneyValue>{formatMoney(data.worthDelta.formatted)}</MoneyValue></p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">{data.worthDeltaPercent === null ? 'Procento nelze spočítat z nulového minulého základu.' : `${data.worthDeltaPercent.formatted} % proti ${previousAsOf.toLocaleDateString('cs-CZ')}`}</p>
          </Link>
          <Link href="/net-worth" className="surface block p-5 transition-colors hover:bg-surface-subtle">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-ink-muted">Hotovost : investice</p>
              <ChartPieSlice size={20} weight="duotone" className="text-accent" aria-hidden="true" />
            </div>
            <p className="money-value mt-3 text-2xl font-semibold tracking-[-0.04em]">{data.cashInvestmentRatio === null ? 'Bez investic' : `${data.cashInvestmentRatio} : 1`}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">Kreditní limity nejsou závazek ani součást hotovosti.</p>
          </Link>
        </div>
      </section>

      <section aria-labelledby="operations" className="flex flex-col gap-3">
        <SectionHeader title="Rezervy a krytí" description="Zdroje příjmů, dostupné rezervy a závazky mimo běžné fixní výdaje." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DashboardMetric href="/planning" icon={<TrendUp size={19} weight="duotone" />} iconClass="bg-[var(--accent-soft)] text-accent" label="Označené příjmy" value={<MoneyValue>{formatMoney(data.fixedIncome)}</MoneyValue>} detail="Platby ručně nebo pravidlem označené kategorií Příjmy." />
          <DashboardMetric
            href="/accounts"
            icon={<CreditCard size={19} weight="duotone" />}
            iconClass="bg-[var(--accent-soft)] text-accent"
            label="Využití kreditních limitů"
            value={data.credit.utilization === null ? 'Bez podkladu' : `${data.credit.utilization} %`}
            progress={data.credit.utilization === null ? null : Number(data.credit.utilization)}
            progressGradient
            detail={data.credit.accountsCount === 0 ? 'Není nastaven CZK kreditní účet s limitem.' : <><MoneyValue>{formatMoney(data.credit.used)}</MoneyValue> z <MoneyValue>{formatMoney(data.credit.limit)}</MoneyValue>.</>}
          />
          <DashboardMetric
            href="/planning"
            icon={<Bank size={19} weight="duotone" />}
            iconClass="bg-[var(--accent-soft)] text-accent"
            label="DCA financování"
            value={data.dca.plansCount === 0 ? 'Bez plánů' : `${data.dca.plansCount - data.dca.unmatchedCount}/${data.dca.plansCount}`}
            progress={data.dca.plansCount ? ((data.dca.plansCount - data.dca.unmatchedCount) / data.dca.plansCount) * 100 : null}
            progressClass={data.dca.overdueCount > 0 ? 'bg-critical' : 'bg-positive'}
            detail={
              data.dca.plansCount === 0
                ? 'Aktivní pravidelný vklad není nastaven.'
                : data.dca.unmatchedCount === 0
                  ? 'Financování všech aktivních plánů má spárovaný převod.'
                  : data.dca.overdueCount > 0
                    ? `${data.dca.overdueCount} plánů je po toleranci bez spárovaného převodu na brokera.`
                    : `${data.dca.pendingCount} plánů čeká na splatnost nebo doplnění financování; vklad není potvrzený nákup investice.`
            }
          />
          <DashboardMetric
            href="/insurance"
            icon={<Car size={19} weight="duotone" />}
            iconClass="bg-[var(--accent-soft)] text-accent"
            label="Pojistky vozidel"
            value={<MoneyValue>{formatMoney(data.insurance.annualCostTotal)}</MoneyValue>}
            valueCaption={<>ročně · <MoneyValue>{formatMoney(data.insurance.monthlyAccrualCost)}</MoneyValue>/měsíc · {data.insurance.upcomingRenewals.length > 0 ? `${data.insurance.upcomingRenewals.length} obnova do 30 dnů` : 'žádná obnova do 30 dnů'}</>}
            detail={data.insurance.sinkingFundCovered ? 'Rezerva na spořáku pokrývá cíl k dnešku.' : <>Rezerva na spořáku nestačí — chybí <MoneyValue>{formatMoney(data.insurance.sinkingFundShortfall)}</MoneyValue> do cíle k dnešku.</>}
            detailTone={data.insurance.sinkingFundCovered ? 'positive' : 'warning'}
          />
        </div>
        {data.zeroCashAndInvestment ? <StatusNotice title="Poměr hotovosti a investic nelze vyhodnotit" tone="info">K vybranému měsíci nejsou doložené žádné hodnoty hotovosti ani investic.</StatusNotice> : null}
      </section>

      <div className="grid gap-8 xl:grid-cols-12 xl:items-start">
        <section aria-labelledby="action-center" className="flex flex-col gap-3 xl:col-span-5">
          <SectionHeader title="Akční centrum" description="Jen položky vyžadující zásah." />
          <div className="surface divide-y divide-line overflow-hidden">
            {data.actions.map((action) =>
              action.count > 0 ? (
                <Link key={action.key} href={action.href} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-4 transition-colors hover:bg-surface-subtle">
                  <span className="mt-0.5 text-warning">{ACTION_ICONS[action.key]}</span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">{action.title}</span><span className="mt-1 block text-xs leading-relaxed text-ink-muted">{action.detail}</span></span>
                  <span className="flex items-center gap-2"><Badge tone="warning">{action.count}</Badge><ArrowRight size={15} className="text-ink-muted transition-transform group-hover:translate-x-0.5" /></span>
                </Link>
              ) : (
                <div key={action.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-4">
                  <span className="mt-0.5 text-positive">{ACTION_ICONS[action.key]}</span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">{action.title}</span><span className="mt-1 block text-xs leading-relaxed text-ink-muted">Bez aktuálního problému.</span></span>
                </div>
              ),
            )}
          </div>
        </section>

        <section aria-labelledby="recurring" className="flex flex-col gap-3 xl:col-span-7">
          <SectionHeader title="Fixní výdaje" description="Celkový měsíční náklad a přiřazené platby vůči očekávání." />
          <DashboardMetric
            href="/planning"
            icon={<Receipt size={19} weight="duotone" />}
            iconClass="bg-[var(--accent-soft)] text-accent"
            label="Celkem tento měsíc"
            value={<MoneyValue>{formatMoney(data.burnRate.total)}</MoneyValue>}
            progress={data.burnRate.spendingTargetProgress}
            progressClass={data.burnRate.targetDifference?.isPositive ? 'bg-warning' : 'bg-accent'}
            detail={
              data.burnRate.target ? (
                <><MoneyValue>{formatMoney(data.burnRate.targetDifference?.formatted ?? '0')}</MoneyValue> proti cíli <MoneyValue>{formatMoney(data.burnRate.target)}</MoneyValue>.</>
              ) : (
                'Měsíční cíl fixních výdajů není nastaven.'
              )
            }
          />
          {data.recurringExpenses.length > 0 ? (
            <>
              <div className="surface overflow-hidden">
                <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto] gap-6 border-b border-line px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-muted sm:grid"><span>Položka</span><span className="text-right">Očekáváno</span><span className="w-36 text-right">Zaplaceno</span></div>
                <ol className="divide-y divide-line">
                  {data.recurringExpenses.map((expense) => (
                    <li key={expense.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{expense.name}</p>
                          <Badge tone={expense.stateTone}>{expense.stateLabel}</Badge>
                        </div>
                        {expense.difference ? <p className={`tabular mt-1 text-xs ${expense.difference.isZero ? 'text-ink' : expense.difference.isPositive ? 'text-critical' : 'text-positive'}`}><MoneyValue>{formatMoney(expense.difference.formatted)}</MoneyValue> proti očekávání</p> : null}
                      </div>
                      <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right"><span className="text-xs text-ink-muted sm:hidden">Očekáváno</span><span className="tabular text-sm font-medium"><MoneyValue>{formatMoney(expense.expectedAmount, expense.currency)}</MoneyValue></span></div>
                      <div className="flex items-baseline justify-between gap-3 sm:w-36 sm:block sm:text-right">
                        <span className="text-xs text-ink-muted sm:hidden">Zaplaceno</span>
                        {expense.actualAmount ? <span className="tabular text-sm font-semibold"><MoneyValue>{formatMoney(expense.actualAmount)}</MoneyValue></span> : <Link href={`/transactions?period=${data.period.transactionPeriod}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">Najít platbu <ArrowRight size={14} /></Link>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <Link href="/planning" className="ui-button ui-button-ghost self-start">Nastavení fixních výdajů <ArrowRight size={16} /></Link>
            </>
          ) : (
            <StatusNotice title="Fixní výdaje nejsou nastavené" tone="info" actions={<Link href="/planning" className="ui-button ui-button-secondary">Přidat položky</Link>}>Bez očekávaných položek nelze kontrolovat označení pravidelných plateb.</StatusNotice>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function DashboardMetric({
  icon,
  iconClass,
  label,
  value,
  valueCaption,
  detail,
  detailTone,
  progress,
  progressClass,
  progressGradient,
  href,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: React.ReactNode;
  valueCaption?: React.ReactNode;
  detail: React.ReactNode;
  detailTone?: 'warning' | 'positive';
  progress?: number | null;
  progressClass?: string;
  progressGradient?: boolean;
  href?: string;
}): React.JSX.Element {
  const visibleProgress = progress === null || progress === undefined ? null : Math.max(0, Math.min(progress, 100));
  const detailClass = detailTone === 'warning' ? 'text-warning' : detailTone === 'positive' ? 'text-positive' : 'text-ink-muted';

  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>{icon}</span>
      </div>
      <p className="money-value mt-4 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
      {valueCaption ? <p className="mt-1 text-xs text-ink-muted">{valueCaption}</p> : null}
      {visibleProgress !== null ? (
        progressGradient ? (
          <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-[linear-gradient(90deg,var(--positive)_0%,var(--warning)_60%,var(--critical)_100%)]"><span className="absolute inset-y-0 right-0 bg-line" style={{ width: `${100 - visibleProgress}%` }} /></div>
        ) : (
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line"><span className={`block h-full rounded-full ${progressClass ?? 'bg-accent'}`} style={{ width: `${visibleProgress}%` }} /></div>
        )
      ) : null}
      <p className={`mt-3 text-xs leading-relaxed ${detailClass}`}>{detail}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="surface block min-w-0 p-4 transition-colors hover:bg-surface-subtle sm:p-5">
        {content}
      </Link>
    );
  }

  return <div className="surface min-w-0 p-4 sm:p-5">{content}</div>;
}
