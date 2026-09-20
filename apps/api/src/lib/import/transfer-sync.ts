import { prisma } from '@orbit-api/lib/db/prisma';
import { matchTransfers } from '@orbit-api/lib/finance/transfer-matching';

/**
 * Database-facing wrapper around the pure matcher in
 * `lib/finance/transfer-matching.ts`. Only rows still unmatched are ever
 * considered, so calling this repeatedly (after every import, after a manual
 * re-classification, or from a button) is always safe — it can only add new
 * pairs, never touch an existing one.
 */
export interface TransferSyncResult {
  matched: number;
  ambiguous: number;
}

export async function matchPendingTransfers(): Promise<TransferSyncResult> {
  return prisma.$transaction(async (tx) => {
    // Matching is a read-then-write operation. One advisory lock prevents two
    // concurrent imports/manual runs from claiming the same legs twice.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(742022)`;

    const candidates = await tx.transaction.findMany({
      where: { kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null, amountCzk: { not: null } },
      select: { id: true, accountId: true, date: true, amountCzk: true, currency: true, kind: true },
    });
    const result = matchTransfers(
      candidates.flatMap((candidate) =>
        candidate.amountCzk
          ? [{ id: candidate.id, accountId: candidate.accountId, date: candidate.date, amountCzk: candidate.amountCzk, currency: candidate.currency }]
          : [],
      ),
    );

    await Promise.all(result.pairs.map(async ([outId, inId]) => {
      await tx.transfer.create({ data: { legs: { connect: [{ id: outId }, { id: inId }] } } });
      await tx.transaction.updateMany({
        where: { id: { in: [outId, inId] }, kind: 'PENDING_TRANSFER' },
        data: { kind: 'INTERNAL_TRANSFER' },
      });
    }));

    return { matched: result.pairs.length, ambiguous: result.ambiguous.length };
  });
}
