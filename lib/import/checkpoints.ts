import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import type { SnapshotSource } from '@/lib/generated/prisma/enums';
import { endOfDayUtc, reconcileCheckpoint } from '@/lib/finance/net-worth';
import { lookupFxRate } from '@/lib/providers/fx/rate-lookup';

/**
 * Balance checkpoints for cash accounts.
 *
 * A statement export lists movements only, so an account's balance has to be
 * anchored by a figure a person read from their banking app. Recording it with
 * every import keeps the anchor fresh and, more usefully, turns it into a check:
 * if the ledger predicted a different number, a statement is missing.
 */

export interface CheckpointResult {
  balance: string;
  asOf: string;
  expected: string | null;
  difference: string | null;
  matches: boolean;
}

export interface RecordCheckpointInput {
  accountId: string;
  /** Calendar day the balance is true as of, "YYYY-MM-DD". */
  day: string;
  /** Decimal string; never a JS number. */
  balance: string;
  note?: string | null;
  source?: SnapshotSource;
  importBatchId?: string | null;
}

export async function recordBalanceCheckpoint(input: RecordCheckpointInput): Promise<CheckpointResult> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: input.accountId } });
  const capturedAt = endOfDayUtc(new Date(`${input.day}T00:00:00.000Z`));

  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error(`Invalid checkpoint date: ${input.day}`);
  }

  const balance = new Prisma.Decimal(input.balance);

  // A foreign-currency checkpoint used to store balanceCzk: null unconditionally
  // — no conversion was ever attempted, unlike individual transactions (see
  // process-csv.ts). That made a non-CZK account's checkpoint permanently
  // unusable as a net-worth anchor (lib/finance/net-worth.ts's usableSnapshot
  // requires balanceCzk), regardless of how clean the statement it came from
  // was. A lookup failure degrades to null exactly as before — it must never
  // block the checkpoint write, same resilience rule the per-transaction FX
  // resolver already follows.
  const balanceCzk =
    account.currency === 'CZK'
      ? balance
      : await lookupFxRate(capturedAt, account.currency, 'CZK')
          .then((rate) => balance.times(rate))
          .catch((error: unknown) => {
            console.error(`FX lookup failed for checkpoint ${account.id} (${account.currency}->CZK)`, error);
            return null;
          });

  const [previous, transactions] = await Promise.all([
    prisma.accountSnapshot.findFirst({
      where: { accountId: account.id, capturedAt: { lt: capturedAt } },
      orderBy: { capturedAt: 'desc' },
      select: { accountId: true, capturedAt: true, balance: true },
    }),
    prisma.transaction.findMany({
      where: { accountId: account.id },
      select: { accountId: true, date: true, amount: true, kind: true },
    }),
  ]);

  const reconciliation = reconcileCheckpoint(
    { id: account.id, name: account.name, type: account.type, currency: account.currency, includeInNetWorth: true },
    transactions.map((transaction) => ({
      accountId: transaction.accountId,
      date: transaction.date,
      amountCzk: transaction.amount,
      kind: transaction.kind,
    })),
    previous ? { accountId: previous.accountId, capturedAt: previous.capturedAt, balanceCzk: previous.balance } : undefined,
    { balance, capturedAt },
  );

  // Re-entering a balance for the same day corrects it rather than stacking.
  await prisma.accountSnapshot.upsert({
    where: { accountId_capturedAt: { accountId: account.id, capturedAt } },
    update: {
      balance,
      balanceCzk,
      expectedBalance: reconciliation.expected,
      note: input.note ?? null,
      source: input.source ?? 'MANUAL',
      importBatchId: input.importBatchId ?? null,
    },
    create: {
      accountId: account.id,
      source: input.source ?? 'MANUAL',
      importBatchId: input.importBatchId ?? null,
      capturedAt,
      currency: account.currency,
      balance,
      balanceCzk,
      expectedBalance: reconciliation.expected,
      note: input.note ?? null,
    },
  });

  return {
    balance: balance.toFixed(2),
    asOf: input.day,
    expected: reconciliation.expected?.toFixed(2) ?? null,
    difference: reconciliation.difference?.toFixed(2) ?? null,
    matches: reconciliation.matches,
  };
}
