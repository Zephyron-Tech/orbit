import { describe, expect, it } from 'vitest';

import { buildOwnAccountIndex, isInternalTransfer, isOrlenTopUp, normalizeAccountNumber } from './internal-transfers';

describe('normalizeAccountNumber', () => {
  it('drops the bank code', () => {
    expect(normalizeAccountNumber('204370628/0600')).toBe('204370628');
  });

  it('drops leading zeros, which statements add inconsistently', () => {
    expect(normalizeAccountNumber('0204370628')).toBe('204370628');
    expect(normalizeAccountNumber('0204370628')).toBe(normalizeAccountNumber('204370628/0600'));
  });

  it('keeps only the account number of a prefixed account', () => {
    expect(normalizeAccountNumber('670100-2205220540')).toBe('2205220540');
    expect(normalizeAccountNumber('123-8840130277/0100')).toBe('8840130277');
  });

  it('handles empty input', () => {
    expect(normalizeAccountNumber('')).toBe('');
    expect(normalizeAccountNumber('   ')).toBe('');
  });
});

describe('isInternalTransfer', () => {
  const own = buildOwnAccountIndex([{ externalId: '204370628/0600' }, { externalId: '235025552/0600' }]);

  it('recognises the real savings-to-current transfer', () => {
    expect(isInternalTransfer('204370628', own)).toBe(true);
  });

  it('does not flag a payment to somebody else', () => {
    expect(isInternalTransfer('7770227', own)).toBe(false);
  });

  it('does not flag a card payment, which has no counterparty account', () => {
    expect(isInternalTransfer(null, own)).toBe(false);
    expect(isInternalTransfer('', own)).toBe(false);
  });

  it('ignores accounts without a number', () => {
    expect(buildOwnAccountIndex([{ externalId: null }]).size).toBe(0);
  });
});

describe('isOrlenTopUp', () => {
  it('recognises an Orlen wallet top-up by merchant text', () => {
    expect(isOrlenTopUp('ORLEN Litvinovska', null, '-500.00')).toBe(true);
  });

  it('recognises it regardless of case or diacritics', () => {
    expect(isOrlenTopUp('orlén unipetrol rpa', null, '-500.00')).toBe(true);
  });

  it('checks the description too, not only the merchant', () => {
    expect(isOrlenTopUp(null, 'Dobiti Orlen', '-500.00')).toBe(true);
  });

  it('does not flag a positive amount (a refund, not a top-up)', () => {
    expect(isOrlenTopUp('ORLEN Litvinovska', null, '500.00')).toBe(false);
  });

  it('does not flag an unrelated merchant', () => {
    expect(isOrlenTopUp('LIDL CESKA REPUBLIKA', null, '-500.00')).toBe(false);
  });

  it('handles missing merchant and description', () => {
    expect(isOrlenTopUp(null, null, '-500.00')).toBe(false);
  });
});
