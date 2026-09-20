import { describe, expect, it } from 'vitest';

import { DateParseError, formatCzechDate, parseCzechDate } from './dates';

describe('parseCzechDate', () => {
  it('parses the export format as midnight UTC', () => {
    expect(parseCzechDate('23.07.2026').toISOString()).toBe('2026-07-23T00:00:00.000Z');
    expect(parseCzechDate('01.07.2026').toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(parseCzechDate('31.12.2026').toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('does not drift across a month boundary', () => {
    // The bug this guards against: a Prague-local parse would move this to June.
    const date = parseCzechDate('01.07.2026');

    expect(date.getUTCMonth()).toBe(6);
    expect(date.getUTCDate()).toBe(1);
  });

  it('accepts single-digit day and month', () => {
    expect(parseCzechDate('1.7.2026').toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('handles a leap day', () => {
    expect(parseCzechDate('29.02.2028').toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('rejects a date the calendar does not have', () => {
    for (const raw of ['31.02.2026', '29.02.2026', '32.01.2026', '01.13.2026']) {
      expect(() => parseCzechDate(raw)).toThrow(DateParseError);
    }
  });

  it('rejects malformed input', () => {
    for (const raw of ['', '2026-07-23', '23/07/2026', '23.07.26', 'nope']) {
      expect(() => parseCzechDate(raw)).toThrow(DateParseError);
    }
  });

  it('round-trips through the formatter', () => {
    expect(formatCzechDate(parseCzechDate('09.07.2026'))).toBe('09.07.2026');
  });
});
