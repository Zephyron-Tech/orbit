export const PERIOD_COOKIE = 'orbit-period';
export const PERIOD_EVENT = 'orbit-period-change';

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
] as const;

export function isPeriod(value: string | null | undefined): value is string {
  return typeof value === 'string' && PERIOD_PATTERN.test(value);
}

export function formatPeriod(value: string): string {
  const match = PERIOD_PATTERN.exec(value);
  if (!match) return value;
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`;
}

export function offsetPeriod(value: string, offset: number): string {
  if (!isPeriod(value)) return value;
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodParts(value: string): { year: number; month: number } | null {
  if (!isPeriod(value)) return null;
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

export function storePeriod(value: string): void {
  if (!isPeriod(value)) return;
  document.cookie = `${PERIOD_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(PERIOD_EVENT, { detail: value }));
}
