/**
 * Turns a real Moneta CSV export into a committable test fixture.
 *
 * Direct identifiers (account numbers, IBAN, card numbers, names of natural
 * persons, payment symbols, free-text messages) are replaced with deterministic
 * pseudonyms, so the same input always yields the same output and relationships
 * between rows survive: the same counterparty keeps the same fake account.
 *
 * Deliberately preserved, because the parser tests depend on them:
 *   - amounts, dates and their formatting quirks
 *   - merchant strings from `Popis platby` (truncation, diacritics, spacing)
 *   - company counterparties, which are not personal data
 *   - `Bankovní reference` uniqueness and its four-part structure
 *
 * Usage: npx tsx scripts/anonymize-moneta-csv.ts <input.csv> <output.csv>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const FAKE_ACCOUNT = '111222333/0600';
const FAKE_ACCOUNT_BARE = '0111222333';
const FAKE_IBAN = 'CZ6506000000000111222333';
const FAKE_CARD = '464461******0000';

/** Natural persons only. Companies stay as they are. */
const PERSON_NAMES = [
  'NOVÁKOVÁ JANA',
  'SVOBODOVÁ MARIE',
  'DVOŘÁK IVO',
  'PROCHÁZKOVÁ IVA',
  'NOVÁK JAN',
  'KRÁLOVÁ EVA',
  'BENEŠ PETR',
];

/** Anything that looks like a company keeps its real name. */
const COMPANY_MARKERS = [
  'A.S.',
  'A. S.',
  'S.R.O.',
  'SPOL.',
  'REPUBLIC',
  'PRODEJ',
  'NFCTRON',
  'VODAFONE',
  'ČEZ',
  'O2',
];

function isCompany(name: string): boolean {
  const upper = name.toUpperCase();

  return COMPANY_MARKERS.some((marker) => upper.includes(marker));
}

/** Stable pseudonym: the same input always maps to the same index. */
function pick<T>(pool: readonly T[], seed: string): T {
  const digest = createHash('sha256').update(seed).digest();
  const item = pool[digest.readUInt32BE(0) % pool.length];

  if (item === undefined) {
    throw new Error('Empty pseudonym pool');
  }

  return item;
}

/** Replaces every digit run with stable pseudo-digits, keeping the layout. */
function scrambleDigits(value: string, seed: string): string {
  return value.replace(/\d+/g, (run) => {
    const digest = createHash('sha256').update(`${seed}:${run}`).digest('hex');

    return digest.replace(/\D/g, '').padEnd(run.length, '0').slice(0, run.length);
  });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((cell) => cell.trim().length > 0));
}

function toCsv(rows: readonly string[][]): string {
  return `${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\r\n')}\r\n`;
}

