import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { learnRecurringExpenseAliases } from '@orbit-api/lib/import/recurring-alias-worker';
import { matchPendingTransfers } from '@orbit-api/lib/import/transfer-sync';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

/**
 * Inline edits from the ledger. Everything a person can change by hand lives
 * here; the parsers never write these fields, so an import can never overwrite
 * a categorization the user made.
 */
const updateSchema = z.object({
  id: z.uuid(),
  categoryId: z.uuid().nullable(),
  bucketId: z.uuid().nullable(),
  recurringExpenseId: z.uuid().nullable(),
  kind: z.enum(['NORMAL', 'INTERNAL_TRANSFER', 'PENDING_TRANSFER', 'SETTLEMENT']),
  isShared: z.boolean(),
  paidBy: z.enum(['ME', 'PARTNER']),
  myShareRatio: z.number().min(0).max(1).nullable(),
  notes: z.string().max(500).nullable(),
});

export const transactions = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .patch('/', async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatná data' }, 400);

    const data = parsed.data;
    const transferCategory =
      data.kind === 'INTERNAL_TRANSFER' || data.kind === 'PENDING_TRANSFER'
        ? await prisma.category.findFirst({ where: { key: 'transfer', isActive: true }, select: { id: true } })
        : null;

    const existing = await prisma.transaction.findUnique({
      where: { id: data.id },
      select: { settlementId: true, transferId: true },
    });

    if (!existing) return c.json({ error: 'Transakce neexistuje' }, 404);
    if (existing.settlementId) return c.json({ error: 'Transakce je součástí uzavřeného vyrovnání' }, 409);

    await prisma.$transaction(async (tx) => {
      if (data.kind !== 'INTERNAL_TRANSFER' && existing.transferId) {
        await tx.transaction.updateMany({ where: { transferId: existing.transferId }, data: { transferId: null } });
        await tx.transfer.delete({ where: { id: existing.transferId } });
      }

      await tx.transaction.update({
        where: { id: data.id },
        data: {
          categoryId: transferCategory?.id ?? data.categoryId,
          bucketId: data.bucketId,
          recurringExpenseId: data.recurringExpenseId,
          kind: data.kind,
          isShared: data.kind === 'NORMAL' ? data.isShared : false,
          paidBy: data.paidBy,
          myShareRatio:
            data.kind === 'NORMAL' && data.isShared && data.myShareRatio !== null
              ? new Prisma.Decimal(data.myShareRatio)
              : null,
          notes: data.notes,
          transferId: data.kind === 'INTERNAL_TRANSFER' ? undefined : null,
        },
      });
    });

    if (data.kind === 'INTERNAL_TRANSFER') {
      try {
        await matchPendingTransfers();
      } catch (error: unknown) {
        console.error('Transfer matching failed after manual reclassification', error);
      }
    }
    if (data.recurringExpenseId) {
      try {
        await learnRecurringExpenseAliases();
      } catch (error: unknown) {
        console.error('Recurring alias learning failed after transaction update', error);
      }
    }

    return c.json({ ok: true });
  })
  .post('/bulk-categorize', async (c) => {
    const parsed = z
      .object({ ids: z.array(z.uuid()).min(1).max(500), categoryId: z.uuid().nullable() })
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatná data' }, 400);

    await prisma.transaction.updateMany({
      where: { id: { in: parsed.data.ids }, settlementId: null },
      data: { categoryId: parsed.data.categoryId },
    });

    return c.json({ ok: true });
  })
  .post('/:id/dismiss-unmatched-transfer', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatná transakce' }, 400);

    const { count } = await prisma.transaction.updateMany({
      where: {
        id: parsedId.data,
        kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] },
        transferId: null,
        transferDismissedAt: null,
      },
      data: { transferDismissedAt: new Date() },
    });

    if (count === 0) {
      return c.json({ error: 'Převod už není nespárovaný, nebo byl už dříve skryt.' }, 409);
    }

    return c.json({ ok: true });
  })
  .post('/match-transfers', async (c) => {
    const result = await matchPendingTransfers();
    return c.json({ ok: true, matched: result.matched, ambiguous: result.ambiguous });
  });
