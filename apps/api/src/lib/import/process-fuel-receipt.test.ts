import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@orbit-api/lib/db/prisma', () => ({
  prisma: {
    fuelReceipt: { findMany: vi.fn(), update: vi.fn() },
    fuelPurchase: { findMany: vi.fn() },
  },
}));

import { prisma } from '@orbit-api/lib/db/prisma';

import { rematchFuelReceipts } from './process-fuel-receipt';

const receipt = (id: string, stationCode: string, purchasedAt: string, totalAfterDiscount: string) => ({
  id,
  stationCode,
  purchasedAt: new Date(purchasedAt),
  totalAfterDiscount: new Prisma.Decimal(totalAfterDiscount),
});

const purchase = (id: string, stationCode: string, purchasedAt: string, amountCzk: string) => ({
  id,
  stationCode,
  purchasedAt: new Date(purchasedAt),
  amountCzk: new Prisma.Decimal(amountCzk),
});

describe('rematchFuelReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when nothing is unmatched', async () => {
    vi.mocked(prisma.fuelReceipt.findMany).mockResolvedValue([]);

    await expect(rematchFuelReceipts()).resolves.toEqual({ matched: 0, stillUnmatched: 0 });
    expect(prisma.fuelPurchase.findMany).not.toHaveBeenCalled();
  });

  it('matches a receipt uploaded before its Sales.xls purchase existed', async () => {
    vi.mocked(prisma.fuelReceipt.findMany).mockResolvedValue([receipt('r1', '190', '2026-08-20T12:27:25.000Z', '1399.94')] as never);
    vi.mocked(prisma.fuelPurchase.findMany).mockResolvedValue([purchase('p1', '190', '2026-08-20T12:27:20.000Z', '1399.94')] as never);
    vi.mocked(prisma.fuelReceipt.update).mockResolvedValue({} as never);

    await expect(rematchFuelReceipts()).resolves.toEqual({ matched: 1, stillUnmatched: 0 });
    expect(prisma.fuelReceipt.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { purchaseId: 'p1' } });
  });

  it('leaves an ambiguous receipt unmatched rather than guessing', async () => {
    vi.mocked(prisma.fuelReceipt.findMany).mockResolvedValue([receipt('r1', '190', '2026-08-20T12:27:25.000Z', '500.00')] as never);
    vi.mocked(prisma.fuelPurchase.findMany).mockResolvedValue([
      purchase('p1', '190', '2026-08-20T12:27:20.000Z', '500.00'),
      purchase('p2', '190', '2026-08-20T12:28:00.000Z', '500.00'),
    ] as never);

    await expect(rematchFuelReceipts()).resolves.toEqual({ matched: 0, stillUnmatched: 1 });
    expect(prisma.fuelReceipt.update).not.toHaveBeenCalled();
  });

  it('never lets two receipts in the same pass claim the same purchase', async () => {
    vi.mocked(prisma.fuelReceipt.findMany).mockResolvedValue([
      receipt('r1', '190', '2026-08-20T12:27:25.000Z', '500.00'),
      receipt('r2', '190', '2026-08-21T12:27:25.000Z', '500.00'),
    ] as never);
    // Only one real candidate, but its station/amount happen to also satisfy
    // r2's criteria if r1's claim weren't removed first.
    vi.mocked(prisma.fuelPurchase.findMany).mockResolvedValue([purchase('p1', '190', '2026-08-20T12:27:20.000Z', '500.00')] as never);
    vi.mocked(prisma.fuelReceipt.update).mockResolvedValue({} as never);

    await expect(rematchFuelReceipts()).resolves.toEqual({ matched: 1, stillUnmatched: 1 });
    expect(prisma.fuelReceipt.update).toHaveBeenCalledTimes(1);
    expect(prisma.fuelReceipt.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { purchaseId: 'p1' } });
  });
});
