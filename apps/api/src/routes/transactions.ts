import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { normalizeMerchant } from '@orbit-api/lib/finance/idempotency';
import { recommendMerchantCategories } from '@orbit-api/lib/finance/merchant-category-recommendations';
import { validateSplit } from '@orbit-api/lib/finance/split';
import { learnRecurringExpenseAliases } from '@orbit-api/lib/import/recurring-alias-worker';
import { matchPendingTransfers } from '@orbit-api/lib/import/transfer-sync';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

const PAGE_SIZE = 100;

function monthRange(month: string): { gte: Date; lt: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match?.[1] || !match[2]) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
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

function isPeriod(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value);
}

function resolveTransactionPeriod(
  value: string | undefined,
  month: string | undefined,
  preferredMonth: string | undefined,
): { value: string; range: { gte: Date; lt: Date } | null } {
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

/**
 * Inline edits from the ledger. Everything a person can change by hand lives
 * here; the parsers never write these fields, so an import can never overwrite
 * a categorization the user made.
 */
const updateSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid().nullable(),
  bucketId: z.uuid().nullable(),
  recurringExpenseId: z.uuid().nullable(),
  kind: z.enum(['NORMAL', 'INTERNAL_TRANSFER', 'PENDING_TRANSFER', 'SETTLEMENT']),
  isShared: z.boolean(),
  paidBy: z.enum(['ME', 'PARTNER']),
  myShareRatio: z.number().min(0).max(1).nullable(),
  notes: z.string().max(500).nullable(),
});

const createCategorySchema = z.object({ name: z.string().trim().min(1, 'Zadejte název').max(80), isShared: z.boolean() });
const updateCategorySchema = createCategorySchema.extend({ id: z.uuid(), isActive: z.boolean() });

function customKey(): string {
  return `custom-${crypto.randomUUID()}`;
}

