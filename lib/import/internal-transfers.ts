/**
 * A transfer between two accounts that both belong to us appears twice: once as
 * an outgoing row on one statement and once as an incoming row on the other.
 * Counting both inflates income and spending by the same amount and distorts
 * cash-flow, so they are flagged on import and skipped by every aggregate.
 */

/**
 * Reduces an account number to its comparable core.
 *
 * Statements are inconsistent: the owning account is printed as
 * "204370628/0600" while the same account as a counterparty is just
 * "204370628". Prefixed accounts ("670100-2205220540") keep only the part after
 * the dash, which is the account number proper.
 */
export function normalizeAccountNumber(value: string): string {
  const trimmed = value.trim().replace(/\s/g, '');

  if (!trimmed) {
    return '';
  }

  const withoutBankCode = trimmed.split('/')[0] ?? '';
  const withoutPrefix = withoutBankCode.includes('-')
    ? (withoutBankCode.split('-').pop() ?? '')
    : withoutBankCode;

  // Leading zeros are cosmetic: "0204370628" and "204370628" are one account.
  return withoutPrefix.replace(/^0+(?=\d)/, '');
}

/** Builds the set of account numbers Orbit knows about. */
export function buildOwnAccountIndex(accounts: readonly { externalId: string | null }[]): Set<string> {
  const index = new Set<string>();

  for (const account of accounts) {
    const normalized = account.externalId ? normalizeAccountNumber(account.externalId) : '';

    if (normalized) {
      index.add(normalized);
    }
  }

  return index;
}

/**
 * True when the counterparty is one of our own accounts.
 *
 * `ownAccounts` must exclude the account being imported: a statement never
 * lists itself as the counterparty, but a self-match would silently flag
 * genuine payments if it ever did.
 */
export function isInternalTransfer(counterAccount: string | null, ownAccounts: ReadonlySet<string>): boolean {
  if (!counterAccount) {
    return false;
  }

  const normalized = normalizeAccountNumber(counterAccount);

  return normalized.length > 0 && ownAccounts.has(normalized);
}

/** Moneta card/bank transfer description used for broker funding when no counter-account is exported. */
export function isTrading212Funding(merchant: string | null, description: string | null, amount: string): boolean {
  if (!amount.trim().startsWith('-')) return false;
  const text = `${merchant ?? ''} ${description ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return /TRADING\s*212/.test(text);
}
