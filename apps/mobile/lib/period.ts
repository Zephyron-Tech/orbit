// Mirrors apps/web/lib/ui/period.ts's month-key helpers (no localStorage/cookie
// persistence here — mobile keeps the picked period as plain screen state).

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'] as const;

export function isPeriod(value: string | null | undefined): value is string {
  return typeof value === 'string' && PERIOD_PATTERN.test(value);
}

export function formatPeriod(value: string): string {
  const match = PERIOD_PATTERN.exec(value);
  if (!match?.[1] || !match[2]) return value;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

export function offsetPeriod(value: string, offset: number): string {
  if (!isPeriod(value)) return value;
  const [year, month] = value.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
