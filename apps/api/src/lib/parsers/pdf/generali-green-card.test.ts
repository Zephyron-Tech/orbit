import { describe, expect, it } from 'vitest';

import { CsvStructureError } from '@orbit-api/lib/parsers/csv/types';

import { parseGreenCard } from './generali-green-card';

/**
 * Structural fixture mirroring the real COBX green-card layout (verified
 * against 4 real Generali cards this session) — fabricated data throughout,
 * never real personal details. The data line + next line shape is the part
 * that matters: "<day> <month> <year> <day> <month> <year> <policyNumber>"
 * then "<plateOrVin> <categoryLetter> <make>", repeated (DUPLIKÁT+ORIGINÁL).
 */
function fixture(dataLine: string, nextLine: string): string {
  const block = `${dataLine}\n${nextLine}`;

  return `
1. MEZINÁRODNÍ AUTOMOBILOVÁ POJIŠŤOVACÍ KARTA
1. INTERNATIONAL MOTOR INSURANCE CARD
2. VYDÁNA Z POVĚŘENÍ ČESKÉ KANCELÁŘE POJISTITELŮ, PRAHA
4. Kód země / Kód pojistitele / Číslo
6. Druh vozidla
5. Registrační značka
7. Značka vozidla
CZ/0001/
3.
${block}
${block}
`;
}

describe('parseGreenCard', () => {
  it('extracts policy number, plate, vehicle category, make, and validity dates for a car', () => {
    const result = parseGreenCard(fixture('1 6 2026 31 5 2027 1234567890', '4A12345 A Škoda'));

    expect(result).toEqual({
      policyNumber: '1234567890',
      plateOrVin: '4A12345',
      vehicleType: 'CAR',
      make: 'Škoda',
      validFrom: '2026-06-01',
      validTo: '2027-05-31',
    });
  });

  it('extracts a motorcycle card, single-digit day and month with no leading zero', () => {
    const result = parseGreenCard(fixture('3 4 2026 2 4 2027 9876543210', '9C1234 B Kawasaki'));

    expect(result.vehicleType).toBe('MOTORCYCLE');
    expect(result.validFrom).toBe('2026-04-03');
  });

  it('accepts a VIN in the plate field when no registration plate has been assigned', () => {
    const result = parseGreenCard(fixture('1 1 2026 1 1 2027 5555555555', 'JH2RC36900M300529 B Honda'));

    expect(result.plateOrVin).toBe('JH2RC36900M300529');
  });

  it('rejects a document that is not a green card', () => {
    expect(() => parseGreenCard('Nějaký úplně jiný dokument bez souvislosti.')).toThrow(CsvStructureError);
  });

  it('rejects a green card whose data line is missing or malformed', () => {
    const brokenText = `
1. MEZINÁRODNÍ AUTOMOBILOVÁ POJIŠŤOVACÍ KARTA
(no data line follows)
`;

    expect(() => parseGreenCard(brokenText)).toThrow(CsvStructureError);
  });
});
