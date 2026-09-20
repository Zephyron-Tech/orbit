'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { validateSplit } from '@/lib/finance/split';

/**
 * Splitting a transaction into several ledger rows. Kept separate from
 * `actions.ts`: this is a structural change (rows are created/removed), while
 * `updateTransaction` only ever edits fields in place.
 */

const lineSchema = z.object({
  amount: z.string().trim().min(1),
  categoryId: z.uuid().nullable(),
  isShared: z.boolean(),
  myShareRatio: z.number().min(0).max(1).nullable(),
  notes: z.string().max(500).nullable(),
});

const splitSchema = z.object({
  parentId: z.uuid(),
  lines: z.array(lineSchema).min(2).max(20),
});

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toDecimal(raw: string): Prisma.Decimal | null {
  try {
    return new Prisma.Decimal(raw.trim().replace(',', '.'));
  } catch {
    return null;
  }
}

export async function splitTransaction(input: {
  parentId: string;
  lines: {
    amount: string;
    categoryId: string | null;
    isShared: boolean;
    myShareRatio: number | null;
    notes: string | null;
  }[];
}): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = splitSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: 'Neplatná data' };
  }

  const parent = await prisma.transaction.findUnique({
    where: { id: parsed.data.parentId },
    select: {
      id: true,
      accountId: true,
      date: true,
      currency: true,
      merchant: true,
      source: true,
      paidBy: true,
      amount: true,
      amountCzk: true,
      idempotencyKey: true,
      externalId: true,
      kind: true,
      settlementId: true,
    },
  });

  if (!parent) {
    return { ok: false, error: 'Transakce neexistuje' };
  }

  // Only a plain transaction can be split — a transfer or a repayment is
  // already a specific accounting event, not spending to break down.
  if (parent.kind !== 'NORMAL' && parent.kind !== 'SPLIT_PARENT') {
    return { ok: false, error: 'Tuto transakci nelze rozdělit' };
  }

  if (parent.settlementId) {
    return { ok: false, error: 'Transakce je součástí uzavřeného vyrovnání' };
  }

  const decimalLines = parsed.data.lines.map((line) => ({ ...line, decimal: toDecimal(line.amount) }));

  if (decimalLines.some((line) => line.decimal === null)) {
    return { ok: false, error: 'Neplatná částka' };
  }

  const validation = validateSplit(
    parent.amount,
    decimalLines.map((line) => ({ amount: line.decimal as Prisma.Decimal })),
  );

  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  // Re-splitting: refuse if any earlier part has already been settled — undoing
  // it would silently invalidate a settlement both people already agreed on.
  if (parent.kind === 'SPLIT_PARENT') {
    const settledChild = await prisma.transaction.findFirst({
      where: { parentId: parent.id, settlementId: { not: null } },
      select: { id: true },
    });

    if (settledChild) {
      return { ok: false, error: 'Část tohoto rozdělení je už součástí uzavřeného vyrovnání' };
    }
  }

  const isCzk = parent.currency === 'CZK';
  const czkRatio = isCzk || parent.amountCzk === null ? null : parent.amountCzk.dividedBy(parent.amount);

  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { parentId: parent.id } });

    await tx.transaction.update({
      where: { id: parent.id },
      data: { kind: 'SPLIT_PARENT', isShared: false, myShareRatio: null },
    });

    await tx.transaction.createMany({
      data: decimalLines.map((line, index) => {
        const amount = line.decimal as Prisma.Decimal;

        return {
          // Derived from the already-unique parent, so these can never collide
          // with an imported row or with each other.
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

  revalidatePath('/transactions');

  return { ok: true };
}

export async function mergeSplit(parentId: string): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(parentId);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatná transakce' };
  }

  const parent = await prisma.transaction.findUnique({
    where: { id: parsedId.data },
    select: { id: true, kind: true },
  });

  if (!parent || parent.kind !== 'SPLIT_PARENT') {
    return { ok: false, error: 'Tato transakce není rozdělená' };
  }

  const settledChild = await prisma.transaction.findFirst({
    where: { parentId: parent.id, settlementId: { not: null } },
    select: { id: true },
  });

  if (settledChild) {
    return { ok: false, error: 'Část tohoto rozdělení je už součástí uzavřeného vyrovnání' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { parentId: parent.id } });
    await tx.transaction.update({ where: { id: parent.id }, data: { kind: 'NORMAL' } });
  });

  revalidatePath('/transactions');

  return { ok: true };
}
