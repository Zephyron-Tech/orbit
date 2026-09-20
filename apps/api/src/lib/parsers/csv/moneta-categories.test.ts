import { describe, expect, it } from 'vitest';

import { classifyByMerchant, mapMonetaCategory } from './moneta-categories';

describe('mapMonetaCategory', () => {
  it('maps a known bank category', () => {
    expect(mapMonetaCategory('Jídlo a pití')).toBe('groceries');
    expect(mapMonetaCategory('Benzín')).toBe('fuel');
  });

  it('leaves an unmapped category alone rather than guessing', () => {
    expect(mapMonetaCategory('Kategorie, kterou Moneta teprve vymyslí')).toBeNull();
  });

  it('returns null for no category', () => {
    expect(mapMonetaCategory(null)).toBeNull();
  });
});

describe('classifyByMerchant', () => {
  it('recognises the real savings-account interest case', () => {
    // Merchant "KREDITNÍ ÚROKY", description "Úroky/poplatky" — no bank category.
    expect(classifyByMerchant('KREDITNÍ ÚROKY', 'Úroky/poplatky')).toBe('interest');
  });

  it('is diacritic- and case-insensitive', () => {
    expect(classifyByMerchant('kreditni uroky', null)).toBe('interest');
    expect(classifyByMerchant('Úrok z vkladu', null)).toBe('interest');
  });

  it('checks the description too, not only the merchant', () => {
    expect(classifyByMerchant('MMB, a. s.', 'Kreditní úrok')).toBe('interest');
  });

  it('does not match an unrelated merchant', () => {
    expect(classifyByMerchant('KAUFLAND CZ 1050 PRACHATICE', 'Použití platební karty')).toBeNull();
  });

  it('returns null when both fields are empty', () => {
    expect(classifyByMerchant(null, null)).toBeNull();
  });

  it('does not false-positive on an unrelated word containing similar letters', () => {
    // Regression guard: the pattern must not fire on merchants that merely
    // share letters with "úrok" (e.g. "EUROKONTAKT").
    expect(classifyByMerchant('EUROKONTAKT PRAHA', null)).toBeNull();
  });
});
