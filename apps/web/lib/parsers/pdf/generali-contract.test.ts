import { describe, expect, it } from 'vitest';

import { CsvStructureError } from '@/lib/parsers/csv/types';

import { parseGeneraliContract } from './generali-contract';

// Structural fixtures for each real template found this session, fabricated
// data throughout — never real personal details.

const RENEWAL_NOTICE = `
Pojištění vozidel
Pojistná smlouva č. 1234567890
Registrační značka 4A12345
Vozidlo motocykl
Škoda
ŠKODA FELICIA

Podrobnější informace o pojištění vozidla
pro období od 1. 6. 2026 do 31. 5. 2027

Roční cena pojištění je 9 999 Kč.
`;

const OFFER = `
NABÍDKA POJISTNÉ SMLOUVY
sdružené pojištění vozidla 9876543210

Pojistná smlouva se uzavírá na dobu neurčitou s počátkem pojištění 1. 1. 2026 00:00:01 a s ročním pojistným obdobím.

3.3 Údaje o vozidle
Registrační značka: 4A54321
MPZ: Česká republika
Druh vozidla: osobní automobil
Tovární značka: Škoda
Typ: Octavia

Výše pojistného 12 345 Kč
`;

const FULL_CONTRACT = `
POJISTNÁ SMLOUVA
sdružené pojištění vozidla 5555555555

Pojistná smlouva je účinná od 15. 3. 2026 10:00:00 a pojištění je sjednáno na dobu neurčitou a s ročním pojistným obdobím.

3.3 Údaje o vozidle
Registrační značka: 4A11111
Druh vozidla: osobní automobil

Výše pojistného 20 000 Kč
`;

const IMPORTED_WITH_NO_REAL_MODEL = `
NABÍDKA POJISTNÉ SMLOUVY
sdružené pojištění vozidla 2223334445

Pojistná smlouva se uzavírá na dobu neurčitou s počátkem pojištění 1. 2. 2026 a s ročním pojistným obdobím.

3.3 Údaje o vozidle
Registrační značka: Neuvedeno
Druh vozidla: motocykl
Tovární značka: Honda
Typ: JINÉ
Specifikace: RC36/VRF750F

Výše pojistného 800 Kč
`;

const NOT_YET_REGISTERED = `
NABÍDKA POJISTNÉ SMLOUVY
sdružené pojištění vozidla 1112223334

Pojistná smlouva se uzavírá na dobu neurčitou s počátkem pojištění 1. 5. 2026 a s časem uvedeným v Pojistce a s ročním pojistným obdobím.

3.3 Údaje o vozidle
Registrační značka: Neuvedeno
Druh vozidla: motocykl

Výše pojistného 700 Kč
`;

describe('parseGeneraliContract', () => {
  it('extracts every field from the renewal-notice template', () => {
    const result = parseGeneraliContract(RENEWAL_NOTICE);

    expect(result).toEqual({
      policyNumber: '1234567890',
      licensePlate: '4A12345',
      vehicleName: null,
      vehicleType: 'MOTORCYCLE',
      annualCost: '9999.00',
      startDate: '2026-06-01',
      warnings: [],
    });
  });

  it('extracts every field from the "NABÍDKA" offer template, including vehicleName from make + Typ', () => {
    const result = parseGeneraliContract(OFFER);

    expect(result).toEqual({
      policyNumber: '9876543210',
      licensePlate: '4A54321',
      vehicleName: 'Škoda Octavia',
      vehicleType: 'CAR',
      annualCost: '12345.00',
      startDate: '2026-01-01',
      warnings: [],
    });
  });

  it('extracts every field from the full "POJISTNÁ SMLOUVA" template', () => {
    const result = parseGeneraliContract(FULL_CONTRACT);

    expect(result).toEqual({
      policyNumber: '5555555555',
      licensePlate: '4A11111',
      vehicleName: null,
      vehicleType: 'CAR',
      annualCost: '20000.00',
      startDate: '2026-03-15',
      warnings: [],
    });
  });

  it('leaves vehicleName unguessed when "Typ" is the real document\'s own placeholder "JINÉ" — the real Honda VFR750F case', () => {
    const result = parseGeneraliContract(IMPORTED_WITH_NO_REAL_MODEL);

    expect(result.vehicleName).toBeNull();
  });

  it('treats "Neuvedeno" as no plate, without throwing — the real not-yet-registered case', () => {
    const result = parseGeneraliContract(NOT_YET_REGISTERED);

    expect(result.licensePlate).toBeNull();
    expect(result.policyNumber).toBe('1112223334');
    expect(result.warnings).toContain('Registrační značka není ve smlouvě uvedena (vozidlo možná ještě nemá RZ)');
  });

  it('never throws for a missing individual field — only a document that is not a Generali vehicle contract at all', () => {
    const sparse = 'Toto je pojistná smlouva o pojištění vozidla, ale jinak skoro prázdná.';
    const result = parseGeneraliContract(sparse);

    expect(result.policyNumber).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects a document unrelated to vehicle insurance', () => {
    expect(() => parseGeneraliContract('Toto je faktura za elektřinu, nic víc.')).toThrow(CsvStructureError);
  });
});
