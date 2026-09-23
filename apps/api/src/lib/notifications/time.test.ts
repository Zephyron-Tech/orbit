import { describe, expect, it } from 'vitest';

import { isPragueHour, isPragueWeekday, pragueDateKey, pragueDayOfMonth, pragueIsoWeekKey, pragueMonthKey } from './time';

describe('isPragueWeekday', () => {
  it('is true for a weekday', () => {
    // Wednesday 2026-09-23, well inside the day, no boundary risk.
    expect(isPragueWeekday(new Date('2026-09-23T12:00:00Z'))).toBe(true);
  });

  it('is false for Saturday and Sunday', () => {
    expect(isPragueWeekday(new Date('2026-09-26T12:00:00Z'))).toBe(false); // Saturday
    expect(isPragueWeekday(new Date('2026-09-27T12:00:00Z'))).toBe(false); // Sunday
  });
});

describe('isPragueHour — CEST (summer, UTC+2)', () => {
  it('19:00 Prague is 17:00 UTC in late September (still CEST)', () => {
    expect(isPragueHour(new Date('2026-09-23T17:00:00Z'), 19)).toBe(true);
    expect(isPragueHour(new Date('2026-09-23T16:59:00Z'), 19)).toBe(false);
    expect(isPragueHour(new Date('2026-09-23T18:00:00Z'), 19)).toBe(false);
  });
});

describe('isPragueHour — CET (winter, UTC+1)', () => {
  it('19:00 Prague is 18:00 UTC in December (CET)', () => {
    expect(isPragueHour(new Date('2026-12-23T18:00:00Z'), 19)).toBe(true);
    expect(isPragueHour(new Date('2026-12-23T17:00:00Z'), 19)).toBe(false);
  });
});

describe('isPragueHour — DST boundary', () => {
  it('correctly reads the hour just after the late-October fallback (CEST -> CET)', () => {
    // EU DST ends last Sunday of October, 2026-10-25 01:00 UTC (03:00->02:00 Prague).
    // At 2026-10-25T18:00:00Z Prague is already back on CET (UTC+1) = 19:00 local.
    expect(isPragueHour(new Date('2026-10-25T18:00:00Z'), 19)).toBe(true);
  });

  it('correctly reads the hour just before the late-March spring-forward (CET -> CEST)', () => {
    // EU DST starts last Sunday of March, 2026-03-29 01:00 UTC. At
    // 2026-03-28T18:00:00Z Prague is still on CET (UTC+1) = 19:00 local.
    expect(isPragueHour(new Date('2026-03-28T18:00:00Z'), 19)).toBe(true);
  });
});

describe('pragueDayOfMonth', () => {
  it('reads the Prague calendar day, not the UTC one, near midnight', () => {
    // 2026-09-01T22:30:00Z is 2026-09-02T00:30 Prague (CEST, UTC+2).
    expect(pragueDayOfMonth(new Date('2026-09-01T22:30:00Z'))).toBe(2);
  });
});

describe('pragueDateKey / pragueMonthKey', () => {
  it('rolls to the next Prague day before UTC midnight', () => {
    expect(pragueDateKey(new Date('2026-09-01T22:30:00Z'))).toBe('2026-09-02');
    expect(pragueMonthKey(new Date('2026-09-01T22:30:00Z'))).toBe('2026-09');
  });

  it('rolls the month key at a Prague month boundary', () => {
    // 2026-09-30T23:00:00Z is 2026-10-01T01:00 Prague (CEST).
    expect(pragueMonthKey(new Date('2026-09-30T23:00:00Z'))).toBe('2026-10');
  });
});

describe('pragueIsoWeekKey', () => {
  it('matches a known ISO week', () => {
    // 2026-09-23 is a Wednesday in ISO week 39 of 2026.
    expect(pragueIsoWeekKey(new Date('2026-09-23T12:00:00Z'))).toBe('2026-W39');
  });

  it('week 1 belongs to the year containing the first Thursday', () => {
    // 2027-01-01 is a Friday, so it belongs to ISO week 53 of 2026, not week 1 of 2027.
    expect(pragueIsoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});
