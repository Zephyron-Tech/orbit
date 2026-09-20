import { describe, expect, it } from 'vitest';

import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { PaymentFrequency } from '@orbit-api/lib/generated/prisma/enums';

import {
  getMonthlyAccrualCost,
  getSinkingFundRequirement,
  getUpcomingRenewals,
  nextOccurrenceOnOrAfter,
  type InsurancePolicyInput,
} from './insurance';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

type PolicyOverrides = Partial<Omit<InsurancePolicyInput, 'id' | 'annualCost' | 'startDate'>> & {
  id: string;
  annualCost: string;
  startDate?: string;
};

function policy(overrides: PolicyOverrides): InsurancePolicyInput {
  return {
    id: overrides.id,
    annualCost: d(overrides.annualCost),
    paymentFrequency: overrides.paymentFrequency ?? 'ANNUAL',
    startDate: new Date(overrides.startDate ?? '2026-01-01'),
    status: overrides.status ?? 'ACTIVE',
  };
}

describe('nextOccurrenceOnOrAfter', () => {
  const frequency = (value: PaymentFrequency): PaymentFrequency => value;

  it('ANNUAL: returns this year\'s anniversary when now is before it', () => {
    const result = nextOccurrenceOnOrAfter(new Date('2026-01-21T00:00:00Z'), frequency('ANNUAL'), new Date('2026-08-23T00:00:00Z'));
    expect(result.toISOString().slice(0, 10)).toBe('2027-01-21');
  });

  it('ANNUAL: returns next year\'s anniversary when now is after it in the anchor year', () => {
    // Anniversary already passed for 2026 (Jan 21), so the next one is 2027-01-21.
    const result = nextOccurrenceOnOrAfter(new Date('2025-01-21T00:00:00Z'), frequency('ANNUAL'), new Date('2026-08-23T00:00:00Z'));
    expect(result.toISOString().slice(0, 10)).toBe('2027-01-21');
  });

  it('ANNUAL: returns now itself when now is exactly the anniversary', () => {
    const now = new Date('2026-01-21T00:00:00Z');
    const result = nextOccurrenceOnOrAfter(new Date('2025-01-21T00:00:00Z'), frequency('ANNUAL'), now);
    expect(result.getTime()).toBe(now.getTime());
  });

  it('SEMI_ANNUAL: steps forward every 6 months', () => {
    const result = nextOccurrenceOnOrAfter(new Date('2025-01-21T00:00:00Z'), frequency('SEMI_ANNUAL'), new Date('2026-08-23T00:00:00Z'));
    // Occurrences: 2025-01-21, 2025-07-21, 2026-01-21, 2026-07-21, 2027-01-21.
    expect(result.toISOString().slice(0, 10)).toBe('2027-01-21');
  });

  it('MONTHLY: steps forward every month', () => {
    const result = nextOccurrenceOnOrAfter(new Date('2026-06-05T00:00:00Z'), frequency('MONTHLY'), new Date('2026-08-23T00:00:00Z'));
    expect(result.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('clamps month-overflow instead of rolling into the following month', () => {
    // Jan 31 + 1 month must land on Feb 28 (2026 is not a leap year), never "Mar 3".
    const result = nextOccurrenceOnOrAfter(new Date('2026-01-31T00:00:00Z'), frequency('MONTHLY'), new Date('2026-02-01T00:00:00Z'));
    expect(result.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('returns startDate unchanged when it is in the future relative to now', () => {
    const start = new Date('2027-03-10T00:00:00Z');
    const result = nextOccurrenceOnOrAfter(start, frequency('ANNUAL'), new Date('2026-08-23T00:00:00Z'));
    expect(result.getTime()).toBe(start.getTime());
  });
});

describe('getMonthlyAccrualCost', () => {
  it('counts ACTIVE and PENDING_RENEWAL, excludes PAID and TERMINATED', () => {
    const policies = [
      policy({ id: 'a', annualCost: '1200', status: 'ACTIVE' }),
      policy({ id: 'b', annualCost: '600', status: 'PENDING_RENEWAL' }),
      policy({ id: 'c', annualCost: '9999', status: 'PAID' }),
      policy({ id: 'd', annualCost: '9999', status: 'TERMINATED' }),
    ];

    // (1200 + 600) / 12 = 150
    expect(getMonthlyAccrualCost(policies).toString()).toBe('150');
  });

  it('returns zero for an empty list', () => {
    expect(getMonthlyAccrualCost([]).toString()).toBe('0');
  });
});

describe('getUpcomingRenewals', () => {
  const now = new Date('2026-08-23T00:00:00Z');

  it('includes a renewal due exactly today', () => {
    const result = getUpcomingRenewals([policy({ id: 'a', annualCost: '1200', startDate: '2026-08-23' })], now, 30);
    expect(result).toHaveLength(1);
  });

  it('includes a renewal due exactly at the threshold and excludes one day beyond', () => {
    const withinThreshold = policy({ id: 'a', annualCost: '1200', startDate: '2026-09-22' });
    const beyondThreshold = policy({ id: 'b', annualCost: '1200', startDate: '2026-09-23' });

    const result = getUpcomingRenewals([withinThreshold, beyondThreshold], now, 30);

    expect(result.map((r) => r.policy.id)).toEqual(['a']);
  });

  it('never surfaces TERMINATED or PAID policies regardless of due date', () => {
    const result = getUpcomingRenewals(
      [
        policy({ id: 'a', annualCost: '1200', startDate: '2026-08-23', status: 'TERMINATED' }),
        policy({ id: 'b', annualCost: '1200', startDate: '2026-08-23', status: 'PAID' }),
      ],
      now,
      30,
    );
    expect(result).toHaveLength(0);
  });

  it('sorts results ascending by due date', () => {
    const result = getUpcomingRenewals(
      [
        policy({ id: 'later', annualCost: '1200', startDate: '2026-09-20' }),
        policy({ id: 'sooner', annualCost: '1200', startDate: '2026-08-25' }),
      ],
      now,
      30,
    );
    expect(result.map((r) => r.policy.id)).toEqual(['sooner', 'later']);
  });
});

describe('getSinkingFundRequirement', () => {
  it('is zero right at the start of a period', () => {
    const now = new Date('2026-01-21T00:00:00Z');
    const result = getSinkingFundRequirement([policy({ id: 'a', annualCost: '1200', startDate: '2025-01-21' })], now);
    expect(result.toString()).toBe('0');
  });

  it('accrues roughly half the annual cost at the midpoint of an ANNUAL period', () => {
    // Period: 2026-01-21 -> 2027-01-21 (365 days). Midpoint ~2026-07-22 (182 days elapsed).
    const now = new Date('2026-07-22T00:00:00Z');
    const result = getSinkingFundRequirement([policy({ id: 'a', annualCost: '1200', startDate: '2026-01-21' })], now);
    const value = Number(result.toString());
    expect(value).toBeGreaterThan(590);
    expect(value).toBeLessThan(610);
  });

  it('scales the per-period amount for MONTHLY and SEMI_ANNUAL frequencies', () => {
    const now = new Date('2026-01-16T00:00:00Z'); // 15 days into a MONTHLY period starting 2026-01-01
    const monthly = policy({ id: 'm', annualCost: '1200', startDate: '2026-01-01', paymentFrequency: 'MONTHLY' });
    const semiAnnual = policy({ id: 's', annualCost: '1200', startDate: '2026-01-01', paymentFrequency: 'SEMI_ANNUAL' });

    // MONTHLY per-period amount = 1200/12 = 100, ~15/31 elapsed.
    const monthlyResult = Number(getSinkingFundRequirement([monthly], now).toString());
    expect(monthlyResult).toBeGreaterThan(45);
    expect(monthlyResult).toBeLessThan(50);

    // SEMI_ANNUAL per-period amount = 1200/2 = 600, ~15/181 elapsed.
    const semiAnnualResult = Number(getSinkingFundRequirement([semiAnnual], now).toString());
    expect(semiAnnualResult).toBeGreaterThan(45);
    expect(semiAnnualResult).toBeLessThan(55);
  });

  it('excludes TERMINATED and PAID policies', () => {
    const now = new Date('2026-07-22T00:00:00Z');
    const result = getSinkingFundRequirement(
      [
        policy({ id: 'a', annualCost: '1200', startDate: '2026-01-21', status: 'TERMINATED' }),
        policy({ id: 'b', annualCost: '1200', startDate: '2026-01-21', status: 'PAID' }),
      ],
      now,
    );
    expect(result.toString()).toBe('0');
  });
});
