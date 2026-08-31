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
import { cookies } from 'next/headers';

import { MonthPicker } from '@/components/dashboard/month-picker';
import { MoneyValue } from '@/components/ui/money-value';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { Badge, StatusNotice } from '@/components/ui/status';
import { prisma } from '@/lib/db/prisma';
import { calculateBurnRate, type BurnRateTransaction } from '@/lib/finance/burn-rate';
import { loadInsuranceOverview } from '@/lib/finance/insurance-service';
import { loadNetWorth } from '@/lib/finance/net-worth-service';
import { monthPeriod } from '@/lib/finance/settlement';
import { findCoverageGaps } from '@/lib/import/coverage';
import { Prisma } from '@/lib/generated/prisma/client';
import { isPeriod, PERIOD_COOKIE, periodParts } from '@/lib/ui/period';

export const dynamic = 'force-dynamic';

const MONEY_FORMATTERS = new Map<string, Intl.NumberFormat>();

function formatMoney(amount: Prisma.Decimal, currency = 'CZK'): string {
  let formatter = MONEY_FORMATTERS.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    MONEY_FORMATTERS.set(currency, formatter);
  }
  return formatter.format(amount.toNumber());
}

function parsePeriod(value: string | undefined, fallback: { year: number; month: number }): { year: number; month: number } {
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : fallback;
}

