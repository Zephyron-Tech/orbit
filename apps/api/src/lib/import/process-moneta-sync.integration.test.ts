/**
 * Integration test for the Moneta sync ingest path (currently: the
 * email-fallback bot only — the on-demand live-scrape flow was cancelled,
 * see docs/moneta-ondemand-sync-spec.md). Requires a running database
 * (`npm run db:up`) and is excluded from the default unit-test run:
 * `npm run test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@orbit-api/lib/db/prisma';
import { MonetaSyncError, processMonetaSyncTransactions } from '@orbit-api/lib/import/process-moneta-sync';

const EXTERNAL_ID = '555666777/0600';

let accountId = '';

async function cleanUp(): Promise<void> {
  const account = await prisma.account.findFirst({ where: { externalId: EXTERNAL_ID }, select: { id: true } });

  if (!account) {
    return;
  }

  const batches = await prisma.importBatch.findMany({ where: { accountId: account.id }, select: { id: true } });

  await prisma.ingestionEvent.deleteMany({ where: { importBatchId: { in: batches.map((batch) => batch.id) } } });
  await prisma.accountSnapshot.deleteMany({ where: { accountId: account.id } });
  await prisma.transaction.deleteMany({ where: { accountId: account.id } });
  await prisma.importBatch.deleteMany({ where: { accountId: account.id } });
  await prisma.account.delete({ where: { id: account.id } });
}

beforeAll(async () => {
  await cleanUp();

  const account = await prisma.account.create({
    data: { name: 'Moneta live-sync test', type: 'CHECKING', provider: 'MONETA', externalId: EXTERNAL_ID },
  });

  accountId = account.id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('processMonetaSyncTransactions', () => {
  it('inserts new rows keyed by the bank\'s own transactionId', async () => {
    const summary = await processMonetaSyncTransactions({
      accountId,
      transactions: [
        {
          transactionId: '260913S00000000001',
          date: '2026-09-13',
          amount: '-450.00',
          currency: 'CZK',
          merchant: 'ALBERT',
          description: null,
          counterAccount: null,
          sourceCategory: 'Potraviny',
        },
      ],
    });

    expect(summary.inserted).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);

    const stored = await prisma.transaction.findFirst({ where: { accountId, externalId: '260913S00000000001' } });

    expect(stored?.source).toBe('API');
    expect(stored?.amount.toString()).toBe('-450');
  });

  it('skips a transactionId already stored, without erroring, even inside a differently-shaped resync', async () => {
    // A real sync re-sends a rolling window of recent history every run, so
    // the payload naturally differs run to run even when most rows already
    // exist — a byte-identical resend is covered by the ALREADY_IMPORTED
    // test below instead.
    const summary = await processMonetaSyncTransactions({
      accountId,
      transactions: [
        {
          transactionId: '260913S00000000001',
          date: '2026-09-13',
          amount: '-450.00',
          currency: 'CZK',
          merchant: 'ALBERT',
          description: null,
          counterAccount: null,
          sourceCategory: 'Potraviny',
        },
        {
          transactionId: '260912S00000000009',
          date: '2026-09-12',
          amount: '-99.00',
          currency: 'CZK',
          merchant: 'BILLA',
          description: null,
          counterAccount: null,
          sourceCategory: 'Potraviny',
        },
      ],
    });

    expect(summary.inserted).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it('rejects an identical payload replayed twice with ALREADY_IMPORTED', async () => {
    const payload = {
      accountId,
      transactions: [
        {
          transactionId: '260913S00000000002',
          date: '2026-09-13',
          amount: '-120.00',
          currency: 'CZK',
          merchant: 'LIDL',
          description: null,
          counterAccount: null,
          sourceCategory: null,
        },
      ],
    };

    await processMonetaSyncTransactions(payload);

    await expect(processMonetaSyncTransactions(payload)).rejects.toMatchObject({ code: 'ALREADY_IMPORTED' });
  });

  it('accepts an identical resend once the earlier batch\'s row was deleted without the batch itself', async () => {
    // Real incident: cleaning up a wrong-sign import deleted only the
    // Transaction rows, not the ImportBatch that wrote them. The next
    // byte-identical resend then hit ALREADY_IMPORTED and was silently
    // dropped, even though nothing was left in the ledger for it.
    const payload = {
      accountId,
      transactions: [
        {
          transactionId: '260913S00000000003',
          date: '2026-09-13',
          amount: '-77.00',
          currency: 'CZK',
          merchant: 'KAUFLAND',
          description: null,
          counterAccount: null,
          sourceCategory: null,
        },
      ],
    };

    const first = await processMonetaSyncTransactions(payload);
    expect(first.inserted).toBe(1);

    await prisma.transaction.deleteMany({ where: { accountId, externalId: '260913S00000000003' } });

    const second = await processMonetaSyncTransactions(payload);

    expect(second.inserted).toBe(1);
    await expect(
      prisma.transaction.count({ where: { accountId, externalId: '260913S00000000003' } }),
    ).resolves.toBe(1);
  });

  it('writes a checkpoint when a balance is supplied', async () => {
    const summary = await processMonetaSyncTransactions({
      accountId,
      balance: '69826.91',
      transactions: [
        {
          transactionId: '260913S00000000003',
          date: '2026-09-13',
          amount: '10.00',
          currency: 'CZK',
          merchant: null,
          description: null,
          counterAccount: null,
          sourceCategory: null,
        },
      ],
    });

    expect(summary.checkpoint?.balance).toBe('69826.91');

    const snapshot = await prisma.accountSnapshot.findFirst({ where: { accountId } });

    expect(snapshot?.source).toBe('PROVIDER');
  });

  it('refuses an unknown account', async () => {
    await expect(
      processMonetaSyncTransactions({ accountId: '00000000-0000-0000-0000-000000000000', transactions: [] }),
    ).rejects.toBeInstanceOf(MonetaSyncError);
  });

  it('dedups an email-fallback row (no transactionId) via ATTRIBUTES, and dryRun writes nothing', async () => {
    const row = {
      transactionId: null,
      date: '2026-09-13',
      amount: '250.00',
      currency: 'CZK',
      merchant: 'Obchodník s.r.o.',
      description: null,
      counterAccount: null,
      sourceCategory: null,
    };

    const preview = await processMonetaSyncTransactions({ accountId, transactions: [row], dryRun: true });

    expect(preview.dryRun).toBe(true);
    expect(preview.batchId).toBeNull();
    expect(preview.inserted).toBe(1);

    const notWritten = await prisma.transaction.findFirst({ where: { accountId, merchant: 'Obchodník s.r.o.' } });
    expect(notWritten).toBeNull();

    const committed = await processMonetaSyncTransactions({ accountId, transactions: [row] });
    expect(committed.inserted).toBe(1);

    // Same day/amount/merchant, no reference, arriving alongside something
    // new (a real resend never resends byte-identically — see the
    // ALREADY_IMPORTED test above for that case) — the repeat must not
    // double it.
    const resend = await processMonetaSyncTransactions({
      accountId,
      transactions: [row, { ...row, amount: '10.00', merchant: 'Jiný obchodník' }],
    });
    expect(resend.inserted).toBe(1);
    expect(resend.skipped).toBe(1);
  });

  it('refuses a non-Moneta account', async () => {
    const other = await prisma.account.create({ data: { name: 'T212 test', type: 'INVESTMENT', provider: 'TRADING212' } });

    await expect(
      processMonetaSyncTransactions({
        accountId: other.id,
        transactions: [
          {
            transactionId: 'x',
            date: '2026-09-13',
            amount: '1.00',
            currency: 'CZK',
            merchant: null,
            description: null,
            counterAccount: null,
            sourceCategory: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_PROVIDER' });

    await prisma.account.delete({ where: { id: other.id } });
  });
});
