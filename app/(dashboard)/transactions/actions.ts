'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { matchPendingTransfers } from '@/lib/import/transfer-sync';
import { learnRecurringExpenseAliases } from '@/lib/import/recurring-alias-worker';

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
  /** My share of a shared transaction, 0–1. Null when not shared. */
  myShareRatio: z.number().min(0).max(1).nullable(),
  notes: z.string().max(500).nullable(),
});

export type UpdateTransactionInput = z.infer<typeof updateSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function updateTransaction(input: UpdateTransactionInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = updateSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: 'Neplatná data' };
  }

  const data = parsed.data;
  const transferCategory =
    data.kind === 'INTERNAL_TRANSFER' || data.kind === 'PENDING_TRANSFER'
      ? await prisma.category.findFirst({ where: { key: 'transfer', isActive: true }, select: { id: true } })
      : null;

  // A settled transaction is frozen: changing its share after the fact would
  // silently invalidate a settlement that both people already agreed on.
  const existing = await prisma.transaction.findUnique({
    where: { id: data.id },
    select: { settlementId: true, transferId: true },
  });

  if (!existing) {
    return { ok: false, error: 'Transakce neexistuje' };
  }

  if (existing.settlementId) {
    return { ok: false, error: 'Transakce je součástí uzavřeného vyrovnání' };
  }

  await prisma.$transaction(async (tx) => {
    if (data.kind !== 'INTERNAL_TRANSFER' && existing.transferId) {
      // A transfer is exactly one verified pair. Releasing only one leg would
      // leave its counterpart linked to an orphaned Transfer row.
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
        myShareRatio:
          data.kind === 'NORMAL' && data.isShared && data.myShareRatio !== null
            ? new Prisma.Decimal(data.myShareRatio)
            : null,
        notes: data.notes,
        transferId: data.kind === 'INTERNAL_TRANSFER' ? undefined : null,
      },
    });
  });

  // A manual reclassification to INTERNAL_TRANSFER might complete a pair the
  // importer could not see yet. Best-effort, same as after an import.
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

  revalidatePath('/transactions');

  return { ok: true };
}

/** Applies one category to many rows at once, for cleaning up an import. */
export async function bulkCategorize(ids: string[], categoryId: string | null): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(500), categoryId: z.uuid().nullable() }).safeParse({
    ids,
    categoryId,
  });

  if (!parsed.success) {
    return { ok: false, error: 'Neplatná data' };
  }

  await prisma.transaction.updateMany({
    where: { id: { in: parsed.data.ids }, settlementId: null },
    data: { categoryId: parsed.data.categoryId },
  });

  revalidatePath('/transactions');

  return { ok: true };
}

export interface TransferMatchResult extends ActionResult {
  matched?: number;
  ambiguous?: number;
}

/** Manual re-run, for after a bulk reclassification or just to check now. */
export async function runTransferMatching(): Promise<TransferMatchResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const result = await matchPendingTransfers();

  revalidatePath('/transactions');

  return { ok: true, matched: result.matched, ambiguous: result.ambiguous };
}
