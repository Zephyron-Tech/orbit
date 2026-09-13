import { createHash } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { buildIdempotencyKey } from '@/lib/finance/idempotency';
import { createFxRateResolver, FxRateError } from '@/lib/providers/fx/rate-lookup';
import type { ParsedTransaction } from '@/lib/parsers/csv/types';

import { recordBalanceCheckpoint, type CheckpointResult } from './checkpoints';
import { buildOwnAccountIndex, isInternalTransfer, isTrading212Funding } from './internal-transfers';
import { resolveCategoryIds, resolveTransactionCategory } from './process-csv';

/**
 * Writes transactions scraped live from Moneta's internet banking (the
 * mac-automation bot) straight into the ledger — no file, no CSV/XML/PDF
 * parsing. Every row already carries the bank's own real transaction
 * reference, so this always dedups via the EXTERNAL_ID strategy, the safest
 * case `buildIdempotencyKey` supports (unlike a credit-card PDF, which has
 * no reference at all).
 *
 * Deliberately reuses `resolveTransactionCategory`/`resolveCategoryIds`
 * (exported from `process-csv.ts` for exactly this) and the internal-transfer
 * heuristics, so a live-synced row is categorized and transfer-detected
 * identically to one that arrived via CSV — one implementation, not two that
 * could drift apart.
 */

export class MonetaSyncError extends Error {
  constructor(
    message: string,
    readonly code: 'ACCOUNT_NOT_FOUND' | 'UNSUPPORTED_PROVIDER' | 'ALREADY_IMPORTED' | 'BAD_FORMAT',
  ) {
    super(message);
    this.name = 'MonetaSyncError';
  }
}

export interface MonetaSyncTransactionInput {
  transactionId: string;
  date: string;
  amount: string;
  currency: string;
  merchant: string | null;
  description: string | null;
  counterAccount: string | null;
  sourceCategory: string | null;
}

export interface ProcessMonetaSyncOptions {
  accountId: string;
  /** Current live balance, if the bot captured one — writes an AccountSnapshot checkpoint. */
  balance?: string | null;
  transactions: readonly MonetaSyncTransactionInput[];
}

export interface MonetaSyncSummary {
  batchId: string;
  accountId: string;
  rowCount: number;
  inserted: number;
  skipped: number;
  failed: number;
  failures: { transactionId: string; reason: string }[];
  checkpoint: CheckpointResult | null;
}

