'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { learnRecurringExpenseAliases } from '@/lib/import/recurring-alias-worker';

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum zadejte ve formátu RRRR-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Zadejte platné datum')
  .nullable();

const recurringExpenseSchema = z.object({
  name: z.string().trim().min(1, 'Zadejte název').max(120),
  categoryId: z.uuid().nullable(),
  /** Always positive — the sign convention on `Transaction.amount` is a ledger concern. */
  expectedAmount: z
    .string()
    .trim()
    .refine((value) => /^\d+([.,]\d{1,4})?$/.test(value), 'Zadejte kladnou částku, např. 18200')
    .transform((value) => value.replace(',', '.')),
  currency: z.string().trim().toUpperCase().length(3, 'Měna musí být tříznakový kód'),
  isShared: z.boolean(),
  myShareRatio: z.number().min(0).max(1).nullable(),
  isActive: z.boolean(),
  dueDay: z.number().int().min(1, 'Den splatnosti musí být 1 až 31').max(31, 'Den splatnosti musí být 1 až 31').nullable(),
  graceDays: z.number().int().min(0, 'Tolerance nemůže být záporná').max(31, 'Tolerance může být nejvýše 31 dní'),
  startsOn: dateString,
  endsOn: dateString,
  paymentAccountId: z.uuid().nullable(),
}).superRefine((input, context) => {
  if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
    context.addIssue({ code: 'custom', path: ['endsOn'], message: 'Datum ukončení musí být po datu začátku' });
  }
});

export type RecurringExpenseInput = z.infer<typeof recurringExpenseSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Neplatná data';
}

function toPrismaData(input: RecurringExpenseInput) {
  return {
    name: input.name,
    categoryId: input.categoryId,
    expectedAmount: new Prisma.Decimal(input.expectedAmount),
    currency: input.currency,
    isShared: input.isShared,
    myShareRatio: input.isShared && input.myShareRatio !== null ? new Prisma.Decimal(input.myShareRatio) : null,
    isActive: input.isActive,
    dueDay: input.dueDay,
    graceDays: input.graceDays,
    startsOn: input.startsOn ? new Date(`${input.startsOn}T00:00:00.000Z`) : null,
    endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00.000Z`) : null,
    paymentAccountId: input.paymentAccountId,
  };
}

async function validatePaymentAccount(paymentAccountId: string | null): Promise<string | null> {
  if (!paymentAccountId) return null;

  const account = await prisma.account.findUnique({
    where: { id: paymentAccountId },
    select: { isArchived: true, type: true },
  });

  if (!account || account.isArchived || account.type === 'INVESTMENT') {
    return 'Platební účet musí být aktivní neinvestiční účet';
  }

  return null;
}

export async function createRecurringExpense(input: RecurringExpenseInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = recurringExpenseSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }

  const accountError = await validatePaymentAccount(parsed.data.paymentAccountId);
  if (accountError) return { ok: false, error: accountError };

  await prisma.recurringExpense.create({ data: toPrismaData(parsed.data) });
  await learnRecurringExpenseAliases();

  revalidatePath('/settings/recurring');
  revalidatePath('/dashboard');
  revalidatePath('/transactions');

  return { ok: true };
}

export async function updateRecurringExpense(id: string, input: RecurringExpenseInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);
  const parsed = recurringExpenseSchema.safeParse(input);

  if (!parsedId.success || !parsed.success) {
    return { ok: false, error: parsed.success ? 'Neplatný fixní výdaj' : firstIssue(parsed.error) };
  }

  const accountError = await validatePaymentAccount(parsed.data.paymentAccountId);
  if (accountError) return { ok: false, error: accountError };

  const data = toPrismaData(parsed.data);

  // A recurring expense's sharing arrangement is the arrangement for every
  // instance of it — editing "Nájem" to unshared should stop the July rent
  // payment from reading as shared too, not just future ones. Settled
  // transactions are excluded: their share is frozen, same as everywhere
  // else a settlement closes a period.
  await prisma.$transaction([
    prisma.recurringExpense.update({ where: { id: parsedId.data }, data }),
    prisma.transaction.updateMany({
      where: { recurringExpenseId: parsedId.data, kind: 'NORMAL', settlementId: null },
      data: { isShared: data.isShared, myShareRatio: data.myShareRatio },
    }),
  ]);
  await learnRecurringExpenseAliases();

  revalidatePath('/settings/recurring');
  revalidatePath('/dashboard');
  revalidatePath('/transactions');
  revalidatePath('/settlement');

  return { ok: true };
}

/** Hides a recurring expense from tagging without touching transactions already tagged to it. */
export async function setRecurringExpenseActive(id: string, isActive: boolean): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatný fixní výdaj' };
  }

  await prisma.recurringExpense.update({ where: { id: parsedId.data }, data: { isActive } });

  revalidatePath('/settings/recurring');
  revalidatePath('/dashboard');
  revalidatePath('/transactions');

  return { ok: true };
}

/**
 * Deletes a recurring expense, but only while nothing is tagged to it.
 * Untagging a year of rent transactions is not something a stray click
 * should do; deactivating is the way to retire one that has history.
 */
export async function deleteRecurringExpense(id: string): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatný fixní výdaj' };
  }

  const transactions = await prisma.transaction.count({ where: { recurringExpenseId: parsedId.data } });

  if (transactions > 0) {
    return {
      ok: false,
      error: `Je k němu přiřazeno ${transactions} transakcí. Místo smazání ho deaktivujte.`,
    };
  }

  await prisma.recurringExpense.delete({ where: { id: parsedId.data } });

  revalidatePath('/settings/recurring');
  revalidatePath('/dashboard');

  return { ok: true };
}
