import { prisma } from '@/lib/db/prisma';
import { normalizeMerchant } from '@/lib/finance/idempotency';

export interface RecurringAliasWorkerResult {
  learned: number;
  conflicts: number;
  assigned: number;
}

/**
 * Learns exact account-scoped aliases from explicitly tagged fixed expenses.
 * It never changes transaction tags and never resolves conflicts by guessing.
 */
export async function learnRecurringExpenseAliases(): Promise<RecurringAliasWorkerResult> {
  const evidence = await prisma.transaction.findMany({
    where: {
      kind: 'NORMAL',
      amount: { lt: 0 },
      parentId: null,
      recurringExpenseId: { not: null },
      recurringExpense: { isActive: true },
    },
    select: { id: true, accountId: true, merchant: true, recurringExpenseId: true },
  });

  const candidates = new Map<string, { accountId: string; merchantKey: string; recurringExpenseId: string; transactionId: string }>();
  const conflicts = new Set<string>();
  for (const row of evidence) {
    if (!row.recurringExpenseId) continue;
    const merchantKey = normalizeMerchant(row.merchant);
    if (!merchantKey) continue;
    const key = `${row.accountId}|${merchantKey}`;
    const previous = candidates.get(key);
    if (previous && previous.recurringExpenseId !== row.recurringExpenseId) {
      conflicts.add(key);
      continue;
    }
    candidates.set(key, { accountId: row.accountId, merchantKey, recurringExpenseId: row.recurringExpenseId, transactionId: row.id });
  }

  let learned = 0;
  for (const [key, candidate] of candidates) {
    if (conflicts.has(key)) continue;
    const existing = await prisma.recurringExpenseAlias.findUnique({
      where: { accountId_merchantKey: { accountId: candidate.accountId, merchantKey: candidate.merchantKey } },
      select: { recurringExpenseId: true },
    });
    if (existing) {
      if (existing.recurringExpenseId !== candidate.recurringExpenseId) conflicts.add(key);
      continue;
    }
    await prisma.recurringExpenseAlias.create({
      data: {
        accountId: candidate.accountId,
        merchantKey: candidate.merchantKey,
        recurringExpenseId: candidate.recurringExpenseId,
        learnedFromTransactionId: candidate.transactionId,
      },
    });
    learned += 1;
  }
  const aliases = await prisma.recurringExpenseAlias.findMany({
    where: { recurringExpense: { isActive: true } },
    select: { accountId: true, merchantKey: true, recurringExpenseId: true, recurringExpense: { select: { categoryId: true } } },
  });
  let assigned = 0;
  for (const alias of aliases) {
    const candidates = await prisma.transaction.findMany({
      where: {
        accountId: alias.accountId,
        kind: 'NORMAL',
        amount: { lt: 0 },
        parentId: null,
        settlementId: null,
        OR: [{ recurringExpenseId: null }, { recurringExpenseId: alias.recurringExpenseId }],
      },
      select: { id: true, merchant: true },
    });
    const ids = candidates.filter((row) => normalizeMerchant(row.merchant) === alias.merchantKey).map((row) => row.id);
    if (ids.length === 0) continue;
    const result = await prisma.transaction.updateMany({
      where: {
        id: { in: ids },
        OR: [{ recurringExpenseId: null }, { recurringExpenseId: alias.recurringExpenseId }],
        settlementId: null,
        parentId: null,
      },
      data: {
        recurringExpenseId: alias.recurringExpenseId,
        categoryId: alias.recurringExpense.categoryId,
      },
    });
    assigned += result.count;
  }
  return { learned, conflicts: conflicts.size, assigned };
}
