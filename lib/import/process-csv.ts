import { createHash } from 'node:crypto';

import { PDFParse } from 'pdf-parse';

import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import type { Provider } from '@/lib/generated/prisma/enums';
import { buildAttributeSignature, buildIdempotencyKey, dedupStrategyFor, normalizeMerchant, type DedupStrategy } from '@/lib/finance/idempotency';
import { createFxRateResolver, FxRateError } from '@/lib/providers/fx/rate-lookup';
import { decodeCsv } from '@/lib/parsers/csv/decode';
import { classifyByMerchant, mapMonetaCategory } from '@/lib/parsers/csv/moneta-categories';
import { getCsvParser } from '@/lib/parsers/csv/registry';
import { CsvStructureError, type ParsedTransaction } from '@/lib/parsers/csv/types';
import { parseMonetaStatement, type StatementParseResult } from '@/lib/parsers/xml/moneta-statement';
import { parseMonetaCreditCardStatement, type CreditCardStatementParseResult } from '@/lib/parsers/pdf/moneta-credit-card-statement';
import { ensurePdfWorkerConfigured } from '@/lib/parsers/pdf/pdf-worker';

import { recordBalanceCheckpoint, type CheckpointResult } from './checkpoints';
import { buildOwnAccountIndex, isInternalTransfer, isTrading212Funding, normalizeAccountNumber } from './internal-transfers';
import { matchPendingTransfers } from './transfer-sync';
import { buildRecurringMerchantIndex } from './recurring-matching';
import { learnRecurringExpenseAliases } from './recurring-alias-worker';
import { rebuildMonthlyNetWorth } from '@/lib/finance/monthly-net-worth-service';

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ACCOUNT_NOT_FOUND'
      | 'ACCOUNT_MISMATCH'
      | 'ALREADY_IMPORTED'
      | 'UNSUPPORTED_PROVIDER'
      | 'BAD_FORMAT',
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportRowPreview {
  externalId: string | null;
  date: string;
  amount: string;
  currency: string;
  merchant: string | null;
  sourceCategory: string | null;
  mappedCategory: string | null;
  /** True when the counterparty is another of our own accounts. */
  internalTransfer: boolean;
  /** True when this row already exists in the database or twice in the file. */
  duplicate: boolean;
}

export interface StatementInfo {
  number: string;
  /** `null` on an account's first-ever statement — no prior coverage exists. */
  from: string | null;
  to: string;
  openingBalance: string;
  closingBalance: string;
  /** Problems the document found by checking itself. Empty means it adds up. */
  warnings: string[];
}

/** Where the account balance stands after this import, and what anchors it. */
export interface DerivedBalance {
  balance: string;
  /** Day of the anchor the figure is counted from. Null when there is none. */
  anchoredAt: string | null;
  anchorSource: 'STATEMENT' | 'MANUAL' | 'NONE';
  /**
   * True when no anchor exists, so the figure is only the sum of imported
   * movements — a lower bound rather than a balance.
   */
  incomplete: boolean;
}

export interface ImportSummary {
  batchId: string | null;
  /** Balance after the import. Derived, never typed in when an anchor exists. */
  derivedBalance: DerivedBalance | null;
  /**
   * True only when a movement export lands on an account with no anchor at all.
   * With an anchor the balance is derivable and asking for it would let a typo
   * override a fact.
   */
  needsAnchor: boolean;
  /** 'STATEMENT' carries balances and verifies itself; 'MOVEMENTS' does not. */
  kind: 'STATEMENT' | 'MOVEMENTS';
  statement: StatementInfo | null;
  provider: Provider;
  accountId: string;
  filename: string;
  dryRun: boolean;
  dedupStrategy: DedupStrategy;
  encoding: string;
  rowCount: number;
  inserted: number;
  /** Rows already present in the database, or repeated inside the file. */
  skipped: number;
  failed: number;
  periodFrom: string | null;
  periodTo: string | null;
  preview: ImportRowPreview[];
  failures: { rowNumber: number; reason: string }[];
  /** Result of the balance checkpoint recorded alongside this import, if any. */
  checkpoint: CheckpointResult | null;
}

