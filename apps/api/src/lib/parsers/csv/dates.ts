/**
 * Bank statements carry a calendar day, not an instant. "23.07.2026" means the
 * whole day in Prague, so it is stored as midnight UTC of that day: any local
 * timezone offset would shift a late-evening transaction into the neighbouring
 * day and, at a month boundary, into the wrong settlement period.
 */

const DATE_PATTERN = /^(?<day>\d{1,2})\.\s?(?<month>\d{1,2})\.\s?(?<year>\d{4})$/;

export class DateParseError extends Error {
  constructor(readonly raw: string) {
    super(`Cannot parse date: ${JSON.stringify(raw)}`);
    this.name = 'DateParseError';
  }
}

/** Parses "DD.MM.YYYY" into midnight UTC of that calendar day. */
export function parseCzechDate(raw: string): Date {
  const match = DATE_PATTERN.exec(raw.trim());

  if (!match?.groups) {
    throw new DateParseError(raw);
  }

  const day = Number(match.groups.day);
  const month = Number(match.groups.month);
  const year = Number(match.groups.year);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Date.UTC silently rolls over: 31.02. would become 3 March. Round-trip the
  // components to reject a date the calendar does not have.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new DateParseError(raw);
  }

  return parsed;
}

/** Formats a stored booking date back to the export's own notation. */
export function formatCzechDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `${day}.${month}.${date.getUTCFullYear()}`;
}
