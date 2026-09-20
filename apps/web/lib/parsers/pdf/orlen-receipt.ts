import { parseCzechAmount } from '@/lib/parsers/csv/numbers';

/**
 * Orlen receipts are digitally generated PDFs with clean extractable text
 * (verified against a real sample) — no OCR needed. This parses the already
 * -extracted text (extraction itself is a separate step, same split as
 * `lib/parsers/csv/decode.ts` keeping bytes->text apart from text->row).
 *
 * Pure: no database, no network, no clock.
 */

const DATE_PATTERN = /Datum \(DUZP\):\s*(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/;
const DOC_NUMBER_PATTERN = /Doklad:\s*(\S+)/;
const STATION_PATTERN = /ČS\s*(\d+)\s*-\s*([^\n]+)/;
/** e.g. "* 3 110141 VERVA 100 1462,30*" — leading `*`, ST code, internal code, name, gross total before the trailing `*`. */
const PRODUCT_LINE_PATTERN = /\*\s*\d+\s+\d+\s+(.+?)\s+([\d,]+)\*/;
/** e.g. "*21,0 (31,180 l x 46,90 CZK)[A] *" */
const QUANTITY_PRICE_PATTERN = /\(([\d,]+)\s*l\s*x\s*([\d,]+)\s*CZK\)/i;
/** e.g. "Sleva Karta EASY -62,36" */
const DISCOUNT_PATTERN = /Sleva\s+(.+?)\s+(-?[\d,]+)$/m;
const TOTAL_PATTERN = /Suma:\s*([\d,]+)\s*CZK/;
const TRANSACTION_CODE_PATTERN = /Kód:\s*([A-F0-9]+):?/;
const CARD_PATTERN = /Karta:\s*(\d+)/;

export interface ParsedFuelReceipt {
  purchasedAt: Date;
  docNumber: string;
  stationCode: string;
  stationName: string;
  product: string;
  quantityLiters: string;
  pricePerLiter: string;
  grossBeforeDiscount: string;
  discountLabel: string | null;
  discountAmount: string;
  totalAfterDiscount: string;
  transactionCode: string | null;
  cardLast4: string;
  rawText: string;
}

export class ReceiptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptParseError';
  }
}

function requireMatch(pattern: RegExp, text: string, label: string): RegExpExecArray {
  const match = pattern.exec(text);

  if (!match) {
    throw new ReceiptParseError(`V textu účtenky se nepodařilo najít: ${label}`);
  }

  return match;
}

/** Parses one Orlen fuel receipt's extracted text into structured fields. */
export function parseOrlenReceipt(text: string): ParsedFuelReceipt {
  const dateMatch = requireMatch(DATE_PATTERN, text, 'Datum (DUZP)');
  const [, day, month, year, hour, minute, second] = dateMatch;
  const purchasedAt = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));

  if (Number.isNaN(purchasedAt.getTime())) {
    throw new ReceiptParseError(`Neplatné datum na účtence: ${dateMatch[0]}`);
  }

  const docNumber = requireMatch(DOC_NUMBER_PATTERN, text, 'číslo dokladu')[1];
  const stationMatch = requireMatch(STATION_PATTERN, text, 'čerpací stanici');
  const productMatch = requireMatch(PRODUCT_LINE_PATTERN, text, 'řádek s produktem');
  const quantityPriceMatch = requireMatch(QUANTITY_PRICE_PATTERN, text, 'množství/cenu');
  const totalMatch = requireMatch(TOTAL_PATTERN, text, 'celkovou částku (Suma)');
  const cardMatch = requireMatch(CARD_PATTERN, text, 'kartu');

  const discountMatch = DISCOUNT_PATTERN.exec(text);
  const transactionCodeMatch = TRANSACTION_CODE_PATTERN.exec(text);

  if (!docNumber) {
    throw new ReceiptParseError('Prázdné číslo dokladu');
  }

  const cardNumber = cardMatch[1] ?? '';
  // The full card number must never be persisted — `rawText` is stored
  // verbatim as `FuelReceipt.rawText`, so it gets masked here too, same as
  // the card column masking in the xls parser.
  const maskedText = cardNumber ? text.replace(cardNumber, `${'*'.repeat(Math.max(0, cardNumber.length - 4))}${cardNumber.slice(-4)}`) : text;

  return {
    purchasedAt,
    docNumber,
    stationCode: stationMatch[1] ?? '',
    // The source text prints "Prachatice,Nebahovská" with no space after the
    // comma; a station name is for display, so add it back.
    stationName: (stationMatch[2] ?? '').trim().replace(/,\s*/g, ', '),
    product: (productMatch[1] ?? '').trim(),
    quantityLiters: parseCzechAmount(quantityPriceMatch[1] ?? ''),
    pricePerLiter: parseCzechAmount(quantityPriceMatch[2] ?? ''),
    grossBeforeDiscount: parseCzechAmount(productMatch[2] ?? ''),
    discountLabel: discountMatch ? (discountMatch[1] ?? '').trim() : null,
    discountAmount: discountMatch ? parseCzechAmount((discountMatch[2] ?? '').replace('-', '')) : '0.00',
    totalAfterDiscount: parseCzechAmount(totalMatch[1] ?? ''),
    transactionCode: transactionCodeMatch ? (transactionCodeMatch[1] ?? null) : null,
    cardLast4: cardNumber.slice(-4),
    rawText: maskedText,
  };
}
