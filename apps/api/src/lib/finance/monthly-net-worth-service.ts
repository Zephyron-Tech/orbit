import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { calculateAccountBalance, type NetWorthAccount, type NetWorthTransaction } from './net-worth';

interface MonthlyBreakdownItem {
  accountId: string;
  type: string;
  balance: string | null;
  contribution: string | null;
  status: string;
  asOf: string | null;
  warning?: string;
  provenance?: Record<string, string | number | null>;
}

export interface MonthlyNetWorthPoint {
  month: string;
  totalWorth: number;
  cashValue: number;
  investmentValue: number;
  liabilityValue: number;
  isComplete: boolean;
  breakdown: MonthlyBreakdownItem[];
}

function monthEnd(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
}

function endOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Rebuilds composite monthly points from statement checkpoints and provider snapshots. */
export async function rebuildMonthlyNetWorth(from: Date, to: Date): Promise<number> {
  const today = endOfTodayUtc();
  const requestedEnd = monthEnd(to.getUTCFullYear(), to.getUTCMonth());
  const effectiveTo = requestedEnd > today ? today : requestedEnd;
  const [accounts, transactions, snapshots] = await Promise.all([
    prisma.account.findMany({ where: { isArchived: false, includeInNetWorth: true }, orderBy: { name: 'asc' } }),
    prisma.transaction.findMany({ where: { date: { lte: effectiveTo } }, select: { accountId: true, date: true, amount: true, amountCzk: true, currency: true, kind: true } }),
    prisma.accountSnapshot.findMany({
      where: { capturedAt: { lte: effectiveTo } },
      include: { importBatch: { select: { id: true, statementNumber: true, coverageFrom: true, coverageTo: true } }, account: { select: { provider: true } } },
      orderBy: { capturedAt: 'asc' },
    }),
  ]);
  let rebuilt = 0;
  const cursor = monthStart(from);
  const end = monthStart(to);
  for (let month = new Date(cursor); month <= end; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const naturalMonthEnd = monthEnd(month.getUTCFullYear(), month.getUTCMonth());
    const asOf = naturalMonthEnd > today ? today : naturalMonthEnd;
    let cash = new Prisma.Decimal(0);
    let investment = new Prisma.Decimal(0);
    let liability = new Prisma.Decimal(0);
    let complete = true;
    const breakdown: MonthlyBreakdownItem[] = [];
    for (const account of accounts) {
      const accountSnapshots = snapshots.filter((snapshot) => snapshot.accountId === account.id && snapshot.capturedAt <= asOf);
      const transactionsForAccount: NetWorthTransaction[] = transactions
        .filter((transaction) => transaction.accountId === account.id && transaction.date <= asOf)
        .flatMap((transaction) => {
          const amountCzk = transaction.currency === 'CZK' ? transaction.amount : transaction.amountCzk;
          return amountCzk ? [{ accountId: transaction.accountId, date: transaction.date, amountCzk, kind: transaction.kind }] : [];
        });
      if (account.type === 'INVESTMENT') {
        const nearest = [...accountSnapshots]
          .filter((snapshot) => snapshot.balanceCzk !== null)
          .sort((a, b) => {
            const distance = Math.abs(a.capturedAt.getTime() - asOf.getTime()) - Math.abs(b.capturedAt.getTime() - asOf.getTime());
            return distance || b.capturedAt.getTime() - a.capturedAt.getTime();
          })[0];
        if (!nearest || !nearest.balanceCzk || Math.abs(nearest.capturedAt.getTime() - asOf.getTime()) > 31 * 86_400_000) {
          complete = false;
          breakdown.push({ accountId: account.id, type: account.type, balance: null, contribution: null, status: 'T212_MISSING', asOf: null, warning: 'Chybí blízký provider snímek.' });
          continue;
        }
        investment = investment.plus(nearest.balanceCzk);
        breakdown.push({ accountId: account.id, type: account.type, balance: nearest.balanceCzk.toFixed(2), contribution: nearest.balanceCzk.toFixed(2), status: 'T212_NEAREST_SNAPSHOT', asOf: nearest.capturedAt.toISOString(), provenance: { snapshotId: nearest.id, distanceDays: Math.round(Math.abs(nearest.capturedAt.getTime() - asOf.getTime()) / 86_400_000) } });
        continue;
      }
      const usable = [...accountSnapshots]
        .filter((snapshot) => snapshot.balanceCzk !== null)
        .at(-1);
      const netAccount: NetWorthAccount = { id: account.id, name: account.name, type: account.type, currency: account.currency, includeInNetWorth: true };
      const balance = calculateAccountBalance(netAccount, transactionsForAccount, usable ? { accountId: account.id, capturedAt: usable.capturedAt, balanceCzk: usable.balanceCzk } : undefined);
      const directStatementForMonth = usable?.source === 'STATEMENT' && usable.capturedAt.getUTCFullYear() === asOf.getUTCFullYear() && usable.capturedAt.getUTCMonth() === asOf.getUTCMonth();
      const incomplete = !usable || (!directStatementForMonth && asOf.getTime() === naturalMonthEnd.getTime());
      if (incomplete) complete = false;
      // Same split as calculateNetWorth: negative CREDIT balance is debt, a
      // positive one (overpayment / "Přeplatek" on a statement) is a real asset.
      if (account.type === 'CREDIT' && balance.isNegative()) liability = liability.plus(balance.abs());
      else cash = cash.plus(balance);
      breakdown.push({
        accountId: account.id,
        type: account.type,
        balance: balance.toFixed(2),
        contribution: account.type === 'CREDIT' && balance.isNegative() ? balance.abs().toFixed(2) : balance.toFixed(2),
        status: usable?.source === 'STATEMENT' ? 'STATEMENT_DERIVED' : usable ? 'BANK_DERIVED_WITHOUT_MONTH_STATEMENT' : account.type === 'CREDIT' ? 'CREDIT_INCOMPLETE' : 'TRANSACTION_ONLY_INCOMPLETE',
        asOf: usable?.capturedAt.toISOString() ?? null,
        warning: incomplete ? 'Chybí potvrzený počáteční stav.' : undefined,
        provenance: usable?.importBatch ? { statementNumber: usable.importBatch.statementNumber, importBatchId: usable.importBatch.id, coverageTo: usable.importBatch.coverageTo?.toISOString() ?? null } : undefined,
      });
    }
    const monthKey = monthStart(month);
    const breakdownJson = JSON.parse(JSON.stringify(breakdown)) as Prisma.InputJsonValue;
    await prisma.monthlyNetWorthSnapshot.upsert({
      where: { month: monthKey },
      create: { month: monthKey, totalWorth: cash.plus(investment).minus(liability), cashValue: cash, investmentValue: investment, liabilityValue: liability, breakdown: breakdownJson, isComplete: complete },
      update: { totalWorth: cash.plus(investment).minus(liability), cashValue: cash, investmentValue: investment, liabilityValue: liability, breakdown: breakdownJson, isComplete: complete },
    });
    rebuilt += 1;
  }
  return rebuilt;
}

export async function loadMonthlyNetWorthHistory(limit = 60): Promise<MonthlyNetWorthPoint[]> {
  const rows = await prisma.monthlyNetWorthSnapshot.findMany({ orderBy: { month: 'desc' }, take: limit });
  return rows.reverse().map((row) => ({
    month: row.month.toISOString().slice(0, 7),
    totalWorth: row.totalWorth.toNumber(),
    cashValue: row.cashValue.toNumber(),
    investmentValue: row.investmentValue.toNumber(),
    liabilityValue: row.liabilityValue.toNumber(),
    isComplete: row.isComplete,
    breakdown: row.breakdown as unknown as MonthlyBreakdownItem[],
  }));
}
