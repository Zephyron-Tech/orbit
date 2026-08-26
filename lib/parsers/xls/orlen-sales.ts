import * as XLSX from 'xlsx';

import { parseCzechAmount } from '@/lib/parsers/csv/numbers';
import type { ParseFailure } from '@/lib/parsers/csv/types';

/**
 * tankarta.cz's own export headers, verbatim. A structural check, not a
 * cosmetic one: if Orlen changes the export shape, importing must fail loud
 * rather than silently misreading columns.
 */
const EXPECTED_HEADERS = [
  'Datum a čas',
  'Číslo karty',
  'Poznámka karty',
  'Číslo a název ČS',
  'Množství a jednotka',
  'Číslo a název produktu',
  'Kredit | Kč',
] as const;

/** Leading digits are the station/product's own numeric code, run together with the name, no separator. */
const CODE_AND_NAME_PATTERN = /^(\d+)(.+)$/;
/** e.g. "31,180L" — Czech decimal comma, unit suffix with no space. */
const QUANTITY_PATTERN = /^([\d,]+)\s*L$/i;

/**
 * Days between the Excel 1900 epoch and the Unix epoch. Converting the raw
 * numeric serial by hand (rather than using the `xlsx` library's own
 * `cellDates` option) keeps this deterministic regardless of the host
 * process's timezone — `cellDates` reconstructs the Date using the *local*
 * timezone, which only happened to match here because this machine's
 * timezone is Europe/Prague; a UTC-timezone production container would
 * silently shift every purchase by 2 hours. The wall-clock digits embedded
 * in the serial are treated as UTC directly, same convention the CSV/XML
 * parsers already use for bank export dates.
 */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

function excelSerialToUtcDate(serial: number): Date {
  return new Date(Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * 86_400_000));
}

export interface ParsedFuelPurchase {
  purchasedAt: Date;
  /** Full card number is never kept past this function. */
  cardLast4: string;
  stationCode: string;
  stationName: string;
  product: string;
  /** Decimal string, e.g. "31.18". */
  quantityLiters: string;
  /** Decimal string, already net of any Tankarta discount. */
  amountCzk: string;
  raw: Record<string, string>;
}

export interface XlsParseResult {
  purchases: ParsedFuelPurchase[];
  failures: ParseFailure[];
}

export class XlsStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsStructureError';
  }
}

const CARD_NUMBER_COLUMN_INDEX = 1;

/** Masks the card number column before it lands in `raw` — that gets stored verbatim as `FuelPurchase.rawData`. */
function toRawRow(row: readonly unknown[]): Record<string, string> {
  return Object.fromEntries(
    EXPECTED_HEADERS.map((header, index) => {
      if (index !== CARD_NUMBER_COLUMN_INDEX) {
        return [header, String(row[index] ?? '')];
      }

      const cardNumber = String(row[index] ?? '');
      return [header, cardNumber ? `${'*'.repeat(Math.max(0, cardNumber.length - 4))}${cardNumber.slice(-4)}` : ''];
    }),
  );
}

function isBlankRow(row: readonly unknown[]): boolean {
  return row.every((cell) => cell === undefined || cell === null || cell === '');
}

/**
 * Parses a tankarta.cz `Sales.xls` export (legacy binary BIFF8 format) into
 * fuel purchase rows. Pure: no database, no network, no clock — same
 * contract as the CSV parsers, just reading bytes instead of decoded text
 * since XLS is a binary format.
 */
export function parseOrlenSales(buffer: Buffer): XlsParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new XlsStructureError('Soubor Sales.xls neobsahuje žádný list');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const header = rows[0];

  if (!header || EXPECTED_HEADERS.some((expected, index) => header[index] !== expected)) {
    throw new XlsStructureError(`Neočekávaná hlavička souboru Sales.xls. Očekávané sloupce: ${EXPECTED_HEADERS.join(', ')}`);
  }

  const purchases: ParsedFuelPurchase[] = [];
  const failures: ParseFailure[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];

    if (!row || isBlankRow(row)) {
      continue;
    }

    const raw = toRawRow(row);

    try {
      const serial = row[0];
      if (typeof serial !== 'number' || !Number.isFinite(serial)) {
        throw new Error(`Invalid date: ${String(serial)}`);
      }

      const purchasedAt = excelSerialToUtcDate(serial);
      if (Number.isNaN(purchasedAt.getTime())) {
        throw new Error(`Invalid date: ${String(serial)}`);
      }

      const cardNumber = String(row[1] ?? '').trim();
      if (cardNumber.length < 4) {
        throw new Error(`Invalid card number: ${cardNumber}`);
      }

      const stationRaw = String(row[3] ?? '').trim();
      const stationMatch = CODE_AND_NAME_PATTERN.exec(stationRaw);
      if (!stationMatch?.[1] || !stationMatch[2]) {
        throw new Error(`Cannot split station code/name: ${stationRaw}`);
      }

      const quantityRaw = String(row[4] ?? '').trim();
      const quantityMatch = QUANTITY_PATTERN.exec(quantityRaw);
      if (!quantityMatch?.[1]) {
        throw new Error(`Cannot parse quantity: ${quantityRaw}`);
      }

      const productRaw = String(row[5] ?? '').trim();
      const productMatch = CODE_AND_NAME_PATTERN.exec(productRaw);
      if (!productMatch?.[2]) {
        throw new Error(`Cannot split product code/name: ${productRaw}`);
      }

      const amountRaw = row[6];
      if (typeof amountRaw !== 'number' || !Number.isFinite(amountRaw)) {
        throw new Error(`Invalid amount: ${String(amountRaw)}`);
      }

      purchases.push({
        purchasedAt,
        cardLast4: cardNumber.slice(-4),
        stationCode: stationMatch[1],
        stationName: stationMatch[2].trim(),
        product: productMatch[2].trim(),
        quantityLiters: parseCzechAmount(quantityMatch[1]),
        amountCzk: amountRaw.toFixed(2),
        raw,
      });
    } catch (error: unknown) {
      failures.push({
        rowNumber: index + 1,
        reason: error instanceof Error ? error.message : 'Unknown parse error',
        raw,
      });
    }
  }

  return { purchases, failures };
}
