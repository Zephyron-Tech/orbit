/**
 * Backfills `amountCzk`/`fxRate` on every existing foreign-currency
 * transaction that still has `amountCzk: null` — rows imported before
 * lib/providers/fx/rate-lookup.ts existed (or a row whose lookup failed at
 * import time; see the transaction's linked IngestionEvent for why).
 *
 * Dry-run by default: prints what would change and exits. Pass --confirm to
 * actually write.
 *
 * Usage: npx tsx scripts/backfill-fx-rates.ts [--confirm]
 */
import 'dotenv/config';

import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { createFxRateResolver, FxRateError } from '@/lib/providers/fx/rate-lookup';

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');

  const rows = await prisma.transaction.findMany({
    where: { currency: { not: 'CZK' }, amountCzk: null },
    select: { id: true, date: true, currency: true, amount: true, merchant: true },
    orderBy: { date: 'asc' },
  });

  console.log(`${rows.length} foreign-currency transaction(s) without a CZK amount.`);

  if (rows.length === 0) {
    return;
  }

  const resolveFxRate = createFxRateResolver();
  const updates: { id: string; amountCzk: Prisma.Decimal; fxRate: Prisma.Decimal }[] = [];
  const failures: { id: string; date: string; currency: string; merchant: string | null; reason: string }[] = [];

  for (const row of rows) {
    try {
      const fxRate = await resolveFxRate(row.date, row.currency, 'CZK');
      updates.push({ id: row.id, amountCzk: row.amount.times(fxRate), fxRate });
    } catch (error: unknown) {
      failures.push({
        id: row.id,
        date: row.date.toISOString().slice(0, 10),
        currency: row.currency,
        merchant: row.merchant,
        reason: error instanceof FxRateError ? error.message : 'FX rate lookup failed',
      });
    }
  }

  for (const update of updates) {
    const row = rows.find((r) => r.id === update.id);
    console.log(
      `  ${row?.date.toISOString().slice(0, 10)} ${row?.merchant ?? '(no merchant)'}: ${row?.amount.toFixed(2)} ${row?.currency} -> ${update.amountCzk.toFixed(2)} CZK (rate ${update.fxRate.toFixed(4)})`,
    );
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} lookup failure(s), left as amountCzk: null:`);
    for (const failure of failures) {
      console.log(`  ${failure.date} ${failure.currency} ${failure.merchant ?? '(no merchant)'}: ${failure.reason}`);
    }
  }

  if (!confirm) {
    console.log('\nDry run only — nothing written. Re-run with --confirm to actually update.');
    return;
  }

  await prisma.$transaction(
    updates.map((update) =>
      prisma.transaction.update({
        where: { id: update.id },
        data: { amountCzk: update.amountCzk, fxRate: update.fxRate },
      }),
    ),
  );

  console.log(`\nUpdated ${updates.length} row(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
