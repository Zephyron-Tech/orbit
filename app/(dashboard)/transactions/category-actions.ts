'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { normalizeMerchant } from '@/lib/finance/idempotency';

export interface CategoryActionResult {
  ok: boolean;
  error?: string;
}

const createSchema = z.object({
  name: z.string().trim().min(1, 'Zadejte název').max(80),
  isShared: z.boolean(),
});
const updateSchema = createSchema.extend({ id: z.uuid(), isActive: z.boolean() });

function customKey(): string {
  return `custom-${crypto.randomUUID()}`;
}

export async function createCategory(input: z.input<typeof createSchema>): Promise<CategoryActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím.' };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Neplatná kategorie.' };

  try {
    await prisma.category.create({
      data: { key: customKey(), name: parsed.data.name, defaultIsShared: parsed.data.isShared },
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Kategorie s tímto názvem už existuje.' };
    }
    console.error('Category creation failed', error);
    return { ok: false, error: 'Kategorii se nepodařilo vytvořit.' };
  }

  revalidatePath('/transactions');
  revalidatePath('/settings/recurring');
  return { ok: true };
}

export async function updateCategory(input: z.input<typeof updateSchema>): Promise<CategoryActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím.' };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Neplatná kategorie.' };

  try {
    await prisma.category.update({
      where: { id: parsed.data.id },
      data: { name: parsed.data.name, defaultIsShared: parsed.data.isShared, isActive: parsed.data.isActive },
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Kategorie s tímto názvem už existuje.' };
    }
    console.error('Category update failed', error);
    return { ok: false, error: 'Kategorii se nepodařilo uložit.' };
  }

  revalidatePath('/transactions');
  revalidatePath('/settings/recurring');
  return { ok: true };
}

const applyMerchantSchema = z.object({
  accountId: z.uuid(),
  categoryId: z.uuid(),
  merchantKey: z.string().min(1).max(240),
  from: z.string().datetime(),
  to: z.string().datetime(),
});

/** Applies a confirmed merchant category only to still-safe uncategorized rows. */
export async function applyMerchantCategory(input: z.input<typeof applyMerchantSchema>): Promise<CategoryActionResult & { updated?: number }> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím.' };
  const parsed = applyMerchantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Návrh kategorie už není platný.' };
  const data = parsed.data;
  const category = await prisma.category.findFirst({ where: { id: data.categoryId, isActive: true }, select: { id: true } });
  if (!category) return { ok: false, error: 'Kategorie už není dostupná.' };

  const rows = await prisma.transaction.findMany({
    where: {
      accountId: data.accountId,
      date: { gte: new Date(data.from), lt: new Date(data.to) },
      kind: 'NORMAL',
      amount: { lt: 0 },
      categoryId: null,
      settlementId: null,
      parentId: null,
    },
    select: { id: true, merchant: true },
  });
  const ids = rows.filter((row) => normalizeMerchant(row.merchant) === data.merchantKey).map((row) => row.id);
  if (ids.length === 0) return { ok: false, error: 'Všechny odpovídající platby už byly změněné. Obnovte stránku.' };

  const result = await prisma.transaction.updateMany({
    where: { id: { in: ids }, categoryId: null, settlementId: null, parentId: null },
    data: { categoryId: data.categoryId },
  });
  revalidatePath('/transactions');
  return { ok: true, updated: result.count };
}

export async function countMerchantCategoryTargets(input: z.input<typeof applyMerchantSchema>): Promise<CategoryActionResult & { count?: number }> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím.' };
  const parsed = applyMerchantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Návrh kategorie už není platný.' };
  const data = parsed.data;
  const rows = await prisma.transaction.findMany({
    where: { accountId: data.accountId, date: { gte: new Date(data.from), lt: new Date(data.to) }, kind: 'NORMAL', amount: { lt: 0 }, categoryId: null, settlementId: null, parentId: null },
    select: { merchant: true },
  });
  return { ok: true, count: rows.filter((row) => normalizeMerchant(row.merchant) === data.merchantKey).length };
}
