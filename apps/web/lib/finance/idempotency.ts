/**
 * Merchant-name normalization. Pure. This is a trimmed copy of the API's own
 * `lib/finance/idempotency.ts` — only `normalizeMerchant` is needed
 * client-side (the transaction table groups by it for merchant-category
 * suggestions); the idempotency-key builders that give this file its name
 * are import-pipeline concerns that stay API-only.
 *
 * Trim, collapse whitespace, uppercase, strip diacritics — everything else
 * that is not a letter, digit or space.
 */
export function normalizeMerchant(merchant: string | null | undefined): string {
  if (!merchant) {
    return '';
  }

  return merchant
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
