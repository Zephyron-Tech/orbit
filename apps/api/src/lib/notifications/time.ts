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

/** 0-23, Prague local time (CET/CEST already accounted for by Intl). */
export function pragueHour(now: Date): number {
  // "24" is what Intl prints for midnight in hour12:false.
  const formatted = HOUR_FORMAT.format(now);
  return formatted === '24' ? 0 : Number(formatted);
}

/**
 * `hour` or later, Prague local time. Deliberately not an exact-hour match:
 * the cron loop's `sleep 3600` drifts later by however long each cycle's
 * curls take, and that drift compounds — a real production run skipped
 * Prague hour 19 entirely, landing at 18:59 then 20:00 on consecutive
 * ticks, because one cycle happened to take just over 61 minutes. An
 * exact-hour check has no way to catch a miss like that; a floor check
 * combined with a per-day dedupe key (see pragueDateKey) still sends at
 * most once a day, whichever tick after `hour` happens to land first.
 */
export function isPragueHourOrLater(now: Date, hour: number): boolean {
  return pragueHour(now) >= hour;
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
