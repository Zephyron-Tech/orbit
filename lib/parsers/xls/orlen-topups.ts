import * as XLSX from 'xlsx';

import type { ParseFailure } from '@/lib/parsers/csv/types';

/**
 * tankarta.cz's own "DOBITÝ KREDIT" export headers, verbatim. A structural
 * check, not a cosmetic one: if Orlen changes the export shape, importing
 * must fail loud rather than silently misreading columns.
 */
const EXPECTED_HEADERS = ['Datum a čas', 'Způsob dobití', 'Číslo a název ČS', 'Typ operace', 'Kredit | Kč'] as const;

/**
 * Days between the Excel 1900 epoch and the Unix epoch. Kept independent
 * from `orlen-sales.ts`'s copy on purpose — these are meant to stay
 * standalone pure modules, not share internal helpers.
 */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

function excelSerialToUtcDate(serial: number): Date {
  return new Date(Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * 86_400_000));
}

export interface ParsedFuelTopUp {
  toppedUpAt: Date;
  method: string;
  station: string;
  operationType: string;
  /** Decimal string. */
  amountCzk: string;
  raw: Record<string, string>;
}

export interface XlsTopUpParseResult {
  topUps: ParsedFuelTopUp[];
  failures: ParseFailure[];
}

export class XlsStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsStructureError';
  }
}

function toRawRow(row: readonly unknown[]): Record<string, string> {
  return Object.fromEntries(EXPECTED_HEADERS.map((header, index) => [header, String(row[index] ?? '')]));
}

function isBlankRow(row: readonly unknown[]): boolean {
  return row.every((cell) => cell === undefined || cell === null || cell === '');
}

/**
 * Parses a tankarta.cz `ChargingPrepaids.xls` export (legacy binary BIFF8
 * format) into wallet top-up rows. Pure: no database, no network, no clock.
 */
export function parseOrlenTopUps(buffer: Buffer): XlsTopUpParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new XlsStructureError('Soubor ChargingPrepaids.xls neobsahuje žádný list');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
  const header = rows[0];

  if (!header || EXPECTED_HEADERS.some((expected, index) => header[index] !== expected)) {
    throw new XlsStructureError(`Neočekávaná hlavička souboru ChargingPrepaids.xls. Očekávané sloupce: ${EXPECTED_HEADERS.join(', ')}`);
  }

  const topUps: ParsedFuelTopUp[] = [];
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

      const toppedUpAt = excelSerialToUtcDate(serial);
      if (Number.isNaN(toppedUpAt.getTime())) {
        throw new Error(`Invalid date: ${String(serial)}`);
      }

      const method = String(row[1] ?? '').trim();
      if (!method) {
        throw new Error('Missing top-up method');
      }

      // A bank-transfer top-up ("Dobití/vrácení bankovním převodem") has no
      // station — it isn't done at a kiosk or online terminal, so an empty
      // value here is a legitimate case, not a malformed row.
      const station = String(row[2] ?? '').trim();

      const operationType = String(row[3] ?? '').trim();
      if (!operationType) {
        throw new Error('Missing operation type');
      }

      const amountRaw = row[4];
      if (typeof amountRaw !== 'number' || !Number.isFinite(amountRaw)) {
        throw new Error(`Invalid amount: ${String(amountRaw)}`);
      }

      topUps.push({
        toppedUpAt,
        method,
        station,
        operationType,
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

  return { topUps, failures };
}
