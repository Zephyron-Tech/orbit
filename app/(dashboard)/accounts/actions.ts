'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { rebuildMonthlyNetWorth } from '@/lib/finance/monthly-net-worth-service';
import { recordBalanceCheckpoint } from '@/lib/import/checkpoints';
import { reorderRows } from '@/lib/db/reorder';

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

const accountSchema = z.object({
  name: z.string().trim().min(1, 'Zadejte název').max(120),
  type: z.enum(ACCOUNT_TYPES),
  provider: z.enum(PROVIDERS),
  /**
   * Account number exactly as the CSV export prints it ("204370628/0600").
   * An import is refused when this does not match the file, so a July statement
   * cannot be filed under the savings account by accident.
   */
  externalId: z
    .string()
    .trim()
    .max(64)
    .transform((value) => value || null)
    .nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Měna musí být tříznakový kód'),
  includeInNetWorth: z.boolean(),
  creditLimit: decimalString.nullable(),
  cardLast4: z.string().trim().regex(/^\d{4}$/, 'Zadejte poslední 4 číslice karty').nullable(),
  emergencyReserveMonths: z.number().int().positive('Zadejte kladný počet měsíců').nullable(),
  annualInterestRate: percentageString.nullable(),
  interestTaxRate: percentageString
    .nullable()
    .refine((value) => value === null || new Prisma.Decimal(value).lessThanOrEqualTo(100), 'Daň musí být nejvýše 100 %'),
}).superRefine((value, context) => {
  if (value.type !== 'CREDIT' && (value.creditLimit !== null || value.cardLast4 !== null)) {
    context.addIssue({
      code: 'custom',
      message: 'Limit a poslední 4 číslice lze zadat jen pro kreditní účet',
      path: ['creditLimit'],
    });
  }

  if (
    value.type !== 'SAVINGS' &&
    (value.emergencyReserveMonths !== null || value.annualInterestRate !== null || value.interestTaxRate !== null)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Rezervu a úročení lze nastavit jen pro spořicí účet',
      path: ['emergencyReserveMonths'],
    });
  }

  if (value.type === 'CREDIT' && value.externalId && /^\d(?:[ -]?\d){12,18}$/.test(value.externalId)) {
    context.addIssue({
      code: 'custom',
      message: 'Nikdy nezadávejte celé číslo karty',
      path: ['externalId'],
    });
  }
});

export type AccountInput = z.infer<typeof accountSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Neplatná data';
}

/** Prisma's unique-constraint error, so a duplicate reads as a message, not a crash. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function revalidateAccountViews(): void {
  revalidatePath('/accounts');
  revalidatePath('/net-worth');
  revalidatePath('/dashboard');
}

function accountData(input: AccountInput) {
  return {
    ...input,
    annualInterestRate: input.annualInterestRate === null ? null : new Prisma.Decimal(input.annualInterestRate).dividedBy(100),
    interestTaxRate: input.interestTaxRate === null ? null : new Prisma.Decimal(input.interestTaxRate).dividedBy(100),
  };
}

export async function createAccount(input: AccountInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = accountSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }

  try {
    await prisma.account.create({ data: accountData(parsed.data) });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: 'Účet s tímto číslem už u tohoto poskytovatele existuje' };
    }

    console.error('Account creation failed', error);

    return { ok: false, error: 'Účet se nepodařilo vytvořit' };
  }

  revalidateAccountViews();
  revalidatePath('/import');

  return { ok: true };
}

export async function updateAccount(id: string, input: AccountInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);
  const parsed = accountSchema.safeParse(input);

  if (!parsedId.success || !parsed.success) {
    return { ok: false, error: parsed.success ? 'Neplatný účet' : firstIssue(parsed.error) };
  }

  const dependentPlans = await prisma.recurringInvestmentPlan.count({ where: { isActive: true, OR: [{ sourceAccountId: parsedId.data }, { brokerAccountId: parsedId.data }] } });
  if (dependentPlans > 0) {
    const stillValidBroker = parsed.data.type === 'INVESTMENT' && parsed.data.provider === 'TRADING212';
    const stillValidSource = parsed.data.type !== 'INVESTMENT';
    const [brokerPlans, sourcePlans] = await Promise.all([
      prisma.recurringInvestmentPlan.count({ where: { isActive: true, brokerAccountId: parsedId.data } }),
      prisma.recurringInvestmentPlan.count({ where: { isActive: true, sourceAccountId: parsedId.data } }),
    ]);
    if ((brokerPlans > 0 && !stillValidBroker) || (sourcePlans > 0 && !stillValidSource)) {
      return { ok: false, error: 'Účet používá aktivní DCA plán. Nejdřív plán upravte nebo deaktivujte.' };
    }
  }

  try {
    await prisma.account.update({ where: { id: parsedId.data }, data: accountData(parsed.data) });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: 'Účet s tímto číslem už u tohoto poskytovatele existuje' };
    }

    console.error('Account update failed', error);

    return { ok: false, error: 'Účet se nepodařilo uložit' };
  }

  revalidateAccountViews();
  revalidatePath('/import');

  return { ok: true };
}

/** Hides an account without touching its transactions. Reversible. */
export async function setAccountArchived(id: string, isArchived: boolean): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatný účet' };
  }

  if (isArchived) {
    const dcaPlans = await prisma.recurringInvestmentPlan.count({ where: { isActive: true, OR: [{ sourceAccountId: parsedId.data }, { brokerAccountId: parsedId.data }] } });
    if (dcaPlans > 0) return { ok: false, error: `Účet používá ${dcaPlans} aktivních DCA plánů. Nejdřív je upravte nebo deaktivujte.` };
  }

  await prisma.account.update({ where: { id: parsedId.data }, data: { isArchived } });

  revalidateAccountViews();
  revalidatePath('/import');

  return { ok: true };
}

