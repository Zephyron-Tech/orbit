import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { reorderRows } from '@orbit-api/lib/db/reorder';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

const ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'INVESTMENT', 'CREDIT'] as const;
const PROVIDERS = ['MONETA', 'REVOLUT', 'TRADING212', 'MANUAL'] as const;
const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,14}(?:\.\d{1,4})?$/, 'Zadejte částku s nejvýše 4 desetinnými místy');
const percentageString = z
  .string()
  .trim()
  .regex(/^\d{1,4}(?:\.\d{1,4})?$/, 'Zadejte procento s nejvýše 4 desetinnými místy');

const accountSchema = z
  .object({
    name: z.string().trim().min(1, 'Zadejte název').max(120),
    type: z.enum(ACCOUNT_TYPES),
    provider: z.enum(PROVIDERS),
    externalId: z
      .string()
      .trim()
      .max(64)
      .transform((value) => value || null)
      .nullable(),
    currency: z.string().trim().toUpperCase().length(3, 'Měna musí být tříznakový kód'),
    includeInNetWorth: z.boolean(),
    creditLimit: decimalString.nullable(),
    cardLast4: z.string().trim().regex(/^\d{4}$/, 'Zadejte poslední 4 číslice karty').nullable(),
    emergencyReserveMonths: z.number().int().positive('Zadejte kladný počet měsíců').nullable(),
    annualInterestRate: percentageString.nullable(),
    interestTaxRate: percentageString
      .nullable()
      .refine((value) => value === null || new Prisma.Decimal(value).lessThanOrEqualTo(100), 'Daň musí být nejvýše 100 %'),
  })
  .superRefine((value, context) => {
    if (value.type !== 'CREDIT' && (value.creditLimit !== null || value.cardLast4 !== null)) {
      context.addIssue({ code: 'custom', message: 'Limit a poslední 4 číslice lze zadat jen pro kreditní účet', path: ['creditLimit'] });
    }
    if (
      value.type !== 'SAVINGS' &&
      (value.emergencyReserveMonths !== null || value.annualInterestRate !== null || value.interestTaxRate !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Rezervu a úročení lze nastavit jen pro spořicí účet', path: ['emergencyReserveMonths'] });
    }
  });

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function accountData(input: z.infer<typeof accountSchema>) {
  return {
    ...input,
    annualInterestRate: input.annualInterestRate === null ? null : new Prisma.Decimal(input.annualInterestRate).dividedBy(100),
    interestTaxRate: input.interestTaxRate === null ? null : new Prisma.Decimal(input.interestTaxRate).dividedBy(100),
  };
}

export const accounts = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const rows = await prisma.account.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return c.json(rows);
  })
  .get('/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný účet' }, 400);
    const account = await prisma.account.findUnique({ where: { id: parsedId.data } });
    if (!account) return c.json({ error: 'Účet nenalezen' }, 404);
    return c.json(account);
  })
  .post('/', async (c) => {
    const parsed = accountSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Neplatná data' }, 400);

    try {
      const account = await prisma.account.create({ data: accountData(parsed.data) });
      return c.json(account, 201);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return c.json({ error: 'Účet s tímto číslem už u tohoto poskytovatele existuje' }, 409);
      }
      console.error('Account creation failed', error);
      return c.json({ error: 'Účet se nepodařilo vytvořit' }, 500);
    }
  })
  .patch('/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsed = accountSchema.safeParse(await c.req.json());
    if (!parsedId.success) return c.json({ error: 'Neplatný účet' }, 400);
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Neplatná data' }, 400);

    try {
      const account = await prisma.account.update({ where: { id: parsedId.data }, data: accountData(parsed.data) });
      return c.json(account);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return c.json({ error: 'Účet s tímto číslem už u tohoto poskytovatele existuje' }, 409);
      }
      console.error('Account update failed', error);
      return c.json({ error: 'Účet se nepodařilo uložit' }, 500);
    }
  })
  .post('/:id/archive', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsedBody = z.object({ isArchived: z.boolean() }).safeParse(await c.req.json());
    if (!parsedId.success || !parsedBody.success) return c.json({ error: 'Neplatný požadavek' }, 400);

    if (parsedBody.data.isArchived) {
      const dcaPlans = await prisma.recurringInvestmentPlan.count({
        where: { isActive: true, OR: [{ sourceAccountId: parsedId.data }, { brokerAccountId: parsedId.data }] },
      });
      if (dcaPlans > 0) {
        return c.json({ error: `Účet používá ${dcaPlans} aktivních DCA plánů. Nejdřív je upravte nebo deaktivujte.` }, 409);
      }
    }

    const account = await prisma.account.update({ where: { id: parsedId.data }, data: { isArchived: parsedBody.data.isArchived } });
    return c.json(account);
  })
  .delete('/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný účet' }, 400);

    const [transactions, dcaPlans] = await Promise.all([
      prisma.transaction.count({ where: { accountId: parsedId.data } }),
      prisma.recurringInvestmentPlan.count({ where: { OR: [{ sourceAccountId: parsedId.data }, { brokerAccountId: parsedId.data }] } }),
    ]);
    if (transactions > 0) return c.json({ error: `Účet má ${transactions} transakcí. Místo smazání ho archivujte.` }, 409);
    if (dcaPlans > 0) return c.json({ error: `Účet používá ${dcaPlans} DCA plánů. Nejdřív je upravte nebo deaktivujte.` }, 409);

    await prisma.account.delete({ where: { id: parsedId.data } });
    return c.body(null, 204);
  })
  .post('/reorder', async (c) => {
    const parsed = z.object({ id: z.uuid(), direction: z.union([z.literal(-1), z.literal(1)]) }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatný požadavek' }, 400);

    const result = await reorderRows(
      parsed.data.id,
      parsed.data.direction,
      (tx) => tx.account.findMany({ where: { isArchived: false }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true } }),
      (tx, accountId, position) => tx.account.update({ where: { id: accountId }, data: { sortOrder: position } }),
    );

    if (!result.ok) {
      return c.json(
        { error: result.error === 'CONFLICT' ? 'Někdo jiný právě měnil pořadí, zkuste to znovu.' : 'Neplatný účet' },
        result.error === 'CONFLICT' ? 409 : 400,
      );
    }

    return c.json({ ok: true });
  });
