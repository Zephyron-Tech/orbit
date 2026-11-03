import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { reorderRows } from '@orbit-api/lib/db/reorder';
import { loadAccountBalanceHistory } from '@orbit-api/lib/finance/account-balance-history-service';
import { loadNetWorth } from '@orbit-api/lib/finance/net-worth-service';
import { rebuildMonthlyNetWorth } from '@orbit-api/lib/finance/monthly-net-worth-service';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { recordBalanceCheckpoint } from '@orbit-api/lib/import/checkpoints';
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
    savingsGoalAmount: decimalString.nullable(),
  })
  .superRefine((value, context) => {
    if (value.type !== 'CREDIT' && (value.creditLimit !== null || value.cardLast4 !== null)) {
      context.addIssue({ code: 'custom', message: 'Limit a poslední 4 číslice lze zadat jen pro kreditní účet', path: ['creditLimit'] });
    }
    if (
      value.type !== 'SAVINGS' &&
      (value.emergencyReserveMonths !== null || value.annualInterestRate !== null || value.interestTaxRate !== null || value.savingsGoalAmount !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Rezervu, úročení a cíl lze nastavit jen pro spořicí účet', path: ['emergencyReserveMonths'] });
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

const VARIABLE_SYMBOL_KEY = 'Variabilní Symbol';

/**
 * Variable symbol of a payment row. Statement imports store it under its own
 * key; rows from the e-mail fallback only carry it inside the merchant text
 * ("... VS: 1010774842"), so a card repayment would never be recognised.
 */
function readVariableSymbol(rawData: Prisma.JsonValue | null): string | null {
  if (rawData === null || typeof rawData !== 'object' || Array.isArray(rawData)) return null;
  const record = rawData as Record<string, unknown>;
  const value = record[VARIABLE_SYMBOL_KEY];
  if (typeof value === 'string' && value.trim()) return value.trim();
  const merchant = record.merchant;
  const match = typeof merchant === 'string' ? /\bVS:\s*(\d+)/.exec(merchant) : null;
  return match?.[1] ?? null;
}

export const accounts = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const [rows, netWorth] = await Promise.all([
      prisma.account.findMany({
        orderBy: [{ isArchived: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { transactions: true } },
          snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { balance: true, capturedAt: true, source: true } },
        },
      }),
      loadNetWorth(),
    ]);
    const derivedBalances = new Map(netWorth.accounts.map((entry) => [entry.accountId, entry.balance]));

    const result = rows.map((account) => {
      const snapshot = account.snapshots[0];
      const derivedBalance = derivedBalances.get(account.id);
      const creditDetails =
        account.type === 'CREDIT' && account.creditLimit && derivedBalance
          ? {
              limit: account.creditLimit.toString(),
              debt: derivedBalance.lessThan(0) ? derivedBalance.negated().toString() : '0',
              capacity: account.creditLimit.minus(derivedBalance.lessThan(0) ? derivedBalance.negated() : 0).toString(),
              asOf: snapshot?.capturedAt.toISOString() ?? null,
              invalidCapacitySnapshot: snapshot?.source === 'MANUAL' && snapshot.balance.isPositive(),
            }
          : null;

      return {
        id: account.id,
        name: account.name,
        type: account.type,
        provider: account.provider,
        externalId: account.externalId,
        currency: account.currency,
        includeInNetWorth: account.includeInNetWorth,
        creditLimit: account.creditLimit?.toString() ?? null,
        cardLast4: account.cardLast4,
        emergencyReserveMonths: account.type === 'SAVINGS' ? account.emergencyReserveMonths : null,
        annualInterestRate: account.type === 'SAVINGS' ? (account.annualInterestRate?.times(100).toString() ?? null) : null,
        interestTaxRate: account.type === 'SAVINGS' ? (account.interestTaxRate?.times(100).toString() ?? null) : null,
        savingsGoalAmount: account.type === 'SAVINGS' ? (account.savingsGoalAmount?.toString() ?? null) : null,
        isArchived: account.isArchived,
        transactionCount: account._count.transactions,
        creditDetails,
        creditNeedsOpeningConfirmation: account.type === 'CREDIT' && account.snapshots.length === 0 && account._count.transactions > 0,
      };
    });

    return c.json(result);
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
  })
  .post('/credit-debt', async (c) => {
    const creditDebtSchema = z.object({
      accountId: z.uuid(),
      debt: decimalString.refine((value) => new Prisma.Decimal(value).greaterThan(0), 'Dluh musí být kladný'),
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Zadejte platné datum'),
    });
    const parsed = creditDebtSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Neplatná data' }, 400);

    const date = new Date(`${parsed.data.asOf}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed.data.asOf) {
      return c.json({ error: 'Zadejte platné datum' }, 400);
    }

    const account = await prisma.account.findUnique({ where: { id: parsed.data.accountId }, select: { type: true, currency: true } });
    if (account?.type !== 'CREDIT') return c.json({ error: 'Dluh lze zadat pouze pro kreditní účet' }, 400);
    if (account.currency !== 'CZK') return c.json({ error: 'Ruční dluh kreditky zatím podporuje pouze CZK.' }, 400);

    try {
      await recordBalanceCheckpoint({
        accountId: parsed.data.accountId,
        day: parsed.data.asOf,
        balance: new Prisma.Decimal(parsed.data.debt).negated().toString(),
      });
    } catch (error: unknown) {
      console.error('Credit debt checkpoint failed', error);
      return c.json({ error: 'Dluh se nepodařilo uložit' }, 500);
    }

    void rebuildMonthlyNetWorth(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)), new Date()).catch((error: unknown) =>
      console.error('Monthly net-worth rebuild failed after credit debt', error),
    );

    return c.json({ ok: true });
  })
  .post('/:id/credit-zero-start', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný účet' }, 400);

    const account = await prisma.account.findUnique({ where: { id: parsedId.data }, select: { type: true, currency: true } });
    if (account?.type !== 'CREDIT' || account.currency !== 'CZK') {
      return c.json({ error: 'Nulový počáteční stav lze potvrdit pouze pro CZK kreditní účet.' }, 400);
    }

    const [existing, firstTransaction] = await Promise.all([
      prisma.accountSnapshot.findFirst({ where: { accountId: parsedId.data, balance: { lte: 0 } }, select: { id: true } }),
      prisma.transaction.findFirst({ where: { accountId: parsedId.data }, orderBy: { date: 'asc' }, select: { date: true } }),
    ]);
    if (existing) return c.json({ error: 'Kreditní účet už má potvrzený počáteční stav.' }, 409);
    if (!firstTransaction) return c.json({ error: 'Nejdřív importujte alespoň jednu karetní platbu.' }, 400);

    const dayBefore = new Date(firstTransaction.date);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    try {
      await recordBalanceCheckpoint({
        accountId: parsedId.data,
        day: dayBefore.toISOString().slice(0, 10),
        balance: '0',
        note: 'Confirmed zero credit-card balance before first imported movement',
      });
    } catch (error: unknown) {
      console.error('Credit zero start checkpoint failed', error);
      return c.json({ error: 'Nulový počáteční stav se nepodařilo uložit.' }, 500);
    }

    return c.json({ ok: true });
  })
  .post('/:id/clear-credit-capacity', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný účet' }, 400);

    const snapshot = await prisma.accountSnapshot.findFirst({
      where: { accountId: parsedId.data, source: 'MANUAL', balance: { gt: 0 } },
      orderBy: { capturedAt: 'desc' },
      select: { id: true, capturedAt: true, account: { select: { type: true } } },
    });

    if (!snapshot || snapshot.account.type !== 'CREDIT') {
      // The correction may already have succeeded in another tab or after a
      // refresh. It is safe and less confusing to make removal idempotent.
      return c.json({ ok: true });
    }

    await prisma.accountSnapshot.delete({ where: { id: snapshot.id } });
    void rebuildMonthlyNetWorth(new Date(Date.UTC(snapshot.capturedAt.getUTCFullYear(), snapshot.capturedAt.getUTCMonth(), 1)), new Date()).catch(
      (error: unknown) => console.error('Monthly net-worth rebuild failed after credit correction', error),
    );

    return c.json({ ok: true });
  })
  .get('/credit-repayment-candidates', async (c) => {
    // PENDING_TRANSFER included alongside NORMAL: a card payment's counterparty
    // account (Moneta's shared card-clearing account) can coincidentally equal
    // another account's own Account.externalId, which the generic import-time
    // internal-transfer guess flags as PENDING_TRANSFER — a one-sided guess
    // with no second leg to match, since the credit account has no
    // transaction of its own without a card statement. Excluding
    // PENDING_TRANSFER here would make that row invisible to this matcher
    // forever, stuck.
    const rows = await prisma.transaction.findMany({
      where: { transferId: null, kind: { in: ['NORMAL', 'PENDING_TRANSFER'] }, amountCzk: { not: null } },
      select: { id: true, accountId: true, date: true, amountCzk: true, rawData: true, kind: true, account: { select: { name: true, type: true } } },
    });


    const candidates: {
      creditTransactionId: string | null;
      sourceTransactionId: string;
      amount: string;
      date: string;
      sourceAccountName: string;
      matchedBy: 'AMOUNT_DATE' | 'VARIABLE_SYMBOL';
      creditAccountId?: string;
      creditAccountName?: string;
    }[] = [];
    const matchedSourceIds = new Set<string>();

    // Amount/date matching stays NORMAL-only on both sides: unlike the
    // Variabilní Symbol match below, it has no independent bank-assigned
    // reference to fall back on, so it should not widen to a guessed kind too.
    const creditRows = rows.filter(
      (row): row is typeof row & { amountCzk: Prisma.Decimal } =>
        row.kind === 'NORMAL' && row.account.type === 'CREDIT' && row.amountCzk !== null && row.amountCzk.isPositive(),
    );

    for (const credit of creditRows) {
      const sourceMatches = rows.filter(
        (source) =>
          source.kind === 'NORMAL' &&
          source.account.type !== 'CREDIT' &&
          source.amountCzk?.isNegative() &&
          source.amountCzk.abs().equals(credit.amountCzk.abs()) &&
          source.accountId !== credit.accountId &&
          Math.abs(source.date.getTime() - credit.date.getTime()) <= 3 * 86_400_000,
      );
      if (sourceMatches.length !== 1) continue;
      const source = sourceMatches[0];
      if (!source) continue;
      matchedSourceIds.add(source.id);
      candidates.push({
        creditTransactionId: credit.id,
        sourceTransactionId: source.id,
        amount: credit.amountCzk.toFixed(2),
        date: credit.date.toISOString().slice(0, 10),
        sourceAccountName: source.account.name,
        matchedBy: 'AMOUNT_DATE',
      });
    }

    // Second detection: a checking-side payoff with no card statement
    // imported yet, matched instead on Variabilní Symbol, which Moneta sets
    // to the card's own contract number on a card payment — the same value
    // stored as the credit account's Account.externalId. A bank-assigned
    // reference, not a guess. Requires an existing checkpoint on the credit
    // account — with none at all, adding the payment to an assumed zero
    // would itself be a guess; the credit-zero-start endpoint is the
    // intended way to establish that baseline first.
    const creditAccounts = await prisma.account.findMany({
      where: { type: 'CREDIT', currency: 'CZK', externalId: { not: null } },
      select: { id: true, name: true, externalId: true },
    });
    const creditAccountsWithAnchor = creditAccounts.length
      ? await prisma.accountSnapshot.findMany({
          where: { accountId: { in: creditAccounts.map((a) => a.id) } },
          select: { accountId: true },
          distinct: ['accountId'],
        })
      : [];
    const anchoredCreditAccountIds = new Set(creditAccountsWithAnchor.map((s) => s.accountId));

    for (const creditAccount of creditAccounts) {
      if (!anchoredCreditAccountIds.has(creditAccount.id) || !creditAccount.externalId) continue;

      for (const source of rows) {
        if (
          source.account.type === 'CREDIT' ||
          matchedSourceIds.has(source.id) ||
          !source.amountCzk?.isNegative() ||
          readVariableSymbol(source.rawData) !== creditAccount.externalId
        ) {
          continue;
        }

        matchedSourceIds.add(source.id);
        candidates.push({
          creditTransactionId: null,
          sourceTransactionId: source.id,
          amount: source.amountCzk.abs().toFixed(2),
          date: source.date.toISOString().slice(0, 10),
          sourceAccountName: source.account.name,
          matchedBy: 'VARIABLE_SYMBOL',
          creditAccountId: creditAccount.id,
          creditAccountName: creditAccount.name,
        });
      }
    }

    return c.json(candidates);
  })
  // Registered after every other static GET route on this router
  // (/, /credit-repayment-candidates) — Hono matches GET routes in
  // registration order for this pattern, so a `/:id` declared earlier
  // shadows any static GET route that comes after it and swallows its
  // requests as an (always-invalid) `id` param instead. Confirmed by a
  // real failure: GET /credit-repayment-candidates returned this route's
  // own "Neplatný účet" 400 instead of ever running its own handler,
  // because `.get('/:id')` used to be declared right above `.get('/')`.
  .get('/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný účet' }, 400);
    const account = await prisma.account.findUnique({ where: { id: parsedId.data } });
    if (!account) return c.json({ error: 'Účet nenalezen' }, 404);
    return c.json(account);
  })
  .get('/:id/balance-history', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatný účet' }, 400);
    const parsedMonths = z.coerce.number().int().min(1).max(60).safeParse(c.req.query('months') ?? 12);
    const months = parsedMonths.success ? parsedMonths.data : 12;

    const account = await prisma.account.findUnique({ where: { id: parsedId.data }, select: { id: true } });
    if (!account) return c.json({ error: 'Účet nenalezen' }, 404);

    const history = await loadAccountBalanceHistory(account.id, months);
    return c.json({ history });
  })
  .post('/credit-payoff-from-checking', async (c) => {
    const parsed = z.object({ sourceTransactionId: z.uuid(), creditAccountId: z.uuid() }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatné transakce' }, 400);
    const { sourceTransactionId: sourceId, creditAccountId: creditId } = parsed.data;


    const [source, creditAccount] = await Promise.all([
      prisma.transaction.findUnique({
        where: { id: sourceId },
        select: { id: true, date: true, amountCzk: true, transferId: true, rawData: true, account: { select: { type: true } } },
      }),
      prisma.account.findUnique({ where: { id: creditId }, select: { type: true, currency: true, externalId: true } }),
    ]);

    // Re-verified server-side rather than trusting the client-supplied
    // pairing — same discipline as credit-repayment.
    if (
      !source ||
      source.transferId !== null ||
      source.account.type === 'CREDIT' ||
      !source.amountCzk?.isNegative() ||
      !creditAccount ||
      creditAccount.type !== 'CREDIT' ||
      creditAccount.currency !== 'CZK' ||
      !creditAccount.externalId ||
      readVariableSymbol(source.rawData) !== creditAccount.externalId
    ) {
      return c.json({ error: 'Platba neodpovídá variabilnímu symbolu kreditky.' }, 400);
    }

    const latestSnapshot = await prisma.accountSnapshot.findFirst({
      where: { accountId: creditId },
      orderBy: { capturedAt: 'desc' },
      select: { balance: true },
    });
    if (!latestSnapshot) {
      return c.json({ error: 'Kreditka nemá žádný počáteční stav — nejdřív potvrďte nulový start nebo zadejte dluh ručně.' }, 400);
    }

    const day = source.date.toISOString().slice(0, 10);
    const newBalance = latestSnapshot.balance.plus(source.amountCzk.abs());
    const transferCategory = await prisma.category.findFirst({ where: { key: 'transfer', isActive: true }, select: { id: true } });

    await prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.create({ data: { legs: { connect: [{ id: sourceId }] } } });
      await tx.transaction.update({ where: { id: sourceId }, data: { kind: 'INTERNAL_TRANSFER', transferId: transfer.id, categoryId: transferCategory?.id ?? null } });
    });

    try {
      await recordBalanceCheckpoint({
        accountId: creditId,
        day,
        balance: newBalance.toString(),
        note: `Payoff matched to transaction ${sourceId} (Variabilní symbol)`,
      });
    } catch (error: unknown) {
      console.error('Credit payoff checkpoint failed', error);
      return c.json({ error: 'Splacení se podařilo spárovat, ale nový zůstatek kreditky se nepodařilo uložit.' }, 500);
    }

    void rebuildMonthlyNetWorth(new Date(Date.UTC(source.date.getUTCFullYear(), source.date.getUTCMonth(), 1)), new Date()).catch((error: unknown) =>
      console.error('Monthly net-worth rebuild failed after credit payoff', error),
    );

    return c.json({ ok: true });
  })
  .post('/credit-repayment', async (c) => {
    const parsed = z.object({ creditTransactionId: z.uuid(), sourceTransactionId: z.uuid() }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatné transakce' }, 400);
    const { creditTransactionId: creditId, sourceTransactionId: sourceId } = parsed.data;

    const rows = await prisma.transaction.findMany({
      where: { id: { in: [creditId, sourceId] }, transferId: null },
      select: { id: true, accountId: true, date: true, amountCzk: true, account: { select: { type: true } } },
    });
    if (rows.length !== 2) return c.json({ error: 'Pohyby už byly změněné nebo spárované.' }, 409);

    const credit = rows.find((row) => row.id === creditId);
    const source = rows.find((row) => row.id === sourceId);
    if (
      !credit ||
      !source ||
      credit.account.type !== 'CREDIT' ||
      !credit.amountCzk?.isPositive() ||
      !source.amountCzk?.isNegative() ||
      !source.amountCzk.abs().equals(credit.amountCzk.abs()) ||
      Math.abs(source.date.getTime() - credit.date.getTime()) > 3 * 86_400_000
    ) {
      return c.json({ error: 'Pohyby netvoří jednoznačné splacení kreditky.' }, 400);
    }

    const transferCategory = await prisma.category.findFirst({ where: { key: 'transfer', isActive: true }, select: { id: true } });
    await prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.create({ data: { legs: { connect: [{ id: creditId }, { id: sourceId }] } } });
      await tx.transaction.updateMany({ where: { id: { in: [creditId, sourceId] } }, data: { kind: 'INTERNAL_TRANSFER', transferId: transfer.id, categoryId: transferCategory?.id ?? null } });
    });

    return c.json({ ok: true });
  });