/**
 * Deletes an account, but only while it holds nothing. Cascading a delete into
 * a year of imported transactions is not something a stray click should do;
 * archiving is the way to retire an account that has history.
 */
export async function deleteAccount(id: string): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatný účet' };
  }

  const [transactions, dcaPlans] = await Promise.all([
    prisma.transaction.count({ where: { accountId: parsedId.data } }),
    prisma.recurringInvestmentPlan.count({ where: { OR: [{ sourceAccountId: parsedId.data }, { brokerAccountId: parsedId.data }] } }),
  ]);

  if (transactions > 0) {
    return {
      ok: false,
      error: `Účet má ${transactions} transakcí. Místo smazání ho archivujte.`,
    };
  }
  if (dcaPlans > 0) return { ok: false, error: `Účet používá ${dcaPlans} DCA plánů. Nejdřív je upravte nebo deaktivujte.` };

  await prisma.account.delete({ where: { id: parsedId.data } });

  revalidateAccountViews();
  revalidatePath('/import');

  return { ok: true };
}

const creditDebtSchema = z.object({
  accountId: z.uuid(),
  debt: decimalString.refine((value) => new Prisma.Decimal(value).greaterThan(0), 'Dluh musí být kladný'),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Zadejte platné datum'),
});

export type CreditDebtInput = z.infer<typeof creditDebtSchema>;

