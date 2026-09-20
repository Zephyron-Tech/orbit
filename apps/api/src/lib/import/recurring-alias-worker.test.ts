import { describe, expect, it, vi } from 'vitest';

import { learnRecurringExpenseAliases } from './recurring-alias-worker';

vi.mock('@orbit-api/lib/db/prisma', () => ({
  prisma: {
    transaction: { findMany: vi.fn(), updateMany: vi.fn() },
    recurringExpenseAlias: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  },
}));

describe('learnRecurringExpenseAliases', () => {
  it('learns an alias from a manually tagged fixed expense', async () => {
    const { prisma } = await import('@orbit-api/lib/db/prisma');
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ id: 'tx', accountId: 'a', merchant: 'Spotify - Petr', recurringExpenseId: 'spotify' }] as never);
    vi.mocked(prisma.recurringExpenseAlias.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.recurringExpenseAlias.create).mockResolvedValue({} as never);
    vi.mocked(prisma.recurringExpenseAlias.findMany).mockResolvedValue([]);

    await expect(learnRecurringExpenseAliases()).resolves.toEqual({ learned: 1, conflicts: 0, assigned: 0 });
    expect(prisma.recurringExpenseAlias.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ merchantKey: 'SPOTIFY PETR', recurringExpenseId: 'spotify' }) }));
  });
});
