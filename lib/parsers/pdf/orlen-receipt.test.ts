import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseOrlenReceipt, ReceiptParseError } from './orlen-receipt';

const FIXTURE = join(process.cwd(), 'docs/samples/orlen/receipt.txt');

function loadFixture(): string {
  return readFileSync(FIXTURE, 'utf8');
}

describe('parseOrlenReceipt', () => {
  const receipt = parseOrlenReceipt(loadFixture());

  it('parses the doc number, station and totals', () => {
    expect(receipt.docNumber).not.toHaveLength(0);
    expect(receipt.stationCode).toBe('190');
    expect(receipt.stationName).toBe('Prachatice,Nebahovská');
    expect(receipt.totalAfterDiscount).toBe('1399.94');
  });

  it('parses quantity and price per liter', () => {
    expect(receipt.quantityLiters).toBe('31.180');
    expect(receipt.pricePerLiter).toBe('46.90');
  });

  it('parses the pre-discount gross and the Tankkarta discount', () => {
    expect(receipt.grossBeforeDiscount).toBe('1462.30');
    expect(receipt.discountLabel).toBe('Karta EASY');
    expect(receipt.discountAmount).toBe('62.36');
  });

  it('cross-checks: gross minus discount equals the final total', () => {
    const gross = Number(receipt.grossBeforeDiscount);
    const discount = Number(receipt.discountAmount);
    const total = Number(receipt.totalAfterDiscount);

    expect(Math.round((gross - discount) * 100) / 100).toBe(total);
  });

  it('parses the purchase date and time', () => {
    expect(receipt.purchasedAt.toISOString()).toBe('2026-08-20T12:27:25.000Z');
  });

  it('never keeps more than the last 4 digits of the card number', () => {
    expect(receipt.cardLast4).toHaveLength(4);
  });

  it('masks the card number in the stored raw text', () => {
    expect(receipt.rawText).not.toContain(receipt.cardLast4.repeat(4));
    expect(receipt.rawText).toMatch(/Karta: \*+\d{4}/);
  });

  it('has no discount when there is none on the receipt', () => {
    const withoutDiscount = loadFixture().replace(/Sleva.*\n/, '');
    const parsed = parseOrlenReceipt(withoutDiscount);

    expect(parsed.discountLabel).toBeNull();
    expect(parsed.discountAmount).toBe('0.00');
  });
});

describe('parseOrlenReceipt malformed input', () => {
  it('throws when the text has no Doklad number', () => {
    const broken = loadFixture().replace(/Doklad:.*\n/, '');

    expect(() => parseOrlenReceipt(broken)).toThrow(ReceiptParseError);
  });

  it('throws when the text has no recognisable structure at all', () => {
    expect(() => parseOrlenReceipt('this is not a receipt')).toThrow(ReceiptParseError);
  });
});
