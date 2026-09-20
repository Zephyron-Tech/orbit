import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { parseOrlenTopUps, XlsStructureError } from './orlen-topups';
import { buildFuelTopUpKey } from '@orbit-api/lib/finance/idempotency';

const FIXTURE = join(process.cwd(), 'docs/samples/orlen/ChargingPrepaids.xls');

function loadFixture(): Buffer {
  return readFileSync(FIXTURE);
}

describe('parseOrlenTopUps', () => {
  const result = parseOrlenTopUps(loadFixture());

  it('parses every row of a real export without failures', () => {
    expect(result.topUps).toHaveLength(303);
    expect(result.failures).toHaveLength(0);
  });

  it('parses method, station and amount', () => {
    const first = result.topUps[0];

    expect(first?.method).toBe('Dobití online');
    expect(first?.station).toBe('1MA - TKE');
    expect(first?.amountCzk).toBe('100.00');
  });

  it('parses dates deterministically regardless of the host timezone', () => {
    expect(result.topUps[0]?.toppedUpAt.toISOString()).toBe('2026-08-20T15:35:20.000Z');
  });

  it('allows an empty station for a bank-transfer top-up', () => {
    const bankTransfer = result.topUps.find((topUp) => topUp.method === 'Dobití/vrácení bankovním převodem' && topUp.station === '');

    expect(bankTransfer).toBeDefined();
  });

  it('produces a stable, unique idempotency key per row', () => {
    const keys = result.topUps.map((topUp) =>
      buildFuelTopUpKey({
        toppedUpAt: topUp.toppedUpAt,
        method: topUp.method,
        station: topUp.station,
        amountCzk: topUp.amountCzk,
      }),
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('re-parsing the same file yields identical idempotency keys (re-import is a no-op)', () => {
    const again = parseOrlenTopUps(loadFixture());
    const keyOf = (topUp: (typeof result.topUps)[number]) =>
      buildFuelTopUpKey({
        toppedUpAt: topUp.toppedUpAt,
        method: topUp.method,
        station: topUp.station,
        amountCzk: topUp.amountCzk,
      });

    expect(again.topUps.map(keyOf)).toEqual(result.topUps.map(keyOf));
  });
});

describe('parseOrlenTopUps malformed input', () => {
  it('throws a structural error when the header does not match', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Wrong', 'Header', 'Shape']]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }) as Buffer;

    expect(() => parseOrlenTopUps(buffer)).toThrow(XlsStructureError);
  });

  it('reports an unparseable row as a failure, not a thrown error', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Datum a čas', 'Způsob dobití', 'Číslo a název ČS', 'Typ operace', 'Kredit | Kč'],
      ['not-a-number', 'Dobití online', '1MA - TKE', 'Vložené/vrácené prostředky na/ze středisko/a', 100],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }) as Buffer;

    const result = parseOrlenTopUps(buffer);

    expect(result.topUps).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toMatch(/date/i);
  });
});
