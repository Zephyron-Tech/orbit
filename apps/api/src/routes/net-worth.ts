import { Hono } from 'hono';

import { prisma } from '@orbit-api/lib/db/prisma';
import { loadAccountAnalytics } from '@orbit-api/lib/finance/account-analytics-service';
import { countIncompleteOrUnknown, findCheckpointIssues, isActionableTransfer, totalDataConfidenceIssues } from '@orbit-api/lib/finance/data-confidence';
import { loadMonthlyNetWorthHistory, rebuildMonthlyNetWorth } from '@orbit-api/lib/finance/monthly-net-worth-service';
import { loadNetWorth } from '@orbit-api/lib/finance/net-worth-service';
import { findCoverageGaps } from '@orbit-api/lib/import/coverage';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

export const netWorth = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const activeAccountCount = await prisma.account.count({ where: { isArchived: false } });
    if (activeAccountCount === 0) {
      return c.json({ empty: true as const });
    }

    const [current, batches, unmatchedTransfers, firstBankBatch, planningSettings, accounts, recurringExpenses] = await Promise.all([
      loadNetWorth(),
      prisma.importBatch.findMany({ where: { status: 'COMPLETED' }, select: { accountId: true, coverageFrom: true, coverageTo: true, account: { select: { name: true } } } }),
      prisma.transaction.findMany({
        where: { kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null, transferDismissedAt: null },
        select: { id: true, date: true, amount: true, amountCzk: true, currency: true, merchant: true, account: { select: { name: true, provider: true } } },
        orderBy: { date: 'desc' },
      }),
      prisma.importBatch.findFirst({
        where: { status: 'COMPLETED', account: { provider: { not: 'TRADING212' } }, periodFrom: { not: null } },
        orderBy: { periodFrom: 'asc' },
        select: { periodFrom: true },
      }),
      prisma.planningSettings.findUnique({ where: { id: 'household' }, select: { transferHistoryFrom: true, hideHistoricalBrokerTransfers: true } }),
      prisma.account.findMany({
        where: { isArchived: false, includeInNetWorth: true },
        select: {
          id: true,
          name: true,
          type: true,
          provider: true,
          currency: true,
          creditLimit: true,
          annualInterestRate: true,
          interestTaxRate: true,
          emergencyReserveMonths: true,
          snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { cashBalance: true, investedValue: true, unrealizedPnl: true, updatedAt: true, currency: true, balance: true, expectedBalance: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.recurringExpense.findMany({ where: { isActive: true, currency: 'CZK' }, select: { expectedAmount: true } }),
    ]);

    let monthlyHistory = await loadMonthlyNetWorthHistory();
    if (monthlyHistory.length === 0 && firstBankBatch?.periodFrom) {
      await rebuildMonthlyNetWorth(firstBankBatch.periodFrom, new Date());
      monthlyHistory = await loadMonthlyNetWorthHistory();
    }

    const analytics = await Promise.all(accounts.map((account) => loadAccountAnalytics(account.id, account.currency)));
    const analyticsByAccount = new Map(analytics.map((item) => [item.accountId, item]));
    const worthByAccount = new Map(current.accounts.map((account) => [account.accountId, account]));
    const cardAccounts = accounts.flatMap((account) => {
      const worth = worthByAccount.get(account.id);
      const accountAnalytics = analyticsByAccount.get(account.id);
      if (!worth || !accountAnalytics) return [];
      return [
        {
          id: account.id,
          name: account.name,
          type: account.type,
          provider: account.provider,
          balance: worth.balance.toFixed(2),
          source: worth.source,
          asOf: worth.asOf?.toISOString() ?? null,
          incomplete: worth.incompleteHistory || worth.source === 'UNKNOWN',
          creditLimit: account.creditLimit?.toFixed(2) ?? null,
          annualInterestRate: account.annualInterestRate?.toFixed(6) ?? null,
          interestTaxRate: account.interestTaxRate?.toFixed(4) ?? null,
          emergencyReserveMonths: account.emergencyReserveMonths,
          portfolio: account.snapshots[0]
            ? {
                cashBalance: account.snapshots[0].cashBalance?.toFixed(2) ?? null,
                investedValue: account.snapshots[0].investedValue?.toFixed(2) ?? null,
                unrealizedPnl: account.snapshots[0].unrealizedPnl?.toFixed(2) ?? null,
                updatedAt: account.snapshots[0].updatedAt.toISOString(),
                currency: account.snapshots[0].currency,
              }
            : null,
          analytics: accountAnalytics,
        },
      ];
    });
    const fixedBaseline = recurringExpenses.reduce((total, expense) => total.plus(expense.expectedAmount), current.cashValue.minus(current.cashValue)).toFixed(2);

    const gapsByAccount = [...new Map(batches.map((batch) => [batch.accountId, batch.account.name])).entries()]
      .map(([accountId, name]) => ({ name, gaps: findCoverageGaps(batches.filter((batch) => batch.accountId === accountId)) }))
      .filter((entry) => entry.gaps.length > 0);

    const unknown = current.accounts.filter((account) => account.source === 'UNKNOWN').map((a) => ({ accountId: a.accountId, name: a.name }));
    const incompleteAll = current.accounts.filter((account) => account.incompleteHistory);
    const incompleteCredit = incompleteAll.filter((account) => account.type === 'CREDIT').map((a) => ({ accountId: a.accountId, name: a.name }));
    const incompleteCash = incompleteAll.filter((account) => account.type !== 'CREDIT').map((a) => ({ accountId: a.accountId, name: a.name }));
    const transferBaseline = planningSettings?.transferHistoryFrom ?? firstBankBatch?.periodFrom ?? null;
    const actionableTransfers = unmatchedTransfers.filter((transaction) => isActionableTransfer({ date: transaction.date, provider: transaction.account.provider }, transferBaseline));
    const historicalBrokerTransfers = planningSettings?.hideHistoricalBrokerTransfers ? 0 : unmatchedTransfers.length - actionableTransfers.length;
    const coverageGapCount = gapsByAccount.reduce((count, entry) => count + entry.gaps.length, 0);
    const checkpointIssues = findCheckpointIssues(
      accounts.map((account) => ({
        accountId: account.id,
        name: account.name,
        latestSnapshot: account.snapshots[0] ? { balance: account.snapshots[0].balance, expectedBalance: account.snapshots[0].expectedBalance } : null,
      })),
    );
    const confidenceIssueCount = totalDataConfidenceIssues({
      incompleteOrUnknown: countIncompleteOrUnknown(current.accounts.map((a) => ({ accountId: a.accountId, name: a.name, incompleteHistory: a.incompleteHistory, source: a.source }))).length,
      coverageGaps: coverageGapCount,
      actionableTransfers: actionableTransfers.length,
      checkpointIssues: checkpointIssues.length,
    });

    return c.json({
      empty: false as const,
      totalWorth: current.totalWorth.toNumber(),
      cashValue: current.cashValue.toNumber(),
      investmentValue: current.investmentValue.toNumber(),
      liabilityValue: current.liabilityValue.toNumber(),
      cardAccounts,
      fixedBaseline,
      monthlyHistory,
      confidenceIssueCount,
      incompleteCash,
      incompleteCredit,
      unknown,
      gapsByAccount,
      coverageGapCount,
      historicalBrokerTransfers,
      checkpointIssues: checkpointIssues.map((a) => ({ accountId: a.accountId, name: a.name })),
      unmatchedTransfers: actionableTransfers.map((t) => ({
        id: t.id,
        date: t.date.toISOString(),
        amount: t.amount.toNumber(),
        amountCzk: t.amountCzk ? t.amountCzk.toNumber() : null,
        currency: t.currency,
        merchant: t.merchant,
        accountName: t.account.name,
      })),
    });
  });
