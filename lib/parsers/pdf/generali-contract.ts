import { parseCzechAmount } from '@/lib/parsers/csv/numbers';
import { CsvStructureError } from '@/lib/parsers/csv/types';
import type { VehicleCategory } from '@/lib/generated/prisma/enums';

/**
 * Generali vehicle-insurance contract PDF — deliberately tolerant, unlike
 * `generali-green-card.ts`. Verified against 3 real templates this session
 * (a renewal notice, a "NABÍDKA POJISTNÉ SMLOUVY" offer, and a full
 * "POJISTNÁ SMLOUVA") with different wording for the same facts and no
 * self-check of any kind (a Moneta statement verifies its own totals; this
 * document verifies nothing). A 4th template can appear at any time.
 *
 * This is a deliberate departure from the transaction-import doctrine ("a
 * parser that cannot produce a reference must fail the row, not guess") —
 * that rule exists because a wrong guess silently corrupts settlement math.
 * Here the extracted fields only ever prefill a form a person reviews and
 * submits themselves, so a partial or slightly-off guess is a convenience,
 * not a correctness risk. Every field is independently optional; only a
 * document that doesn't look like a Generali vehicle-insurance contract at
 * all is rejected outright.
 *
 * Pure: no database, no network, no clock.
 */

const SNIFF_PATTERN = /pojist\S*\s+smlouv\S*/i;
const VEHICLE_WORD_PATTERN = /vozidl/i;

const POLICY_NUMBER_PATTERNS = [
  /sdružené pojištění vozidla\s+(\d+)/,
  /Pojistná smlouva č\.\s*(\d+)/,
];

const LICENSE_PLATE_PATTERN = /Registrační značka:?\s+(\S+)/;

const VEHICLE_TYPE_TEXT_PATTERNS = [/Druh vozidla:?\s+([^\n]+)/, /^Vozidlo\s+([^\n]+)/m];

const ANNUAL_COST_PATTERNS = [/Výše pojistného\s+([\d\s]+)\s*Kč/, /Roční\s+cena pojištění je\s+([\d\s]+)\s*Kč/];

const START_DATE_PATTERNS = [
  /účinná od\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/,
  /počátkem pojištění\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})/,
  /pro období od\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})\s+do/,
];

const VEHICLE_TYPE_BY_TEXT: { pattern: RegExp; category: VehicleCategory }[] = [
  { pattern: /osobní automobil/i, category: 'CAR' },
  { pattern: /motocykl/i, category: 'MOTORCYCLE' },
  { pattern: /nákladní|traktor/i, category: 'TRUCK_OR_TRACTOR' },
  { pattern: /moped|kolo s pomocným motorkem/i, category: 'MOPED' },
  { pattern: /autobus/i, category: 'BUS' },
  { pattern: /přívěs|návěs/i, category: 'TRAILER' },
];

export interface ContractParseResult {
  policyNumber: string | null;
  licensePlate: string | null;
  vehicleType: VehicleCategory | null;
  /** Decimal string, or null when no total-premium line was recognized. */
  annualCost: string | null;
  /** ISO date, or null when no start-of-coverage line was recognized. */
  startDate: string | null;
  /** What this document didn't provide, or couldn't confirm. */
  warnings: string[];
}

function firstMatch(patterns: readonly RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/** "21. 1. 2026" -> "2026-01-21". Tolerates a missing space after each dot. */
function toIsoDate(raw: string): string | null {
  const match = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(raw.trim());

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;

  return `${year}-${(month ?? '').padStart(2, '0')}-${(day ?? '').padStart(2, '0')}`;
}

export function parseGeneraliContract(text: string): ContractParseResult {
  if (!SNIFF_PATTERN.test(text) || !VEHICLE_WORD_PATTERN.test(text)) {
    throw new CsvStructureError('Nevypadá to jako smlouva o pojištění vozidla od Generali');
  }

  const warnings: string[] = [];

  const policyNumber = firstMatch(POLICY_NUMBER_PATTERNS, text);
  if (!policyNumber) warnings.push('Nepodařilo se najít číslo pojistné smlouvy');

  const licensePlateRaw = firstMatch([LICENSE_PLATE_PATTERN], text);
  const licensePlate = licensePlateRaw && licensePlateRaw.toLowerCase() !== 'neuvedeno' ? licensePlateRaw : null;
  if (!licensePlate) warnings.push('Registrační značka není ve smlouvě uvedena (vozidlo možná ještě nemá RZ)');

  const vehicleTypeText = firstMatch(VEHICLE_TYPE_TEXT_PATTERNS, text);
  const vehicleType = vehicleTypeText
    ? (VEHICLE_TYPE_BY_TEXT.find(({ pattern }) => pattern.test(vehicleTypeText))?.category ?? null)
    : null;
  if (!vehicleType) warnings.push('Nepodařilo se rozpoznat druh vozidla');

  const annualCostRaw = firstMatch(ANNUAL_COST_PATTERNS, text);
  const annualCost = annualCostRaw
    ? (() => {
        try {
          return parseCzechAmount(annualCostRaw);
        } catch {
          return null;
        }
      })()
    : null;
  if (!annualCost) warnings.push('Nepodařilo se najít výši ročního pojistného');

  const startDateRaw = firstMatch(START_DATE_PATTERNS, text);
  const startDate = startDateRaw ? toIsoDate(startDateRaw) : null;
  if (!startDate) warnings.push('Nepodařilo se najít počátek pojištění');

  return { policyNumber, licensePlate, vehicleType, annualCost, startDate, warnings };
}