const PREVIEW_LIMIT = 25;

export interface ProcessCsvOptions {
  bytes: Uint8Array;
  filename: string;
  accountId: string;
  /** When true nothing is written; the caller shows the summary for confirmation. */
  dryRun: boolean;
  /**
   * Balance read from the banking app at the end of the statement period.
   * Recorded after the rows land, so the reconciliation compares against a
   * ledger that already contains them.
   */
  closingBalance?: string | null;
}

export async function processCsvImport(options: ProcessCsvOptions): Promise<ImportSummary> {
  const account = await prisma.account.findUnique({ where: { id: options.accountId } });

  if (!account) {
    throw new ImportError('Vybraný účet neexistuje', 'ACCOUNT_NOT_FOUND');
  }

  const parser = (() => {
    try {
      return getCsvParser(account.provider);
    } catch {
      throw new ImportError(`Pro poskytovatele ${account.provider} není k dispozici parser`, 'UNSUPPORTED_PROVIDER');
    }
  })();

  const fileHash = createHash('sha256').update(options.bytes).digest('hex');

  // A byte-identical re-upload is answered before any parsing happens.
  const previousBatch = await prisma.importBatch.findUnique({ where: { fileHash } });

  if (previousBatch?.status === 'COMPLETED') {
    throw new ImportError(
      `Tento soubor už byl importován ${previousBatch.createdAt.toISOString().slice(0, 10)}`,
      'ALREADY_IMPORTED',
    );
  }

  // A PDF is a credit card statement — the only file type here that isn't
  // text, so it's checked by magic bytes before anything tries to decode it
  // as one.
  const isPdf = options.bytes.length >= 4 && new TextDecoder().decode(options.bytes.slice(0, 4)) === '%PDF';

  const creditCardResult: CreditCardStatementParseResult | null = isPdf
    ? await (async () => {
        ensurePdfWorkerConfigured();
        const pdf = new PDFParse({ data: Buffer.from(options.bytes) });

        try {
          const { text } = await pdf.getText();

          try {
            return parseMonetaCreditCardStatement(text);
          } catch (error: unknown) {
            const reason = error instanceof CsvStructureError ? error.message : 'Nečitelný výpis ke kreditní kartě (PDF)';

            throw new ImportError(reason, 'BAD_FORMAT');
          }
        } finally {
          await pdf.destroy();
        }
      })()
    : null;

  // A movement export never touches this branch; decoding a PDF's binary
  // bytes as text would just produce garbage, so this only runs otherwise.
  const decoded = isPdf ? null : decodeCsv(options.bytes);

  // A monthly statement is XML and carries balances; a movement export is CSV
  // and does not. The file decides, not the caller.
  const isStatement = decoded !== null && looksLikeStatement(options.filename, decoded.text);

  const statementResult: StatementParseResult | null = isStatement
    ? (() => {
        try {
          return parseMonetaStatement(decoded.text);
        } catch (error: unknown) {
          const reason = error instanceof CsvStructureError ? error.message : 'Nečitelný XML výpis';

          throw new ImportError(reason, 'BAD_FORMAT');
        }
      })()
    : null;

  const parsed = creditCardResult
    ? {
        provider: creditCardResult.provider,
        sourceAccountId: creditCardResult.sourceAccountId,
        sourceCardLast4: creditCardResult.sourceCardLast4,
        transactions: creditCardResult.transactions,
        failures: [],
      }
    : statementResult
      ? {
          provider: statementResult.provider,
          sourceAccountId: statementResult.sourceAccountId,
          sourceCardLast4: null,
          transactions: statementResult.transactions,
          failures: [],
        }
      : (() => {
          try {
            return parser(decoded!.text);
          } catch (error: unknown) {
            const reason = error instanceof CsvStructureError ? error.message : 'Nečitelný CSV soubor';

            throw new ImportError(reason, 'BAD_FORMAT');
          }
        })();

  // Both statement shapes (XML bank statement, PDF card statement) carry
  // balances and a period; a movement CSV carries neither. Everything below
  // that renders/persists "the statement" reads from this one place instead
  // of branching on which parser produced it.
  const anyStatementResult: { period: { number: string; from: string | null; to: string }; openingBalance: string; closingBalance: string; warnings: string[] } | null = statementResult
    ? statementResult
    : creditCardResult
      ? {
          period: { number: creditCardResult.number, from: creditCardResult.period.from, to: creditCardResult.period.to },
          openingBalance: creditCardResult.openingBalance,
          closingBalance: creditCardResult.closingBalance,
          warnings: creditCardResult.warnings,
        }
      : null;

  // The export names the account it belongs to; refuse to file July's Moneta
  // statement under the Revolut account. Normalisation is shared with internal
  // transfer detection: a CSV prints "204370628/0600", a statement "204370628".
  //
  // Skipped for CREDIT accounts: a card statement's sourceAccountId is the
  // card's contract number ("Variabilní symbol"), not an account number —
  // there is no field on the document in the same identifier space as
  // Account.externalId (which for a card is typically the payment account,
  // e.g. "301030/0600", something else entirely). Identity is already
  // verified below via cardLast4, which is the real binding for a card.
  if (account.type !== 'CREDIT' && parsed.sourceAccountId && account.externalId) {
    if (normalizeAccountNumber(parsed.sourceAccountId) !== normalizeAccountNumber(account.externalId)) {
      throw new ImportError(
        `Soubor patří k účtu ${parsed.sourceAccountId}, ale ${account.name} má číslo ${account.externalId}`,
        'ACCOUNT_MISMATCH',
      );
    }
  }
  if (parsed.sourceCardLast4) {
    if (account.type !== 'CREDIT') {
      throw new ImportError('Export historie karty lze importovat jen na kreditní účet', 'ACCOUNT_MISMATCH');
    }
    if (!account.cardLast4) {
      throw new ImportError('Před importem historie karty nastavte poslední čtyři číslice karty v nastavení účtu', 'ACCOUNT_MISMATCH');
    }
    if (account.cardLast4 !== parsed.sourceCardLast4) {
      throw new ImportError(
        `Export patří ke kartě končící ${parsed.sourceCardLast4}, ale ${account.name} končí ${account.cardLast4}`,
        'ACCOUNT_MISMATCH',
      );
    }
  }

  const keyed = parsed.transactions.map((transaction) => ({
    transaction,
    key: buildIdempotencyKey({
      provider: parsed.provider,
      externalId: transaction.externalId,
      accountId: account.id,
      date: transaction.date,
      amount: transaction.amount,
      currency: transaction.currency,
      merchant: transaction.merchant,
    }),
  }));

  const dedupStrategy: DedupStrategy = keyed.every(({ transaction }) =>
    dedupStrategyFor({
      provider: parsed.provider,
      externalId: transaction.externalId,
      accountId: account.id,
      date: transaction.date,
      amount: transaction.amount,
      currency: transaction.currency,
      merchant: transaction.merchant,
    }) === 'EXTERNAL_ID',
  )
    ? 'EXTERNAL_ID'
    : 'ATTRIBUTES';

  // One query for every key, rather than one query per row.
  const existing = await prisma.transaction.findMany({
    where: { idempotencyKey: { in: keyed.map(({ key }) => key) } },
    select: { idempotencyKey: true },
  });
  const existingKeys = new Set(existing.map((row) => row.idempotencyKey));

  // Cross-format safety net: a row with no source reference only ever
  // hashes via ATTRIBUTES, which the exact-key check above can't match
  // against a same real transaction that an *earlier* import keyed via
  // EXTERNAL_ID instead (e.g. a credit-card CSV export with a reference,
  // re-imported later from that card's PDF statement, which never has one
  // at all). Only fetched/compared when this file actually has a
  // reference-less row — most imports never need it.
  const hasReferenceLessRow = keyed.some(({ transaction }) => !transaction.externalId?.trim());
  const existingSignatures = hasReferenceLessRow
    ? new Set(
        (
          await prisma.transaction.findMany({
            where: { accountId: account.id },
            select: { date: true, amount: true, currency: true, merchant: true },
          })
        ).map((row) => buildAttributeSignature({ date: row.date, amount: row.amount.toString(), currency: row.currency, merchant: row.merchant })),
      )
    : null;

  const seenInFile = new Set<string>();
  const fresh: { transaction: ParsedTransaction; key: string }[] = [];
  let skipped = 0;

  for (const entry of keyed) {
    const isCrossFormatDuplicate =
      !entry.transaction.externalId?.trim() &&
      existingSignatures?.has(
        buildAttributeSignature({
          date: entry.transaction.date,
          amount: entry.transaction.amount,
          currency: entry.transaction.currency,
          merchant: entry.transaction.merchant,
        }),
      );

    if (existingKeys.has(entry.key) || seenInFile.has(entry.key) || isCrossFormatDuplicate) {
      skipped += 1;
      continue;
    }

    seenInFile.add(entry.key);
    fresh.push(entry);
  }

  const categoryIds = await resolveCategoryIds(parsed.transactions);
  const incomeSourceRules = await prisma.incomeSourceRule.findMany({
    where: { isActive: true, OR: [{ accountId: null }, { accountId: account.id }] },
    select: { merchantKey: true, accountId: true },
  });
  const incomeMerchantKeys = new Set(
    incomeSourceRules
      .filter((rule) => rule.accountId === null || rule.accountId === account.id)
      .map((rule) => rule.merchantKey),
  );
  const recurringEvidence = await prisma.transaction.findMany({
    where: {
      accountId: account.id,
      kind: 'NORMAL',
      amount: { lt: 0 },
      parentId: null,
      recurringExpenseId: { not: null },
      recurringExpense: { isActive: true, OR: [{ paymentAccountId: null }, { paymentAccountId: account.id }] },
    },
    select: { merchant: true, recurringExpenseId: true },
  });
  const recurringAliases = await prisma.recurringExpenseAlias.findMany({
    where: { accountId: account.id, recurringExpense: { isActive: true } },
    select: { merchantKey: true, recurringExpenseId: true, recurringExpense: { select: { categoryId: true } } },
  });
  const recurringMerchantIndex = buildRecurringMerchantIndex(recurringEvidence);
  const recurringCategoryByExpense = new Map<string, string | null>();
  for (const alias of recurringAliases) {
    recurringMerchantIndex.set(alias.merchantKey, alias.recurringExpenseId);
    recurringCategoryByExpense.set(alias.recurringExpenseId, alias.recurringExpense.categoryId);
  }

  // Transfers between two of our own accounts are flagged here rather than left
  // for the user: both legs would otherwise inflate income and spending.
  const otherAccounts = await prisma.account.findMany({
    where: { id: { not: account.id } },
    select: { externalId: true },
  });
  const ownAccountIndex = buildOwnAccountIndex(otherAccounts);

  const dates = parsed.transactions.map((transaction) => transaction.date.getTime());
  const periodFrom = dates.length > 0 ? new Date(Math.min(...dates)) : null;
  const periodTo = dates.length > 0 ? new Date(Math.max(...dates)) : null;

  const preview: ImportRowPreview[] = keyed.slice(0, PREVIEW_LIMIT).map(({ transaction, key }) => ({
    externalId: transaction.externalId,
    date: transaction.date.toISOString().slice(0, 10),
    amount: transaction.amount,
    currency: transaction.currency,
    merchant: transaction.merchant,
    sourceCategory: transaction.sourceCategory,
    mappedCategory: resolveTransactionCategory(transaction),
    internalTransfer: isInternalTransfer(transaction.counterAccount, ownAccountIndex),
    duplicate: existingKeys.has(key),
  }));

  const summary: ImportSummary = {
    batchId: null,
    provider: parsed.provider,
    accountId: account.id,
    filename: options.filename,
    dryRun: options.dryRun,
    dedupStrategy,
    encoding: decoded?.encoding ?? 'pdf',
    rowCount: parsed.transactions.length + parsed.failures.length,
    inserted: fresh.length,
    skipped,
    failed: parsed.failures.length,
    periodFrom: periodFrom?.toISOString().slice(0, 10) ?? null,
    periodTo: periodTo?.toISOString().slice(0, 10) ?? null,
    preview,
    failures: parsed.failures.map((failure) => ({ rowNumber: failure.rowNumber, reason: failure.reason })),
    checkpoint: null,
    derivedBalance: null,
    // CREDIT accounts never ask here: they have their own dedicated anchor
    // tools ("Splatit dluh", "Potvrdit nulový start" on /accounts) that
    // already enforce the correct debt-is-negative sign convention. This
    // generic prompt takes whatever a person types verbatim with no sign
    // handling — real production data once had a genuine card debt overwritten
    // by a positive "available credit" figure typed in here by mistake.
    needsAnchor:
      account.type !== 'CREDIT' &&
      anyStatementResult === null &&
      (await prisma.accountSnapshot.count({ where: { accountId: account.id } })) === 0,
    kind: anyStatementResult ? ('STATEMENT' as const) : ('MOVEMENTS' as const),
    statement: anyStatementResult
      ? {
          number: anyStatementResult.period.number,
          from: anyStatementResult.period.from,
          to: anyStatementResult.period.to,
          openingBalance: anyStatementResult.openingBalance,
          closingBalance: anyStatementResult.closingBalance,
          warnings: anyStatementResult.warnings,
        }
      : null,
  };

  if (options.dryRun) {
    return summary;
  }

  // Foreign-currency rows need a real CZK equivalent, or every cash-flow
  // aggregate silently drops them (a null amountCzk is excluded, not zero).
  // Resolved outside the DB transaction, cached per (date, currency) so a
  // statement with many same-day foreign rows makes one HTTP call, not one
  // per row. A lookup failure never blocks the import or the row itself —
  // it falls back to today's amountCzk: null (same as before this existed),
  // but leaves a visible IngestionEvent instead of failing silently.
  const resolveFxRate = createFxRateResolver();
  const fxByKey = new Map<string, { amountCzk: Prisma.Decimal; fxRate: Prisma.Decimal }>();
  const fxFailures: { key: string; transaction: ParsedTransaction; reason: string }[] = [];

  await Promise.all(
    fresh
      .filter(({ transaction }) => transaction.currency !== 'CZK')
      .map(async ({ transaction, key }) => {
        try {
          const fxRate = await resolveFxRate(transaction.date, transaction.currency, 'CZK');
          fxByKey.set(key, { amountCzk: new Prisma.Decimal(transaction.amount).times(fxRate), fxRate });
        } catch (error: unknown) {
          const reason = error instanceof FxRateError ? error.message : 'FX rate lookup failed';
          fxFailures.push({ key, transaction, reason });
        }
      }),
  );

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.importBatch.upsert({
      where: { fileHash },
      update: { status: 'PENDING', filename: options.filename },
      create: {
        provider: parsed.provider,
        accountId: account.id,
        filename: options.filename,
        fileHash,
        status: 'PENDING',
        statementNumber: anyStatementResult?.period.number ?? null,
        // Only a statement declares what it covers; a movement export does not.
        // `null` on a movement export, and also on an account's first-ever
        // statement — there is no prior coverage to declare either way.
        coverageFrom: anyStatementResult?.period.from ? new Date(`${anyStatementResult.period.from}T00:00:00.000Z`) : null,
        coverageTo: anyStatementResult ? new Date(`${anyStatementResult.period.to}T00:00:00.000Z`) : null,
      },
    });

    if (fresh.length > 0) {
      // skipDuplicates plus the unique index on idempotencyKey makes a repeated
      // import a no-op, even if two uploads race each other.
      await tx.transaction.createMany({
        skipDuplicates: true,
        data: fresh.map(({ transaction, key }) => {
          const internalTransfer =
            isInternalTransfer(transaction.counterAccount, ownAccountIndex) ||
            isTrading212Funding(transaction.merchant, transaction.description, transaction.amount);
          const recurringExpenseId = !internalTransfer && new Prisma.Decimal(transaction.amount).isNegative()
            ? (recurringMerchantIndex.get(normalizeMerchant(transaction.merchant)) ?? null)
            : null;

          return {
          idempotencyKey: key,
          externalId: transaction.externalId,
          source: 'CSV_IMPORT' as const,
          kind: internalTransfer ? ('PENDING_TRANSFER' as const) : ('NORMAL' as const),
          importBatchId: created.id,
          accountId: account.id,
          recurringExpenseId,
          categoryId: internalTransfer
            ? (categoryIds.get('transfer') ?? null)
            : new Prisma.Decimal(transaction.amount).isPositive() && incomeMerchantKeys.has(normalizeMerchant(transaction.merchant))
              ? (categoryIds.get('income') ?? null)
              : recurringExpenseId
                ? (recurringCategoryByExpense.get(recurringExpenseId) ?? null)
              : (categoryIds.get(resolveTransactionCategory(transaction) ?? '') ?? null),
          date: transaction.date,
          amount: new Prisma.Decimal(transaction.amount),
          currency: transaction.currency,
          amountCzk: transaction.currency === 'CZK' ? new Prisma.Decimal(transaction.amount) : (fxByKey.get(key)?.amountCzk ?? null),
          fxRate: transaction.currency === 'CZK' ? null : (fxByKey.get(key)?.fxRate ?? null),
          merchant: transaction.merchant,
          description: transaction.description,
          rawData: transaction.raw,
          };
        }),
      });
    }

    // Only failures are logged row by row. Successful and skipped rows are
    // counted on the batch: a per-row audit of a full statement would bury the
    // rows that actually need looking at.
    if (parsed.failures.length > 0) {
      await tx.ingestionEvent.createMany({
        data: parsed.failures.map((failure) => ({
          provider: parsed.provider,
          status: 'FAILED' as const,
          importBatchId: created.id,
          rowNumber: failure.rowNumber,
          rawPayload: failure.raw,
          errorMessage: failure.reason,
        })),
      });
    }

    // The transaction itself still gets inserted (amountCzk stays null, the
    // same fallback as before FX lookup existed) — a rate-lookup hiccup must
    // never lose the row, only be visible instead of silent.
    if (fxFailures.length > 0) {
      await tx.ingestionEvent.createMany({
        data: fxFailures.map((failure) => ({
          provider: parsed.provider,
          status: 'FAILED' as const,
          importBatchId: created.id,
          idempotencyKey: failure.key,
          rawPayload: failure.transaction.raw,
          errorMessage: `Přepočet do CZK selhal: ${failure.reason}`,
        })),
      });
    }

    return tx.importBatch.update({
      where: { id: created.id },
      data: {
        status: 'COMPLETED',
        rowCount: summary.rowCount,
        insertedCount: fresh.length,
        skippedCount: skipped,
        failedCount: parsed.failures.length,
        periodFrom,
        periodTo,
        completedAt: new Date(),
      },
    });
  });

  // Recorded last, so it reconciles against a ledger that already holds this
  // import's rows. A statement supplies the balance itself; only a movement
  // export needs the figure typed in.
  //
  // A statement that failed its own self-check is not trusted as an anchor: a
  // wrong balance is worse than none, because everything after it inherits the
  // error silently.
  const anchor = anyStatementResult
    ? anyStatementResult.warnings.length === 0
      ? { day: anyStatementResult.period.to, balance: anyStatementResult.closingBalance }
      : null
    // Same reasoning as needsAnchor above: a CREDIT account's manual anchor
    // must go through the dedicated debt-entry tools, which enforce the
    // negative-is-debt sign convention. A typed-in movement-CSV closingBalance
    // never does, and it takes only one honest mistake to overwrite a real
    // debt with a positive "available credit" figure.
    : options.closingBalance && periodTo && account.type !== 'CREDIT'
      ? { day: periodTo.toISOString().slice(0, 10), balance: options.closingBalance }
      : null;

  const checkpoint = anchor
      ? await recordBalanceCheckpoint({
        accountId: account.id,
        day: anchor.day,
        balance: anchor.balance,
        note: `Import ${options.filename}`,
        source: anyStatementResult ? 'STATEMENT' : 'MANUAL',
        importBatchId: anyStatementResult ? batch.id : null,
      })
    : null;

  // Best-effort: a matcher bug must never fail an otherwise-successful import.
  // The rows it would have linked stay flagged INTERNAL_TRANSFER and simply
  // wait for the next run (another import, a manual re-classification, or the
  // "Spárovat převody" button).
  try {
    await matchPendingTransfers();
  } catch (error: unknown) {
    console.error('Transfer matching failed after import', error);
  }
  try {
    await learnRecurringExpenseAliases();
  } catch (error: unknown) {
    console.error('Recurring alias learning failed after import', error);
  }
  if (statementResult) {
    try {
      // First-ever statement has no `from` to rebuild back to; its own
      // period's month is the earliest month this import could have touched.
      const rebuildFromMonth = (statementResult.period.from ?? statementResult.period.to).slice(0, 7);

      await rebuildMonthlyNetWorth(new Date(`${rebuildFromMonth}-01T00:00:00.000Z`), new Date());
    } catch (error: unknown) {
      console.error('Monthly net-worth rebuild failed after statement import', error);
    }
  }

  return { ...summary, batchId: batch.id, checkpoint, derivedBalance: await deriveBalance(account.id) };
}

