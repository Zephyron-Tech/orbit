import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CsvStructureError } from '@/lib/parsers/csv/types';

import { parseMonetaCreditCardStatement } from './moneta-credit-card-statement';

const FIXTURE = join(process.cwd(), 'docs/samples/moneta/credit-card-2026-08.txt');

function load(): string {
  return readFileSync(FIXTURE, 'utf8');
}

describe('parseMonetaCreditCardStatement', () => {
  const result = parseMonetaCreditCardStatement(load());

  it('reads every transaction, including the rewards section on page 2', () => {
    expect(result.transactions).toHaveLength(15);
  });

  it('reads the period from the document', () => {
    expect(result.period).toEqual({ from: '2026-07-31', to: '2026-08-31' });
  });

  it('reads the card contract number and last four digits', () => {
    expect(result.sourceAccountId).toBe('1010774842');
    expect(result.sourceCardLast4).toBe('1234');
  });

  it('reads the balances', () => {
    expect(result.openingBalance).toBe('0.00');
    expect(result.closingBalance).toBe('-12586.86');
  });

  it('verifies itself and reports nothing wrong with a real statement', () => {
    expect(result.warnings).toEqual([]);
  });

  it('reads amounts as exact decimal strings, negative for a purchase', () => {
    const purchase = result.transactions.find((t) => t.merchant === 'Orlen Litvinov CZ' && t.amount === '-2000.00');

    expect(purchase).toBeDefined();
  });

  it('reads a positive amount for a reward credit', () => {
    const reward = result.transactions.filter((t) => t.merchant === 'ODMĚNA BALÍČKU VÝHOD');

    expect(reward).toHaveLength(2);
    expect(reward.map((t) => t.amount).sort()).toEqual(['12.85', '3.79']);
  });

  it('has no per-row reference — every transaction falls back to the attribute idempotency strategy', () => {
    expect(result.transactions.every((t) => t.externalId === null)).toBe(true);
  });

  it('dates transactions at midnight UTC of the posting day, not the valuta day', () => {
    const purchase = result.transactions.find((t) => t.merchant === 'KAUFLAND CZ 1510 PLZEN BORY CZ');

    // Posting date is 20.08.2026; valuta (the second date line) is 19.08.2026.
    expect(purchase?.date.toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });
});

describe('parseMonetaCreditCardStatement self-check', () => {
  it('notices a closing balance that contradicts the opening balance and transactions', () => {
    const text = load().replace('Celkem dlužná částka - 12 586,86', 'Celkem dlužná částka - 99 999,99');
    const result = parseMonetaCreditCardStatement(text);

    expect(result.warnings.join(' ')).toMatch(/výpis uvádí konečnou dlužnou částku/);
  });
});

describe('parseMonetaCreditCardStatement malformed input', () => {
  it('rejects a document that is not a Moneta credit card statement', () => {
    expect(() => parseMonetaCreditCardStatement('this is not a statement')).toThrow(CsvStructureError);
  });

  it('rejects a statement with no transaction rows at all', () => {
    const text = load().replace(/\d{2}\.\d{2}\.\d{4}\n\d{2}\.\d{2}\.\d{4}\n.+ -?[\d ]+,\d{2}\n?/g, '');

    expect(() => parseMonetaCreditCardStatement(text)).toThrow(CsvStructureError);
  });

  it('throws when the card number cannot be found', () => {
    const text = load().replace(/karta číslo xxxx xxxx xxxx 1234/, 'karta číslo neznámá');

    expect(() => parseMonetaCreditCardStatement(text)).toThrow(CsvStructureError);
  });
});
