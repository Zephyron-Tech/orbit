/**
 * Flags transfers between our own accounts on transactions imported before the
 * detection existed. Re-derived from the stored `rawData`, so nothing has to be
 * re-downloaded or re-imported.
 *
 * Idempotent: only NORMAL rows are considered.
 *
 * Usage: npx tsx scripts/backfill-internal-transfers.ts
 */
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { buildOwnAccountIndex, isInternalTransfer } from '../lib/import/internal-transfers';
import { PrismaClient } from '../lib/generated/prisma/client';

const COUNTER_ACCOUNT_COLUMN = 'Číslo protiúčtu';

function counterAccountOf(rawData: unknown): string | null {
  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    return null;
  }

  const value = (rawData as Record<string, unknown>)[COUNTER_ACCOUNT_COLUMN];

  return typeof value === 'string' && value.trim() ? value : null;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const accounts = await prisma.account.findMany({ select: { id: true, externalId: true } });
    const transactions = await prisma.transaction.findMany({
      where: { kind: 'NORMAL' },
      select: { id: true, accountId: true, rawData: true },
    });

    const flagged: string[] = [];

    for (const transaction of transactions) {
      // A statement never lists its own account as the counterparty; excluding
      // it keeps a self-match from ever flagging a genuine payment.
      const others = accounts.filter((account) => account.id !== transaction.accountId);

      if (isInternalTransfer(counterAccountOf(transaction.rawData), buildOwnAccountIndex(others))) {
        flagged.push(transaction.id);
      }
    }

    if (flagged.length > 0) {
      await prisma.transaction.updateMany({
        where: { id: { in: flagged } },
        data: { kind: 'INTERNAL_TRANSFER' },
      });
    }

    console.log(`Flagged ${flagged.length} of ${transactions.length} transactions as internal transfers`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
