/**
 * Integration test for POST /:id/dismiss-unmatched-transfer. Requires a
 * running database (`npm run db:up`); excluded from the default unit-test
 * run, part of `test:integration`.
 *
 * Exercises the real Hono router (`app.request()`), not a mocked handler —
 * auth is a real access token signed for a throwaway user, everything else
 * runs against the real test database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signAccessToken } from '@orbit-api/lib/auth/jwt';
import { prisma } from '@orbit-api/lib/db/prisma';

import { transactions } from './transactions';

let accountId = '';
let userId = '';
let authHeader = '';

async function makeTransaction(overrides: {
  kind: 'INTERNAL_TRANSFER' | 'PENDING_TRANSFER' | 'NORMAL';
  transferId?: string | null;
  transferDismissedAt?: Date | null;
  idempotencyKey: string;
}) {
  return prisma.transaction.create({
    data: {
      accountId,
      date: new Date('2026-08-20T00:00:00.000Z'),
      amount: '-25000.00',
      amountCzk: '-25000.00',
      currency: 'CZK',
      merchant: 'VANDLÍČEK JAN',
      kind: overrides.kind,
      transferId: overrides.transferId ?? null,
      transferDismissedAt: overrides.transferDismissedAt ?? null,
      idempotencyKey: overrides.idempotencyKey,
    },
  });
}

function dismiss(id: string): Promise<Response> {
  return transactions.request(`/${id}/dismiss-unmatched-transfer`, {
    method: 'POST',
    headers: { Authorization: authHeader },
  });
}

beforeAll(async () => {
  const account = await prisma.account.create({
    data: { name: 'Dismiss transfer test', type: 'CHECKING', provider: 'MONETA', currency: 'CZK' },
  });
  accountId = account.id;

  const user = await prisma.user.create({
    data: { email: 'dismiss-transfer-test@example.com', passwordHash: 'unused', role: 'OWNER' },
  });
  userId = user.id;
  authHeader = `Bearer ${await signAccessToken(user)}`;
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { accountId } });
  await prisma.account.delete({ where: { id: accountId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('POST /:id/dismiss-unmatched-transfer', () => {
  it('dismisses a genuinely unmatched INTERNAL_TRANSFER without changing kind or transferId', async () => {
    const tx = await makeTransaction({ kind: 'INTERNAL_TRANSFER', idempotencyKey: 'dismiss-test-1' });

    const response = await dismiss(tx.id);
    expect(response.status).toBe(200);

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(updated.kind).toBe('INTERNAL_TRANSFER');
    expect(updated.transferId).toBeNull();
    expect(updated.transferDismissedAt).not.toBeNull();
  });

  it('dismisses a genuinely unmatched PENDING_TRANSFER too', async () => {
    const tx = await makeTransaction({ kind: 'PENDING_TRANSFER', idempotencyKey: 'dismiss-test-2' });

    const response = await dismiss(tx.id);
    expect(response.status).toBe(200);

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(updated.transferDismissedAt).not.toBeNull();
  });

  it('refuses a transaction that is already matched (has a transferId)', async () => {
    const transfer = await prisma.transfer.create({ data: {} });
    const tx = await makeTransaction({ kind: 'INTERNAL_TRANSFER', transferId: transfer.id, idempotencyKey: 'dismiss-test-3' });

    const response = await dismiss(tx.id);
    expect(response.status).toBe(409);

    const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(unchanged.transferDismissedAt).toBeNull();
  });

  it('refuses a NORMAL transaction — nothing to dismiss', async () => {
    const tx = await makeTransaction({ kind: 'NORMAL', idempotencyKey: 'dismiss-test-4' });

    const response = await dismiss(tx.id);
    expect(response.status).toBe(409);
  });

  it('refuses a transaction already dismissed', async () => {
    const tx = await makeTransaction({ kind: 'INTERNAL_TRANSFER', transferDismissedAt: new Date(), idempotencyKey: 'dismiss-test-5' });

    const response = await dismiss(tx.id);
    expect(response.status).toBe(409);
  });

  it('rejects the call with no auth token', async () => {
    const tx = await makeTransaction({ kind: 'INTERNAL_TRANSFER', idempotencyKey: 'dismiss-test-6' });

    const response = await transactions.request(`/${tx.id}/dismiss-unmatched-transfer`, { method: 'POST' });
    expect(response.status).toBe(401);
  });
});
