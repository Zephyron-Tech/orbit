import { Prisma } from '@/lib/generated/prisma/client';
import { moveItem } from '@/lib/ui/reorder';

import { prisma } from './prisma';

export type ReorderResult = { ok: true } | { ok: false; error: 'NOT_FOUND' | 'CONFLICT' };

class ReorderTargetNotFound extends Error {}

/**
 * Read-recompute-write for a manual up/down reorder (accounts, insurance
 * policies, and any future list that gets the same "position by
 * `sortOrder`, moved one step by a button click" treatment) — one
 * implementation instead of two independently-drifting copies.
 *
 * Runs at Postgres `SERIALIZABLE` isolation, unlike the rest of this app's
 * transactions (default `READ COMMITTED`). That's deliberate: a plain
 * transaction does not stop two concurrent reorders on the same list from
 * silently losing one of them — both read the same pre-move snapshot
 * before either commits, and whichever write lands last overwrites the
 * other's move with no error, even though the UI already showed "Pořadí
 * bylo změněno" to both people. `SERIALIZABLE` makes Postgres detect that
 * overlap and abort the loser with a write-conflict error (surfaced by
 * Prisma as `P2034`) instead — a visible, retryable "someone else changed
 * this, try again" beats a silent lost update.
 */
export async function reorderRows<T extends { id: string }>(
  targetId: string,
  direction: -1 | 1,
  load: (tx: Prisma.TransactionClient) => Promise<T[]>,
  writeSortOrder: (tx: Prisma.TransactionClient, id: string, position: number) => Promise<unknown>,
): Promise<ReorderResult> {
  try {
    await prisma.$transaction(
      async (tx) => {
        const items = await load(tx);
        const index = items.findIndex((item) => item.id === targetId);

        if (index === -1) {
          throw new ReorderTargetNotFound();
        }

        const reordered = moveItem(items, index, direction);

        await Promise.all(reordered.map((item, position) => writeSortOrder(tx, item.id, position)));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { ok: true };
  } catch (error: unknown) {
    if (error instanceof ReorderTargetNotFound) {
      return { ok: false, error: 'NOT_FOUND' };
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return { ok: false, error: 'CONFLICT' };
    }

    throw error;
  }
}
