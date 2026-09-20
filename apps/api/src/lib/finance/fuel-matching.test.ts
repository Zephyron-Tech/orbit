import { describe, expect, it } from 'vitest';

import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { matchReceiptToPurchase, type FuelPurchaseCandidate } from './fuel-matching';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

const receipt = {
  stationCode: '190',
  purchasedAt: new Date('2026-08-20T12:27:25.000Z'),
  totalAfterDiscount: decimal('1399.94'),
};

describe('matchReceiptToPurchase', () => {
  it('matches an exact single candidate within the time window', () => {
    const candidates: FuelPurchaseCandidate[] = [
      { id: 'p1', stationCode: '190', purchasedAt: new Date('2026-08-20T12:27:23.000Z'), amountCzk: decimal('1399.94') },
    ];

    expect(matchReceiptToPurchase(receipt, candidates)).toBe('p1');
  });

  it('does not match a candidate outside the time window', () => {
    const candidates: FuelPurchaseCandidate[] = [
      { id: 'p1', stationCode: '190', purchasedAt: new Date('2026-08-20T12:40:00.000Z'), amountCzk: decimal('1399.94') },
    ];

    expect(matchReceiptToPurchase(receipt, candidates)).toBeNull();
  });

  it('does not match a candidate at a different station', () => {
    const candidates: FuelPurchaseCandidate[] = [
      { id: 'p1', stationCode: '131', purchasedAt: new Date('2026-08-20T12:27:23.000Z'), amountCzk: decimal('1399.94') },
    ];

    expect(matchReceiptToPurchase(receipt, candidates)).toBeNull();
  });

  it('does not match a candidate with a different amount', () => {
    const candidates: FuelPurchaseCandidate[] = [
      { id: 'p1', stationCode: '190', purchasedAt: new Date('2026-08-20T12:27:23.000Z'), amountCzk: decimal('999.00') },
    ];

    expect(matchReceiptToPurchase(receipt, candidates)).toBeNull();
  });

  it('refuses to guess when more than one candidate matches equally', () => {
    const candidates: FuelPurchaseCandidate[] = [
      { id: 'p1', stationCode: '190', purchasedAt: new Date('2026-08-20T12:27:20.000Z'), amountCzk: decimal('1399.94') },
      { id: 'p2', stationCode: '190', purchasedAt: new Date('2026-08-20T12:27:30.000Z'), amountCzk: decimal('1399.94') },
    ];

    expect(matchReceiptToPurchase(receipt, candidates)).toBeNull();
  });

  it('returns null for no candidates', () => {
    expect(matchReceiptToPurchase(receipt, [])).toBeNull();
  });

  it('respects a custom window', () => {
    const candidates: FuelPurchaseCandidate[] = [
      { id: 'p1', stationCode: '190', purchasedAt: new Date('2026-08-20T12:29:00.000Z'), amountCzk: decimal('1399.94') },
    ];

    expect(matchReceiptToPurchase(receipt, candidates, 1)).toBeNull();
    expect(matchReceiptToPurchase(receipt, candidates, 5)).toBe('p1');
  });
});
