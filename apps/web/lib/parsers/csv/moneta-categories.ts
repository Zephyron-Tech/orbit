/**
 * Moneta already categorizes card payments in its export ("Název kategorie").
 * Mapping those onto Orbit's own categories saves categorizing most of the
 * ledger by hand. Values are immutable seeded `Category.key`s.
 *
 * A category Moneta invents later simply stays unmapped: the transaction is
 * imported uncategorized rather than being dropped or guessed at.
 */
export const MONETA_CATEGORY_MAP: Readonly<Record<string, string>> = {
  'Jídlo a pití': 'groceries',
  Potraviny: 'groceries',
  Restaurace: 'restaurants',
  Benzín: 'fuel',
  Auto: 'transport',
  Doprava: 'transport',
  Bydlení: 'housing',
  Domácnost: 'housing',
  Energie: 'utilities',
  Zábava: 'subscriptions',
  'Krása a zdraví': 'health',
  Zdraví: 'health',
  Oblečení: 'shopping',
  Elektronika: 'shopping',
  Hotely: 'travel',
  Cestování: 'travel',
  Služby: 'subscriptions',
  Bankomat: 'transfer',
};

/** Returns the Orbit category name for a Moneta label, or null when unmapped. */
export function mapMonetaCategory(sourceCategory: string | null): string | null {
  if (!sourceCategory) {
    return null;
  }

  return MONETA_CATEGORY_MAP[sourceCategory.trim()] ?? null;
}

/**
 * Moneta never puts a bank category on savings-account interest — verified
 * against a real export: "KREDITNÍ ÚROKY" / "Úroky/poplatky" both carry an
 * empty `Název kategorie`. There is nothing to map, so this classifies by the
 * merchant text itself instead, the same fallback role `classifyByMerchant`
 * plays for T212 dividends and interest.
 */
const MERCHANT_PATTERNS: readonly { pattern: RegExp; category: string }[] = [{ pattern: /\bUROK/, category: 'interest' }];

/** Diacritic- and case-insensitive: "KREDITNÍ ÚROKY" and "kreditni uroky" match alike. */
function foldForMatching(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/**
 * Classifies a transaction by its merchant or description text when the bank
 * supplies no category at all. Checked only as a fallback after
 * `mapMonetaCategory` — an actual bank-supplied category always wins.
 */
export function classifyByMerchant(merchant: string | null, description: string | null): string | null {
  const haystack = foldForMatching(`${merchant ?? ''} ${description ?? ''}`);

  for (const { pattern, category } of MERCHANT_PATTERNS) {
    if (pattern.test(haystack)) {
      return category;
    }
  }

  return null;
}