/** Records a credit-card liability as a negative, reconcilable account balance. */
export async function recordCreditDebt(input: CreditDebtInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = creditDebtSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }

  const date = new Date(`${parsed.data.asOf}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed.data.asOf) {
    return { ok: false, error: 'Zadejte platné datum' };
  }

  const account = await prisma.account.findUnique({
    where: { id: parsed.data.accountId },
    select: { type: true, currency: true },
  });

  if (account?.type !== 'CREDIT') {
    return { ok: false, error: 'Dluh lze zadat pouze pro kreditní účet' };
  }
  if (account.currency !== 'CZK') return { ok: false, error: 'Ruční dluh kreditky zatím podporuje pouze CZK.' };

  try {
    await recordBalanceCheckpoint({
      accountId: parsed.data.accountId,
      day: parsed.data.asOf,
      balance: new Prisma.Decimal(parsed.data.debt).negated().toString(),
    });
  } catch (error: unknown) {
    console.error('Credit debt checkpoint failed', error);
    return { ok: false, error: 'Dluh se nepodařilo uložit' };
  }

  revalidateAccountViews();
  void rebuildMonthlyNetWorth(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)), new Date()).catch((error: unknown) => console.error('Monthly net-worth rebuild failed after credit debt', error));

  return { ok: true };
}

/** Confirms that the card had no debt immediately before its first imported movement. */
export async function confirmCreditZeroStart(accountId: string): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(accountId);
  if (!parsedId.success) return { ok: false, error: 'Neplatný účet' };
  const account = await prisma.account.findUnique({ where: { id: parsedId.data }, select: { type: true, currency: true } });
  if (account?.type !== 'CREDIT' || account.currency !== 'CZK') {
    return { ok: false, error: 'Nulový počáteční stav lze potvrdit pouze pro CZK kreditní účet.' };
  }
  const [existing, firstTransaction] = await Promise.all([
    prisma.accountSnapshot.findFirst({ where: { accountId: parsedId.data, balance: { lte: 0 } }, select: { id: true } }),
    prisma.transaction.findFirst({ where: { accountId: parsedId.data }, orderBy: { date: 'asc' }, select: { date: true } }),
  ]);
  if (existing) return { ok: false, error: 'Kreditní účet už má potvrzený počáteční stav.' };
  if (!firstTransaction) return { ok: false, error: 'Nejdřív importujte alespoň jednu karetní platbu.' };

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
    return { ok: false, error: 'Nulový počáteční stav se nepodařilo uložit.' };
  }
  revalidateAccountViews();
  return { ok: true };
}

/** Removes a manually entered positive card availability figure, never a debt checkpoint. */
export async function clearCreditCapacitySnapshot(accountId: string): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsedId = z.uuid().safeParse(accountId);
  if (!parsedId.success) return { ok: false, error: 'Neplatný účet' };
  const snapshot = await prisma.accountSnapshot.findFirst({
    where: { accountId: parsedId.data, source: 'MANUAL', balance: { gt: 0 } },
    orderBy: { capturedAt: 'desc' },
    select: { id: true, capturedAt: true, account: { select: { type: true } } },
  });
  if (!snapshot || snapshot.account.type !== 'CREDIT') {
    // The correction may already have succeeded in another tab or after a
    // refresh. It is safe and less confusing to make removal idempotent.
    revalidateAccountViews();
    return { ok: true };
  }
  await prisma.accountSnapshot.delete({ where: { id: snapshot.id } });
  revalidateAccountViews();
  void rebuildMonthlyNetWorth(new Date(Date.UTC(snapshot.capturedAt.getUTCFullYear(), snapshot.capturedAt.getUTCMonth(), 1)), new Date()).catch((error: unknown) => console.error('Monthly net-worth rebuild failed after credit correction', error));
  return { ok: true };
}

/** Swaps an account's display position with its neighbor, among non-archived accounts. */
export async function reorderAccount(id: string, direction: -1 | 1): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatný účet' };
  }

  const result = await reorderRows(
    parsedId.data,
    direction,
    (tx) => tx.account.findMany({ where: { isArchived: false }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true } }),
    (tx, accountId, position) => tx.account.update({ where: { id: accountId }, data: { sortOrder: position } }),
  );

  if (!result.ok) {
    return { ok: false, error: result.error === 'CONFLICT' ? 'Někdo jiný právě měnil pořadí, zkuste to znovu.' : 'Neplatný účet' };
  }

  revalidateAccountViews();

  return { ok: true };
}

export interface CreditRepaymentCandidate {
  /** Null when there is no transaction on the credit account to pair with — see `creditAccountId` instead. */
  creditTransactionId: string | null;
  sourceTransactionId: string;
  amount: string;
  date: string;
  sourceAccountName: string;
  /** How this candidate was matched. */
  matchedBy: 'AMOUNT_DATE' | 'VARIABLE_SYMBOL';
  /** Only set for a VARIABLE_SYMBOL match — which credit account to check off. */
  creditAccountId?: string;
  creditAccountName?: string;
}

/** The raw CSV row's own key for "Variabilní Symbol" — see lib/parsers/csv/moneta.ts's COLUMNS map. */
const VARIABLE_SYMBOL_KEY = 'Variabilní Symbol';

function readVariableSymbol(rawData: Prisma.JsonValue | null): string | null {
  if (rawData === null || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return null;
  }

  const value = (rawData as Record<string, unknown>)[VARIABLE_SYMBOL_KEY];

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function findCreditRepaymentCandidates(): Promise<CreditRepaymentCandidate[]> {
  if (!(await getActiveUser())) return [];
  // PENDING_TRANSFER included alongside NORMAL: a card payment's counterparty
  // account (Moneta's shared card-clearing account) can coincidentally equal
  // another account's own Account.externalId, which the generic import-time
  // internal-transfer guess (lib/import/internal-transfers.ts) then flags as
  // PENDING_TRANSFER — a one-sided guess with no second leg to match, since
  // the credit account has no transaction of its own without a card
  // statement. Excluding PENDING_TRANSFER here would make that row invisible
  // to this matcher forever, stuck.
  const rows = await prisma.transaction.findMany({
    where: { transferId: null, kind: { in: ['NORMAL', 'PENDING_TRANSFER'] }, amountCzk: { not: null } },
    select: { id: true, accountId: true, date: true, amountCzk: true, rawData: true, kind: true, account: { select: { name: true, type: true } } },
  });
  const candidates: CreditRepaymentCandidate[] = [];
  const matchedSourceIds = new Set<string>();
  // Amount/date matching stays NORMAL-only on both sides: unlike the
  // Variabilní Symbol match below, it has no independent bank-assigned
  // reference to fall back on, so it should not widen to a guessed kind too.
  const creditRows = rows.filter(
    (row): row is typeof row & { amountCzk: Prisma.Decimal } =>
      row.kind === 'NORMAL' && row.account.type === 'CREDIT' && row.amountCzk !== null && row.amountCzk.isPositive(),
  );

  for (const credit of creditRows) {
    const sourceMatches = rows.filter((source) =>
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

  // Second detection: a checking-side payoff with no card statement imported
  // yet, so there is no transaction on the credit account to pair against.
  // Matched instead on Variabilní Symbol, which Moneta sets to the card's own
  // contract number on a card payment — the same value stored as the credit
  // account's Account.externalId (see lib/parsers/pdf/moneta-credit-card-statement.ts).
  // A bank-assigned reference, not a guess, same trust level as Bankovní
  // reference elsewhere in this codebase. Requires an existing checkpoint on
  // the credit account — with none at all, adding the payment to an assumed
  // zero would itself be a guess; `confirmCreditZeroStart` is the intended
  // way to establish that baseline first.
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
    if (!anchoredCreditAccountIds.has(creditAccount.id) || !creditAccount.externalId) {
      continue;
    }

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

  return candidates;
}

export async function confirmCreditPayoffFromChecking(sourceTransactionId: string, creditAccountId: string): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsed = z.tuple([z.uuid(), z.uuid()]).safeParse([sourceTransactionId, creditAccountId]);
  if (!parsed.success) return { ok: false, error: 'Neplatné transakce' };
  const [sourceId, creditId] = parsed.data;

  const [source, creditAccount] = await Promise.all([
    prisma.transaction.findUnique({
      where: { id: sourceId },
      select: { id: true, date: true, amountCzk: true, transferId: true, rawData: true, account: { select: { type: true } } },
    }),
    prisma.account.findUnique({ where: { id: creditId }, select: { type: true, currency: true, externalId: true } }),
  ]);

  // Re-verified server-side rather than trusting the client-supplied pairing —
  // same discipline as confirmCreditRepayment.
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
    return { ok: false, error: 'Platba neodpovídá variabilnímu symbolu kreditky.' };
  }

  const latestSnapshot = await prisma.accountSnapshot.findFirst({
    where: { accountId: creditId },
    orderBy: { capturedAt: 'desc' },
    select: { balance: true },
  });

  if (!latestSnapshot) {
    return { ok: false, error: 'Kreditka nemá žádný počáteční stav — nejdřív potvrďte nulový start nebo zadejte dluh ručně.' };
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
    return { ok: false, error: 'Splacení se podařilo spárovat, ale nový zůstatek kreditky se nepodařilo uložit.' };
  }

  revalidateAccountViews();
  revalidatePath('/transactions');
  void rebuildMonthlyNetWorth(new Date(Date.UTC(source.date.getUTCFullYear(), source.date.getUTCMonth(), 1)), new Date()).catch((error: unknown) =>
    console.error('Monthly net-worth rebuild failed after credit payoff', error),
  );

  return { ok: true };
}

export async function confirmCreditRepayment(creditTransactionId: string, sourceTransactionId: string): Promise<ActionResult> {
  if (!(await getActiveUser())) return { ok: false, error: 'Přihlaste se prosím' };
  const parsed = z.tuple([z.uuid(), z.uuid()]).safeParse([creditTransactionId, sourceTransactionId]);
  if (!parsed.success) return { ok: false, error: 'Neplatné transakce' };
  const [creditId, sourceId] = parsed.data;
  const rows = await prisma.transaction.findMany({
    where: { id: { in: [creditId, sourceId] }, transferId: null },
    select: { id: true, accountId: true, date: true, amountCzk: true, account: { select: { type: true } } },
  });
  if (rows.length !== 2) return { ok: false, error: 'Pohyby už byly změněné nebo spárované.' };
  const credit = rows.find((row) => row.id === creditId);
  const source = rows.find((row) => row.id === sourceId);
  if (!credit || !source || credit.account.type !== 'CREDIT' || !credit.amountCzk?.isPositive() || !source.amountCzk?.isNegative() || !source.amountCzk.abs().equals(credit.amountCzk.abs()) || Math.abs(source.date.getTime() - credit.date.getTime()) > 3 * 86_400_000) {
    return { ok: false, error: 'Pohyby netvoří jednoznačné splacení kreditky.' };
  }
  const transferCategory = await prisma.category.findFirst({ where: { key: 'transfer', isActive: true }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.create({ data: { legs: { connect: [{ id: creditId }, { id: sourceId }] } } });
    await tx.transaction.updateMany({ where: { id: { in: [creditId, sourceId] } }, data: { kind: 'INTERNAL_TRANSFER', transferId: transfer.id, categoryId: transferCategory?.id ?? null } });
  });
  revalidateAccountViews();
  revalidatePath('/transactions');
  return { ok: true };
}