const applyMerchantSchema = z.object({
  accountId: z.uuid(),
  categoryId: z.uuid(),
  merchantKey: z.string().min(1).max(240),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

const lineSchema = z.object({
  amount: z.string().trim().min(1),
  categoryId: z.uuid().nullable(),
  isShared: z.boolean(),
  myShareRatio: z.number().min(0).max(1).nullable(),
  notes: z.string().max(500).nullable(),
});
const splitSchema = z.object({ parentId: z.uuid(), lines: z.array(lineSchema).min(2).max(20) });

function toDecimal(raw: string): Prisma.Decimal | null {
  try {
    return new Prisma.Decimal(raw.trim().replace(',', '.'));
  } catch {
    return null;
  }
}

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

function serializeTransaction(transaction: Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>) {
  return {
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
    transferCounterpartyAccount: transaction.transfer?.legs.find((leg) => leg.id !== transaction.id)?.account.name ?? null,
  };
}

export const transactions = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const q = c.req.query();
    const preferredMonth = q.preferredMonth;
    const period = resolveTransactionPeriod(q.period, q.month === 'all' ? undefined : q.month, preferredMonth);

    const where: Prisma.TransactionWhereInput = { kind: { not: 'SPLIT_PARENT' } };
    const range = period.range;
    if (range) where.date = range;
    if (q.accountId) where.accountId = q.accountId;
    if (q.uncategorized === '1') where.categoryId = null;
    else if (q.categoryId) where.categoryId = q.categoryId;
    if (q.shared === '1') where.isShared = true;

    const flow = q.flow === 'income' || q.flow === 'expense' ? q.flow : '';
    if (flow) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { kind: 'NORMAL' }, { amount: flow === 'income' ? { gt: 0 } : { lt: 0 } }];
    }
    const unmatchedTransfersOnly = q.transfer === 'unmatched';
    if (unmatchedTransfersOnly) {
      // transferDismissedAt: null matches dashboard.ts/net-worth.ts's own
      // "unmatched" definition — without it, a dismissed transfer (see
      // POST /:id/dismiss-unmatched-transfer below) would keep showing up
      // in this filtered list forever, even though it no longer counts
      // toward either of those "needs attention" panels.
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] } }, { transferId: null }, { transferDismissedAt: null }];
    }
    const sort = q.sort === 'amount' ? 'amount' : 'date';
    const direction = q.direction === 'asc' ? 'asc' : 'desc';
    const absoluteAmount = sort === 'amount' && q.absolute === '1';

    const query = q.q?.trim();
    if (query) {
      where.OR = [
        { merchant: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { notes: { contains: query, mode: 'insensitive' } },
      ];
    }

    const totalCount = await prisma.transaction.count({ where });
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const page = Math.min(parsePage(q.page), totalPages);

    let orderedTransactionIds: string[] | null = null;
    if (absoluteAmount) {
      const clauses: Prisma.Sql[] = [Prisma.sql`"kind" <> 'SPLIT_PARENT'`];
      if (range) clauses.push(Prisma.sql`"date" >= ${range.gte} AND "date" < ${range.lt}`);
      if (q.accountId) clauses.push(Prisma.sql`"accountId" = ${q.accountId}`);
      if (q.uncategorized === '1') clauses.push(Prisma.sql`"categoryId" IS NULL`);
      else if (q.categoryId) clauses.push(Prisma.sql`"categoryId" = ${q.categoryId}`);
      if (q.shared === '1') clauses.push(Prisma.sql`"isShared" = true`);
      if (flow) {
        clauses.push(Prisma.sql`"kind" = 'NORMAL'`);
        clauses.push(flow === 'income' ? Prisma.sql`"amount" > 0` : Prisma.sql`"amount" < 0`);
      }
      if (unmatchedTransfersOnly) {
        clauses.push(Prisma.sql`"kind" IN ('INTERNAL_TRANSFER', 'PENDING_TRANSFER')`);
        clauses.push(Prisma.sql`"transferId" IS NULL`);
        clauses.push(Prisma.sql`"transferDismissedAt" IS NULL`);
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

    const reportingWhere = (kind?: 'NORMAL'): Prisma.TransactionWhereInput => ({ AND: [where, ...(kind ? [{ kind }] : [])] });

    const oneTimeIncomeCategory = await prisma.category.findUnique({ where: { key: 'one_time_income' }, select: { id: true } });
    const excludeOneTimeIncome: Prisma.TransactionWhereInput = oneTimeIncomeCategory
      ? { OR: [{ categoryId: null }, { categoryId: { not: oneTimeIncomeCategory.id } }] }
      : {};

    const historyFrom = range ? new Date(Date.UTC(range.gte.getUTCFullYear(), range.gte.getUTCMonth() - 12, 1)) : null;
    const planningSettings = await prisma.planningSettings.findUnique({ where: { id: 'household' }, select: { reportingStartMonth: true } });

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
      prisma.category.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        select: { id: true, key: true, name: true, defaultIsShared: true, isActive: true, _count: { select: { transactions: true } } },
      }),
      prisma.bucket.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.recurringExpense.findMany({ where: { isActive: true }, orderBy: [{ expectedAmount: 'desc' }, { name: 'asc' }], select: { id: true, name: true } }),
      prisma.account.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.$queryRaw<{ month: string }[]>`
        SELECT DISTINCT to_char("date", 'YYYY-MM') AS month
        FROM "Transaction"
        ${planningSettings?.reportingStartMonth ? Prisma.sql`WHERE "date" >= ${planningSettings.reportingStartMonth}` : Prisma.empty}
        ORDER BY month DESC
      `,
      prisma.transaction.aggregate({ where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: 'CZK' }, { amount: { gt: 0 } }] }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: { not: 'CZK' } }, { amountCzk: { gt: 0 } }] }, _sum: { amountCzk: true } }),
      prisma.transaction.aggregate({ where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: 'CZK' }, { amount: { lt: 0 } }] }, _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: { AND: [reportingWhere('NORMAL'), excludeOneTimeIncome, { currency: { not: 'CZK' } }, { amountCzk: { lt: 0 } }] }, _sum: { amountCzk: true } }),
      prisma.transaction.count({ where: { AND: [reportingWhere(), { currency: { not: 'CZK' } }, { amountCzk: null }] } }),
      range && historyFrom
        ? prisma.transaction.findMany({
            where: { date: { gte: historyFrom, lt: range.lt }, kind: { in: ['NORMAL'] } },
            select: { id: true, accountId: true, date: true, amount: true, merchant: true, categoryId: true, settlementId: true, parentId: true, kind: true, account: { select: { provider: true } } },
          })
        : Promise.resolve([]),
    ]);

    const orderedTransactions = orderedTransactionIds
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
        ).map((recommendation) => ({ ...recommendation, categoryName: categories.find((category) => category.id === recommendation.categoryId)?.name ?? 'Kategorie' }))
      : [];

    return c.json({
      period: { value: period.value, from: range?.gte.toISOString() ?? null, to: range?.lt.toISOString() ?? null },
      page,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages,
      missingConversions,
      balance: balance.toString(),
      income: income.toString(),
      expenses: expenses.toString(),
      transactions: orderedTransactions.map(serializeTransaction),
      categories: categories.map((category) => ({ ...category, transactionCount: category._count.transactions })),
      buckets,
      recurringExpenses,
      accounts,
      months: months.map((row) => row.month),
      recommendations,
      unmatchedTransfersOnly,
      sort,
      direction,
      absoluteAmount,
      flow,
    });
  })
  // Single-transaction read — mobile's detail screen navigates by id
  // (push/back/deep-link/refresh) rather than web's in-list modal, so it
  // needs a real endpoint to refetch a specific transaction rather than
  // scanning the paginated list for it.
  .get('/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatná transakce' }, 400);

    const transaction = await prisma.transaction.findUnique({ where: { id: parsedId.data }, select: transactionSelect });
    if (!transaction) return c.json({ error: 'Transakce nenalezena' }, 404);

    return c.json(serializeTransaction(transaction));
  })
  .patch('/', async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatná data' }, 400);

    const data = parsed.data;
    const transferCategory =
      data.kind === 'INTERNAL_TRANSFER' || data.kind === 'PENDING_TRANSFER'
        ? await prisma.category.findFirst({ where: { key: 'transfer', isActive: true }, select: { id: true } })
        : null;

    const existing = await prisma.transaction.findUnique({ where: { id: data.id }, select: { settlementId: true, transferId: true } });

    if (!existing) return c.json({ error: 'Transakce neexistuje' }, 404);
    if (existing.settlementId) return c.json({ error: 'Transakce je součástí uzavřeného vyrovnání' }, 409);

    await prisma.$transaction(async (tx) => {
      if (data.kind !== 'INTERNAL_TRANSFER' && existing.transferId) {
        await tx.transaction.updateMany({ where: { transferId: existing.transferId }, data: { transferId: null } });
        await tx.transfer.delete({ where: { id: existing.transferId } });
      }

      await tx.transaction.update({
        where: { id: data.id },
        data: {
          categoryId: transferCategory?.id ?? data.categoryId,
          bucketId: data.bucketId,
          recurringExpenseId: data.recurringExpenseId,
          kind: data.kind,
          isShared: data.kind === 'NORMAL' ? data.isShared : false,
          paidBy: data.paidBy,
          myShareRatio: data.kind === 'NORMAL' && data.isShared && data.myShareRatio !== null ? new Prisma.Decimal(data.myShareRatio) : null,
          notes: data.notes,
          transferId: data.kind === 'INTERNAL_TRANSFER' ? undefined : null,
        },
      });
    });

    if (data.kind === 'INTERNAL_TRANSFER') {
      try {
        await matchPendingTransfers();
      } catch (error: unknown) {
        console.error('Transfer matching failed after manual reclassification', error);
      }
    }
    if (data.recurringExpenseId) {
      try {
        await learnRecurringExpenseAliases();
      } catch (error: unknown) {
        console.error('Recurring alias learning failed after transaction update', error);
      }
    }

    return c.json({ ok: true });
  })
  .post('/bulk-categorize', async (c) => {
    const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(500), categoryId: z.uuid().nullable() }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatná data' }, 400);

    await prisma.transaction.updateMany({ where: { id: { in: parsed.data.ids }, settlementId: null }, data: { categoryId: parsed.data.categoryId } });
    return c.json({ ok: true });
  })
  .post('/:id/dismiss-unmatched-transfer', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatná transakce' }, 400);

    const { count } = await prisma.transaction.updateMany({
      where: { id: parsedId.data, kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null, transferDismissedAt: null },
      data: { transferDismissedAt: new Date() },
    });

    if (count === 0) return c.json({ error: 'Převod už není nespárovaný, nebo byl už dříve skryt.' }, 409);
    return c.json({ ok: true });
  })
  .post('/match-transfers', async (c) => {
    const result = await matchPendingTransfers();
    return c.json({ ok: true, matched: result.matched, ambiguous: result.ambiguous });
  })
  .post('/categories', async (c) => {
    const parsed = createCategorySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Neplatná kategorie.' }, 400);

    try {
      const category = await prisma.category.create({ data: { key: customKey(), name: parsed.data.name, defaultIsShared: parsed.data.isShared } });
      return c.json(category, 201);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return c.json({ error: 'Kategorie s tímto názvem už existuje.' }, 409);
      }
      console.error('Category creation failed', error);
      return c.json({ error: 'Kategorii se nepodařilo vytvořit.' }, 500);
    }
  })
  .patch('/categories/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsed = updateCategorySchema.omit({ id: true }).safeParse(await c.req.json());
    if (!parsedId.success || !parsed.success) return c.json({ error: 'Neplatná kategorie.' }, 400);

    try {
      const category = await prisma.category.update({
        where: { id: parsedId.data },
        data: { name: parsed.data.name, defaultIsShared: parsed.data.isShared, isActive: parsed.data.isActive },
      });
      return c.json(category);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return c.json({ error: 'Kategorie s tímto názvem už existuje.' }, 409);
      }
      console.error('Category update failed', error);
      return c.json({ error: 'Kategorii se nepodařilo uložit.' }, 500);
    }
  })
  .post('/apply-merchant-category', async (c) => {
    const parsed = applyMerchantSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Návrh kategorie už není platný.' }, 400);
    const data = parsed.data;
    const category = await prisma.category.findFirst({ where: { id: data.categoryId, isActive: true }, select: { id: true } });
    if (!category) return c.json({ error: 'Kategorie už není dostupná.' }, 404);

    const rows = await prisma.transaction.findMany({
      where: { accountId: data.accountId, date: { gte: new Date(data.from), lt: new Date(data.to) }, kind: 'NORMAL', amount: { lt: 0 }, categoryId: null, settlementId: null, parentId: null },
      select: { id: true, merchant: true },
    });
    const ids = rows.filter((row) => normalizeMerchant(row.merchant) === data.merchantKey).map((row) => row.id);
    if (ids.length === 0) return c.json({ error: 'Všechny odpovídající platby už byly změněné. Obnovte stránku.' }, 409);

    const result = await prisma.transaction.updateMany({ where: { id: { in: ids }, categoryId: null, settlementId: null, parentId: null }, data: { categoryId: data.categoryId } });
    return c.json({ ok: true, updated: result.count });
  })
  .post('/count-merchant-category-targets', async (c) => {
    const parsed = applyMerchantSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Návrh kategorie už není platný.' }, 400);
    const data = parsed.data;
    const rows = await prisma.transaction.findMany({
      where: { accountId: data.accountId, date: { gte: new Date(data.from), lt: new Date(data.to) }, kind: 'NORMAL', amount: { lt: 0 }, categoryId: null, settlementId: null, parentId: null },
      select: { merchant: true },
    });
    return c.json({ ok: true, count: rows.filter((row) => normalizeMerchant(row.merchant) === data.merchantKey).length });
  })
  .post('/split', async (c) => {
    const parsed = splitSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatná data' }, 400);

    const parent = await prisma.transaction.findUnique({
      where: { id: parsed.data.parentId },
      select: { id: true, accountId: true, date: true, currency: true, merchant: true, source: true, paidBy: true, amount: true, amountCzk: true, idempotencyKey: true, externalId: true, kind: true, settlementId: true },
    });

    if (!parent) return c.json({ error: 'Transakce neexistuje' }, 404);
    if (parent.kind !== 'NORMAL' && parent.kind !== 'SPLIT_PARENT') return c.json({ error: 'Tuto transakci nelze rozdělit' }, 409);
    if (parent.settlementId) return c.json({ error: 'Transakce je součástí uzavřeného vyrovnání' }, 409);

    const decimalLines = parsed.data.lines.map((line) => ({ ...line, decimal: toDecimal(line.amount) }));
    if (decimalLines.some((line) => line.decimal === null)) return c.json({ error: 'Neplatná částka' }, 400);

    const validation = validateSplit(parent.amount, decimalLines.map((line) => ({ amount: line.decimal as Prisma.Decimal })));
    if (!validation.ok) return c.json({ error: validation.error }, 400);

    if (parent.kind === 'SPLIT_PARENT') {
      const settledChild = await prisma.transaction.findFirst({ where: { parentId: parent.id, settlementId: { not: null } }, select: { id: true } });
      if (settledChild) return c.json({ error: 'Část tohoto rozdělení je už součástí uzavřeného vyrovnání' }, 409);
    }

    const isCzk = parent.currency === 'CZK';
    const czkRatio = isCzk || parent.amountCzk === null ? null : parent.amountCzk.dividedBy(parent.amount);

    await prisma.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { parentId: parent.id } });
      await tx.transaction.update({ where: { id: parent.id }, data: { kind: 'SPLIT_PARENT', isShared: false, myShareRatio: null } });
      await tx.transaction.createMany({
        data: decimalLines.map((line, index) => {
          const amount = line.decimal as Prisma.Decimal;
          return {
            idempotencyKey: `${parent.idempotencyKey}#split#${index}`,
            externalId: `${parent.externalId ?? parent.id}#${index}`,
            accountId: parent.accountId,
            date: parent.date,
            amount,
            currency: parent.currency,
            amountCzk: isCzk ? amount : czkRatio ? amount.times(czkRatio) : null,
            merchant: parent.merchant,
            source: parent.source,
            paidBy: parent.paidBy,
            kind: 'NORMAL' as const,
            parentId: parent.id,
            categoryId: line.categoryId,
            isShared: line.isShared,
            myShareRatio: line.isShared && line.myShareRatio !== null ? new Prisma.Decimal(line.myShareRatio) : null,
            notes: line.notes,
          };
        }),
      });
    });

    return c.json({ ok: true });
  })
  .post('/:id/merge-split', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatná transakce' }, 400);

    const parent = await prisma.transaction.findUnique({ where: { id: parsedId.data }, select: { id: true, kind: true } });
    if (!parent || parent.kind !== 'SPLIT_PARENT') return c.json({ error: 'Tato transakce není rozdělená' }, 409);

    const settledChild = await prisma.transaction.findFirst({ where: { parentId: parent.id, settlementId: { not: null } }, select: { id: true } });
    if (settledChild) return c.json({ error: 'Část tohoto rozdělení je už součástí uzavřeného vyrovnání' }, 409);

    await prisma.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { parentId: parent.id } });
      await tx.transaction.update({ where: { id: parent.id }, data: { kind: 'NORMAL' } });
    });

    return c.json({ ok: true });
  });
