'use client';

import { useState } from 'react';

/**
 * A money-amount input that shows the Czech thousands-grouped form
 * ("12 000") once you leave the field, and the plain digits while you're
 * actively typing in it — reformatting on every keystroke is what causes
 * cursor-jump bugs, and there's no library here to offload that to (see
 * select-field.tsx: this whole app hand-rolls its own form primitives).
 *
 * `value`/`onChange` always carry the canonical, ungrouped string a form's
 * existing zod schema already expects (digits + at most one decimal
 * separator) — grouping is display-only, never part of the submitted value.
 */

/** Matches Intl.NumberFormat('cs-CZ')'s own grouping character. */
const GROUPING_SPACE = ' ';

function groupThousands(raw: string, decimalSeparator: '.' | ','): string {
  if (!raw) return raw;

  const [whole = '', fraction] = raw.split(decimalSeparator);
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUPING_SPACE);
  const withSign = `${negative ? '-' : ''}${grouped}`;

  return fraction === undefined ? withSign : `${withSign}${decimalSeparator}${fraction}`;
}

/** Strips anything that isn't a digit, the decimal separator, or a leading minus. */
function sanitize(raw: string, decimalSeparator: '.' | ',', allowNegative: boolean): string {
  const negative = allowNegative && raw.trim().startsWith('-');
  const separatorLiteral = decimalSeparator === '.' ? '\\.' : ',';
  const body = raw.replace(new RegExp(`[^\\d${separatorLiteral}]`, 'g'), '');
  const firstSeparator = body.indexOf(decimalSeparator);

  const cleaned =
    firstSeparator === -1
      ? body
      : `${body.slice(0, firstSeparator + 1)}${body.slice(firstSeparator + 1).replaceAll(decimalSeparator, '')}`;

  return negative ? `-${cleaned}` : cleaned;
}

export interface AmountFieldProps {
  /** Canonical value: digits, at most one `decimalSeparator`, optional leading "-". Never grouped. */
  value: string;
  onChange: (value: string) => void;
  /** Which character the field (and the caller's own validation schema) treats as the decimal point. Defaults to '.'. */
  decimalSeparator?: '.' | ',';
  allowNegative?: boolean;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
}

export function AmountField({
  value,
  onChange,
  decimalSeparator = '.',
  allowNegative = false,
  className,
  ...rest
}: AmountFieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);

  const displayValue = focused ? value : groupThousands(value, decimalSeparator);

  return (
    <input
      {...rest}
      inputMode="decimal"
      value={displayValue}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => onChange(sanitize(event.target.value, decimalSeparator, allowNegative))}
      className={className}
    />
  );
}
