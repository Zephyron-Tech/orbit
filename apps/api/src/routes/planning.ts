import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { normalizeMerchant } from '@orbit-api/lib/finance/idempotency';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { learnRecurringExpenseAliases } from '@orbit-api/lib/import/recurring-alias-worker';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Neplatná data';
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ---------------------------------------------------------------------------
// Spending target + investment plans + income source rules
// (ported from app/(dashboard)/planning/actions.ts)
// ---------------------------------------------------------------------------

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

const planSchema = z
  .object({
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
  })
  .superRefine((input, context) => {
    if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
      context.addIssue({ code: 'custom', path: ['endsOn'], message: 'Datum ukončení musí být po datu začátku.' });
    }
  });

const incomeSourceRuleSchema = z.object({
  name: z.string().trim().min(1, 'Zadejte zobrazovaný název').max(120),
  merchantText: z.string().trim().min(1, 'Zadejte text obchodníka').max(300),
  accountId: z.uuid().nullable(),
});

type InvestmentPlanInput = z.infer<typeof planSchema>;
type IncomeSourceRuleInput = z.infer<typeof incomeSourceRuleSchema>;

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
  if (ids.length > 0) {
    await prisma.transaction.updateMany({ where: { id: { in: ids }, categoryId: null, settlementId: null }, data: { categoryId: incomeCategory.id } });
  }
}

