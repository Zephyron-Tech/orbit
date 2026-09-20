import { describe, expect, it } from 'vitest';

import { recommendMerchantCategories, type MerchantCategoryEvidence } from './merchant-category-recommendations';

function row(overrides: Partial<MerchantCategoryEvidence> = {}): MerchantCategoryEvidence {
  return {
    id: crypto.randomUUID(),
    accountId: 'account-a',
    provider: 'MONETA',
    merchant: 'ORLEN LITVINOV CZ',
    date: new Date('2026-05-10T00:00:00Z'),
    amount: '-500.00',
    categoryId: 'fuel',
    settlementId: null,
    parentId: null,
    kind: 'NORMAL',
    ...overrides,
  };
}

describe('recommendMerchantCategories', () => {
  it('recommends a category after three consistent prior months', () => {
    const history = [
      row({ date: new Date('2026-04-01T00:00:00Z') }),
      row({ date: new Date('2026-05-01T00:00:00Z') }),
      row({ date: new Date('2026-06-01T00:00:00Z') }),
    ];
    const target = [row({ id: 'target', date: new Date('2026-07-01T00:00:00Z'), categoryId: null })];

    expect(recommendMerchantCategories(history, target, new Set(['fuel']))).toMatchObject([
      { categoryId: 'fuel', supportingMonths: 3, evidenceMonths: 3, targetIds: ['target'] },
    ]);
  });

  it('does not recommend conflicting or other-account evidence', () => {
    const history = [
      row({ date: new Date('2026-04-01T00:00:00Z'), categoryId: 'fuel' }),
      row({ date: new Date('2026-05-01T00:00:00Z'), categoryId: 'shopping' }),
      row({ date: new Date('2026-06-01T00:00:00Z'), accountId: 'account-b', categoryId: 'fuel' }),
    ];
    const target = [row({ id: 'target', date: new Date('2026-07-01T00:00:00Z'), categoryId: null })];

    expect(recommendMerchantCategories(history, target, new Set(['fuel', 'shopping']))).toEqual([]);
  });

  it('never targets settled, split, income, or already categorized rows', () => {
    const history = [
      row({ date: new Date('2026-04-01T00:00:00Z') }),
      row({ date: new Date('2026-05-01T00:00:00Z') }),
      row({ date: new Date('2026-06-01T00:00:00Z') }),
    ];
    const target = [
      row({ id: 'settled', date: new Date('2026-07-01T00:00:00Z'), categoryId: null, settlementId: 's' }),
      row({ id: 'child', date: new Date('2026-07-01T00:00:00Z'), categoryId: null, parentId: 'p' }),
      row({ id: 'income', date: new Date('2026-07-01T00:00:00Z'), categoryId: null, amount: '500' }),
      row({ id: 'done', date: new Date('2026-07-01T00:00:00Z') }),
    ];

    expect(recommendMerchantCategories(history, target, new Set(['fuel']))).toEqual([]);
  });
});
