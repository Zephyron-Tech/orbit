import type { PaymentFrequency } from '@/lib/api-client';

/**
 * Insurance renewal date math. Pure: inputs in, a date out. No Prisma, no
 * fetch, no clock — the caller supplies everything, including the moment in
 * time.
 *
 * This is a trimmed copy of the API's own `lib/finance/insurance.ts` — only
 * the date-math half (`nextOccurrenceOnOrAfter`) is needed client-side, for
 * the upcoming-renewal badge on the insurance list. The Decimal-based accrual
 * math (`perPeriodAmount`, `getMonthlyAccrualCost`, sinking-fund math) stays
 * API-only; it's already precomputed server-side into the dashboard/
 * insurance overview responses, so web never needs `Prisma.Decimal` at all.
 */

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
    Date.UTC(year, targetMonthIndex, clampedDay, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
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
  const monthsBetween = (now.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - startDate.getUTCMonth());

  let stepsElapsed = Math.max(0, Math.floor(monthsBetween / step));
  let candidate = addMonthsClamped(startDate, stepsElapsed * step);

  while (candidate.getTime() < now.getTime()) {
    stepsElapsed += 1;
    candidate = addMonthsClamped(startDate, stepsElapsed * step);
  }

  return candidate;
}
