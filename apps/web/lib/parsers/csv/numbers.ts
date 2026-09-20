/**
 * Czech bank exports write amounts as "-1 234,50": decimal comma, optional
 * thousands separators that may be a plain space or a non-breaking space.
 *
 * Everything here works on strings. Parsing through `Number` would lose
 * precision on amounts that binary floating point cannot represent, and those
 * cents accumulate into a settlement that never matches the bank.
 */

const AMOUNT_PATTERN = /^(?<sign>[+-])?(?<whole>\d+)(?:[.,](?<fraction>\d+))?$/;

/** Space, non-breaking space, narrow no-break space and thin space. */
const SEPARATORS = /[\s   ']/g;

export class AmountParseError extends Error {
  constructor(readonly raw: string) {
    super(`Cannot parse amount: ${JSON.stringify(raw)}`);
    this.name = 'AmountParseError';
  }
}

/**
 * Parses a Czech-formatted amount into a canonical decimal string that
 * `Prisma.Decimal` accepts verbatim. The sign is preserved: Moneta already
 * writes expenses as negative, matching Orbit's own convention.
 */
export function parseCzechAmount(raw: string): string {
  const cleaned = raw.trim().replace(SEPARATORS, '');

  if (cleaned.length === 0) {
    throw new AmountParseError(raw);
  }

  const match = AMOUNT_PATTERN.exec(cleaned);

  if (!match?.groups) {
    throw new AmountParseError(raw);
  }

  const { sign, whole, fraction } = match.groups;

  if (whole === undefined) {
    throw new AmountParseError(raw);
  }

  // Trim leading zeros but keep a single digit, so "007,50" becomes "7.50".
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFraction = (fraction ?? '').padEnd(2, '0');
  const value = `${normalizedWhole}.${normalizedFraction}`;

  // Avoid "-0.00", which is a different string but the same number.
  if (sign === '-' && /^0\.0*$/.test(value)) {
    return value;
  }

  return sign === '-' ? `-${value}` : value;
}
