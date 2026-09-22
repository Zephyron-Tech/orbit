const FORMATTER = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

/** Formats an ISO date (or date-time) string as a short Czech date, e.g. "22. 9. 2026". */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return FORMATTER.format(date);
}
