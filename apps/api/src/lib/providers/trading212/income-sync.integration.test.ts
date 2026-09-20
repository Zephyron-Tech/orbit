import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@orbit-api/lib/db/prisma';

import type { Trading212Client } from './client';
import { syncTrading212Income, Trading212IncomeSyncError } from './income-sync';

/**
 * These exercise the database write path directly, so they need a live
 * Postgres — run with `npm run test:integration`, not the default suite.
 */

const DIVIDEND = {
  amount: 1.02,
  currency: 'CZK',
  paidOn: '2026-06-26T18:22:17.000Z',
  ticker: 'NVDA_US_EQ',
  reference: 'test-dividend-1',
};

const INTEREST = {
  amount: 0.01,
  currency: 'CZK',
  dateTime: '2026-08-07T00:00:00.000Z',
  reference: 'test-interest-1',
  type: 'INTEREST_ON_FREE_CASH' as const,
};

const DEPOSIT = {
  amount: 2000,
  currency: 'CZK',
  dateTime: '2026-08-18T00:00:00.000Z',
  reference: 'test-deposit-1',
  type: 'DEPOSIT' as const,
};

const WITHDRAW = {
  amount: -500,
  currency: 'EUR',
  dateTime: '2026-08-19T00:00:00.000Z',
  reference: 'test-withdraw-1',
  type: 'WITHDRAW' as const,
};

function fakeClient(
  dividends: (typeof DIVIDEND)[],
  transactions: (typeof INTEREST | typeof DEPOSIT | typeof WITHDRAW)[],
  accountId = 1,
): Trading212Client {
  return {
    getAccountSummary: async () => ({ id: accountId }),
    getDividends: async () => dividends,
    getTransactionHistory: async () => transactions,
  } as unknown as Trading212Client;
}

let accountId: string;

beforeEach(async () => {
  const account = await prisma.account.create({
    data: { name: 'T212 income test', type: 'INVESTMENT', provider: 'TRADING212', currency: 'CZK' },
  });
  accountId = account.id;
});

afterEach(async () => {
  await prisma.transaction.deleteMany({ where: { accountId } });
  await prisma.account.delete({ where: { id: accountId } });
});

async function categoryId(key: string): Promise<string> {
  const category = await prisma.category.findUniqueOrThrow({ where: { key } });

  return category.id;
}

describe('syncTrading212Income', () => {
  it('imports a dividend as a real income row, tagged with the Dividends category', async () => {
    const result = await syncTrading212Income({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient([DIVIDEND], []),
    });

    expect(result.dividendsFound).toBe(1);
    expect(result.inserted).toBe(1);

    const row = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-dividend-1' } });
    expect(row.amount.toString()).toBe('1.02');
    expect(row.kind).toBe('NORMAL');
    expect(row.merchant).toBe('NVDA_US_EQ');
    expect(row.categoryId).toBe(await categoryId('dividends'));
  });

  it('imports interest on free cash, tagged with the Interest category', async () => {
    const result = await syncTrading212Income({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient([], [INTEREST]),
    });

    expect(result.interestFound).toBe(1);
    expect(result.inserted).toBe(1);

    const row = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-interest-1' } });
    expect(row.amount.toString()).toBe('0.01');
    expect(row.categoryId).toBe(await categoryId('interest'));
  });

  it('imports deposits and withdrawals as pending transfer candidates', async () => {
    const result = await syncTrading212Income({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient([], [DEPOSIT, WITHDRAW]),
    });

    expect(result.bankTransfersFound).toBe(2);
    expect(result.inserted).toBe(2);

    const deposit = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-deposit-1' } });
    expect(deposit).toMatchObject({ kind: 'PENDING_TRANSFER', description: 'Vklad do Trading 212', categoryId: await categoryId('transfer') });
    expect(deposit.amount.toString()).toBe('2000');
    expect(deposit.amountCzk?.toString()).toBe('2000');
    expect(deposit.rawData).toMatchObject(DEPOSIT);

    const withdrawal = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-withdraw-1' } });
    expect(withdrawal).toMatchObject({ kind: 'PENDING_TRANSFER', description: 'Výběr z Trading 212', categoryId: await categoryId('transfer') });
    expect(withdrawal.amount.toString()).toBe('-500');
    expect(withdrawal.amountCzk).toBeNull();
  });

  it('is idempotent: importing the same dividend twice inserts it once', async () => {
    const options = {
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient([DIVIDEND], []),
    };

    const first = await syncTrading212Income(options);
    const second = await syncTrading212Income(options);

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    await expect(prisma.transaction.count({ where: { accountId } })).resolves.toBe(1);
  });

  it('does not touch AccountSnapshot — the price valuation and the income stream are independent', async () => {
    await syncTrading212Income({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient([DIVIDEND], [INTEREST]),
    });

    await expect(prisma.accountSnapshot.count({ where: { accountId } })).resolves.toBe(0);
  });

  it('refuses when no Trading 212 account exists', async () => {
    await prisma.account.delete({ where: { id: accountId } });

    await expect(
      syncTrading212Income({
        keyId: 'k',
        secret: 's',
        baseUrl: 'https://live.trading212.com',
        client: fakeClient([], []),
      }),
    ).rejects.toMatchObject({ code: 'NO_ACCOUNT' });

    const account = await prisma.account.create({
      data: { name: 'T212 income test', type: 'INVESTMENT', provider: 'TRADING212', currency: 'CZK' },
    });
    accountId = account.id;
  });

  it('refuses when more than one active Trading 212 account exists', async () => {
    const second = await prisma.account.create({
      data: { name: 'Second T212', type: 'INVESTMENT', provider: 'TRADING212', currency: 'CZK' },
    });

    await expect(
      syncTrading212Income({ keyId: 'k', secret: 's', baseUrl: 'https://live.trading212.com', client: fakeClient([], []) }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });

    await prisma.account.delete({ where: { id: second.id } });
  });

  it('refuses a provider account ID that differs from the bound account', async () => {
    await prisma.account.update({ where: { id: accountId }, data: { externalId: '2' } });

    await expect(
      syncTrading212Income({ keyId: 'k', secret: 's', baseUrl: 'https://live.trading212.com', client: fakeClient([], [], 1) }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
  });

  it('keeps the raw API item for debugging', async () => {
    await syncTrading212Income({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient([DIVIDEND], []),
    });

    const row = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-dividend-1' } });
    expect(row.rawData).toMatchObject({ ticker: 'NVDA_US_EQ', reference: 'test-dividend-1' });
  });
});

describe('Trading212IncomeSyncError', () => {
  it('is exported and carries a code', () => {
    const error = new Trading212IncomeSyncError('test', 'NO_ACCOUNT');
    expect(error.code).toBe('NO_ACCOUNT');
  });
});