async function incomeSourceRuleData(
  input: IncomeSourceRuleInput,
): Promise<{ data?: { name: string; merchantKey: string; accountId: string | null }; error?: string }> {
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

async function validatePlanAccounts(input: InvestmentPlanInput): Promise<string | null> {
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

// ---------------------------------------------------------------------------
// Recurring expenses (ported from app/(dashboard)/planning/recurring-actions.ts)
// ---------------------------------------------------------------------------

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum zadejte ve formátu RRRR-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Zadejte platné datum')
  .nullable();

const recurringExpenseSchema = z
  .object({
    name: z.string().trim().min(1, 'Zadejte název').max(120),
    categoryId: z.uuid().nullable(),
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
  })
  .superRefine((input, context) => {
    if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
      context.addIssue({ code: 'custom', path: ['endsOn'], message: 'Datum ukončení musí být po datu začátku' });
    }
  });

type RecurringExpenseInput = z.infer<typeof recurringExpenseSchema>;

function recurringExpenseData(input: RecurringExpenseInput) {
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

  const account = await prisma.account.findUnique({ where: { id: paymentAccountId }, select: { isArchived: true, type: true } });

  if (!account || account.isArchived || account.type === 'INVESTMENT') {
    return 'Platební účet musí být aktivní neinvestiční účet';
  }

  return null;
}

export const planning = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const [settings, plans, accounts, incomeSourceRules, expenses, categories, firstBankBatch] = await Promise.all([
      prisma.planningSettings.findUnique({ where: { id: 'household' } }),
      prisma.recurringInvestmentPlan.findMany({
        orderBy: [{ isActive: 'desc' }, { expectedAmount: 'desc' }, { name: 'asc' }],
        include: { sourceAccount: { select: { name: true } }, brokerAccount: { select: { name: true } } },
      }),
      prisma.account.findMany({
        where: { isArchived: false },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true, provider: true, currency: true },
      }),
      prisma.incomeSourceRule.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { account: { select: { name: true } } } }),
      prisma.recurringExpense.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { transactions: true } }, paymentAccount: { select: { name: true } } },
      }),
      prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.importBatch.findFirst({
        where: { status: 'COMPLETED', account: { provider: { not: 'TRADING212' } }, periodFrom: { not: null } },
        orderBy: { periodFrom: 'asc' },
        select: { periodFrom: true },
      }),
    ]);

    return c.json({
      settings: settings
        ? {
            monthlySpendingTarget: settings.monthlySpendingTarget?.toString() ?? null,
            transferHistoryFrom: settings.transferHistoryFrom?.toISOString().slice(0, 10) ?? null,
            hideHistoricalBrokerTransfers: settings.hideHistoricalBrokerTransfers,
          }
        : null,
      firstBankBatchPeriodFrom: firstBankBatch?.periodFrom?.toISOString().slice(0, 10) ?? null,
      plans: plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        sourceAccountId: plan.sourceAccountId,
        sourceAccountName: plan.sourceAccount?.name ?? null,
        brokerAccountId: plan.brokerAccountId,
        brokerAccountName: plan.brokerAccount.name,
        expectedAmount: plan.expectedAmount.toString(),
        currency: plan.currency,
        dueDay: plan.dueDay,
        graceDays: plan.graceDays,
        isActive: plan.isActive,
        startsOn: plan.startsOn?.toISOString().slice(0, 10) ?? null,
        endsOn: plan.endsOn?.toISOString().slice(0, 10) ?? null,
      })),
      accounts,
      incomeSourceRules: incomeSourceRules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        merchantKey: rule.merchantKey,
        accountId: rule.accountId,
        accountName: rule.account?.name ?? null,
        isActive: rule.isActive,
      })),
      expenses: expenses.map((expense) => ({
        id: expense.id,
        name: expense.name,
        categoryId: expense.categoryId,
        expectedAmount: expense.expectedAmount.toFixed(2),
        currency: expense.currency,
        isShared: expense.isShared,
        myShareRatio: expense.myShareRatio ? expense.myShareRatio.toNumber() : null,
        isActive: expense.isActive,
        dueDay: expense.dueDay,
        graceDays: expense.graceDays,
        startsOn: expense.startsOn?.toISOString().slice(0, 10) ?? null,
        endsOn: expense.endsOn?.toISOString().slice(0, 10) ?? null,
        paymentAccountId: expense.paymentAccountId,
        paymentAccountName: expense.paymentAccount?.name ?? null,
        transactionCount: expense._count.transactions,
      })),
      categories,
    });
  })
  .post('/spending-target', async (c) => {
    const parsed = spendingTargetSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

    const data = {
      monthlySpendingTarget: parsed.data.monthlySpendingTarget ? new Prisma.Decimal(parsed.data.monthlySpendingTarget) : null,
      transferHistoryFrom: parsed.data.transferHistoryFrom ? new Date(`${parsed.data.transferHistoryFrom}T00:00:00.000Z`) : null,
      hideHistoricalBrokerTransfers: parsed.data.hideHistoricalBrokerTransfers,
    };

    await prisma.planningSettings.upsert({ where: { id: 'household' }, create: { id: 'household', ...data }, update: data });
    return c.json({ ok: true });
  })
  .post('/investment-plans', async (c) => {
    const parsed = planSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);
    const accountError = await validatePlanAccounts(parsed.data);
    if (accountError) return c.json({ error: accountError }, 422);

    const plan = await prisma.recurringInvestmentPlan.create({ data: planData(parsed.data) });
    return c.json(plan, 201);
  })
  .patch('/investment-plans/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsed = planSchema.safeParse(await c.req.json());
    if (!parsedId.success) return c.json({ error: 'Neplatný plán' }, 400);
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);
    const accountError = await validatePlanAccounts(parsed.data);
    if (accountError) return c.json({ error: accountError }, 422);

    const plan = await prisma.recurringInvestmentPlan.update({ where: { id: parsedId.data }, data: planData(parsed.data) });
    return c.json(plan);
  })
  .post('/investment-plans/:id/active', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsedBody = z.object({ isActive: z.boolean() }).safeParse(await c.req.json());
    if (!parsedId.success || !parsedBody.success) return c.json({ error: 'Neplatný plán' }, 400);

    const plan = await prisma.recurringInvestmentPlan.update({ where: { id: parsedId.data }, data: { isActive: parsedBody.data.isActive } });
    return c.json(plan);
  })
  .delete('/investment-plans/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný plán' }, 400);

    await prisma.recurringInvestmentPlan.delete({ where: { id: parsedId.data } });
    return c.body(null, 204);
  })
  .post('/income-source-rules', async (c) => {
    const parsed = incomeSourceRuleSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);
    const result = await incomeSourceRuleData(parsed.data);
    if (!result.data) return c.json({ error: result.error }, 422);
    if (await incomeSourceRuleConflict(result.data.merchantKey, result.data.accountId)) {
      return c.json({ error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' }, 409);
    }

    try {
      const rule = await prisma.incomeSourceRule.create({ data: result.data });
      await applyIncomeRuleToExisting(result.data);
      return c.json(rule, 201);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return c.json({ error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' }, 409);
      console.error('Income source rule creation failed', error);
      return c.json({ error: 'Pravidlo se nepodařilo vytvořit.' }, 500);
    }
  })
  .patch('/income-source-rules/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsed = incomeSourceRuleSchema.safeParse(await c.req.json());
    if (!parsedId.success) return c.json({ error: 'Neplatné pravidlo' }, 400);
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);
    const result = await incomeSourceRuleData(parsed.data);
    if (!result.data) return c.json({ error: result.error }, 422);
    if (await incomeSourceRuleConflict(result.data.merchantKey, result.data.accountId, parsedId.data)) {
      return c.json({ error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' }, 409);
    }

    try {
      const rule = await prisma.incomeSourceRule.update({ where: { id: parsedId.data }, data: result.data });
      await applyIncomeRuleToExisting(result.data);
      return c.json(rule);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return c.json({ error: 'Pravidlo pro tohoto obchodníka a účet už existuje.' }, 409);
      console.error('Income source rule update failed', error);
      return c.json({ error: 'Pravidlo se nepodařilo uložit.' }, 500);
    }
  })
  .post('/income-source-rules/:id/active', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsedBody = z.object({ isActive: z.boolean() }).safeParse(await c.req.json());
    if (!parsedId.success || !parsedBody.success) return c.json({ error: 'Neplatné pravidlo' }, 400);

    const rule = await prisma.incomeSourceRule.update({ where: { id: parsedId.data }, data: { isActive: parsedBody.data.isActive } });
    return c.json(rule);
  })
  .delete('/income-source-rules/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatné pravidlo' }, 400);

    await prisma.incomeSourceRule.delete({ where: { id: parsedId.data } });
    return c.body(null, 204);
  })
  .post('/recurring-expenses', async (c) => {
    const parsed = recurringExpenseSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);
    const accountError = await validatePaymentAccount(parsed.data.paymentAccountId);
    if (accountError) return c.json({ error: accountError }, 422);

    const expense = await prisma.recurringExpense.create({ data: recurringExpenseData(parsed.data) });
    await learnRecurringExpenseAliases();
    return c.json(expense, 201);
  })
  .patch('/recurring-expenses/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsed = recurringExpenseSchema.safeParse(await c.req.json());
    if (!parsedId.success) return c.json({ error: 'Neplatný fixní výdaj' }, 400);
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);
    const accountError = await validatePaymentAccount(parsed.data.paymentAccountId);
    if (accountError) return c.json({ error: accountError }, 422);

    const data = recurringExpenseData(parsed.data);

    // Editing a recurring expense's sharing arrangement applies to every
    // NORMAL, unsettled instance of it, not just future ones — same
    // reasoning as the original server action.
    const [expense] = await prisma.$transaction([
      prisma.recurringExpense.update({ where: { id: parsedId.data }, data }),
      prisma.transaction.updateMany({
        where: { recurringExpenseId: parsedId.data, kind: 'NORMAL', settlementId: null },
        data: { isShared: data.isShared, myShareRatio: data.myShareRatio },
      }),
    ]);
    await learnRecurringExpenseAliases();
    return c.json(expense);
  })
  .post('/recurring-expenses/:id/active', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsedBody = z.object({ isActive: z.boolean() }).safeParse(await c.req.json());
    if (!parsedId.success || !parsedBody.success) return c.json({ error: 'Neplatný fixní výdaj' }, 400);

    const expense = await prisma.recurringExpense.update({ where: { id: parsedId.data }, data: { isActive: parsedBody.data.isActive } });
    return c.json(expense);
  })
  .delete('/recurring-expenses/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný fixní výdaj' }, 400);

    const transactionCount = await prisma.transaction.count({ where: { recurringExpenseId: parsedId.data } });
    if (transactionCount > 0) {
      return c.json({ error: `Je k němu přiřazeno ${transactionCount} transakcí. Místo smazání ho deaktivujte.` }, 409);
    }

    await prisma.recurringExpense.delete({ where: { id: parsedId.data } });
    return c.body(null, 204);
  });
