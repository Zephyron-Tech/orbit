import { describe, expect, it } from 'vitest';

import { Prisma } from '@/lib/generated/prisma/client';

import { remainingToSplit, validateSplit } from './split';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const line = (amount: string): { amount: Prisma.Decimal } => ({ amount: d(amount) });

describe('remainingToSplit', () => {
  it('is zero when the lines exactly cover the parent', () => {
    expect(remainingToSplit(d('-1000'), [line('-600'), line('-400')]).toString()).toBe('0');
  });

  it('reports what is left over', () => {
    expect(remainingToSplit(d('-1000'), [line('-600')]).toString()).toBe('-400');
  });

  it('reports a negative remainder when the lines overshoot', () => {
    expect(remainingToSplit(d('-1000'), [line('-600'), line('-500')]).toString()).toBe('100');
  });

  it('keeps exact decimals', () => {
    expect(remainingToSplit(d('-100.51'), [line('-50.26'), line('-50.25')]).toString()).toBe('0');
  });
});

describe('validateSplit', () => {
  it('accepts a split that sums exactly', () => {
    expect(validateSplit(d('-1000'), [line('-600'), line('-400')])).toEqual({ ok: true });
  });

  it('accepts an income transaction split the same way', () => {
    expect(validateSplit(d('1000'), [line('700'), line('300')])).toEqual({ ok: true });
  });

  it('rejects a remainder, naming the exact amount', () => {
    const result = validateSplit(d('-1000'), [line('-600'), line('-300')]);

    expect(result).toEqual({ ok: false, error: 'Zbývá rozdělit -100.00' });
  });

  it('rejects fewer than two lines', () => {
    expect(validateSplit(d('-1000'), [line('-1000')])).toMatchObject({ ok: false });
  });

  it('rejects a zero-amount line', () => {
    expect(validateSplit(d('-1000'), [line('-1000'), line('0')])).toMatchObject({
      ok: false,
      error: 'Žádná část nesmí být nulová',
    });
  });

  it('rejects a line with the opposite sign of the parent', () => {
    // -1000 split into -1400 and +400 sums correctly but invents income.
    const result = validateSplit(d('-1000'), [line('-1400'), line('400')]);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('znaménko') });
  });

  it('rejects splitting a zero-amount transaction', () => {
    expect(validateSplit(d('0'), [line('1'), line('-1')])).toMatchObject({ ok: false });
  });

  it('accepts more than two lines', () => {
    expect(validateSplit(d('-900'), [line('-300'), line('-300'), line('-300')])).toEqual({ ok: true });
  });

  it('is exact on the real Kaufland case: groceries + a personal item', () => {
    // -908.50 total, 700 shared groceries and 208.50 personal.
    expect(validateSplit(d('-908.50'), [line('-700'), line('-208.50')])).toEqual({ ok: true });
  });
});
