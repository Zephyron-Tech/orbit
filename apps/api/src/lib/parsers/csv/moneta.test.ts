import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { decodeCsv } from './decode';
import { parseMonetaCsv } from './moneta';
import { mapMonetaCategory } from './moneta-categories';
import { CsvStructureError } from './types';

const FIXTURE = join(process.cwd(), 'docs/samples/moneta/2026-07.csv');

function loadFixture(): string {
  return decodeCsv(readFileSync(FIXTURE)).text;
}

describe('parseMonetaCsv', () => {
  const result = parseMonetaCsv(loadFixture());

  it('parses every row of a real export without failures', () => {
    expect(result.transactions).toHaveLength(84);
    expect(result.failures).toHaveLength(0);
    expect(result.provider).toBe('MONETA');
  });

  it('reads the account number from the file itself', () => {
    expect(result.sourceAccountId).toBe('111222333/0600');
  });

  it('keeps the bank reference, which is unique per transaction', () => {
    const references = result.transactions.map((transaction) => transaction.externalId);

    expect(new Set(references).size).toBe(references.length);
    expect(references.every((reference) => reference !== null)).toBe(true);
  });

  it('preserves the sign convention: expenses negative, income positive', () => {
    const deposit = result.transactions.find((t) => t.merchant === 'VKLAD ATM MONETA TOKEN');
    const withdrawal = result.transactions.find((t) => t.merchant === 'MMB ZAHRADNI Prachatice CZ');

    expect(deposit?.amount).toBe('3500.00');
    expect(withdrawal?.amount).toBe('-6000.00');
  });

  it('parses amounts as exact decimal strings', () => {
    const amounts = result.transactions.map((transaction) => transaction.amount);

    expect(amounts).toContain('-162.90');
    expect(amounts).toContain('-428.99');
    expect(amounts).toContain('-908.50');
    expect(amounts.every((amount) => /^-?\d+\.\d{2}$/.test(amount))).toBe(true);
  });

  it('uses the booking date at midnight UTC', () => {
    const dates = result.transactions.map((transaction) => transaction.date);

    expect(dates.every((date) => date.getUTCHours() === 0 && date.getUTCMinutes() === 0)).toBe(true);
    // A purchase booked on 1 July belongs to July, not to June.
    expect(dates.some((date) => date.toISOString() === '2026-07-01T00:00:00.000Z')).toBe(true);
  });

  it('does not mistake the single space Moneta writes for a real description', () => {
    // Direct debits have `Popis platby` = " " and the payee in `Název účtu příjemce`.
    const directDebits = result.transactions.filter((t) => t.raw['Typ transakce'] === 'Inkaso');

    expect(directDebits.length).toBeGreaterThan(0);
    expect(directDebits.map((t) => t.merchant)).toContain('VODAFONE CR A.S.');
    expect(directDebits.every((t) => t.merchant !== null && t.merchant.trim().length > 0)).toBe(true);
  });

  it('resolves a merchant for every row', () => {
    expect(result.transactions.every((t) => t.merchant !== null)).toBe(true);
  });

  it('falls back to the standing order name when there is no counterparty', () => {
    const rent = result.transactions.find((t) => t.amount === '-18200.00');

    expect(rent?.merchant).toBe('Nájem a služby');
  });

  it('keeps the bank category so it can be mapped', () => {
    const fuel = result.transactions.find((t) => t.sourceCategory === 'Benzín');

    expect(fuel).toBeDefined();
    expect(mapMonetaCategory(fuel?.sourceCategory ?? null)).toBe('fuel');
    expect(mapMonetaCategory('Kategorie, kterou Moneta teprve vymyslí')).toBeNull();
  });

  it('parses a credit card history without an account-number column', () => {
    const credit = parseMonetaCsv(
      '"Číslo karty";"Popis platby";"Odesláno";"Datum uskutečnění";"Částka";"Měna";"Poznámka pro mě";"Název kategorie";"Bankovní reference";"Variabilní Symbol";"Specifický Symbol";"Platební metoda"\n"400000******1234";"Orlen Example CZ";"21.08.2026";"20.08.2026";"-2000,00";"CZK";"";"Benzín";"card-ref-1";"";"";""',
    );

    expect(credit.sourceAccountId).toBeNull();
    expect(credit.sourceCardLast4).toBe('1234');
    expect(credit.transactions[0]).toMatchObject({ amount: '-2000.00', externalId: 'card-ref-1', sourceCategory: 'Benzín' });
  });

  it('accepts a package-benefit reward row with no card number', () => {
    // "ODMĚNA BALÍČKU VÝHOD" posts to the credit account itself, not to a
    // specific card — a real export has this alongside normal card rows.
    const credit = parseMonetaCsv(
      '"Číslo karty";"Popis platby";"Odesláno";"Datum uskutečnění";"Částka";"Měna";"Poznámka pro mě";"Název kategorie";"Bankovní reference";"Variabilní Symbol";"Specifický Symbol";"Platební metoda"\n' +
        '"400000******1234";"Orlen Example CZ";"21.08.2026";"20.08.2026";"-2000,00";"CZK";"";"Benzín";"card-ref-1";"";"";""\n' +
        '"";"ODMĚNA BALÍČKU VÝHOD";"22.08.2026";"22.08.2026";"3,79";"CZK";"";"";"card-ref-2";"";"";""',
    );

    expect(credit.failures).toHaveLength(0);
    expect(credit.transactions).toHaveLength(2);
    expect(credit.sourceCardLast4).toBe('1234');
  });

  it('stores the whole source row for replay', () => {
    const [first] = result.transactions;

    // The raw row keeps the full reference; externalId keeps its canonical tail.
    expect(first?.raw['Bankovní reference']).toMatch(/:/);
    expect(first?.raw['Bankovní reference']?.endsWith(first?.externalId ?? '')).toBe(true);
    expect(Object.keys(first?.raw ?? {})).toHaveLength(23);
  });

  it('reduces the reference to the form a statement import also produces', () => {
    const [first] = result.transactions;

    expect(first?.externalId).not.toContain(':');
  });

  it('keeps genuinely identical same-day purchases apart', () => {
    // Two 50 CZK payments at the same club on the same day are not duplicates.
    const club = result.transactions.filter((t) => t.merchant === 'MUSIC CLUB HROZEN PRAC PRACHAT');

    expect(club).toHaveLength(2);
    expect(club[0]?.externalId).not.toBe(club[1]?.externalId);
  });
});

