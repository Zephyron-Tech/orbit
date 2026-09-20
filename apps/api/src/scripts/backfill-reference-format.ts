/**
 * Rewrites `Transaction.externalId` to the canonical bank reference and
 * recomputes the idempotency key from it.
 *
 * Needed once, because early CSV imports stored the full colon-separated
 * reference while a monthly statement carries only its final segment. Without
 * this, importing the statement for a month already imported from CSV would
 * create a second copy of every transaction.
 *
 * Idempotent: rows already in canonical form are left alone.
 *
 * Usage: npx tsx scripts/backfill-reference-format.ts
 */
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { buildIdempotencyKey } from '../lib/finance/idempotency';
import { PrismaClient } from '../lib/generated/prisma/client';
import { normalizeSourceReference } from '../lib/parsers/reference';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const transactions = await prisma.transaction.findMany({
      where: { externalId: { contains: ':' } },
      select: {
        id: true,
        externalId: true,
        accountId: true,
        date: true,
        amount: true,
        currency: true,
        merchant: true,
        account: { select: { provider: true } },
      },
    });

    let updated = 0;

    for (const transaction of transactions) {
      const canonical = normalizeSourceReference(transaction.externalId);

      if (!canonical || canonical === transaction.externalId) {
        continue;
      }

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          externalId: canonical,
          idempotencyKey: buildIdempotencyKey({
            provider: transaction.account.provider,
            externalId: canonical,
            accountId: transaction.accountId,
            date: transaction.date,
            amount: transaction.amount.toString(),
            currency: transaction.currency,
            merchant: transaction.merchant,
          }),
        },
      });

      updated += 1;
    }

    console.log(`Rewrote ${updated} of ${transactions.length} references`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
