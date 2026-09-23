import { Hono } from 'hono';

import { prisma } from '@orbit-api/lib/db/prisma';
import { calculateBurnRate, splitOverdueRecurring, type BurnRateTransaction } from '@orbit-api/lib/finance/burn-rate';
import { countIncompleteOrUnknown, findCheckpointIssues, isActionableTransfer, totalDataConfidenceIssues } from '@orbit-api/lib/finance/data-confidence';
import { findUnmatchedDcaPlans, splitOverdueDcaPlans } from '@orbit-api/lib/finance/dca';
import { loadInsuranceOverview } from '@orbit-api/lib/finance/insurance-service';
import { loadNetWorth } from '@orbit-api/lib/finance/net-worth-service';
import { monthPeriod } from '@orbit-api/lib/finance/settlement';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { findCoverageGaps } from '@orbit-api/lib/import/coverage';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

function isPeriodKey(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value);
}

function parsePeriod(value: string | undefined, fallback: { year: number; month: number }): { year: number; month: number } {
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match?.[1] || !match[2]) return fallback;
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

function isCurrentMonth(year: number, month: number, now: Date): boolean {
  return year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
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

function signedMoney(value: Prisma.Decimal): { formatted: string; isNegative: boolean; isPositive: boolean; isZero: boolean } {
  return { formatted: (value.isPositive() ? '+' : '') + value.toFixed(2), isNegative: value.isNegative(), isPositive: value.isPositive(), isZero: value.isZero() };
}

export const dashboard = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const q = c.req.query();
    const preferredMonth = isPeriodKey(q.preferredMonth) ? q.preferredMonth : undefined;

    const newest = await prisma.transaction.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
    const now = new Date();
    const fallback = newest
      ? { year: newest.date.getUTCFullYear(), month: newest.date.getUTCMonth() + 1 }
      : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    const remembered = isPeriodKey(preferredMonth) ? parsePeriod(preferredMonth, fallback) : null;
    const period = parsePeriod(q.period, remembered ?? fallback);
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
      allTimeUnmatchedTransferRows,
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
        where: { isActive: true, AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: asOf } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: from } }] }] },
        orderBy: [{ expectedAmount: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, expectedAmount: true, currency: true, isActive: true, dueDay: true, graceDays: true, paymentAccountId: true },
      }),
      prisma.recurringInvestmentPlan.findMany({
        where: { isActive: true, AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: asOf } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: from } }] }] },
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
          snapshots: { where: { capturedAt: { lte: asOf } }, orderBy: { capturedAt: 'desc' }, take: 1, select: { balance: true, capturedAt: true, expectedBalance: true } },
        },
      }),
      prisma.importBatch.findMany({ select: { status: true, failedCount: true, coverageFrom: true, coverageTo: true, accountId: true, account: { select: { name: true } } } }),
      prisma.transaction.findMany({
        where: { date: { gte: from, lt: to }, kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null, transferDismissedAt: null },
        select: { date: true, account: { select: { provider: true } } },
      }),
      prisma.importBatch.findFirst({
        where: { status: 'COMPLETED', account: { provider: { not: 'TRADING212' } }, periodFrom: { not: null } },
        orderBy: { periodFrom: 'asc' },
        select: { periodFrom: true },
      }),
      loadInsuranceOverview(now, 30),
      prisma.transaction.findMany({
        where: { kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null, transferDismissedAt: null },
        select: { date: true, account: { select: { provider: true } } },
      }),
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
      transactions.flatMap((transaction) => (transaction.kind === 'NORMAL' && transaction.amount.isNegative() && transaction.recurringExpenseId ? [transaction.recurringExpenseId] : [])),
    );
    const missingRecurring = recurringExpenses.filter((expense) => !taggedIds.has(expense.id));
    const fixedIncome = normalTransactions
      .filter((transaction) => transaction.amountCzk.isPositive() && transaction.categoryId === incomeCategory?.id)
      .reduce((sum, transaction) => sum.plus(transaction.amountCzk), zero);
    const target = settings?.monthlySpendingTarget ?? null;
    const targetDifference = target ? burnRate.total.minus(target) : null;
    const periodEndDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
    const todayDay = isCurrentMonth(period.year, period.month, now) ? now.getUTCDate() : periodEndDay;
    const { overdue: overdueRecurring, upcoming: upcomingRecurringUnfiltered } = splitOverdueRecurring(missingRecurring, todayDay, periodEndDay);
    // splitOverdueRecurring's "upcoming" also includes expenses with no
    // dueDay at all — cashBufferIssues below only makes sense for expenses
    // that actually have a scheduled due day, same filter the original
    // inline version applied via `expense.dueDay !== null`.
    const upcomingRecurring = upcomingRecurringUnfiltered.filter((expense) => expense.dueDay !== null);
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
    const cashInvestmentRatio = currentWorth.investmentValue.isZero() ? null : currentWorth.cashValue.dividedBy(currentWorth.investmentValue);
    const incompleteWorthAccounts = countIncompleteOrUnknown(currentWorth.accounts.map((a) => ({ accountId: a.accountId, name: a.name, incompleteHistory: a.incompleteHistory, source: a.source })));
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
    const unmatchedDcaPlans = findUnmatchedDcaPlans(investmentPlans, transactions);
    const { overdue: dcaOverduePlans, pending: dcaPendingPlans } = splitOverdueDcaPlans(unmatchedDcaPlans, todayDay, periodEndDay);

    const coverageGapCount = [...new Map(importBatches.map((batch) => [batch.accountId, batch.account.name])).keys()].reduce(
      (count, accountId) => count + findCoverageGaps(importBatches.filter((batch) => batch.accountId === accountId)).length,
      0,
    );
    const checkpointIssues = findCheckpointIssues(
      accounts.map((account) => ({
        accountId: account.id,
        name: account.name,
        latestSnapshot: account.snapshots[0] ? { balance: account.snapshots[0].balance, expectedBalance: account.snapshots[0].expectedBalance } : null,
      })),
    );
    const failedImports = importBatches.filter((batch) => batch.status === 'FAILED' || batch.failedCount > 0).length;
    const historyBaseline = settings?.transferHistoryFrom ?? firstBankBatch?.periodFrom ?? null;
    const allTimeActionableTransfers = allTimeUnmatchedTransferRows.filter((row) => isActionableTransfer({ date: row.date, provider: row.account.provider }, historyBaseline));
    const dataGapCount = totalDataConfidenceIssues({
      incompleteOrUnknown: incompleteWorthAccounts.length,
      coverageGaps: coverageGapCount,
      actionableTransfers: allTimeActionableTransfers.length,
      checkpointIssues: checkpointIssues.length,
    });
    const floorMonth = [historyBaseline, settings?.reportingStartMonth]
      .filter((date): date is Date => date !== null && date !== undefined)
      .map((date) => date.toISOString().slice(0, 7))
      .sort()
      .at(-1) ?? null;
    const visibleMonths = months.filter((row) => !floorMonth || row.month >= floorMonth).map((row) => row.month);

    const actions = [
      { key: 'uncategorized', title: 'Nezařazené výdaje', count: uncategorizedExpenses, detail: 'Výdaje bez kategorie zkreslují pohled podle účelu.', href: `/transactions?period=${transactionPeriod}&uncategorized=1` },
      { key: 'unmatched-transfers', title: 'Nespárované převody v období', count: unmatchedTransfers, detail: unmatchedTransfers ? 'Bankovní nebo brokerové přesuny z vybraného měsíce čekají na protistranu.' : 'V tomto měsíci nezůstaly žádné jednostranné převody.', href: `/transactions?period=${transactionPeriod}&transfer=unmatched` },
      { key: 'failed-imports', title: 'Chyby importu', count: failedImports, detail: 'Import selhal nebo obsahoval řádky, které se nepodařilo zpracovat.', href: '/import' },
      { key: 'data-gaps', title: 'Mezery v podkladech', count: dataGapCount, detail: 'Chybí kontrolní bod, navazující výpis nebo úplná historie účtu.', href: '/net-worth' },
      { key: 'dca-overdue', title: 'DCA po termínu bez financování', count: dcaOverduePlans.length, detail: dcaOverduePlans.length ? 'Splatnost a tolerance DCA plánu uplynula bez spárovaného převodu na brokera.' : 'Žádný DCA plán není po termínu bez financování.', href: '/planning' },
      { key: 'overdue-recurring', title: 'Fixní výdaje po termínu', count: overdueRecurring.length, detail: overdueRecurring.length ? 'Splatnost a tolerance uplynula bez ručně přiřazené platby.' : 'Žádná naplánovaná fixní platba není po toleranci.', href: `/transactions?period=${transactionPeriod}` },
      { key: 'cash-buffer', title: 'Krytí fixních plateb', count: cashBufferIssues.length, detail: cashBufferIssues.length ? 'Známý zůstatek platebního účtu nepokrývá součet nadcházejících CZK plateb.' : 'Známé platební účty kryjí nadcházející CZK platby.', href: '/planning' },
    ];

    return c.json({
      period: { year: period.year, month: period.month, key: periodKey, transactionPeriod },
      asOf: asOf.toISOString(),
      previousAsOf: previousAsOf.toISOString(),
      visibleMonths,
      netWorth: {
        totalWorth: currentWorth.totalWorth.toFixed(2),
        cashValue: currentWorth.cashValue.toFixed(2),
        investmentValue: currentWorth.investmentValue.toFixed(2),
        liabilityValue: currentWorth.liabilityValue.toFixed(2),
        incompleteAccountsCount: incompleteWorthAccounts.length,
      },
      worthDelta: signedMoney(worthDelta),
      worthDeltaPercent: worthDeltaPercent === null ? null : { formatted: (worthDeltaPercent.isPositive() ? '+' : '') + worthDeltaPercent.toFixed(1), isPositive: worthDeltaPercent.isPositive() },
      cashInvestmentRatio: cashInvestmentRatio === null ? null : cashInvestmentRatio.toFixed(2),
      composition: { cashShare, investmentShare, liabilityShare },
      zeroCashAndInvestment: assetValue.isZero(),
      fixedIncome: fixedIncome.toFixed(2),
      credit: { utilization: creditUtilization === null ? null : creditUtilization.toFixed(1), used: creditUsed.toFixed(2), limit: creditLimit.toFixed(2), accountsCount: creditAccounts.length },
      dca: { plansCount: investmentPlans.length, unmatchedCount: unmatchedDcaPlans.length, overdueCount: dcaOverduePlans.length, pendingCount: dcaPendingPlans.length },
      insurance: insuranceOverview,
      actions,
      burnRate: {
        total: burnRate.total.toFixed(2),
        target: target === null ? null : target.toFixed(2),
        targetDifference: targetDifference === null ? null : signedMoney(targetDifference),
        spendingTargetProgress,
      },
      recurringExpenses: recurringExpenses.map((expense) => {
        const actual = actualById.get(expense.id);
        const isMissing = !taggedIds.has(expense.id);
        const difference = expense.currency === 'CZK' && actual ? actual.actual.minus(expense.expectedAmount) : null;
        return {
          id: expense.id,
          name: expense.name,
          expectedAmount: expense.expectedAmount.toFixed(2),
          currency: expense.currency,
          isMissing,
          stateLabel: isMissing ? recurringStateLabel(expense.dueDay, expense.graceDays, todayDay, periodEndDay) : 'Zaplaceno',
          stateTone: isMissing ? recurringStateTone(expense.dueDay, expense.graceDays, todayDay, periodEndDay) : ('success' as const),
          actualAmount: actual ? actual.actual.toFixed(2) : null,
          difference: difference === null ? null : signedMoney(difference),
        };
      }),
    });
  });