describe('parseMonetaCsv error handling', () => {
  it('rejects an export whose header has changed', () => {
    expect(() => parseMonetaCsv('"Datum";"Suma"\r\n"01.07.2026";"10,00"\r\n')).toThrow(CsvStructureError);
  });

  it('rejects an empty file', () => {
    expect(() => parseMonetaCsv('')).toThrow(CsvStructureError);
  });

  it('refuses an export that mixes several accounts', () => {
    const text = loadFixture().replace('111222333/0600', '999888777/0600');

    expect(() => parseMonetaCsv(text)).toThrow(/mixes several accounts/);
  });

  it('treats an account number missing its bank code as the same account', () => {
    // A real export had one row (an Apple Pay / T212 settlement row) print
    // "111222333" while every other row prints "111222333/0600" — same
    // account, and normalizing it avoids a false "mixes several accounts".
    const text = loadFixture().replace('"111222333/0600";"CZ6506000000000111222333"', '"111222333";"CZ6506000000000111222333"');
    const result = parseMonetaCsv(text);

    expect(result.failures).toHaveLength(0);
    expect(result.transactions).toHaveLength(84);
    expect(result.sourceAccountId).toBe('111222333');
  });

  it('reports a malformed row instead of dropping it', () => {
    const text = loadFixture().replace('"6500,00"', '"6 500 korun"');
    const result = parseMonetaCsv(text);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toMatch(/Cannot parse amount/);
    expect(result.failures[0]?.raw).toBeDefined();
    expect(result.transactions).toHaveLength(83);
  });

  it('reports a row without a bank reference rather than risking a collision', () => {
    const text = loadFixture().replace('0111222333:20260730:00001:387153XSB6798660716', '');
    const result = parseMonetaCsv(text);

    expect(result.failures[0]?.reason).toMatch(/Bankovní reference/);
  });
});
