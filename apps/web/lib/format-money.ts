const FORMATTERS = new Map<string, Intl.NumberFormat>();

/** Formats a decimal-string amount (already `.toFixed(2)`'d server-side, may start with `+`/`-`) via Intl, matching the dashboard/net-worth pages' original `Prisma.Decimal`-based formatting exactly. */
export function formatMoney(value: string, currency = 'CZK'): string {
  let formatter = FORMATTERS.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    FORMATTERS.set(currency, formatter);
  }
  const sign = value.startsWith('+') ? '+' : '';
  const numeric = Number(value.startsWith('+') ? value.slice(1) : value);
  return sign + formatter.format(numeric);
}
