import { describe, expect, it } from 'vitest';

import { findCoverageGaps, findMissingStatements } from './coverage';

function batch(from: string, to: string): { coverageFrom: Date; coverageTo: Date } {
  return { coverageFrom: new Date(`${from}T00:00:00Z`), coverageTo: new Date(`${to}T00:00:00Z`) };
}

describe('findCoverageGaps', () => {
  it('finds no gap in consecutive months', () => {
    expect(findCoverageGaps([batch('2026-07-01', '2026-07-31'), batch('2026-08-01', '2026-08-31')])).toEqual([]);
  });

  it('names a missing month', () => {
    const gaps = findCoverageGaps([batch('2026-07-01', '2026-07-31'), batch('2026-09-01', '2026-09-30')]);

    expect(gaps).toEqual([{ from: '2026-08-01', to: '2026-08-31' }]);
  });

  it('finds a gap of a few days', () => {
    const gaps = findCoverageGaps([batch('2026-07-01', '2026-07-10'), batch('2026-07-14', '2026-07-31')]);

    expect(gaps).toEqual([{ from: '2026-07-11', to: '2026-07-13' }]);
  });

  it('tolerates overlapping and out-of-order imports', () => {
    const gaps = findCoverageGaps([batch('2026-08-01', '2026-08-31'), batch('2026-07-01', '2026-08-15')]);

    expect(gaps).toEqual([]);
  });

  it('ignores a movement export, which declares no coverage', () => {
    // Its transaction dates are a lower bound, not a covered period.
    expect(findCoverageGaps([{ coverageFrom: null, coverageTo: null }])).toEqual([]);
  });

  it('does not mistake a quiet account for a missing statement', () => {
    // The real false positive: a savings statement covering 24 June to 24 July
    // whose only transactions fell on 14 and 15 July.
    const gaps = findCoverageGaps([batch('2026-06-24', '2026-07-24'), batch('2026-07-24', '2026-08-24')]);

    expect(gaps).toEqual([]);
  });

  it('has no gap with a single import', () => {
    expect(findCoverageGaps([batch('2026-07-01', '2026-07-31')])).toEqual([]);
  });
});

describe('findMissingStatements', () => {
  it('finds nothing in a consecutive run', () => {
    expect(findMissingStatements(['2026000006', '2026000007', '2026000008'])).toEqual([]);
  });

  it('names a statement that was never imported', () => {
    expect(findMissingStatements(['2026000006', '2026000008'])).toEqual(['2026000007']);
  });

  it('names several in a row and keeps the number width', () => {
    expect(findMissingStatements(['2026000005', '2026000009'])).toEqual([
      '2026000006',
      '2026000007',
      '2026000008',
    ]);
  });

  it('tolerates statements imported out of order', () => {
    expect(findMissingStatements(['2026000008', '2026000006', '2026000007'])).toEqual([]);
  });

  it('has nothing to say about a single statement', () => {
    expect(findMissingStatements(['2026000007'])).toEqual([]);
    expect(findMissingStatements([])).toEqual([]);
  });

  it('ignores anything that is not a number', () => {
    expect(findMissingStatements(['nope', '2026000007'])).toEqual([]);
  });
});