function endOfMonthUtc(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function endOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const preferredPeriod = (await cookies()).get(PERIOD_COOKIE)?.value;
  const newest = await prisma.transaction.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
  const now = new Date();
  const fallback = newest
    ? { year: newest.date.getUTCFullYear(), month: newest.date.getUTCMonth() + 1 }
    : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const remembered = isPeriod(preferredPeriod) ? periodParts(preferredPeriod) : null;
  const period = parsePeriod(params.period, remembered ?? fallback);
  const periodKey = `${period.year}-${String(period.month).padStart(2, '0')}`;
  const transactionPeriod = `month:${periodKey}`;
  const { from, to } = monthPeriod(period.year, period.month);
  const selectedCurrentMonth = isCurrentMonth(period.year, period.month, now);
  const asOf = selectedCurrentMonth ? endOfDayUtc(now) : endOfMonthUtc(period.year, period.month);
  const previousAsOf = endOfMonthUtc(period.year, period.month - 1);

  const [
    transactions,
    recurringExpenses,
    investmentPlans,
    settings,
    incomeCategory,
    months,
    currentWorth,
    previousWorth,
    accounts,
    importBatches,
    unmatchedTransferRows,
    firstBankBatch,
    insuranceOverview,
  ] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: from, lt: to } },
      select: {
        accountId: true,
        recurringExpenseId: true,
        categoryId: true,
        amount: true,
        amountCzk: true,
        currency: true,
        date: true,
        kind: true,
        isShared: true,
        myShareRatio: true,
        transferId: true,
        transfer: { select: { legs: { select: { accountId: true, amount: true, amountCzk: true, currency: true, kind: true } } } },
      },
    }),
    prisma.recurringExpense.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsOn: null }, { startsOn: { lte: asOf } }] },
          { OR: [{ endsOn: null }, { endsOn: { gte: from } }] },
        ],
      },
      orderBy: [{ expectedAmount: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, expectedAmount: true, currency: true, isActive: true, dueDay: true, graceDays: true, paymentAccountId: true },
    }),
    prisma.recurringInvestmentPlan.findMany({
      where: {
        isActive: true,
        AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: asOf } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: from } }] }],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, sourceAccountId: true, brokerAccountId: true, expectedAmount: true, currency: true, dueDay: true, graceDays: true },
    }),
    prisma.planningSettings.findUnique({ where: { id: 'household' }, select: { monthlySpendingTarget: true, transferHistoryFrom: true, reportingStartMonth: true } }),
    prisma.category.findUnique({ where: { key: 'income' }, select: { id: true } }),
    prisma.$queryRaw<{ month: string }[]>`
      SELECT DISTINCT to_char("date", 'YYYY-MM') AS month
      FROM "Transaction"
      ORDER BY month DESC
    `,
    loadNetWorth(asOf),
    loadNetWorth(previousAsOf),
    prisma.account.findMany({
      where: { isArchived: false, includeInNetWorth: true },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        creditLimit: true,
        cardLast4: true,
        snapshots: {
          where: { capturedAt: { lte: asOf } },
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: { balance: true, capturedAt: true, expectedBalance: true },
        },
      },
    }),
    prisma.importBatch.findMany({
      select: { status: true, failedCount: true, coverageFrom: true, coverageTo: true, accountId: true, account: { select: { name: true } } },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: from, lt: to }, kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null },
      select: { date: true, account: { select: { provider: true } } },
    }),
    prisma.importBatch.findFirst({
      where: { status: 'COMPLETED', account: { provider: { not: 'TRADING212' } }, periodFrom: { not: null } },
      orderBy: { periodFrom: 'asc' },
      select: { periodFrom: true },
    }),
    loadInsuranceOverview(now, 30),
  ]);

  const zero = new Prisma.Decimal(0);
  const transferHistoryFrom = settings?.transferHistoryFrom ?? firstBankBatch?.periodFrom ?? null;
  const unmatchedTransfers = unmatchedTransferRows.filter(
    (row) => row.account.provider !== 'TRADING212' || transferHistoryFrom === null || row.date.getTime() >= transferHistoryFrom.getTime(),
  ).length;
  const reportingTransactions = transactions.flatMap((transaction) => {
    const amountCzk = transaction.currency === 'CZK' ? transaction.amount : transaction.amountCzk;
    return amountCzk ? [{ ...transaction, amountCzk }] : [];
  });
  const normalTransactions = reportingTransactions.filter((transaction) => transaction.kind === 'NORMAL');
  const uncategorizedExpenses = normalTransactions.filter((transaction) => transaction.amountCzk.isNegative() && !transaction.categoryId).length;

  const burnRateTransactions: BurnRateTransaction[] = reportingTransactions.map((transaction) => ({
    recurringExpenseId: transaction.recurringExpenseId,
    amountCzk: transaction.amountCzk,
    date: transaction.date,
    kind: transaction.kind,
    isShared: transaction.isShared,
    myShareRatio: transaction.myShareRatio,
  }));
  const burnRate = calculateBurnRate(burnRateTransactions, recurringExpenses);
  const actualById = new Map(burnRate.lines.map((line) => [line.recurringExpenseId, line]));
  const taggedIds = new Set(
    transactions.flatMap((transaction) => transaction.kind === 'NORMAL' && transaction.amount.isNegative() && transaction.recurringExpenseId ? [transaction.recurringExpenseId] : []),
  );
  const missingRecurring = recurringExpenses.filter((expense) => !taggedIds.has(expense.id));
  const fixedIncome = normalTransactions
    .filter((transaction) => transaction.amountCzk.isPositive() && transaction.categoryId === incomeCategory?.id)
    .reduce((sum, transaction) => sum.plus(transaction.amountCzk), zero);
  const target = settings?.monthlySpendingTarget ?? null;
  const targetDifference = target ? burnRate.total.minus(target) : null;
  const periodEndDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
  const todayDay = isCurrentMonth(period.year, period.month, now) ? now.getUTCDate() : periodEndDay;
  const overdueRecurring = missingRecurring.filter((expense) => expense.dueDay !== null && todayDay > Math.min(expense.dueDay, periodEndDay) + expense.graceDays);
  const upcomingRecurring = missingRecurring.filter((expense) => expense.dueDay !== null && todayDay <= Math.min(expense.dueDay, periodEndDay) + expense.graceDays);
  const scheduledByAccount = new Map<string, Prisma.Decimal>();
  for (const expense of upcomingRecurring) {
    if (!expense.paymentAccountId || expense.currency !== 'CZK') continue;
    scheduledByAccount.set(expense.paymentAccountId, (scheduledByAccount.get(expense.paymentAccountId) ?? zero).plus(expense.expectedAmount));
  }
  const cashBufferIssues = [...scheduledByAccount].filter(([accountId, scheduled]) => {
    const balance = currentWorth.accounts.find((account) => account.accountId === accountId)?.balance;
    return balance ? balance.lessThan(scheduled) : false;
  });

  const worthDelta = currentWorth.totalWorth.minus(previousWorth.totalWorth);
  const worthDeltaPercent = previousWorth.totalWorth.isZero() ? null : worthDelta.dividedBy(previousWorth.totalWorth.abs()).times(100);
  const cashInvestmentRatio = currentWorth.investmentValue.isZero()
    ? null
    : currentWorth.cashValue.dividedBy(currentWorth.investmentValue);
  const incompleteWorthAccounts = currentWorth.accounts.filter((account) => account.incompleteHistory || account.source === 'UNKNOWN');
  const creditAccounts = accounts.filter((account) => account.type === 'CREDIT' && account.creditLimit && account.currency === 'CZK');
  const creditUsed = creditAccounts.reduce((sum, account) => {
    const balance = currentWorth.accounts.find((entry) => entry.accountId === account.id)?.balance ?? zero;
    return balance.isNegative() ? sum.plus(balance.abs()) : sum;
  }, zero);
  const creditLimit = creditAccounts.reduce((sum, account) => sum.plus(account.creditLimit ?? zero), zero);
  const creditUtilization = creditLimit.isZero() ? null : creditUsed.dividedBy(creditLimit).times(100);
  const assetValue = currentWorth.cashValue.plus(currentWorth.investmentValue);
  const compositionValue = assetValue.plus(currentWorth.liabilityValue);
  const cashShare = compositionValue.isZero() ? 0 : currentWorth.cashValue.dividedBy(compositionValue).times(100).toNumber();
  const investmentShare = compositionValue.isZero() ? 0 : currentWorth.investmentValue.dividedBy(compositionValue).times(100).toNumber();
  const liabilityShare = compositionValue.isZero() ? 0 : currentWorth.liabilityValue.dividedBy(compositionValue).times(100).toNumber();
  const spendingTargetProgress = target && !target.isZero() ? burnRate.total.dividedBy(target).times(100).toNumber() : null;
  const matchedTransferIds = new Set<string>();
  const unmatchedDcaPlans = investmentPlans.filter((plan) => {
    const candidate = transactions.find((transaction) => {
      if (!transaction.transferId || !transaction.transfer || matchedTransferIds.has(transaction.transferId)) return false;
      const legs = transaction.transfer.legs;
      const brokerLeg = legs.find((leg) => leg.accountId === plan.brokerAccountId && leg.amount.isPositive() && leg.kind === 'INTERNAL_TRANSFER');
      const hasSourceLeg = plan.sourceAccountId
        ? legs.some((leg) => leg.accountId === plan.sourceAccountId && leg.amount.isNegative() && leg.kind === 'INTERNAL_TRANSFER')
        : legs.some((leg) => leg.accountId !== plan.brokerAccountId && leg.amount.isNegative() && leg.kind === 'INTERNAL_TRANSFER');
      if (!brokerLeg || !hasSourceLeg || brokerLeg.currency !== plan.currency) return false;
      return brokerLeg.amount.abs().equals(plan.expectedAmount);
    });
    if (candidate?.transferId) {
      matchedTransferIds.add(candidate.transferId);
      return false;
    }
    return true;
  });
  const dcaOverduePlans = unmatchedDcaPlans.filter((plan) => {
    const due = Math.min(plan.dueDay, periodEndDay);
    return todayDay > due + plan.graceDays;
  });
  const dcaPendingPlans = unmatchedDcaPlans.filter((plan) => !dcaOverduePlans.some((overdue) => overdue.id === plan.id));

  const coverageGapCount = [...new Map(importBatches.map((batch) => [batch.accountId, batch.account.name])).keys()]
    .reduce((count, accountId) => count + findCoverageGaps(importBatches.filter((batch) => batch.accountId === accountId)).length, 0);
  const checkpointIssues = accounts.filter((account) => {
    const snapshot = account.snapshots[0];
    return !snapshot || (snapshot.expectedBalance !== null && !snapshot.balance.equals(snapshot.expectedBalance));
  }).length;
  const failedImports = importBatches.filter((batch) => batch.status === 'FAILED' || batch.failedCount > 0).length;
  const dataGapCount = coverageGapCount + checkpointIssues + incompleteWorthAccounts.length;
  const historyBaseline = settings?.transferHistoryFrom ?? firstBankBatch?.periodFrom ?? null;
  // Two independent floors: `historyBaseline` hides months where transfer
  // data isn't trustworthy yet, `reportingStartMonth` is the user's explicit
  // "don't show anything before this" — whichever is later wins.
  const floorMonth = [historyBaseline, settings?.reportingStartMonth]
    .filter((date): date is Date => date !== null && date !== undefined)
    .map((date) => date.toISOString().slice(0, 7))
    .sort()
    .at(-1) ?? null;
  const visibleMonths = months.filter((row) => !floorMonth || row.month >= floorMonth);
  const actions = [
    { title: 'Nezařazené výdaje', count: uncategorizedExpenses, detail: 'Výdaje bez kategorie zkreslují pohled podle účelu.', href: `/transactions?period=${transactionPeriod}&uncategorized=1`, icon: <Receipt size={19} weight="duotone" /> },
    { title: 'Nespárované převody v období', count: unmatchedTransfers, detail: unmatchedTransfers ? 'Bankovní nebo brokerové přesuny z vybraného měsíce čekají na protistranu.' : 'V tomto měsíci nezůstaly žádné jednostranné převody.', href: `/transactions?period=${transactionPeriod}&transfer=unmatched`, icon: <LinkBreak size={19} weight="duotone" /> },
    { title: 'Chyby importu', count: failedImports, detail: 'Import selhal nebo obsahoval řádky, které se nepodařilo zpracovat.', href: '/import', icon: <WarningCircle size={19} weight="duotone" /> },
    { title: 'Mezery v podkladech', count: dataGapCount, detail: 'Chybí kontrolní bod, navazující výpis nebo úplná historie účtu.', href: '/net-worth', icon: <Bank size={19} weight="duotone" /> },
    { title: 'DCA po termínu bez financování', count: dcaOverduePlans.length, detail: dcaOverduePlans.length ? 'Splatnost a tolerance DCA plánu uplynula bez spárovaného převodu na brokera.' : 'Žádný DCA plán není po termínu bez financování.', href: '/settings/planning', icon: <ClockCounterClockwise size={19} weight="duotone" /> },
    { title: 'Fixní výdaje po termínu', count: overdueRecurring.length, detail: overdueRecurring.length ? 'Splatnost a tolerance uplynula bez ručně přiřazené platby.' : 'Žádná naplánovaná fixní platba není po toleranci.', href: `/transactions?period=${transactionPeriod}`, icon: <WarningCircle size={19} weight="duotone" /> },
    { title: 'Krytí fixních plateb', count: cashBufferIssues.length, detail: cashBufferIssues.length ? 'Známý zůstatek platebního účtu nepokrývá součet nadcházejících CZK plateb.' : 'Známé platební účty kryjí nadcházející CZK platby.', href: '/settings/recurring', icon: <Bank size={19} weight="duotone" /> },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Řídicí centrum domácnosti"
        description="Stav majetku, fixní provoz a úkoly, které vyžadují kontrolu."
        actions={<MonthPicker current={periodKey} months={visibleMonths.map((row) => row.month)} />}
      />

      <section aria-label="Hlavní telemetrie" className="grid gap-3 lg:grid-cols-12">
        <div className="surface overflow-hidden lg:col-span-8">
          <div className="p-5 md:p-7">
            <div className="flex items-start justify-between gap-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Čisté jmění k {asOf.toLocaleDateString('cs-CZ')}</p><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-accent"><Wallet size={20} weight="duotone" aria-hidden="true" /></span></div>
            <p className="money-value mt-3 text-[clamp(2.1rem,5vw,3.35rem)] font-semibold tracking-[-0.05em]"><MoneyValue>{formatMoney(currentWorth.totalWorth)}</MoneyValue></p>
            <p className="mt-2 text-sm text-ink-muted">{incompleteWorthAccounts.length > 0 ? `${incompleteWorthAccounts.length} účtů má neúplný podklad; hodnota nemusí být úplná.` : 'Součet hotovosti, investic a evidovaných závazků.'}</p>
          </div>
          <div className="border-t border-line bg-surface-subtle px-5 py-4 md:px-7">
            <div className="flex h-2 overflow-hidden rounded-full bg-line" aria-label="Složení aktiv">
              {cashShare > 0 ? <span className="bg-accent" style={{ width: `${cashShare}%` }} /> : null}
              {investmentShare > 0 ? <span className="bg-positive" style={{ width: `${investmentShare}%` }} /> : null}
              {liabilityShare > 0 ? <span className="bg-critical" style={{ width: `${liabilityShare}%` }} /> : null}
            </div>
            <div className="mt-3 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-3"><span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ink-muted"><i className="size-2 rounded-full bg-accent" /><span>Hotovost</span><strong className="font-semibold text-ink"><MoneyValue>{formatMoney(currentWorth.cashValue)}</MoneyValue></strong></span><span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ink-muted"><i className="size-2 rounded-full bg-positive" /><span>Investice</span><strong className="font-semibold text-ink"><MoneyValue>{formatMoney(currentWorth.investmentValue)}</MoneyValue></strong></span><span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-ink-muted"><i className="size-2 rounded-full bg-critical" /><span>Závazky</span><strong className="font-semibold text-ink"><MoneyValue>{formatMoney(currentWorth.liabilityValue)}</MoneyValue></strong></span></div>
          </div>
        </div>
        <div className="grid gap-3 lg:col-span-4"><Link href="/net-worth" className="surface block p-5 transition-colors hover:bg-surface-subtle"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-ink-muted">Změna proti minulému měsíci</p>{worthDelta.isNegative() ? <TrendDown size={20} weight="duotone" className="text-critical" aria-hidden="true" /> : <TrendUp size={20} weight="duotone" className="text-positive" aria-hidden="true" />}</div><p className={`money-value mt-3 text-2xl font-semibold tracking-[-0.04em] ${worthDelta.isNegative() ? 'text-critical' : 'text-positive'}`}><MoneyValue>{worthDelta.isPositive() ? '+' : ''}{formatMoney(worthDelta)}</MoneyValue></p><p className="mt-2 text-xs leading-relaxed text-ink-muted">{worthDeltaPercent === null ? 'Procento nelze spočítat z nulového minulého základu.' : `${worthDeltaPercent.isPositive() ? '+' : ''}${worthDeltaPercent.toFixed(1)} % proti ${previousAsOf.toLocaleDateString('cs-CZ')}`}</p></Link><Link href="/net-worth" className="surface block p-5 transition-colors hover:bg-surface-subtle"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-ink-muted">Hotovost : investice</p><ChartPieSlice size={20} weight="duotone" className="text-accent" aria-hidden="true" /></div><p className="money-value mt-3 text-2xl font-semibold tracking-[-0.04em]">{cashInvestmentRatio === null ? 'Bez investic' : `${cashInvestmentRatio.toFixed(2)} : 1`}</p><p className="mt-2 text-xs leading-relaxed text-ink-muted">Kreditní limity nejsou závazek ani součást hotovosti.</p></Link></div>
      </section>

      <section aria-labelledby="operations" className="flex flex-col gap-3">
        <SectionHeader title="Rezervy a krytí" description="Zdroje příjmů, dostupné rezervy a závazky mimo běžné fixní výdaje." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DashboardMetric href="/settings/planning" icon={<TrendUp size={19} weight="duotone" />} iconClass="bg-[var(--accent-soft)] text-accent" label="Označené příjmy" value={<MoneyValue>{formatMoney(fixedIncome)}</MoneyValue>} detail="Platby ručně nebo pravidlem označené kategorií Příjmy." />
          <DashboardMetric
            href="/settings/accounts"
            icon={<CreditCard size={19} weight="duotone" />}
            iconClass="bg-[var(--accent-soft)] text-accent"
            label="Využití kreditních limitů"
            value={creditUtilization === null ? 'Bez podkladu' : `${creditUtilization.toFixed(1)} %`}
            progress={creditUtilization?.toNumber() ?? null}
            progressGradient
            detail={
              creditAccounts.length === 0 ? (
                'Není nastaven CZK kreditní účet s limitem.'
              ) : (
                <>
                  <MoneyValue>{formatMoney(creditUsed)}</MoneyValue> z <MoneyValue>{formatMoney(creditLimit)}</MoneyValue>.
                </>
              )
            }
          />
          <DashboardMetric href="/settings/planning" icon={<Bank size={19} weight="duotone" />} iconClass="bg-[var(--accent-soft)] text-accent" label="DCA financování" value={investmentPlans.length === 0 ? 'Bez plánů' : `${investmentPlans.length - unmatchedDcaPlans.length}/${investmentPlans.length}`} progress={investmentPlans.length ? ((investmentPlans.length - unmatchedDcaPlans.length) / investmentPlans.length) * 100 : null} progressClass={dcaOverduePlans.length > 0 ? 'bg-critical' : 'bg-positive'} detail={investmentPlans.length === 0 ? 'Aktivní pravidelný vklad není nastaven.' : unmatchedDcaPlans.length === 0 ? 'Financování všech aktivních plánů má spárovaný převod.' : dcaOverduePlans.length > 0 ? `${dcaOverduePlans.length} plánů je po toleranci bez spárovaného převodu na brokera.` : `${dcaPendingPlans.length} plánů čeká na splatnost nebo doplnění financování; vklad není potvrzený nákup investice.`} />
          <DashboardMetric
            href="/settings/insurance"
            icon={<Car size={19} weight="duotone" />}
            iconClass="bg-[var(--accent-soft)] text-accent"
            label="Pojistky vozidel"
            value={<MoneyValue>{formatMoney(new Prisma.Decimal(insuranceOverview.annualCostTotal))}</MoneyValue>}
            valueCaption={
              <>
                ročně · <MoneyValue>{formatMoney(new Prisma.Decimal(insuranceOverview.monthlyAccrualCost))}</MoneyValue>/měsíc ·{' '}
                {insuranceOverview.upcomingRenewals.length > 0 ? `${insuranceOverview.upcomingRenewals.length} obnova do 30 dnů` : 'žádná obnova do 30 dnů'}
              </>
            }
            detail={
              insuranceOverview.sinkingFundCovered ? (
                'Rezerva na spořáku pokrývá cíl k dnešku.'
              ) : (
                <>
                  Rezerva na spořáku nestačí — chybí <MoneyValue>{formatMoney(new Prisma.Decimal(insuranceOverview.sinkingFundShortfall))}</MoneyValue> do cíle k dnešku.
                </>
              )
            }
            detailTone={insuranceOverview.sinkingFundCovered ? 'positive' : 'warning'}
          />
        </div>
        {currentWorth.cashValue.plus(currentWorth.investmentValue).isZero() ? <StatusNotice title="Poměr hotovosti a investic nelze vyhodnotit" tone="info">K vybranému měsíci nejsou doložené žádné hodnoty hotovosti ani investic.</StatusNotice> : null}
      </section>

      <div className="grid gap-8 xl:grid-cols-12 xl:items-start">
        <section aria-labelledby="action-center" className="flex flex-col gap-3 xl:col-span-5">
          <SectionHeader title="Akční centrum" description="Jen položky vyžadující zásah." />
          <div className="surface divide-y divide-line overflow-hidden">
            {actions.map((action) => action.count > 0 ? (
              <Link key={action.title} href={action.href} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-4 transition-colors hover:bg-surface-subtle">
                <span className="mt-0.5 text-warning">{action.icon}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold">{action.title}</span><span className="mt-1 block text-xs leading-relaxed text-ink-muted">{action.detail}</span></span>
                <span className="flex items-center gap-2"><Badge tone="warning">{action.count}</Badge><ArrowRight size={15} className="text-ink-muted transition-transform group-hover:translate-x-0.5" /></span>
              </Link>
            ) : (
              <div key={action.title} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 p-4">
                <span className="mt-0.5 text-positive">{action.icon}</span>
                <span className="min-w-0"><span className="block text-sm font-semibold">{action.title}</span><span className="mt-1 block text-xs leading-relaxed text-ink-muted">Bez aktuálního problému.</span></span>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="recurring" className="flex flex-col gap-3 xl:col-span-7">
          <SectionHeader
            title="Fixní výdaje"
            description="Celkový měsíční náklad a přiřazené platby vůči očekávání."
          />
          <DashboardMetric
            href="/settings/planning"
            icon={<Receipt size={19} weight="duotone" />}
            iconClass="bg-[var(--accent-soft)] text-accent"
            label="Celkem tento měsíc"
            value={<MoneyValue>{formatMoney(burnRate.total)}</MoneyValue>}
            progress={spendingTargetProgress}
            progressClass={targetDifference?.isPositive() ? 'bg-warning' : 'bg-accent'}
            detail={
              target ? (
                <>
                  <MoneyValue>{targetDifference?.isPositive() ? '+' : ''}{formatMoney(targetDifference ?? zero)}</MoneyValue> proti cíli <MoneyValue>{formatMoney(target)}</MoneyValue>.
                </>
              ) : (
                'Měsíční cíl fixních výdajů není nastaven.'
              )
            }
          />
          {recurringExpenses.length > 0 ? (
            <>
            <div className="surface overflow-hidden">
              <div className="hidden grid-cols-[minmax(0,1fr)_auto_auto] gap-6 border-b border-line px-4 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-muted sm:grid"><span>Položka</span><span className="text-right">Očekáváno</span><span className="w-36 text-right">Zaplaceno</span></div>
              <ol className="divide-y divide-line">
                {recurringExpenses.map((expense) => {
                  const actual = actualById.get(expense.id);
                  const isMissing = !taggedIds.has(expense.id);
                  const difference = expense.currency === 'CZK' && actual ? actual.actual.minus(expense.expectedAmount) : null;
                  return <li key={expense.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{expense.name}</p><Badge tone={isMissing ? recurringStateTone(expense.dueDay, expense.graceDays, todayDay, periodEndDay) : 'success'}>{isMissing ? recurringStateLabel(expense.dueDay, expense.graceDays, todayDay, periodEndDay) : 'Zaplaceno'}</Badge></div>{difference ? <p className={`tabular mt-1 text-xs ${difference.isZero() ? 'text-ink' : difference.isPositive() ? 'text-critical' : 'text-positive'}`}><MoneyValue>{difference.isPositive() ? '+' : ''}{formatMoney(difference)}</MoneyValue> proti očekávání</p> : null}</div>
                    <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right"><span className="text-xs text-ink-muted sm:hidden">Očekáváno</span><span className="tabular text-sm font-medium"><MoneyValue>{formatMoney(expense.expectedAmount, expense.currency)}</MoneyValue></span></div>
                    <div className="flex items-baseline justify-between gap-3 sm:w-36 sm:block sm:text-right"><span className="text-xs text-ink-muted sm:hidden">Zaplaceno</span>{actual ? <span className="tabular text-sm font-semibold"><MoneyValue>{formatMoney(actual.actual)}</MoneyValue></span> : <Link href={`/transactions?period=${transactionPeriod}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">Najít platbu <ArrowRight size={14} /></Link>}</div>
                  </li>;
                })}
              </ol>
            </div>
            <Link href="/settings/planning" className="ui-button ui-button-ghost self-start">Nastavení fixních výdajů <ArrowRight size={16} /></Link>
            </>
          ) : <StatusNotice title="Fixní výdaje nejsou nastavené" tone="info" actions={<Link href="/settings/recurring" className="ui-button ui-button-secondary">Přidat položky</Link>}>Bez očekávaných položek nelze kontrolovat označení pravidelných plateb.</StatusNotice>}
        </section>
      </div>
    </PageShell>
  );
}

function isCurrentMonth(year: number, month: number, now: Date): boolean {
  return year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
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
  /** Pre-composed content — wrap any money amounts in <MoneyValue> at the call site. */
  value: React.ReactNode;
  /** Small clarifying text right under the value, e.g. "ročně". */
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
      {visibleProgress !== null ? progressGradient ? <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-[linear-gradient(90deg,var(--positive)_0%,var(--warning)_60%,var(--critical)_100%)]"><span className="absolute inset-y-0 right-0 bg-line" style={{ width: `${100 - visibleProgress}%` }} /></div> : <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line"><span className={`block h-full rounded-full ${progressClass ?? 'bg-accent'}`} style={{ width: `${visibleProgress}%` }} /></div> : null}
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

function recurringStateLabel(dueDay: number | null, graceDays: number, todayDay: number, periodEndDay: number): string {
  if (!dueDay) return 'Bez termínu';
  const due = Math.min(dueDay, periodEndDay);
  return todayDay > due + graceDays ? 'Po termínu' : `Splatnost ${due}.`;
}

function recurringStateTone(dueDay: number | null, graceDays: number, todayDay: number, periodEndDay: number): 'info' | 'warning' {
  if (!dueDay) return 'info';
  return todayDay > Math.min(dueDay, periodEndDay) + graceDays ? 'warning' : 'info';
}
