/**
 * Permanently deletes everything dated before a cutoff: transactions (split
 * children cascade automatically), account balance checkpoints, net-worth
 * history (daily + monthly), and any closed settlement periods entirely
 * before the cutoff. Also drops Transfer rows left with zero surviving legs.
 *
 * Deliberately NOT touched: ImportBatch rows. They're an audit trail, not
 * something any dashboard figure is computed from directly — leaving them
 * only risks a stale-looking import-history entry, never a wrong number.
 *
 * Old AccountSnapshot rows must go, not just old transactions: net worth's
 * cash-balance derivation is "newest checkpoint + every transaction booked
 * strictly after it" (lib/finance/net-worth.ts). An old checkpoint surviving
 * alongside deleted transactions between it and the cutoff would silently
 * undercount. Every account falls back to needing a fresh opening balance
 * after this runs — the same "no anchor yet" state a brand-new account is
 * already in, not a special case.
 *
 * Dry-run by default: prints what would be deleted and exits. Pass --confirm
 * to actually delete.
 *
 * Usage: npx tsx scripts/reset-history-before.ts --cutoff 2026-08-01 [--confirm]
 */
import 'dotenv/config';

import { prisma } from '@/lib/db/prisma';

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main(): Promise<void> {
  const cutoffRaw = flag('cutoff');
  const confirm = process.argv.includes('--confirm');

  if (!cutoffRaw || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) {
    throw new Error('Usage: npx tsx scripts/reset-history-before.ts --cutoff YYYY-MM-DD [--confirm]');
  }

  const cutoff = new Date(`${cutoffRaw}T00:00:00.000Z`);

  const [transactionCount, accountSnapshotCount, netWorthSnapshotCount, monthlySnapshotCount, settlementCount] = await Promise.all([
    prisma.transaction.count({ where: { date: { lt: cutoff } } }),
    prisma.accountSnapshot.count({ where: { capturedAt: { lt: cutoff } } }),
    prisma.netWorthSnapshot.count({ where: { date: { lt: cutoff } } }),
    prisma.monthlyNetWorthSnapshot.count({ where: { month: { lt: cutoff } } }),
    prisma.settlement.count({ where: { periodTo: { lt: cutoff } } }),
  ]);

  console.log(`Cutoff: ${cutoff.toISOString().slice(0, 10)}`);
  console.log(`  transactions to delete:            ${transactionCount}`);
  console.log(`  account snapshots to delete:        ${accountSnapshotCount}`);
  console.log(`  daily net-worth snapshots to delete: ${netWorthSnapshotCount}`);
  console.log(`  monthly net-worth snapshots to delete: ${monthlySnapshotCount}`);
  console.log(`  settlements to delete:              ${settlementCount}`);

  if (!confirm) {
    console.log('\nDry run only — nothing deleted. Re-run with --confirm to actually delete.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { date: { lt: cutoff } } });
    await tx.accountSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } });
    await tx.netWorthSnapshot.deleteMany({ where: { date: { lt: cutoff } } });
    await tx.monthlyNetWorthSnapshot.deleteMany({ where: { month: { lt: cutoff } } });
    await tx.settlement.deleteMany({ where: { periodTo: { lt: cutoff } } });

    // A Transfer with zero surviving legs (both were pre-cutoff) is dead
    // weight; one with exactly one surviving leg is left alone.
    const orphanedTransfers = await tx.transfer.findMany({
      where: { legs: { none: {} } },
      select: { id: true },
    });

    if (orphanedTransfers.length > 0) {
      await tx.transfer.deleteMany({ where: { id: { in: orphanedTransfers.map((t) => t.id) } } });
    }

    console.log(`\nDeleted. ${orphanedTransfers.length} orphaned transfer(s) also removed.`);
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
