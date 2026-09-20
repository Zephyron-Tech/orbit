/**
 * Backfills `Transaction.description` for rows imported before the column
 * existed. The value is re-derived from the stored `rawData`, which is exactly
 * why the raw source row is kept in the first place.
 *
 * Idempotent: only rows with a null description are touched.
 *
 * Usage: npx tsx scripts/backfill-descriptions.ts
 */
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { resolveDescription } from '../lib/parsers/csv/moneta';
import { PrismaClient } from '../lib/generated/prisma/client';

function isRawRow(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const pending = await prisma.transaction.findMany({
      where: { description: null, rawData: { not: undefined } },
      select: { id: true, rawData: true },
    });

    let updated = 0;

    for (const transaction of pending) {
      if (!isRawRow(transaction.rawData)) {
        continue;
      }

      const description = resolveDescription(transaction.rawData);

      if (!description) {
        continue;
      }

      await prisma.transaction.update({ where: { id: transaction.id }, data: { description } });
      updated += 1;
    }

    console.log(`Backfilled ${updated} of ${pending.length} transactions`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
