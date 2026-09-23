/**
 * The only place `Intl.DateTimeFormat(..., { timeZone: 'Europe/Prague' })`
 * gets called — nothing else in this codebase has ever needed a real
 * wall-clock-in-Prague computation (everything else is UTC calendar days,
 * see lib/parsers/csv/dates.ts). The notifications cron runs hourly with no
 * per-endpoint schedule, so time-sensitive checks (the daily digest, the
 * settlement-not-closed reminder) self-gate by checking these helpers first
 * and returning immediately when it's not their window.
 */

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'short' });
const HOUR_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false });
const DATE_PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' });

const WEEKEND_DAYS = new Set(['Sat', 'Sun']);

export function isPragueWeekday(now: Date): boolean {
  return !WEEKEND_DAYS.has(WEEKDAY_FORMAT.format(now));
}

/** `hour` is 0-23, Prague local time (CET/CEST already accounted for by Intl). */
export function isPragueHour(now: Date, hour: number): boolean {
  // "24" is what Intl prints for midnight in hour12:false — never actually
  // matches a 0-23 `hour` argument, but guard against comparing "24" to 0.
  const formatted = HOUR_FORMAT.format(now);
  const parsed = formatted === '24' ? 0 : Number(formatted);
  return parsed === hour;
}

export function pragueDayOfMonth(now: Date): number {
  return Number(DATE_PARTS_FORMAT.format(now).slice(-2));
}

/** `YYYY-MM-DD` in Prague local time — used for daily dedupe keys so a run near the UTC/Prague day boundary lands on the correct day. */
export function pragueDateKey(now: Date): string {
  return DATE_PARTS_FORMAT.format(now);
}

/** `YYYY-MM` in Prague local time — used for monthly dedupe keys. */
export function pragueMonthKey(now: Date): string {
  return pragueDateKey(now).slice(0, 7);
}

/**
 * ISO 8601 week number (Monday-start, week 1 contains the year's first
 * Thursday) — used for weekly dedupe keys. Computed from the Prague
 * calendar date, not the raw UTC instant.
 */
export function pragueIsoWeekKey(now: Date): string {
  const [year, month, day] = pragueDateKey(now).split('-').map(Number);
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
  const dayNumber = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNumber + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstThursdayDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNumber + 3);
  const weekNumber = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}
