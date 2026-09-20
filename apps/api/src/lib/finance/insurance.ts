import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { PaymentFrequency, PolicyStatus } from '@orbit-api/lib/generated/prisma/enums';

/**
 * Vehicle insurance accrual and renewal math. Pure: inputs in, numbers out.
 * No Prisma, no fetch, no clock — the caller supplies everything, including
 * the moment in time.
 */

const ZERO = new Prisma.Decimal(0);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The only fields insurance math needs. Keeps the input decoupled from Prisma rows. */
export interface InsurancePolicyInput {
  id: string;
  /** Always the full yearly premium, regardless of `paymentFrequency`. */
  annualCost: Prisma.Decimal;
  paymentFrequency: PaymentFrequency;
  /** Anniversary/reference date the payment cadence is computed from. */
  startDate: Date;
  status: PolicyStatus;
}

export interface UpcomingRenewal {
  policy: InsurancePolicyInput;
  nextDueDate: Date;
}

/**
 * A policy still in force and still costing money going forward.
 * `PENDING_RENEWAL` is treated the same as `ACTIVE` — an insurer doesn't stop
 * covering a car the day before renewal. `PAID`/`TERMINATED` have no future
 * cost, so they never enter a forward-looking projection.
 */
export function isAccruing(policy: InsurancePolicyInput): boolean {
  return policy.status === 'ACTIVE' || policy.status === 'PENDING_RENEWAL';
}

function frequencyStepMonths(frequency: PaymentFrequency): number {
  switch (frequency) {
    case 'MONTHLY':
      return 1;
    case 'SEMI_ANNUAL':
      return 6;
    case 'ANNUAL':
      return 12;
  }
}

/**
 * Adds `months` (may be negative) to `date` in UTC, clamping the day-of-month
 * to the last valid day of the target month (Jan 31 + 1 month = Feb 28/29,
 * never "Mar 3"). `Date.UTC` itself already normalizes month overflow into
 * the correct year, so only the day needs clamping.
 */
function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const targetMonthIndex = date.getUTCMonth() + months;
  const daysInTargetMonth = new Date(Date.UTC(year, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(date.getUTCDate(), daysInTargetMonth);

  return new Date(
    Date.UTC(
      year,
      targetMonthIndex,
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/**
 * The next date on or after `now` on which `frequency`'s cadence, anchored at
 * `startDate`, falls due. `startDate` is typically in the past (a policy's
 * anniversary date), so this fast-forwards by whole cadence steps rather
 * than walking one-by-one. "On or after" is inclusive of `now` itself — a
 * policy due exactly today is due, not already past.
 */
export function nextOccurrenceOnOrAfter(startDate: Date, frequency: PaymentFrequency, now: Date): Date {
  const step = frequencyStepMonths(frequency);
  const monthsBetween =
    (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - startDate.getUTCMonth());

  let stepsElapsed = Math.max(0, Math.floor(monthsBetween / step));
  let candidate = addMonthsClamped(startDate, stepsElapsed * step);

  while (candidate.getTime() < now.getTime()) {
    stepsElapsed += 1;
    candidate = addMonthsClamped(startDate, stepsElapsed * step);
  }

  return candidate;
}

/** The occurrence immediately preceding (or equal to) `nextOccurrenceOnOrAfter`. */
function currentPeriodStart(startDate: Date, frequency: PaymentFrequency, now: Date): Date {
  const step = frequencyStepMonths(frequency);
  const next = nextOccurrenceOnOrAfter(startDate, frequency, now);

  if (next.getTime() === now.getTime()) {
    return next;
  }

  return addMonthsClamped(next, -step);
}

function daysBetweenUtc(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** The amount due at the end of one cadence period (never `annualCost` itself unless ANNUAL). */
export function perPeriodAmount(annualCost: Prisma.Decimal, frequency: PaymentFrequency): Prisma.Decimal {
  switch (frequency) {
    case 'MONTHLY':
      return annualCost.dividedBy(12);
    case 'SEMI_ANNUAL':
      return annualCost.dividedBy(2);
    case 'ANNUAL':
      return annualCost;
  }
}

/**
 * Average monthly cost of running all accruing policies, for budgeting.
 * Always `annualCost / 12` per policy regardless of `paymentFrequency` —
 * `annualCost` is already the yearly total, so the monthly-equivalent burn
 * never changes with how often it's actually billed.
 */
export function getMonthlyAccrualCost(policies: readonly InsurancePolicyInput[]): Prisma.Decimal {
  return policies.filter(isAccruing).reduce((sum, policy) => sum.plus(policy.annualCost.dividedBy(12)), ZERO);
}

/**
 * Policies whose next cadence occurrence falls within `daysThreshold` days of
 * `now`. Both boundaries are inclusive: a renewal due today (day 0) and a
 * renewal due exactly `daysThreshold` days out both count. Only accruing
 * policies are considered — a `TERMINATED`/`PAID` policy has no upcoming
 * payment to warn about.
 */
export function getUpcomingRenewals(
  policies: readonly InsurancePolicyInput[],
  now: Date,
  daysThreshold: number,
): UpcomingRenewal[] {
  const windowEnd = new Date(now.getTime() + daysThreshold * MS_PER_DAY);

  return policies
    .filter(isAccruing)
    .map((policy) => ({ policy, nextDueDate: nextOccurrenceOnOrAfter(policy.startDate, policy.paymentFrequency, now) }))
    .filter(({ nextDueDate }) => nextDueDate.getTime() <= windowEnd.getTime())
    .sort((a, b) => a.nextDueDate.getTime() - b.nextDueDate.getTime());
}

/**
 * How much should already be set aside today toward each policy's *next*
 * payment, assuming linear accrual across the current cadence period: the
 * fraction of the period elapsed so far, times the amount due at its end.
 * The elapsed/period-length ratio is computed from whole-day integer counts,
 * then divided as `Prisma.Decimal` — the ratio itself never touches a JS
 * float, matching the project's Decimal-only rule for anything that ends up
 * multiplying money.
 */
export function getSinkingFundRequirement(policies: readonly InsurancePolicyInput[], now: Date): Prisma.Decimal {
  return policies.filter(isAccruing).reduce((sum, policy) => {
    const periodStart = currentPeriodStart(policy.startDate, policy.paymentFrequency, now);
    const step = frequencyStepMonths(policy.paymentFrequency);
    const periodEnd = addMonthsClamped(periodStart, step);

    const periodLengthDays = daysBetweenUtc(periodStart, periodEnd);
    const elapsedDays = daysBetweenUtc(periodStart, now);
    const fraction = new Prisma.Decimal(elapsedDays).dividedBy(periodLengthDays);

    return sum.plus(perPeriodAmount(policy.annualCost, policy.paymentFrequency).times(fraction));
  }, ZERO);
}
