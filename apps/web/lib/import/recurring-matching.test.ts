import { describe, expect, it } from 'vitest';

import { buildRecurringMerchantIndex } from './recurring-matching';

describe('buildRecurringMerchantIndex', () => {
  it('matches cosmetic merchant variants to one recurring expense', () => {
    const index = buildRecurringMerchantIndex([
      { merchant: 'PilsFree Internet, s.r.o.', recurringExpenseId: 'internet' },
      { merchant: 'PILSFREE INTERNET S R O', recurringExpenseId: 'internet' },
    ]);
    expect(index.get('PILSFREE INTERNET S R O')).toBe('internet');
  });

  it('omits a merchant with conflicting historical assignments', () => {
    const index = buildRecurringMerchantIndex([
      { merchant: 'ČEZ, A. S.', recurringExpenseId: 'electricity' },
      { merchant: 'ČEZ A.S.', recurringExpenseId: 'rent' },
    ]);
    expect(index.has('CEZ A S')).toBe(false);
  });
});
