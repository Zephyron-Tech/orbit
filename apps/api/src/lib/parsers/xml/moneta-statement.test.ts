import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMonetaCsv } from '@orbit-api/lib/parsers/csv/moneta';
import { decodeCsv } from '@orbit-api/lib/parsers/csv/decode';
import { CsvStructureError } from '@orbit-api/lib/parsers/csv/types';

import { parseMonetaStatement } from './moneta-statement';

const STATEMENT = join(process.cwd(), 'docs/samples/moneta/statement-2026-07.xml');
const SAVINGS = join(process.cwd(), 'docs/samples/moneta/statement-savings-2026-07.xml');
const CSV = join(process.cwd(), 'docs/samples/moneta/2026-07.csv');

function load(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('parseMonetaStatement', () => {
  const result = parseMonetaStatement(load(STATEMENT));

  it('reads every transaction', () => {
    expect(result.transactions).toHaveLength(84);
    expect(result.declaredCount).toBe(84);
  });

  it('reads the balances the CSV export does not carry', () => {
    expect(result.openingBalance).toBe('150589.30');
    expect(result.closingBalance).toBe('184186.86');
  });

  it('verifies itself and reports nothing wrong with a real statement', () => {
    expect(result.warnings).toEqual([]);
  });

  it('reads the period from the document, not from the calendar', () => {
    expect(result.period).toEqual({ number: '2026000007', from: '2026-06-30', to: '2026-07-31' });
  });

  it('handles a statement period that is not a calendar month', () => {
    // The savings account closes around the 24th.
    const savings = parseMonetaStatement(load(SAVINGS));

    expect(savings.period.from).toBe('2026-06-24');
    expect(savings.period.to).toBe('2026-07-24');
    expect(savings.transactions).toHaveLength(4);
    expect(savings.warnings).toEqual([]);
  });

  it('parses ".00" as a valid zero balance', () => {
    expect(parseMonetaStatement(load(SAVINGS)).openingBalance).toBe('0.00');
  });

  it('resolves a merchant for card payments and a name for transfers', () => {
    const merchants = result.transactions.map((transaction) => transaction.merchant);

    expect(merchants).toContain('Footshop s.r.o. Prague CZ');
    expect(merchants.every((merchant) => merchant !== null)).toBe(true);
  });

  it('recognises a counterparty account but not a payment-method label', () => {
    const card = result.transactions.find((t) => t.merchant === 'Footshop s.r.o. Prague CZ');
    const transfer = result.transactions.find((t) => t.counterAccount !== null);

    expect(card?.counterAccount).toBeNull();
    expect(transfer?.counterAccount).toMatch(/\d/);
  });

  it('stores amounts as exact decimal strings', () => {
    expect(result.transactions.every((t) => /^-?\d+\.\d{2}$/.test(t.amount))).toBe(true);
  });

  it('dates transactions at midnight UTC of the effective day', () => {
    expect(result.transactions.every((t) => t.date.getUTCHours() === 0)).toBe(true);
  });
});

describe('statement and CSV agree', () => {
  const statement = parseMonetaStatement(load(STATEMENT));
  const csv = parseMonetaCsv(decodeCsv(readFileSync(CSV)).text);

  it('produces the same canonical reference for every transaction', () => {
    const fromStatement = new Set(statement.transactions.map((t) => t.externalId));
    const fromCsv = new Set(csv.transactions.map((t) => t.externalId));

    // This is what stops a statement import duplicating a month already
    // imported from CSV.
    expect(fromStatement.size).toBe(84);
    expect([...fromCsv].every((reference) => fromStatement.has(reference))).toBe(true);
  });

  it('agrees on amounts and dates', () => {
    const byReference = new Map(statement.transactions.map((t) => [t.externalId, t]));

    for (const row of csv.transactions) {
      const twin = byReference.get(row.externalId);

      expect(twin?.amount).toBe(row.amount);
      expect(twin?.date.toISOString()).toBe(row.date.toISOString());
    }
  });
});

describe('parseMonetaStatement self-check', () => {
  it('notices a transaction removed from the document', () => {
    const xml = load(STATEMENT).replace(/<transaction\b[\s\S]*?<\/transaction>/, '');
    const result = parseMonetaStatement(xml);

    expect(result.warnings.join(' ')).toMatch(/hlásí 84 transakcí, načteno 83/);
  });

  it('notices an amount that no longer adds up', () => {
    const xml = load(STATEMENT).replace('amount="-3328.00"', 'amount="-3329.00"');
    const result = parseMonetaStatement(xml);

    expect(result.warnings.join(' ')).toMatch(/Součet výdajů/);
  });

  it('notices a closing balance that contradicts the movements', () => {
    const xml = load(STATEMENT).replace('<stm-bal-end>184186.86</stm-bal-end>', '<stm-bal-end>999999.00</stm-bal-end>');
    const result = parseMonetaStatement(xml);

    expect(result.warnings.join(' ')).toMatch(/konečný/);
  });

  it('rejects a document that is not a Moneta statement', () => {
    expect(() => parseMonetaStatement('<nope/>')).toThrow(CsvStructureError);
  });

  it('reads an empty date-previous (account\'s first-ever statement) as no prior coverage, not a parse error', () => {
    const xml = load(STATEMENT).replace('date-previous="2026-06-30"', 'date-previous=""');
    const result = parseMonetaStatement(xml);

    expect(result.period.from).toBeNull();
    expect(result.period.to).toBe('2026-07-31');
  });

  it('falls back to attributes for two distinct rows sharing one @id, instead of silently dropping one at import time', () => {
    // Moneta genuinely does this on a same-day interest+tax pair (verified
    // against a real savings statement); reproduced here by forcing two
    // otherwise-distinct real rows to share an id.
    const xml = load(STATEMENT).replace('id="666253V736248517386"', 'id="980718S58185102457"');
    const result = parseMonetaStatement(xml);

    const affected = result.transactions.filter((t) => t.raw['@id'] === '980718S58185102457');

    expect(affected).toHaveLength(2);
    expect(affected.every((t) => t.externalId === null)).toBe(true);
    // Untouched rows keep their reference.
    expect(result.transactions.filter((t) => t.externalId === null)).toHaveLength(2);
    // Not surfaced as a warning: it would otherwise block the checkpoint
    // anchor every time a savings statement has interest, i.e. monthly.
    expect(result.warnings).toEqual([]);
  });
});
