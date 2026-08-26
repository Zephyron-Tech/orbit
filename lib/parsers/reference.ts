/**
 * Moneta prints the same transaction reference two different ways.
 *
 *   CSV "Bankovní reference": 0204370628:20260701:00001:260701S00434438910
 *   XML statement `id`:                             260701S00434438910
 *
 * The leading segments are the account, the booking date and a per-day
 * sequence — all derivable from the row itself. Only the final segment is the
 * bank's own unique identifier, and it is the one both formats agree on.
 *
 * Deduplication keys on the canonical form, so the same transaction imported
 * from a CSV export and from a monthly statement is recognised as one row.
 * Verified against a real July export and statement: 84 of 84 matched.
 */
export function normalizeSourceReference(reference: string | null | undefined): string | null {
  const trimmed = reference?.trim();

  if (!trimmed) {
    return null;
  }

  const tail = trimmed.split(':').pop()?.trim();

  return tail && tail.length > 0 ? tail : null;
}
