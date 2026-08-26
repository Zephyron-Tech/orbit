import { TransactionTable } from '@/components/transactions/transaction-table';
import { CategoryManager } from '@/components/transactions/category-manager';
import { cookies } from 'next/headers';
import { Metric } from '@/components/ui/metric';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { StatusNotice } from '@/components/ui/status';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { isPeriod, PERIOD_COOKIE } from '@/lib/ui/period';
import { recommendMerchantCategories } from '@/lib/finance/merchant-category-recommendations';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;
const CZK = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

interface SearchParams {
  month?: string;
  period?: string;
  accountId?: string;
  categoryId?: string;
  shared?: string;
  uncategorized?: string;
  q?: string;
  page?: string;
  flow?: string;
  sort?: string;
  direction?: string;
  absolute?: string;
  transfer?: string;
}

/** "2026-07" -> UTC half-open range [1 July, 1 August). */
function monthRange(month: string): { gte: Date; lt: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  if (monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  return { gte: new Date(Date.UTC(year, monthIndex, 1)), lt: new Date(Date.UTC(year, monthIndex + 1, 1)) };
}

function parsePage(value: string | undefined): number {
  const page = Number(value);

  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function rollingRange(months: number): { gte: Date; lt: Date } {
  const now = new Date();
  const gte = new Date(now);
  gte.setUTCMonth(gte.getUTCMonth() - months);
  gte.setUTCHours(0, 0, 0, 0);
  const lt = new Date(now);
  lt.setUTCHours(23, 59, 59, 999);
  lt.setUTCDate(lt.getUTCDate() + 1);
  return { gte, lt };
}

function resolveTransactionPeriod(value: string | undefined, month: string | undefined, preferredMonth: string | undefined): { value: string; range: { gte: Date; lt: Date } | null } {
  if (value?.startsWith('month:') && isPeriod(value.slice(6))) return { value, range: monthRange(value.slice(6)) };
  if (value === 'range:1m') return { value, range: rollingRange(1) };
  if (value === 'range:3m') return { value, range: rollingRange(3) };
  if (value === 'range:6m') return { value, range: rollingRange(6) };
  if (value === 'range:1y') return { value, range: rollingRange(12) };
  if (value === 'range:all') return { value, range: null };
  if (isPeriod(month)) return { value: `month:${month}`, range: monthRange(month) };
  if (isPeriod(preferredMonth)) return { value: `month:${preferredMonth}`, range: monthRange(preferredMonth) };
  return { value: 'range:3m', range: rollingRange(3) };
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const preferredPeriod = (await cookies()).get(PERIOD_COOKIE)?.value;
  const period = resolveTransactionPeriod(params.period, params.month === 'all' ? undefined : params.month, preferredPeriod);

  // Split parents are bookkeeping placeholders; children carry money and categorisation.
  const where: Prisma.TransactionWhereInput = { kind: { not: 'SPLIT_PARENT' } };

  const range = period.range;
  if (range) {
    where.date = range;
  }

  if (params.accountId) {
    where.accountId = params.accountId;
  }

  if (params.uncategorized === '1') {
    where.categoryId = null;
  } else if (params.categoryId) {
    where.categoryId = params.categoryId;
  }

  if (params.shared === '1') {
    where.isShared = true;
  }

  const flow = params.flow === 'income' || params.flow === 'expense' ? params.flow : '';
  if (flow) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { kind: 'NORMAL' }, { amount: flow === 'income' ? { gt: 0 } : { lt: 0 } }];
  }
  const unmatchedTransfersOnly = params.transfer === 'unmatched';
  if (unmatchedTransfersOnly) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] } }, { transferId: null }];
  }
  const sort = params.sort === 'amount' ? 'amount' : 'date';
  const direction = params.direction === 'asc' ? 'asc' : 'desc';
  const absoluteAmount = sort === 'amount' && params.absolute === '1';

  const query = params.q?.trim();
  if (query) {
    where.OR = [
      { merchant: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
      { notes: { contains: query, mode: 'insensitive' } },
    ];
  }

  const totalCount = await prisma.transaction.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(parsePage(params.page), totalPages);

  const transactionSelect = {
    id: true,
    accountId: true,
    date: true,
    amount: true,
    currency: true,
    merchant: true,
    description: true,
    categoryId: true,
    bucketId: true,
    recurringExpenseId: true,
    kind: true,
    isShared: true,
    paidBy: true,
    myShareRatio: true,
    notes: true,
    settlementId: true,
    parentId: true,
    transferId: true,
    account: { select: { name: true } },
    transfer: { select: { legs: { select: { id: true, account: { select: { name: true } } } } } },
  } as const;

  let orderedTransactionIds: string[] | null = null;
  if (absoluteAmount) {
    const clauses: Prisma.Sql[] = [Prisma.sql`"kind" <> 'SPLIT_PARENT'`];
    if (range) clauses.push(Prisma.sql`"date" >= ${range.gte} AND "date" < ${range.lt}`);
    if (params.accountId) clauses.push(Prisma.sql`"accountId" = ${params.accountId}`);
    if (params.uncategorized === '1') clauses.push(Prisma.sql`"categoryId" IS NULL`);
    else if (params.categoryId) clauses.push(Prisma.sql`"categoryId" = ${params.categoryId}`);
    if (params.shared === '1') clauses.push(Prisma.sql`"isShared" = true`);
    if (flow) {
      clauses.push(Prisma.sql`"kind" = 'NORMAL'`);
      clauses.push(flow === 'income' ? Prisma.sql`"amount" > 0` : Prisma.sql`"amount" < 0`);
    }
    if (unmatchedTransfersOnly) {
      clauses.push(Prisma.sql`"kind" IN ('INTERNAL_TRANSFER', 'PENDING_TRANSFER')`);
      clauses.push(Prisma.sql`"transferId" IS NULL`);
    }
    if (query) {
      const pattern = `%${query}%`;
      clauses.push(Prisma.sql`("merchant" ILIKE ${pattern} OR "description" ILIKE ${pattern} OR "notes" ILIKE ${pattern})`);
    }
    const directionSql = direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "Transaction"
      WHERE ${Prisma.join(clauses, ' AND ')}
      ORDER BY
        ABS("amountCzk") ${directionSql} NULLS LAST,
        "date" DESC,
        "createdAt" DESC,
        "id" DESC
      OFFSET ${(page - 1) * PAGE_SIZE}
      LIMIT ${PAGE_SIZE}
    `);
    orderedTransactionIds = rows.map((row) => row.id);
  }

  const reportingWhere = (kind?: 'NORMAL'): Prisma.TransactionWhereInput => ({
    AND: [where, ...(kind ? [{ kind }] : [])],
  });

  // One-off capital moved in from outside Orbit's tracked accounts (e.g. the
  // final payout of a closed account never imported) — real money, but not
  // recurring income, so it must not inflate cash-flow/burn-rate totals.
  const oneTimeIncomeCategory = await prisma.category.findUnique({ where: { key: 'one_time_income' }, select: { id: true } });
  // `categoryId: { not: X }` alone compiles to a plain SQL `<>`, which drops
  // every row where categoryId IS NULL (three-valued logic) — an uncategorized
  // transaction must still count as income, so NULL is allowed explicitly.
  const excludeOneTimeIncome: Prisma.TransactionWhereInput = oneTimeIncomeCategory
    ? { OR: [{ categoryId: null }, { categoryId: { not: oneTimeIncomeCategory.id } }] }
    : {};

  const historyFrom = range ? new Date(Date.UTC(range.gte.getUTCFullYear(), range.gte.getUTCMonth() - 12, 1)) : null;

  const [
    unorderedTransactions,
    categories,
    buckets,
    recurringExpenses,
    accounts,
    months,
    incomeCzk,
    incomeForeign,
    expensesCzk,
    expensesForeign,
    missingConversions,
    recommendationRows,
  ] = await Promise.all([
    prisma.transaction.findMany({
      where: orderedTransactionIds ? { id: { in: orderedTransactionIds } } : where,
      orderBy:
        sort === 'amount' && !absoluteAmount
          ? [{ amountCzk: { sort: direction, nulls: 'last' } }, { date: 'desc' }]
          : [{ date: direction }, { createdAt: 'desc' }],
      skip: orderedTransactionIds ? undefined : (page - 1) * PAGE_SIZE,
      take: orderedTransactionIds ? undefined : PAGE_SIZE,
      select: transactionSelect,
    }),
    prisma.category.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: { id: true, key: true, name: true, defaultIsShared: true, isActive: true, _count: { select: { transactions: true } } } }),
    prisma.bucket.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.recurringExpense.findMany({
      where: { isActive: true },
      orderBy: [{ expectedAmount: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.account.findMany({
      where: { isArchived: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.$queryRaw<{ month: string }[]>`
      SELECT DISTINCT to_char("date", 'YYYY-MM') AS month
      FROM "Transaction"
      ORDER BY month DESC
    `,
    prisma.transaction.aggregate({
      where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: 'CZK' }, { amount: { gt: 0 } }] },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: { not: 'CZK' } }, { amountCzk: { gt: 0 } }] },
      _sum: { amountCzk: true },
    }),
    prisma.transaction.aggregate({
      where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: 'CZK' }, { amount: { lt: 0 } }] },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: { not: 'CZK' } }, { amountCzk: { lt: 0 } }] },
      _sum: { amountCzk: true },
    }),
    prisma.transaction.count({
      where: { AND: [reportingWhere(), { currency: { not: 'CZK' } }, { amountCzk: null }] },
    }),
    range && historyFrom
      ? prisma.transaction.findMany({
          where: { date: { gte: historyFrom, lt: range.lt }, kind: { in: ['NORMAL'] } },
          select: { id: true, accountId: true, date: true, amount: true, merchant: true, categoryId: true, settlementId: true, parentId: true, kind: true, account: { select: { provider: true } } },
        })
      : Promise.resolve([]),
  ]);

  const transactions = orderedTransactionIds
    ? orderedTransactionIds.flatMap((id) => {
        const transaction = unorderedTransactions.find((row) => row.id === id);
        return transaction ? [transaction] : [];
      })
    : unorderedTransactions;

  const zero = new Prisma.Decimal(0);
  const income = (incomeCzk._sum.amount ?? zero).plus(incomeForeign._sum.amountCzk ?? zero);
  const expenses = (expensesCzk._sum.amount ?? zero).plus(expensesForeign._sum.amountCzk ?? zero).abs();
  const balance = income.minus(expenses);
  const recommendations = range
    ? recommendMerchantCategories(
        recommendationRows.filter((row) => row.date < range.gte).map((row) => ({ ...row, amount: row.amount.toFixed(4), provider: row.account.provider })),
        recommendationRows.filter((row) => row.date >= range.gte).map((row) => ({ ...row, amount: row.amount.toFixed(4), provider: row.account.provider })),
        new Set(categories.filter((category) => category.isActive).map((category) => category.id)),
      ).map((recommendation) => ({
        ...recommendation,
        categoryName: categories.find((category) => category.id === recommendation.categoryId)?.name ?? 'Kategorie',
      }))
    : [];

  const filterKey = [
    period.value,
    params.accountId,
    params.categoryId,
    params.shared,
    params.uncategorized,
    query,
    page,
    absoluteAmount,
  ].join('|');

  return (
    <PageShell>
      <PageHeader
        title="Transakce"
        description="Přehled pohybů napříč účty. Souhrn vždy vychází ze všech výsledků aktuálního filtru."
      />

      <section aria-label="Cash flow" className="grid gap-3 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Metric
          label="Čistý tok peněz"
          value={CZK.format(balance.toNumber())}
          tone={balance.greaterThanOrEqualTo(0) ? 'positive' : 'critical'}
          detail="Příjmy minus výdaje. Převody mezi účty ani vyrovnání sem nevstupují."
        />
        <Metric label="Příjmy" value={CZK.format(income.toNumber())} tone="positive" detail="běžné příjmy v aktuálním filtru" />
        <Metric label="Výdaje" value={CZK.format(expenses.toNumber())} detail="běžné výdaje v aktuálním filtru" />
      </section>

      {missingConversions > 0 ? (
        <StatusNotice title="Neúplný přepočet do CZK" tone="warning">
          Souhrn nezahrnuje {missingConversions.toLocaleString('cs-CZ')} transakcí v cizí měně bez dostupného CZK přepočtu.
          Původní částky zůstávají v přehledu uvedené ve své měně.
        </StatusNotice>
      ) : null}

      <TransactionTable
        key={filterKey}
        // Decimal is not serializable across server/client boundary.
        transactions={transactions.map((transaction) => ({
          id: transaction.id,
          accountId: transaction.accountId,
          date: transaction.date.toISOString().slice(0, 10),
          amount: transaction.amount.toFixed(2),
          currency: transaction.currency,
          merchant: transaction.merchant,
          description: transaction.description,
          accountName: transaction.account.name,
          categoryId: transaction.categoryId,
          bucketId: transaction.bucketId,
          recurringExpenseId: transaction.recurringExpenseId,
          kind: transaction.kind,
          isShared: transaction.isShared,
          paidBy: transaction.paidBy,
          myShareRatio: transaction.myShareRatio ? transaction.myShareRatio.toNumber() : null,
          notes: transaction.notes,
          isSettled: transaction.settlementId !== null,
          parentId: transaction.parentId,
          transferCounterpartyAccount:
            transaction.transfer?.legs.find((leg) => leg.id !== transaction.id)?.account.name ?? null,
        }))}
        categories={categories}
        categoryManager={<CategoryManager categories={categories.map((category) => ({ ...category, transactionCount: category._count.transactions }))} />}
        buckets={buckets}
        recurringExpenses={recurringExpenses}
        accounts={accounts}
        months={months.map((row) => row.month)}
        filters={{
          period: period.value,
          accountId: params.accountId ?? '',
          categoryId: params.categoryId ?? '',
          shared: params.shared === '1',
          uncategorized: params.uncategorized === '1',
          q: query ?? '',
          flow,
          sort,
          direction,
          absoluteAmount,
          unmatchedTransfersOnly,
        }}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        totalPages={totalPages}
        recommendations={recommendations}
        recommendationPeriod={range ? { from: range.gte.toISOString(), to: range.lt.toISOString() } : null}
      />
    </PageShell>
  );
}