export async function processMonetaSyncTransactions(options: ProcessMonetaSyncOptions): Promise<MonetaSyncSummary> {
  const account = await prisma.account.findUnique({ where: { id: options.accountId } });

  if (!account) {
    throw new MonetaSyncError('Vybraný účet neexistuje', 'ACCOUNT_NOT_FOUND');
  }

  if (account.provider !== 'MONETA') {
    throw new MonetaSyncError(`Účet ${account.name} není u Monety`, 'UNSUPPORTED_PROVIDER');
  }

  // No real file exists for a live sync — the payload itself stands in for
  // one, so a byte-identical resend (a bot retry after a dropped response)
  // is still a safe no-op instead of a second batch.
  const fileHash = createHash('sha256')
    .update(JSON.stringify({ accountId: options.accountId, balance: options.balance ?? null, transactions: options.transactions }))
    .digest('hex');

  const previousBatch = await prisma.importBatch.findUnique({ where: { fileHash } });

  if (previousBatch?.status === 'COMPLETED') {
    throw new MonetaSyncError(`Tento sync už byl zpracován ${previousBatch.createdAt.toISOString()}`, 'ALREADY_IMPORTED');
  }

  // `ParsedTransaction.raw` is typed `Record<string, string>` because every
  // CSV/XML source row naturally is one; a scraped JSON row has null fields
  // too, so the real raw payload is kept separately (`rawByTransactionId`)
  // instead of forcing it through that narrower shape.
  const parsed: ParsedTransaction[] = options.transactions.map((row) => ({
    externalId: row.transactionId,
    date: new Date(`${row.date}T00:00:00.000Z`),
    amount: row.amount,
    currency: row.currency,
    merchant: row.merchant,
    description: row.description,
    counterAccount: row.counterAccount,
    sourceCategory: row.sourceCategory,
    raw: {},
  }));
  const rawByTransactionId = new Map(options.transactions.map((row) => [row.transactionId, row]));

  const keyed = parsed.map((transaction) => ({
    transaction,
    key: buildIdempotencyKey({
      provider: 'MONETA',
      externalId: transaction.externalId,
      accountId: account.id,
      date: transaction.date,
      amount: transaction.amount,
      currency: transaction.currency,
      merchant: transaction.merchant,
    }),
  }));

  const existing = await prisma.transaction.findMany({
    where: { idempotencyKey: { in: keyed.map(({ key }) => key) } },
    select: { idempotencyKey: true },
  });
  const existingKeys = new Set(existing.map((row) => row.idempotencyKey));

  const seenInFile = new Set<string>();
  const fresh: { transaction: ParsedTransaction; key: string }[] = [];
  let skipped = 0;

  for (const entry of keyed) {
    if (existingKeys.has(entry.key) || seenInFile.has(entry.key)) {
      skipped += 1;
      continue;
    }

    seenInFile.add(entry.key);
    fresh.push(entry);
  }

  const categoryIds = await resolveCategoryIds(parsed);
  const otherAccounts = await prisma.account.findMany({
    where: { id: { not: account.id } },
    select: { externalId: true },
  });
  const ownAccountIndex = buildOwnAccountIndex(otherAccounts);

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
      update: { status: 'PENDING' },
      create: {
        provider: 'MONETA',
        accountId: account.id,
        filename: `moneta-live-sync-${account.id}-${new Date().toISOString()}.json`,
        fileHash,
        status: 'PENDING',
      },
    });

    if (fresh.length > 0) {
      await tx.transaction.createMany({
        skipDuplicates: true,
        data: fresh.map(({ transaction, key }) => {
          const internalTransfer =
            isInternalTransfer(transaction.counterAccount, ownAccountIndex) ||
            isTrading212Funding(transaction.merchant, transaction.description, transaction.amount);

          return {
            idempotencyKey: key,
            externalId: transaction.externalId,
            source: 'API' as const,
            kind: internalTransfer ? ('PENDING_TRANSFER' as const) : ('NORMAL' as const),
            importBatchId: created.id,
            accountId: account.id,
            categoryId: internalTransfer
              ? (categoryIds.get('transfer') ?? null)
              : (categoryIds.get(resolveTransactionCategory(transaction) ?? '') ?? null),
            date: transaction.date,
            amount: new Prisma.Decimal(transaction.amount),
            currency: transaction.currency,
            amountCzk: transaction.currency === 'CZK' ? new Prisma.Decimal(transaction.amount) : (fxByKey.get(key)?.amountCzk ?? null),
            fxRate: transaction.currency === 'CZK' ? null : (fxByKey.get(key)?.fxRate ?? null),
            merchant: transaction.merchant,
            description: transaction.description,
            rawData: rawByTransactionId.get(transaction.externalId ?? '') ?? {},
          };
        }),
      });
    }

    if (fxFailures.length > 0) {
      await tx.ingestionEvent.createMany({
        data: fxFailures.map((failure) => ({
          provider: 'MONETA' as const,
          status: 'FAILED' as const,
          importBatchId: created.id,
          idempotencyKey: failure.key,
          rawPayload: rawByTransactionId.get(failure.transaction.externalId ?? '') ?? {},
          errorMessage: `Přepočet do CZK selhal: ${failure.reason}`,
        })),
      });
    }

    return tx.importBatch.update({
      where: { id: created.id },
      data: {
        status: 'COMPLETED',
        rowCount: parsed.length,
        insertedCount: fresh.length,
        skippedCount: skipped,
        failedCount: 0,
        completedAt: new Date(),
      },
    });
  });

  const checkpoint = options.balance
    ? await recordBalanceCheckpoint({
        accountId: account.id,
        day: new Date().toISOString().slice(0, 10),
        balance: options.balance,
        note: 'Moneta live sync',
        source: 'PROVIDER',
        importBatchId: batch.id,
      })
    : null;

  return {
    batchId: batch.id,
    accountId: account.id,
    rowCount: parsed.length,
    inserted: fresh.length,
    skipped,
    failed: fxFailures.length,
    failures: fxFailures.map((failure) => ({ transactionId: failure.transaction.externalId ?? '', reason: failure.reason })),
    checkpoint,
  };
}
