import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { calculateSettlement, describeBalance, monthPeriod, type SettleableTransaction } from '@orbit-api/lib/finance/settlement';
import { computeMyShare } from '@orbit-api/lib/finance/share';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

interface SettlementLineView {
  id: string;
  date: string;
  merchant: string;
  total: string;
  paidBy: 'ME' | 'PARTNER';
  myShare: string | null;
  partnerShare: string | null;
  currency: string;
  kind: 'EXPENSE' | 'SETTLEMENT' | 'UNCONVERTED';
}

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
  .get('/newest-transaction-date', async (c) => {
    const newest = await prisma.transaction.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
    return c.json({ date: newest?.date.toISOString() ?? null });
  })
  .get('/', async (c) => {
    const year = Number(c.req.query('year'));
    const month = Number(c.req.query('month'));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return c.json({ error: 'Neplatné období' }, 400);
    }

    const { from, to } = monthPeriod(year, month);
    const closed = await prisma.settlement.findFirst({
      where: { periodFrom: from, periodTo: to },
      select: {
        id: true,
        paidByMe: true,
        paidByPartner: true,
        balance: true,
        settledAt: true,
        notes: true,
        transactions: {
          select: { id: true, date: true, merchant: true, amount: true, amountCzk: true, currency: true, isShared: true, paidBy: true, myShareRatio: true, kind: true },
          orderBy: { date: 'asc' },
        },
      },
    });

    const [transactions, history, months, unconvertedCount] = await Promise.all([
      closed ? Promise.resolve(null) : loadPeriodTransactions(year, month),
      prisma.settlement.findMany({ orderBy: { periodFrom: 'desc' }, take: 12 }),
      prisma.$queryRaw<{ month: string }[]>`SELECT DISTINCT to_char("date", 'YYYY-MM') AS month FROM "Transaction" ORDER BY month DESC`,
      prisma.transaction.count({
        where: closed
          ? { settlementId: closed.id, currency: { not: 'CZK' }, amountCzk: null }
          : {
              date: { gte: from, lt: to },
              currency: { not: 'CZK' },
              amountCzk: null,
              settlementId: null,
              OR: [{ kind: 'NORMAL', isShared: true, amount: { lt: 0 } }, { kind: 'SETTLEMENT' }],
            },
      }),
    ]);

    let summary;
    let lines: SettlementLineView[];
    let lockedCount: number;

    if (closed) {
      lines = closed.transactions.flatMap<SettlementLineView>((transaction) => {
        const amount = transaction.currency === 'CZK' ? transaction.amount : transaction.amountCzk;

        if (!amount) {
          return [{ id: transaction.id, date: transaction.date.toISOString().slice(0, 10), merchant: transaction.merchant ?? '—', total: transaction.amount.abs().toFixed(2), paidBy: transaction.paidBy, myShare: null, partnerShare: null, currency: transaction.currency, kind: 'UNCONVERTED' }];
        }

        if (transaction.kind === 'SETTLEMENT') {
          return [{ id: transaction.id, date: transaction.date.toISOString().slice(0, 10), merchant: transaction.merchant ?? 'Platba vyrovnání', total: amount.abs().toFixed(2), paidBy: amount.greaterThan(0) ? 'PARTNER' : 'ME', myShare: null, partnerShare: null, currency: 'CZK', kind: 'SETTLEMENT' }];
        }

        if (transaction.kind !== 'NORMAL' || !transaction.isShared || amount.greaterThanOrEqualTo(0)) return [];

        const total = amount.abs();
        const myShare = computeMyShare(total, transaction.myShareRatio, `Transaction ${transaction.id}`);

        return [{ id: transaction.id, date: transaction.date.toISOString().slice(0, 10), merchant: transaction.merchant ?? '—', total: total.toFixed(2), paidBy: transaction.paidBy, myShare: myShare.toFixed(2), partnerShare: total.minus(myShare).toFixed(2), currency: 'CZK', kind: 'EXPENSE' }];
      });
      summary = {
        paidByMe: closed.paidByMe.toFixed(2),
        paidByPartner: closed.paidByPartner.toFixed(2),
        dueFromMe: null,
        dueFromPartner: null,
        settlementReceived: null,
        settlementSent: null,
        balance: closed.balance.toFixed(0),
        exactBalance: null,
        direction: describeBalance(closed.balance),
        sharedCount: lines.filter((line) => line.kind === 'EXPENSE').length,
      };
      lockedCount = closed.transactions.length;
    } else {
      const result = calculateSettlement(transactions ?? []);
      const lineDetails = await prisma.transaction.findMany({
        where: { id: { in: result.lines.map((line) => line.id) } },
        select: { id: true, date: true, merchant: true },
        orderBy: { date: 'asc' },
      });
      const detailById = new Map(lineDetails.map((detail) => [detail.id, detail]));

      summary = {
        paidByMe: result.paidByMe.toFixed(2),
        paidByPartner: result.paidByPartner.toFixed(2),
        dueFromMe: result.dueFromMe.toFixed(2),
        dueFromPartner: result.dueFromPartner.toFixed(2),
        settlementReceived: result.settlementReceived.toFixed(2),
        settlementSent: result.settlementSent.toFixed(2),
        balance: result.balance.toFixed(0),
        exactBalance: result.exactBalance.toFixed(2),
        direction: describeBalance(result.balance),
        sharedCount: result.lines.length,
      };
      lines = result.lines.map((line) => {
        const detail = detailById.get(line.id);
        return { id: line.id, date: detail?.date.toISOString().slice(0, 10) ?? '', merchant: detail?.merchant ?? '—', total: line.total.toFixed(2), paidBy: line.paidBy, myShare: line.myShare.toFixed(2), partnerShare: line.partnerShare.toFixed(2), currency: 'CZK', kind: 'EXPENSE' };
      });
      lockedCount = result.transactionIds.length;
    }

    return c.json({
      period: { year, month },
      isClosed: closed !== null,
      closedId: closed?.id ?? null,
      settledAt: closed?.settledAt?.toISOString() ?? null,
      closedNotes: closed?.notes ?? null,
      summary,
      lines,
      lockedCount,
      unconvertedCount,
      months: months.map((row) => row.month),
      history: history.map((row) => ({ id: row.id, period: row.periodFrom.toISOString().slice(0, 7), balance: row.balance.toFixed(0), settledAt: row.settledAt?.toISOString().slice(0, 10) ?? null })),
    });
  })
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
