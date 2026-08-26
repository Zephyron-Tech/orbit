import { describe, expect, it } from 'vitest';

import {
  buildIdempotencyKey,
  dedupStrategyFor,
  normalizeMerchant,
  toBookingDay,
  toMinorUnits,
  type IdempotencyInput,
} from './idempotency';

const base: IdempotencyInput = {
  provider: 'MONETA',
  accountId: 'acc-1',
  date: new Date('2026-08-17T10:32:00.000Z'),
  amount: '-499.90',
  currency: 'CZK',
  merchant: 'LIDL CESKA REPUBLIKA',
};

describe('normalizeMerchant', () => {
  it('strips diacritics, punctuation and extra whitespace', () => {
    expect(normalizeMerchant('  Čerpací   stanice, MOL s.r.o. ')).toBe('CERPACI STANICE MOL S R O');
  });

  it('returns an empty string for missing input', () => {
    expect(normalizeMerchant(null)).toBe('');
    expect(normalizeMerchant(undefined)).toBe('');
  });
});

describe('toMinorUnits', () => {
  it('normalizes equivalent decimal representations', () => {
    expect(toMinorUnits('-1234.5')).toBe(toMinorUnits('-1234.50'));
    expect(toMinorUnits(-1234.5)).toBe(toMinorUnits('-1234.50'));
    expect(toMinorUnits('-1234.50')).toBe('-123450');
  });

  it('handles whole numbers and zero', () => {
    expect(toMinorUnits('100')).toBe('10000');
    expect(toMinorUnits('0.00')).toBe('0');
    expect(toMinorUnits('-0.00')).toBe('0');
  });

  it('rejects unparseable amounts', () => {
    expect(() => toMinorUnits('499,90 Kč')).toThrow();
  });
});

describe('toBookingDay', () => {
  it('keeps only the UTC calendar day', () => {
    expect(toBookingDay(new Date('2026-08-17T23:59:59.000Z'))).toBe('2026-08-17');
  });

  it('rejects an invalid date', () => {
    expect(() => toBookingDay(new Date('nope'))).toThrow();
  });
});

describe('buildIdempotencyKey', () => {
  it('is deterministic', () => {
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
  });

  it('ignores the time of day, so a re-sent e-mail hashes identically', () => {
    const resent = { ...base, date: new Date('2026-08-17T22:05:11.000Z') };

    expect(buildIdempotencyKey(resent)).toBe(buildIdempotencyKey(base));
  });

  it('ignores cosmetic merchant differences', () => {
    const reformatted = { ...base, merchant: 'Lidl  Česká republika!' };

    expect(buildIdempotencyKey(reformatted)).toBe(buildIdempotencyKey(base));
  });

  it('ignores equivalent amount formatting', () => {
    expect(buildIdempotencyKey({ ...base, amount: -499.9 })).toBe(buildIdempotencyKey(base));
  });

  it('separates identical purchases booked on different accounts', () => {
    const partnerAccount = { ...base, accountId: 'acc-2' };

    expect(buildIdempotencyKey(partnerAccount)).not.toBe(buildIdempotencyKey(base));
  });

  it('separates different amounts, dates, currencies and providers', () => {
    const key = buildIdempotencyKey(base);

    expect(buildIdempotencyKey({ ...base, amount: '-499.91' })).not.toBe(key);
    expect(buildIdempotencyKey({ ...base, date: new Date('2026-08-18T10:32:00.000Z') })).not.toBe(key);
    expect(buildIdempotencyKey({ ...base, currency: 'EUR' })).not.toBe(key);
    expect(buildIdempotencyKey({ ...base, provider: 'REVOLUT' })).not.toBe(key);
  });

  it('cannot be confused by a field boundary shift', () => {
    const a = buildIdempotencyKey({ ...base, accountId: 'acc', merchant: '1 LIDL' });
    const b = buildIdempotencyKey({ ...base, accountId: 'acc1', merchant: 'LIDL' });

    expect(a).not.toBe(b);
  });
});

describe('buildIdempotencyKey with a source reference', () => {
  const withRef: IdempotencyInput = { ...base, externalId: '0111222333:20260730:00001:387153XSB6798660716' };

  it('reports which strategy it used', () => {
    expect(dedupStrategyFor(withRef)).toBe('EXTERNAL_ID');
    expect(dedupStrategyFor(base)).toBe('ATTRIBUTES');
    expect(dedupStrategyFor({ ...base, externalId: '   ' })).toBe('ATTRIBUTES');
  });

  it('ignores attribute changes once a reference is present', () => {
    const key = buildIdempotencyKey(withRef);

    expect(buildIdempotencyKey({ ...withRef, amount: '-1.00' })).toBe(key);
    expect(buildIdempotencyKey({ ...withRef, merchant: 'ÚPLNĚ JINÝ OBCHOD' })).toBe(key);
    expect(buildIdempotencyKey({ ...withRef, date: new Date('2027-01-01T00:00:00.000Z') })).toBe(key);
  });

  it('separates two identical same-day purchases', () => {
    // The real case from a Moneta export: two 50 CZK payments, same club, same day.
    const first = buildIdempotencyKey({ ...base, externalId: '0111222333:20260728:00004:x1' });
    const second = buildIdempotencyKey({ ...base, externalId: '0111222333:20260728:00003:x2' });

    expect(first).not.toBe(second);
    // Without the reference they would collapse into one key.
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
  });

  it('still separates the same reference on different accounts', () => {
    expect(buildIdempotencyKey({ ...withRef, accountId: 'acc-2' })).not.toBe(buildIdempotencyKey(withRef));
  });

  it('cannot collide with an attribute-derived key', () => {
    expect(buildIdempotencyKey(withRef)).not.toBe(buildIdempotencyKey(base));
  });
});
