import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { parseOrlenSales, XlsStructureError } from './orlen-sales';
import { buildFuelPurchaseKey } from '@/lib/finance/idempotency';

const FIXTURE = join(process.cwd(), 'docs/samples/orlen/Sales.xls');

function loadFixture(): Buffer {
  return readFileSync(FIXTURE);
}

describe('parseOrlenSales', () => {
  const result = parseOrlenSales(loadFixture());

  it('parses every row of a real export without failures', () => {
    expect(result.purchases).toHaveLength(347);
    expect(result.failures).toHaveLength(0);
  });

  it('splits station code and name', () => {
    const first = result.purchases[0];

    expect(first?.stationCode).toBe('190');
    expect(first?.stationName).toBe('PRACHATICE, NEBAHOVSKÁ');
  });

  it('parses quantity and amount as exact decimal strings', () => {
    const first = result.purchases[0];

    expect(first?.quantityLiters).toBe('31.180');
    expect(first?.amountCzk).toBe('1399.94');
  });

  it('keeps only the fuel product name, not the internal loyalty code', () => {
    expect(result.purchases[0]?.product).toBe('Verva 100');
  });

  it('never keeps more than the last 4 digits of the card number', () => {
    for (const purchase of result.purchases) {
      expect(purchase.cardLast4).toHaveLength(4);
      expect(purchase.raw['Číslo karty']).not.toContain(purchase.cardLast4.slice(0, 1).repeat(4));
    }
  });

  it('masks the card number in the stored raw row', () => {
    const raw = result.purchases[0]?.raw['Číslo karty'] ?? '';

    expect(raw.endsWith(result.purchases[0]?.cardLast4 ?? '')).toBe(true);
    expect(raw.slice(0, -4)).toMatch(/^\*+$/);
  });

  it('parses dates deterministically regardless of the host timezone', () => {
    // Wall-clock digits embedded in the Excel serial are treated as UTC
    // directly, same convention the CSV/XML parsers use — no timezone
    // conversion. The matching real receipt shows 20.08.2026 12:27:25 local.
    expect(result.purchases[0]?.purchasedAt.toISOString()).toBe('2026-08-20T12:27:23.000Z');
  });

  it('produces a stable, unique idempotency key per row', () => {
    const keys = result.purchases.map((purchase) =>
      buildFuelPurchaseKey({
        cardLast4: purchase.cardLast4,
        purchasedAt: purchase.purchasedAt,
        stationCode: purchase.stationCode,
        amountCzk: purchase.amountCzk,
      }),
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('re-parsing the same file yields identical idempotency keys (re-import is a no-op)', () => {
    const again = parseOrlenSales(loadFixture());
    const keyOf = (purchase: (typeof result.purchases)[number]) =>
      buildFuelPurchaseKey({
        cardLast4: purchase.cardLast4,
        purchasedAt: purchase.purchasedAt,
        stationCode: purchase.stationCode,
        amountCzk: purchase.amountCzk,
      });

    expect(again.purchases.map(keyOf)).toEqual(result.purchases.map(keyOf));
  });
});

describe('parseOrlenSales malformed input', () => {
  it('throws a structural error when the header does not match', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Wrong', 'Header', 'Shape']]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }) as Buffer;

    expect(() => parseOrlenSales(buffer)).toThrow(XlsStructureError);
  });

  it('reports an unparseable row as a failure, not a thrown error', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Datum a čas', 'Číslo karty', 'Poznámka karty', 'Číslo a název ČS', 'Množství a jednotka', 'Číslo a název produktu', 'Kredit | Kč'],
      [46254.5, '1234567890123456789', null, 'NOT-A-VALID-STATION-FORMAT!!!', '31,180L', '7Verva 100', 1399.94],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }) as Buffer;

    const result = parseOrlenSales(buffer);

    expect(result.purchases).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toMatch(/station/i);
  });
});