/** Maps stable Orbit category keys to ids, for the bank categories present in the file. */
async function resolveCategoryIds(transactions: readonly ParsedTransaction[]): Promise<Map<string, string>> {
  const names = new Set<string>();
  names.add('transfer');
  names.add('income');

  for (const transaction of transactions) {
    const mapped = resolveTransactionCategory(transaction);

    if (mapped) {
      names.add(mapped);
    }
  }

  if (names.size === 0) {
    return new Map();
  }

  const categories = await prisma.category.findMany({
    where: { key: { in: [...names] }, isActive: true },
    select: { id: true, key: true },
  });

  return new Map(categories.map((category) => [category.key, category.id]));
}

/**
 * Resolves an Orbit category for a parsed row: the bank's own category first,
 * falling back to the merchant/description text when the bank supplies none
 * at all (Moneta never categorises savings-account interest, for example).
 */
function resolveTransactionCategory(transaction: ParsedTransaction): string | null {
  return mapMonetaCategory(transaction.sourceCategory) ?? classifyByMerchant(transaction.merchant, transaction.description);
}

/** XML statements are recognised by their root element, not only by extension. */
function looksLikeStatement(filename: string, text: string): boolean {
  return filename.toLowerCase().endsWith('.xml') || /<statement[\s>]/.test(text.slice(0, 2000));
}

