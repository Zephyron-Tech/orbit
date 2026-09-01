'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { normalizeMerchant } from '@/lib/finance/idempotency';
import { Prisma } from '@/lib/generated/prisma/client';

const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,14}(?:[.,]\d{1,4})?$/, 'Zadejte kladnou částku s nejvýše 4 desetinnými místy')
  .transform((value) => value.replace(',', '.'));

const spendingTargetSchema = z.object({
  monthlySpendingTarget: decimalString.nullable(),
  transferHistoryFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  hideHistoricalBrokerTransfers: z.boolean(),
});

const planSchema = z.object({
  name: z.string().trim().min(1, 'Zadejte název').max(120),
  sourceAccountId: z.uuid().nullable(),
  brokerAccountId: z.uuid('Vyberte účet Trading 212'),
  expectedAmount: decimalString,
  currency: z.string().trim().toUpperCase().length(3, 'Měna musí být tříznakový kód'),
  dueDay: z.number().int().min(1, 'Den splatnosti musí být 1 až 31').max(31, 'Den splatnosti musí být 1 až 31'),
  graceDays: z.number().int().min(0, 'Tolerance nemůže být záporná').max(31, 'Tolerance může být nejvýše 31 dní'),
  isActive: z.boolean(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).superRefine((input, context) => {
  if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
    context.addIssue({ code: 'custom', path: ['endsOn'], message: 'Datum ukončení musí být po datu začátku.' });
  }
});

const incomeSourceRuleSchema = z.object({
  name: z.string().trim().min(1, 'Zadejte zobrazovaný název').max(120),
  merchantText: z.string().trim().min(1, 'Zadejte text obchodníka').max(300),
  accountId: z.uuid().nullable(),
});

export type SpendingTargetInput = z.infer<typeof spendingTargetSchema>;
export type InvestmentPlanInput = z.infer<typeof planSchema>;
export type IncomeSourceRuleInput = z.infer<typeof incomeSourceRuleSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Neplatná data';
}

function revalidatePlanning(): void {
  revalidatePath('/planning');
  revalidatePath('/dashboard');
}

async function applyIncomeRuleToExisting(rule: { merchantKey: string; accountId: string | null }): Promise<void> {
  const incomeCategory = await prisma.category.findUnique({ where: { key: 'income' }, select: { id: true } });
  if (!incomeCategory) return;
  const rows = await prisma.transaction.findMany({
    where: {
      ...(rule.accountId ? { accountId: rule.accountId } : {}),
      kind: 'NORMAL',
      amount: { gt: 0 },
      settlementId: null,
    },
    select: { id: true, merchant: true },
  });
  const ids = rows.filter((row) => normalizeMerchant(row.merchant) === rule.merchantKey).map((row) => row.id);
  if (ids.length > 0) await prisma.transaction.updateMany({ where: { id: { in: ids }, categoryId: null, settlementId: null }, data: { categoryId: incomeCategory.id } });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function incomeSourceRuleData(input: IncomeSourceRuleInput): Promise<{ data?: { name: string; merchantKey: string; accountId: string | null }; error?: string }> {
  const merchantKey = normalizeMerchant(input.merchantText);
  if (!merchantKey) return { error: 'Text obchodníka po normalizaci nesmí být prázdný.' };

  if (input.accountId) {
    const account = await prisma.account.findUnique({ where: { id: input.accountId }, select: { isArchived: true } });
    if (!account || account.isArchived) return { error: 'Vyberte aktivní účet.' };
  }

  return { data: { name: input.name, merchantKey, accountId: input.accountId } };
}

async function incomeSourceRuleConflict(merchantKey: string, accountId: string | null, exceptId?: string): Promise<boolean> {
  const rule = await prisma.incomeSourceRule.findFirst({
    where: { merchantKey, accountId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return rule !== null;
}

async function validateAccounts(input: InvestmentPlanInput): Promise<string | null> {
  const accountIds = [input.brokerAccountId, ...(input.sourceAccountId ? [input.sourceAccountId] : [])];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, type: true, provider: true, isArchived: true },
  });
  const broker = accounts.find((account) => account.id === input.brokerAccountId);

  if (!broker || broker.isArchived || broker.type !== 'INVESTMENT' || broker.provider !== 'TRADING212') {
    return 'Vyberte aktivní investiční účet Trading 212';
  }

  if (input.sourceAccountId) {
    const source = accounts.find((account) => account.id === input.sourceAccountId);
    if (!source || source.isArchived || source.type === 'INVESTMENT') {
      return 'Zdrojový účet musí být aktivní neinvestiční účet';
    }
  }

  return null;
}

function planData(input: InvestmentPlanInput) {
  return {
    name: input.name,
    sourceAccountId: input.sourceAccountId,
    brokerAccountId: input.brokerAccountId,
    expectedAmount: new Prisma.Decimal(input.expectedAmount),
    currency: input.currency,
    dueDay: input.dueDay,
    graceDays: input.graceDays,
    isActive: input.isActive,
    startsOn: input.startsOn ? new Date(`${input.startsOn}T00:00:00.000Z`) : null,
    endsOn: input.endsOn ? new Date(`${input.endsOn}T00:00:00.000Z`) : null,
  };
}

export async function saveSpendingTarget(input: SpendingTargetInput): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsed = spendingTargetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  await prisma.planningSettings.upsert({
    where: { id: 'household' },
    create: {
      id: 'household',
      monthlySpendingTarget: parsed.data.monthlySpendingTarget ? new Prisma.Decimal(parsed.data.monthlySpendingTarget) : null,
      transferHistoryFrom: parsed.data.transferHistoryFrom ? new Date(`${parsed.data.transferHistoryFrom}T00:00:00.000Z`) : null,
      hideHistoricalBrokerTransfers: parsed.data.hideHistoricalBrokerTransfers,
    },
    update: {
      monthlySpendingTarget: parsed.data.monthlySpendingTarget ? new Prisma.Decimal(parsed.data.monthlySpendingTarget) : null,
      transferHistoryFrom: parsed.data.transferHistoryFrom ? new Date(`${parsed.data.transferHistoryFrom}T00:00:00.000Z`) : null,
      hideHistoricalBrokerTransfers: parsed.data.hideHistoricalBrokerTransfers,
    },
  });
  revalidatePlanning();
  revalidatePath('/net-worth');
  return { ok: true };
}

