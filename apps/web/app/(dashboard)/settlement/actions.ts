'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { calculateSettlement, monthPeriod, type SettleableTransaction } from '@/lib/finance/settlement';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const closeSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  notes: z.string().max(500).nullable(),
});

/** Rows the settlement math needs, for one period, excluding closed ones. */
export async function loadPeriodTransactions(year: number, month: number): Promise<SettleableTransaction[]> {
  const { from, to } = monthPeriod(year, month);

  const rows = await prisma.transaction.findMany({
    where: { date: { gte: from, lt: to } },
    select: {
      id: true,
      amount: true,
      amountCzk: true,
      currency: true,
      isShared: true,
      paidBy: true,
      myShareRatio: true,
      kind: true,
      settlementId: true,
    },
  });

  return rows.flatMap((row) => {
    const amountCzk = row.currency === 'CZK' ? row.amount : row.amountCzk;

    if (!amountCzk) {
      return [];
    }

    return [{
      id: row.id,
      amountCzk,
      isShared: row.isShared,
      paidBy: row.paidBy,
      myShareRatio: row.myShareRatio,
      kind: row.kind,
      settlementId: row.settlementId,
    }];
  });
}

/**
 * Closes a period. The transactions it covers are stamped with the settlement
 * id in the same transaction as the insert, so they can never be settled twice
 * and a later edit cannot silently change an agreed figure.
 */
export async function closeSettlement(input: {
  year: number;
  month: number;
  notes: string | null;
}): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = closeSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: 'Neplatné období' };
  }

  const { year, month, notes } = parsed.data;
  const { from, to } = monthPeriod(year, month);

  const transactions = await loadPeriodTransactions(year, month);
  const result = calculateSettlement(transactions);

  if (result.transactionIds.length === 0) {
    return { ok: false, error: 'V tomto období není co vyrovnávat' };
  }

  const existing = await prisma.settlement.findFirst({ where: { periodFrom: from, periodTo: to } });

  if (existing) {
    return { ok: false, error: 'Toto období už je uzavřené' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const settlement = await tx.settlement.create({
        data: {
          periodFrom: from,
          periodTo: to,
          paidByMe: result.paidByMe,
          paidByPartner: result.paidByPartner,
          balance: result.balance,
          notes,
        },
      });

      // Only rows that are still unsettled, so a concurrent close cannot claim
      // the same transaction for two periods.
      await tx.transaction.updateMany({
        where: { id: { in: result.transactionIds }, settlementId: null },
        data: { settlementId: settlement.id },
      });
    });
  } catch (error: unknown) {
    console.error('Closing settlement failed', error);

    return { ok: false, error: 'Vyrovnání se nepodařilo uzavřít' };
  }

  revalidatePath('/settlement');
  revalidatePath('/transactions');

  return { ok: true };
}

/** Reopens a period, releasing its transactions for editing. */
export async function reopenSettlement(id: string): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatné vyrovnání' };
  }

  const settlement = await prisma.settlement.findUnique({ where: { id: parsedId.data } });

  if (!settlement) {
    return { ok: false, error: 'Vyrovnání neexistuje' };
  }

  if (settlement.settledAt) {
    return { ok: false, error: 'Vyrovnání je označené jako zaplacené, nejdřív ho odznačte' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.transaction.updateMany({
      where: { settlementId: parsedId.data },
      data: { settlementId: null },
    });

    await tx.settlement.delete({ where: { id: parsedId.data } });
  });

  revalidatePath('/settlement');
  revalidatePath('/transactions');

  return { ok: true };
}

/** Records that the balancing payment actually happened. */
export async function markSettled(id: string, settled: boolean): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatné vyrovnání' };
  }

  await prisma.settlement.update({
    where: { id: parsedId.data },
    data: { settledAt: settled ? new Date() : null },
  });

  revalidatePath('/settlement');

  return { ok: true };
}
