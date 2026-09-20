import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { calculateSettlement, monthPeriod, type SettleableTransaction } from '@orbit-api/lib/finance/settlement';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

const closeSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  notes: z.string().max(500).nullable(),
});

/** Rows the settlement math needs, for one period, excluding closed ones. */
async function loadPeriodTransactions(year: number, month: number): Promise<SettleableTransaction[]> {
  const { from, to } = monthPeriod(year, month);

  const rows = await prisma.transaction.findMany({
    where: { date: { gte: from, lt: to } },
    select: { id: true, amount: true, amountCzk: true, currency: true, isShared: true, paidBy: true, myShareRatio: true, kind: true, settlementId: true },
  });

  return rows.flatMap((row) => {
    const amountCzk = row.currency === 'CZK' ? row.amount : row.amountCzk;
    if (!amountCzk) return [];
    return [{ id: row.id, amountCzk, isShared: row.isShared, paidBy: row.paidBy, myShareRatio: row.myShareRatio, kind: row.kind, settlementId: row.settlementId }];
  });
}

export const settlement = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/period', async (c) => {
    const year = Number(c.req.query('year'));
    const month = Number(c.req.query('month'));
    if (!Number.isInteger(year) || !Number.isInteger(month)) return c.json({ error: 'Neplatné období' }, 400);

    const transactions = await loadPeriodTransactions(year, month);
    return c.json(transactions);
  })
  .post('/close', async (c) => {
    const parsed = closeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatné období' }, 400);

    const { year, month, notes } = parsed.data;
    const { from, to } = monthPeriod(year, month);

    const transactions = await loadPeriodTransactions(year, month);
    const result = calculateSettlement(transactions);

    if (result.transactionIds.length === 0) return c.json({ error: 'V tomto období není co vyrovnávat' }, 422);

    const existing = await prisma.settlement.findFirst({ where: { periodFrom: from, periodTo: to } });
    if (existing) return c.json({ error: 'Toto období už je uzavřené' }, 409);

    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.settlement.create({
          data: { periodFrom: from, periodTo: to, paidByMe: result.paidByMe, paidByPartner: result.paidByPartner, balance: result.balance, notes },
        });

        // Only rows still unsettled, so a concurrent close cannot claim the
        // same transaction for two periods.
        await tx.transaction.updateMany({ where: { id: { in: result.transactionIds }, settlementId: null }, data: { settlementId: created.id } });
      });
    } catch (error: unknown) {
      console.error('Closing settlement failed', error);
      return c.json({ error: 'Vyrovnání se nepodařilo uzavřít' }, 500);
    }

    return c.json({ ok: true });
  })
  .post('/:id/reopen', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatné vyrovnání' }, 400);

    const found = await prisma.settlement.findUnique({ where: { id: parsedId.data } });
    if (!found) return c.json({ error: 'Vyrovnání neexistuje' }, 404);
    if (found.settledAt) return c.json({ error: 'Vyrovnání je označené jako zaplacené, nejdřív ho odznačte' }, 409);

    await prisma.$transaction(async (tx) => {
      await tx.transaction.updateMany({ where: { settlementId: parsedId.data }, data: { settlementId: null } });
      await tx.settlement.delete({ where: { id: parsedId.data } });
    });

    return c.json({ ok: true });
  })
  .post('/:id/settled', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsedBody = z.object({ settled: z.boolean() }).safeParse(await c.req.json());
    if (!parsedId.success || !parsedBody.success) return c.json({ error: 'Neplatné vyrovnání' }, 400);

    const updated = await prisma.settlement.update({ where: { id: parsedId.data }, data: { settledAt: parsedBody.data.settled ? new Date() : null } });
    return c.json(updated);
  });
