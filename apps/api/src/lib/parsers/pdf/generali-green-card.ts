import { CsvStructureError } from '@orbit-api/lib/parsers/csv/types';
import type { VehicleCategory } from '@orbit-api/lib/generated/prisma/enums';

/**
 * Generali's international motor insurance card ("zelená karta") — the
 * standardized COBX green-card layout, identical across every EU insurer,
 * not a Generali-specific format. Verified against 4 real cards (2
 * vehicles, each with a plate and a VIN-only case): the document repeats
 * itself twice (DUPLIKÁT then ORIGINÁL, same values both times), and the
 * data line always has the shape
 *   "<day> <month> <year> <day> <month> <year> <policyNumber>"
 * followed on the next line by
 *   "<plateOrVin> <categoryLetter> <make>"
 * — single-digit day/month have no leading zero. Far more reliable than the
 * contract PDF: every field is required here and a missing one is a real
 * structural failure, not a template variation to tolerate.
 *
 * Pure: no database, no network, no clock.
 */

const TITLE_PATTERN = /MEZINÁRODNÍ AUTOMOBILOVÁ POJIŠŤOVACÍ KARTA/;
const DATA_LINE_PATTERN =
  /(\d{1,2})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})\s+(\d+)\n(\S+)\s+([A-G])\s+(.+)/;

const CATEGORY_BY_LETTER: Record<string, VehicleCategory> = {
  A: 'CAR',
  B: 'MOTORCYCLE',
  C: 'TRUCK_OR_TRACTOR',
  D: 'MOPED',
  E: 'BUS',
  F: 'TRAILER',
  G: 'OTHER',
};

export interface GreenCardParseResult {
  policyNumber: string;
  /** The plate, or the VIN when no plate has been assigned yet — the card itself declares this fallback. */
  plateOrVin: string;
  vehicleType: VehicleCategory;
  make: string;
  /** ISO date, inclusive. */
  validFrom: string;
  /** ISO date, inclusive. */
  validTo: string;
}

function toIsoDate(day: string, month: string, year: string): string {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function parseGreenCard(text: string): GreenCardParseResult {
  if (!TITLE_PATTERN.test(text)) {
    throw new CsvStructureError('Není zelená karta (mezinárodní pojišťovací karta)');
  }

  const match = DATA_LINE_PATTERN.exec(text);

  if (!match) {
    throw new CsvStructureError('Na zelené kartě se nepodařilo najít údaje o platnosti, čísle smlouvy a vozidle');
  }

  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear, policyNumber, plateOrVin, categoryLetter, makeRaw] =
    match;

  const vehicleType = CATEGORY_BY_LETTER[categoryLetter ?? ''];

  if (!vehicleType) {
    throw new CsvStructureError(`Neznámý kód druhu vozidla na zelené kartě: ${categoryLetter}`);
  }

  return {
    policyNumber: policyNumber ?? '',
    plateOrVin: plateOrVin ?? '',
    vehicleType,
    make: (makeRaw ?? '').trim(),
    validFrom: toIsoDate(fromDay ?? '', fromMonth ?? '', fromYear ?? ''),
    validTo: toIsoDate(toDay ?? '', toMonth ?? '', toYear ?? ''),
  };
}

