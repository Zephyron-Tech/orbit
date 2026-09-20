import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CsvStructureError } from '@orbit-api/lib/parsers/csv/types';

import { parseMonetaAccountStatement } from './moneta-account-statement';

const SAVINGS = join(process.cwd(), 'docs/samples/moneta/statement-savings-2026-08.pdf.txt');
const CHECKING_EUR = join(process.cwd(), 'docs/samples/moneta/statement-checking-eur-2026-08.pdf.txt');

function load(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('parseMonetaAccountStatement — savings account', () => {
  const result = parseMonetaAccountStatement(load(SAVINGS));

  it('reads every transaction', () => {
    expect(result.transactions).toHaveLength(3);
    expect(result.declaredCount).toBe(3);
  });

  it('reads the balances', () => {
    expect(result.openingBalance).toBe('0.00');
    expect(result.closingBalance).toBe('125092.85');
  });

  it('verifies itself and reports nothing wrong with a real statement', () => {
    expect(result.warnings).toEqual([]);
  });

  it('reads an empty "Předchozí výpis ze dne" (first-ever statement) as no prior coverage', () => {
    expect(result.period).toEqual({ number: '2026/1', from: null, to: '2026-08-31' });
  });

  it('falls back to the ATTRIBUTES strategy for a Kód transakce shared by two rows', () => {
    // Moneta reuses one code for a same-day interest+tax pair, same as the
    // XML statement — both rows here share "260831GTA900001".
    const interest = result.transactions.find((t) => t.merchant === 'KREDITNÍ ÚROKY');
    const tax = result.transactions.find((t) => t.merchant === 'Daň z úroku');

    expect(interest?.externalId).toBeNull();
    expect(tax?.externalId).toBeNull();
    expect(interest?.amount).toBe('109.24');
    expect(tax?.amount).toBe('-16.39');
  });

  it('recognises a counterparty account for a transfer, not for interest', () => {
    const transfer = result.transactions.find((t) => t.merchant === 'NOVÁK JAN');

    expect(transfer?.counterAccount).toBe('111222444/0600');
    expect(transfer?.externalId).toBe('260820XSB4228315073');

    const interest = result.transactions.find((t) => t.merchant === 'KREDITNÍ ÚROKY');
    expect(interest?.counterAccount).toBeNull();
  });

  it('stores amounts as exact decimal strings', () => {
    expect(result.transactions.every((t) => /^-?\d+\.\d{2}$/.test(t.amount))).toBe(true);
  });

  it('dates transactions at midnight UTC', () => {
    expect(result.transactions.every((t) => t.date.getUTCHours() === 0)).toBe(true);
  });
});

describe('parseMonetaAccountStatement — checking (EUR) account', () => {
  const result = parseMonetaAccountStatement(load(CHECKING_EUR));

  it('reads every transaction and self-verifies', () => {
    expect(result.transactions).toHaveLength(5);
    expect(result.declaredCount).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  it('reads the currency from the document, not assumed CZK', () => {
    expect(result.currency).toBe('EUR');
  });

  it('reads real per-row references, unlike the credit card PDF', () => {
    expect(result.transactions.every((t) => t.externalId !== null)).toBe(true);
  });

  it('skips the DI:/KI: continuation lines rather than misreading them as a new row', () => {
    expect(result.transactions.every((t) => t.merchant === 'PŘEVOD-KONVERZE MĚNY')).toBe(true);
  });
});

describe('parseMonetaAccountStatement self-check', () => {
  it('notices a closing balance that contradicts the movements', () => {
    const text = load(SAVINGS).replace('Konečný zůstatek:\n0,00\n125 092,85', 'Konečný zůstatek:\n0,00\n999 999,00');
    const result = parseMonetaAccountStatement(text);

    expect(result.warnings.join(' ')).toMatch(/konečný/);
  });

  it('notices a transaction count that does not match the declared total', () => {
    const text = load(SAVINGS).replace('Celkový počet transakcí: 3', 'Celkový počet transakcí: 4');
    const result = parseMonetaAccountStatement(text);

    expect(result.warnings.join(' ')).toMatch(/hlásí 4 transakcí, načteno 3/);
  });
});

describe('parseMonetaAccountStatement malformed input', () => {
  it('rejects a document that is not a Moneta account statement', () => {
    expect(() => parseMonetaAccountStatement('this is not a statement')).toThrow(CsvStructureError);
  });

  it('rejects a statement with no transaction rows at all', () => {
    const text = load(SAVINGS).replace(
      /\d{2}\.\d{2}\.\d{4} .*\n.*\n\d{2}\.\d{2}\.\d{4}\n?/g,
      '',
    );

    expect(() => parseMonetaAccountStatement(text)).toThrow(CsvStructureError);
  });
});