function main(): void {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath || !outputPath) {
    throw new Error('Usage: anonymize-moneta-csv.ts <input.csv> <output.csv>');
  }

  const rows = parseCsv(readFileSync(inputPath, 'utf8').replace(/^﻿/, ''));
  const header = rows[0];

  if (!header) {
    throw new Error('Empty CSV');
  }

  const at = (name: string): number => {
    const index = header.indexOf(name);

    if (index === -1) {
      throw new Error(`Missing column: ${name}`);
    }

    return index;
  };

  const columns = {
    account: at('Číslo účtu'),
    iban: at('IBAN'),
    counterAccount: at('Číslo protiúčtu'),
    counterName: at('Název účtu příjemce'),
    variableSymbol: at('Variabilní Symbol'),
    specificSymbol: at('Specifický Symbol'),
    message: at('Zpráva pro příjemce'),
    note: at('Poznámka pro mě'),
    standingOrder: at('Název trvalého příkazu'),
    description: at('Popis platby'),
    description2: at('Popis platby 2'),
    description3: at('Popis platby 3'),
    constantSymbol: at('Konstantní Symbol'),
    reference: at('Bankovní reference'),
    card: at('Číslo karty'),
    method: at('Platební metoda'),
  };

  // Pass 1: collect natural persons' names from the two structured columns that
  // hold them, and build a token-level replacement map. Names leak into free
  // text ("JAN NOVÁK" in a message, a counterparty name in `Popis platby`), so a
  // per-column replacement is not enough. Names are never inferred from the
  // description columns: that would also rewrite towns and merchants.
  const nameTokens = new Map<string, string>();

  const registerName = (real: string): void => {
    const trimmed = real.trim();

    if (!trimmed || isCompany(trimmed)) {
      return;
    }

    const fake = pick(PERSON_NAMES, trimmed.toUpperCase());
    const realParts = trimmed.split(/\s+/);
    const fakeParts = fake.split(/\s+/);

    realParts.forEach((part, index) => {
      if (part.length >= 3) {
        nameTokens.set(part.toUpperCase(), fakeParts[index % fakeParts.length] ?? fakeParts[0] ?? 'NOVÁK');
      }
    });
  };

  for (const row of rows.slice(1)) {
    registerName(row[columns.counterName] ?? '');
    registerName(row[columns.method] ?? '');
  }

  /** Replaces any known person-name token wherever it appears in free text. */
  const scrubNames = (value: string): string =>
    value.replace(/[\p{L}]{3,}/gu, (word) => nameTokens.get(word.toUpperCase()) ?? word);

  const anonymized = rows.slice(1).map((row) => {
    const next = [...row];

    next[columns.account] = FAKE_ACCOUNT;
    next[columns.iban] = FAKE_IBAN;

    const counterAccount = row[columns.counterAccount] ?? '';
    if (counterAccount.trim()) {
      next[columns.counterAccount] = scrambleDigits(counterAccount, 'counter-account');
    }

    const counterName = row[columns.counterName] ?? '';
    if (counterName.trim() && !isCompany(counterName)) {
      next[columns.counterName] = pick(PERSON_NAMES, counterName.toUpperCase());
    }

    for (const column of [columns.variableSymbol, columns.specificSymbol]) {
      const value = row[column] ?? '';
      if (value.trim()) {
        next[column] = scrambleDigits(value, 'symbol');
      }
    }

    // Free text can contain contract numbers, receipt links and personal notes.
    for (const column of [columns.message, columns.note, columns.standingOrder]) {
      const value = row[column] ?? '';
      if (value.trim()) {
        next[column] = scrubNames(scrambleDigits(value, 'text')).replace(
          /https?\S+/gi,
          'https://example.test/receipt',
        );
      }
    }

    // `Popis platby` holds a merchant for card payments but a person for
    // transfers; only the latter is replaced. The extra description columns can
    // hold an ATM street address, so their digits are scrambled.
    const description = row[columns.description] ?? '';
    if (description.trim()) {
      next[columns.description] = scrubNames(description);
    }

    for (const column of [columns.description2, columns.description3]) {
      const value = row[column] ?? '';
      if (value.trim()) {
        next[column] = scrubNames(scrambleDigits(value, 'description'));
      }
    }

    // A real constant symbol is at most four digits; anything longer is a
    // card fragment that Moneta put in the wrong column.
    const constantSymbol = row[columns.constantSymbol] ?? '';
    if (constantSymbol.trim().length > 4) {
      next[columns.constantSymbol] = scrambleDigits(constantSymbol, 'constant-symbol');
    }

    // The reference is the deduplication key: keep its shape and uniqueness,
    // replace only the account prefix and the trailing bank reference.
    const reference = row[columns.reference] ?? '';
    if (reference.trim()) {
      const parts = reference.split(':');
      if (parts.length === 4) {
        parts[0] = FAKE_ACCOUNT_BARE;
        parts[3] = scrambleDigits(parts[3] ?? '', 'reference');
        next[columns.reference] = parts.join(':');
      } else {
        next[columns.reference] = scrambleDigits(reference, 'reference');
      }
    }

    const card = row[columns.card] ?? '';
    if (card.trim()) {
      // Keep the odd ATM variant recognisable, it is a real parser edge case.
      next[columns.card] = card.startsWith('ADATM') ? 'ADATM0******000' : FAKE_CARD;
    }

    // The payment method column sometimes holds a person's name instead.
    const method = row[columns.method] ?? '';
    if (method.trim() && !method.toUpperCase().startsWith('PLATBA') && !method.toUpperCase().startsWith('VÝBĚR')) {
      next[columns.method] = pick(PERSON_NAMES, method.toUpperCase());
    }

    return next;
  });

  const references = anonymized.map((row) => row[columns.reference]);
  if (new Set(references).size !== references.length) {
    throw new Error('Anonymization collapsed distinct bank references');
  }

  writeFileSync(outputPath, `﻿${toCsv([header, ...anonymized])}`, 'utf8');
  console.log(`Anonymized ${anonymized.length} rows -> ${outputPath}`);
}

main();
