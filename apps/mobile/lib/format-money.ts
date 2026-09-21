const FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * Formats a decimal-string amount (already `.toFixed(2)`'d server-side, may
 * start with `+`/`-`) via Intl — ported verbatim from
 * apps/web/lib/format-money.ts so both apps render money identically.
 */
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
