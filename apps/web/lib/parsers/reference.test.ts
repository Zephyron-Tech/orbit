import { describe, expect, it } from 'vitest';

import { normalizeSourceReference } from './reference';

describe('normalizeSourceReference', () => {
  it('reduces a CSV reference to the bank identifier', () => {
    expect(normalizeSourceReference('0204370628:20260701:00001:260701S00434438910')).toBe('260701S00434438910');
  });

  it('leaves an XML statement id untouched', () => {
    expect(normalizeSourceReference('260701S00434438910')).toBe('260701S00434438910');
  });

  it('makes both formats agree, which is what deduplication depends on', () => {
    expect(normalizeSourceReference('0204370628:20260701:00002:260630V586175289862')).toBe(
      normalizeSourceReference('260630V586175289862'),
    );
  });

  it('keeps distinct transactions distinct', () => {
    // Two identical same-day purchases differ only in this segment.
    expect(normalizeSourceReference('0204370628:20260728:00004:260727V731417289899')).not.toBe(
      normalizeSourceReference('0204370628:20260728:00003:260727V724747289898'),
    );
  });

  it('returns null for a missing or blank reference', () => {
    expect(normalizeSourceReference(null)).toBeNull();
    expect(normalizeSourceReference(undefined)).toBeNull();
    expect(normalizeSourceReference('   ')).toBeNull();
    expect(normalizeSourceReference('a:b:')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSourceReference('  260701S00434438910  ')).toBe('260701S00434438910');
  });
});
