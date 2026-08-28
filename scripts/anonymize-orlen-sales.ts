/**
 * Turns a real tankarta.cz `Sales.xls` export into a committable test fixture.
 *
 * Only the fuel card number (column B) is a direct identifier; it is replaced
 * with a deterministic pseudonym per distinct real card number, so relationships
 * between rows survive (the same real card always maps to the same fake one).
 *
 * Deliberately preserved, because the parser tests depend on them:
 *   - dates, amounts, quantities and their formatting
 *   - station numbers/names and product names (not personal data)
 *
 * Usage: npx tsx scripts/anonymize-orlen-sales.ts <input.xls> <output.xls>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import * as XLSX from 'xlsx';

const CARD_NUMBER_COLUMN = 1;

/** Stable per real card number: same input always maps to the same fake number. */
function fakeCardNumber(real: string): string {
  const digest = createHash('sha256').update(real).digest('hex');
  const digits = digest.replace(/\D/g, '').padEnd(19, '0').slice(0, 19);

  return `9${digits.slice(1)}`;
}

function main(): void {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath || !outputPath) {
    throw new Error('Usage: anonymize-orlen-sales.ts <input.xls> <output.xls>');
  }

  const workbook = XLSX.read(readFileSync(inputPath), { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('Empty workbook');
  }

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error('Missing worksheet');
  }

  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const cardCache = new Map<string, string>();
  let rows = 0;

  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const address = XLSX.utils.encode_cell({ r: row, c: CARD_NUMBER_COLUMN });
    const cell = sheet[address] as { v?: unknown; t?: string } | undefined;

    if (!cell || typeof cell.v !== 'string' || !cell.v.trim()) {
      continue;
    }

    const real = cell.v;
    let fake = cardCache.get(real);

    if (!fake) {
      fake = fakeCardNumber(real);
      cardCache.set(real, fake);
    }

    cell.v = fake;
    rows += 1;
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }) as Buffer;

  writeFileSync(outputPath, buffer);
  console.log(`Anonymized ${rows} rows (${cardCache.size} distinct card numbers) -> ${outputPath}`);
}

main();