/**
 * Current balance of an account, counted from its newest anchor.
 *
 * Mid-month there is nothing to type in: the last statement fixed the balance,
 * and the movements since are exactly what the CSV just added. Asking for a
 * number that the ledger already knows would invite a typo to override a fact.
 */
async function deriveBalance(accountId: string): Promise<DerivedBalance> {
  const [account, anchor, transactions] = await Promise.all([
    prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { currency: true } }),
    prisma.accountSnapshot.findFirst({
      where: { accountId },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true, balanceCzk: true, balance: true, source: true, note: true },
    }),
    prisma.transaction.findMany({ where: { accountId, kind: { not: 'SPLIT_PARENT' } }, select: { date: true, amount: true, amountCzk: true } }),
  ]);

  const anchorAt = anchor?.capturedAt ?? null;
  const start = anchor
    ? account.currency === 'CZK'
      ? (anchor.balanceCzk ?? anchor.balance)
      : anchor.balance
    : new Prisma.Decimal(0);

  const balance = transactions
    .filter((transaction) => anchorAt === null || transaction.date.getTime() > anchorAt.getTime())
    .reduce(
      (sum, transaction) =>
        sum.plus(account.currency === 'CZK' ? (transaction.amountCzk ?? transaction.amount) : transaction.amount),
      start,
    );

  return {
    balance: balance.toFixed(2),
    anchoredAt: anchorAt?.toISOString().slice(0, 10) ?? null,
    anchorSource: !anchor ? 'NONE' : anchor.source === 'STATEMENT' ? 'STATEMENT' : 'MANUAL',
    incomplete: anchor === null,
  };
}
