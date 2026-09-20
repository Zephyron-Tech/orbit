import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@orbit-api/lib/db/prisma';

import { Trading212Client } from './client';
import { syncTrading212, Trading212SyncError } from './sync';

/**
 * These exercise the database write path directly, so they need a live
 * Postgres — run with `npm run test:integration`, not the default suite.
 */

const SUMMARY = (totalValue: number, id = 1) => ({
  id,
  currency: 'CZK',
  totalValue,
  cash: { availableToTrade: 0, reservedForOrders: 0, inPies: 0 },
  investments: { currentValue: totalValue, totalCost: totalValue, realizedProfitLoss: 0, unrealizedProfitLoss: 0 },
});

function fakeClient(totalValue: number, id = 1): Trading212Client {
  return {
    getSnapshot: async () => ({ summary: SUMMARY(totalValue, id), positions: [] }),
  } as unknown as Trading212Client;
}

let accountId: string;

beforeEach(async () => {
  const account = await prisma.account.create({
    data: { name: 'T212 sync test', type: 'INVESTMENT', provider: 'TRADING212', currency: 'CZK' },
  });
  accountId = account.id;
});

afterEach(async () => {
  await prisma.accountSnapshot.deleteMany({ where: { accountId } });
  await prisma.account.delete({ where: { id: accountId } });
});

describe('syncTrading212', () => {
  it('creates a snapshot on the first call', async () => {
    const result = await syncTrading212({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient(14610.07),
      now: new Date('2026-08-18T11:20:00Z'),
    });

    expect(result.total).toBe('14610.07');
    expect(result.wasExisting).toBe(false);
    expect(result.capturedAt).toBe('2026-08-18T11:00:00.000Z');
  });

  it('overwrites the same hour bucket with fresh data instead of discarding it', async () => {
    // The bug this guards against: the "Obnovit" button called the API but a
    // same-hour bucket silently swallowed the result, so the price never moved
    // and the timestamp shown to the user never changed either.
    await syncTrading212({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient(14610.07),
      now: new Date('2026-08-18T11:05:00Z'),
    });

    const second = await syncTrading212({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient(14649.31),
      now: new Date('2026-08-18T11:40:00Z'),
    });

    expect(second.wasExisting).toBe(true);
    expect(second.total).toBe('14649.31');
    expect(second.capturedAt).toBe('2026-08-18T11:00:00.000Z');

    const stored = await prisma.accountSnapshot.findUniqueOrThrow({
      where: { accountId_capturedAt: { accountId, capturedAt: new Date('2026-08-18T11:00:00.000Z') } },
    });

    expect(stored.balance.toFixed(2)).toBe('14649.31');
  });

  it('moves updatedAt forward on a same-hour refresh even though capturedAt does not', async () => {
    const first = await syncTrading212({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient(100),
      now: new Date('2026-08-18T11:05:00Z'),
    });

    // A tick of real wall-clock time between the two calls, not simulated time:
    // `updatedAt` is written by Prisma from the actual clock, not from `now`.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await syncTrading212({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient(200),
      now: new Date('2026-08-18T11:40:00Z'),
    });

    expect(second.capturedAt).toBe(first.capturedAt);
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThan(new Date(first.updatedAt).getTime());
  });

  it('starts a new bucket in the next hour', async () => {
    await syncTrading212({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient(100),
      now: new Date('2026-08-18T11:59:00Z'),
    });

    const next = await syncTrading212({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      client: fakeClient(200),
      now: new Date('2026-08-18T12:01:00Z'),
    });

    expect(next.capturedAt).toBe('2026-08-18T12:00:00.000Z');
    await expect(prisma.accountSnapshot.count({ where: { accountId } })).resolves.toBe(2);
  });

  it('refuses to sync when no Trading 212 account exists', async () => {
    await prisma.account.delete({ where: { id: accountId } });

    await expect(
      syncTrading212({
        keyId: 'k',
        secret: 's',
        baseUrl: 'https://live.trading212.com',
        client: fakeClient(100),
      }),
    ).rejects.toMatchObject({ code: 'NO_ACCOUNT' });

    // Recreate so afterEach's own cleanup does not fail on a missing row.
    const account = await prisma.account.create({
      data: { name: 'T212 sync test', type: 'INVESTMENT', provider: 'TRADING212', currency: 'CZK' },
    });
    accountId = account.id;
  });

  it('refuses to sync when more than one active Trading 212 account exists', async () => {
    const second = await prisma.account.create({
      data: { name: 'Second T212', type: 'INVESTMENT', provider: 'TRADING212', currency: 'CZK' },
    });

    await expect(
      syncTrading212({ keyId: 'k', secret: 's', baseUrl: 'https://live.trading212.com', client: fakeClient(100) }),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_ACCOUNT' });

    await prisma.account.delete({ where: { id: second.id } });
  });

  it('refuses a provider account ID that differs from the bound account', async () => {
    await prisma.account.update({ where: { id: accountId }, data: { externalId: '2' } });

    await expect(
      syncTrading212({ keyId: 'k', secret: 's', baseUrl: 'https://live.trading212.com', client: fakeClient(100, 1) }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });
  });

  it('refuses a currency mismatch rather than silently mixing them', async () => {
    await prisma.account.update({ where: { id: accountId }, data: { currency: 'EUR' } });

    await expect(
      syncTrading212({ keyId: 'k', secret: 's', baseUrl: 'https://live.trading212.com', client: fakeClient(100) }),
    ).rejects.toBeInstanceOf(Trading212SyncError);
  });
});
