import { describe, expect, it } from 'vitest';

import { AmountParseError, parseCzechAmount } from './numbers';

describe('parseCzechAmount', () => {
  it('parses the formats present in a Moneta export', () => {
    expect(parseCzechAmount('6500,00')).toBe('6500.00');
    expect(parseCzechAmount('-108,00')).toBe('-108.00');
    expect(parseCzechAmount('-162,90')).toBe('-162.90');
    expect(parseCzechAmount('-428,99')).toBe('-428.99');
    expect(parseCzechAmount('-18200,00')).toBe('-18200.00');
  });

  it('strips thousands separators, including non-breaking spaces', () => {
    expect(parseCzechAmount('1 234,50')).toBe('1234.50');
    expect(parseCzechAmount('1 234,50')).toBe('1234.50');
    expect(parseCzechAmount('1 234,50')).toBe('1234.50');
  });

  it('accepts a dot as the decimal separator', () => {
    expect(parseCzechAmount('-1234.50')).toBe('-1234.50');
  });

  it('pads and normalizes the fraction', () => {
    expect(parseCzechAmount('12,5')).toBe('12.50');
    expect(parseCzechAmount('12')).toBe('12.00');
    expect(parseCzechAmount('007,50')).toBe('7.50');
  });

  it('keeps precision that a float would destroy', () => {
    // 0.1 + 0.2 is famously not 0.3 in IEEE-754; string parsing is exact.
    expect(parseCzechAmount('0,10')).toBe('0.10');
    expect(parseCzechAmount('1116,35')).toBe('1116.35');
    expect(parseCzechAmount('908,50')).toBe('908.50');
  });

  it('normalizes negative zero', () => {
    expect(parseCzechAmount('-0,00')).toBe('0.00');
  });

  it('rejects anything that is not a number', () => {
    for (const raw of ['', '   ', '499,90 Kč', 'abc', '1,2,3', '--5']) {
      expect(() => parseCzechAmount(raw)).toThrow(AmountParseError);
    }
  });
});
