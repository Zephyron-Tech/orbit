/**
 * Turns a real Moneta XML statement into a committable test fixture.
 *
 * A statement carries more personal data than a CSV export: the holder's full
 * name and postal address, the branch, marketing blocks with credit limits.
 * Those are removed outright; account numbers, symbols and counterparty names
 * are replaced with deterministic pseudonyms.
 *
 * Deliberately preserved, because the parser tests depend on them:
 *   - balances, turnovers and the transaction count, so the self-check still
 *     has something real to verify
 *   - amounts and dates
 *   - merchant strings from card payments
 *   - transaction id uniqueness and its shared-suffix relationship with the CSV
 *
 * Usage: npx tsx scripts/anonymize-moneta-statement.ts <input.xml> <output.xml>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const FAKE_ACCOUNT = '111222333';
const FAKE_IBAN = 'CZ6506000000000111222333';

const PERSON_NAMES = [
  'NOVÁKOVÁ JANA',
  'SVOBODOVÁ MARIE',
  'DVOŘÁK IVO',
  'PROCHÁZKOVÁ IVA',
  'NOVÁK JAN',
  'KRÁLOVÁ EVA',
  'BENEŠ PETR',
  'PÍSECKÝ LIBOR',
];

const COMPANY_MARKERS = ['A.S.', 'A. S.', 'S.R.O.', 'SPOL.', 'REPUBLIC', 'PRODEJ', 'NFCTRON', 'VODAFONE', 'ČEZ', 'O2'];

function isCompany(name: string): boolean {
  const upper = name.toUpperCase();

  return COMPANY_MARKERS.some((marker) => upper.includes(marker));
}

function pick<T>(pool: readonly T[], seed: string): T {
  const digest = createHash('sha256').update(seed).digest();
  const item = pool[digest.readUInt32BE(0) % pool.length];

  if (item === undefined) {
    throw new Error('Empty pseudonym pool');
  }

  return item;
}

/** Replaces digit runs with stable pseudo-digits, keeping the layout. */
function scrambleDigits(value: string, seed: string): string {
  return value.replace(/\d+/g, (run) => {
    const digest = createHash('sha256').update(`${seed}:${run}`).digest('hex');

    return digest.replace(/\D/g, '').padEnd(run.length, '0').slice(0, run.length);
  });
}

function replaceAttribute(xml: string, tag: string, attribute: string, value: (old: string) => string): string {
  const pattern = new RegExp(`(<${tag}\\b[^>]*?\\b${attribute}=")([^"]*)(")`, 'g');

  return xml.replace(pattern, (_match, prefix: string, old: string, suffix: string) => `${prefix}${value(old)}${suffix}`);
}

/** Matches the element with or without attributes — `trn-message` carries a `position`. */
function replaceElement(xml: string, tag: string, value: (old: string) => string): string {
  const pattern = new RegExp(`(<${tag}(?:\\s[^>]*)?>)([^<]*)(</${tag}>)`, 'g');

  return xml.replace(pattern, (_match, open: string, old: string, close: string) => `${open}${value(old)}${close}`);
}

function main(): void {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath || !outputPath) {
    throw new Error('Usage: anonymize-moneta-statement.ts <input.xml> <output.xml>');
  }

  let xml = readFileSync(inputPath, 'utf8');

  // Whole blocks of personal and marketing content: removed, not pseudonymised.
  xml = xml.replace(/<address-customer>[\s\S]*?<\/address-customer>/g, '<address-customer><name>Jan Novák</name><adr1>Ulice 1</adr1><adr2>000 00 Město</adr2></address-customer>');
  xml = xml.replace(/<infolimit\b[\s\S]*?<\/infolimit>/g, '<infolimit view="0"/>');
  xml = xml.replace(/<rates>[\s\S]*?<\/rates>/g, '<rates/>');
  xml = xml.replace(/<marketing-info>[\s\S]*?<\/marketing-info>/g, '<marketing-info/>');
  xml = xml.replace(/<adv-msg>[\s\S]*?<\/adv-msg>/g, '');
  xml = xml.replace(/<reward>[\s\S]*?<\/reward>/g, '');

  // The transaction id is the canonical reference that deduplication keys on.
  // It must be scrambled with the same seed the CSV anonymiser uses, or the two
  // fixtures stop agreeing and the cross-format test guards nothing.
  xml = replaceAttribute(xml, 'transaction', 'id', (old) => scrambleDigits(old, 'reference'));

  xml = replaceAttribute(xml, 'account', 'number', () => FAKE_ACCOUNT);
  // The account number appears again in an internal element outside <account>.
  xml = replaceElement(xml, 'acc_no_int', () => FAKE_ACCOUNT);
  xml = replaceAttribute(xml, 'account', 'iban', () => FAKE_IBAN);

  // Counterparty accounts: card payments put a payment-method label here, which
  // must survive because the parser reads it.
  xml = replaceAttribute(xml, 'transaction', 'other-account-number', (old) =>
    /\d/.test(old) ? scrambleDigits(old, 'counter-account') : old,
  );

  for (const attribute of ['var-sym', 'spec-sym']) {
    xml = replaceAttribute(xml, 'transaction', attribute, (old) => (old ? scrambleDigits(old, 'symbol') : old));
  }

  // Free text: counterparty names for transfers, merchant strings for cards.
  xml = replaceElement(xml, 'trn-message', (old) => {
    const trimmed = old.trim();

    if (!trimmed || isCompany(trimmed)) {
      return old;
    }

    // A person's name is two or more all-caps words with no digits.
    if (/^[A-ZÁ-Ž][A-ZÁ-Ž\s]+$/.test(trimmed) && trimmed.split(/\s+/).length >= 2) {
      return pick(PERSON_NAMES, trimmed.toUpperCase());
    }

    return scrambleDigits(old, 'text');
  });

  writeFileSync(outputPath, xml, 'utf8');

  const transactions = (xml.match(/<transaction\b/g) ?? []).length;
  console.log(`Anonymized ${transactions} transactions -> ${outputPath}`);
}

main();