export async function createInvestmentPlan(input: InvestmentPlanInput): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const accountError = await validateAccounts(parsed.data);
  if (accountError) return { ok: false, error: accountError };

  await prisma.recurringInvestmentPlan.create({ data: planData(parsed.data) });
  revalidatePlanning();
  return { ok: true };
}

export async function updateInvestmentPlan(id: string, input: InvestmentPlanInput): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(id);
  const parsed = planSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return { ok: false, error: parsed.success ? 'Neplatný plán' : firstIssue(parsed.error) };
  const accountError = await validateAccounts(parsed.data);
  if (accountError) return { ok: false, error: accountError };

  await prisma.recurringInvestmentPlan.update({ where: { id: parsedId.data }, data: planData(parsed.data) });
  revalidatePlanning();
  return { ok: true };
}

export async function setInvestmentPlanActive(id: string, isActive: boolean): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Neplatný plán' };

  await prisma.recurringInvestmentPlan.update({ where: { id: parsedId.data }, data: { isActive } });
  revalidatePlanning();
  return { ok: true };
}

export async function deleteInvestmentPlan(id: string): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Neplatný plán' };

  // Plans have no dependent records yet. Keep this guard when references arrive.
  await prisma.recurringInvestmentPlan.delete({ where: { id: parsedId.data } });
  revalidatePlanning();
  return { ok: true };
}

export async function createIncomeSourceRule(input: IncomeSourceRuleInput): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsed = incomeSourceRuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const result = await incomeSourceRuleData(parsed.data);
  if (!result.data) return { ok: false, error: result.error };
  if (await incomeSourceRuleConflict(result.data.merchantKey, result.data.accountId)) return { ok: false, error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' };

  try {
    await prisma.incomeSourceRule.create({ data: result.data });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' };
    console.error('Income source rule creation failed', error);
    return { ok: false, error: 'Pravidlo se nepodařilo vytvořit.' };
  }
  await applyIncomeRuleToExisting(result.data);
  revalidatePlanning();
  return { ok: true };
}

export async function updateIncomeSourceRule(id: string, input: IncomeSourceRuleInput): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(id);
  const parsed = incomeSourceRuleSchema.safeParse(input);
  if (!parsedId.success || !parsed.success) return { ok: false, error: parsed.success ? 'Neplatné pravidlo' : firstIssue(parsed.error) };
  const result = await incomeSourceRuleData(parsed.data);
  if (!result.data) return { ok: false, error: result.error };
  if (await incomeSourceRuleConflict(result.data.merchantKey, result.data.accountId, parsedId.data)) return { ok: false, error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' };

  try {
    await prisma.incomeSourceRule.update({ where: { id: parsedId.data }, data: result.data });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' };
    console.error('Income source rule update failed', error);
    return { ok: false, error: 'Pravidlo se nepodařilo uložit.' };
  }
  await applyIncomeRuleToExisting(result.data);
  revalidatePlanning();
  return { ok: true };
}

export async function setIncomeSourceRuleActive(id: string, isActive: boolean): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Neplatné pravidlo' };
  await prisma.incomeSourceRule.update({ where: { id: parsedId.data }, data: { isActive } });
  revalidatePlanning();
  return { ok: true };
}

export async function deleteIncomeSourceRule(id: string): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'Neplatné pravidlo' };
  await prisma.incomeSourceRule.delete({ where: { id: parsedId.data } });
  revalidatePlanning();
  return { ok: true };
}
