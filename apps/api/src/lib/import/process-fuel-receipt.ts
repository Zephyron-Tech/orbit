import { createHash } from 'node:crypto';

import { PDFParse } from 'pdf-parse';

import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { matchReceiptToPurchase } from '@orbit-api/lib/finance/fuel-matching';
import { parseOrlenReceipt, ReceiptParseError, type ParsedFuelReceipt } from '@orbit-api/lib/parsers/pdf/orlen-receipt';
import { ensurePdfWorkerConfigured } from '@orbit-api/lib/parsers/pdf/pdf-worker';

export class FuelReceiptError extends Error {
  constructor(
    message: string,
    readonly code: 'ALREADY_IMPORTED' | 'BAD_FORMAT',
  ) {
    super(message);
    this.name = 'FuelReceiptError';
  }
}

export interface FuelReceiptSummary {
  dryRun: boolean;
  /** Null in a dry run — nothing was written. */
  receiptId: string | null;
  docNumber: string;
  purchasedAt: string;
  stationName: string;
  matchedPurchaseId: string | null;
  totalAfterDiscount: string;
  discountAmount: string;
}

const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ProcessFuelReceiptOptions {
  bytes: Uint8Array;
  /** When true nothing is written; the caller shows the preview for confirmation. */
  dryRun: boolean;
}

/**
 * Parses one Orlen receipt PDF and attempts to match it to an
 * already-imported `FuelPurchase` row (station + amount + close timestamp —
 * see `lib/finance/fuel-matching.ts`). Left unmatched when ambiguous or when
 * the purchase hasn't been imported yet; the receipts list in the UI
 * surfaces those. Dry-run/commit shape mirrors `processFuelXlsImport` — the
 * "already uploaded" checks still run during a dry run (so a duplicate
 * shows up in the preview instead of only failing on commit), only the
 * final write is skipped.
 */
export async function processFuelReceiptUpload({ bytes, dryRun }: ProcessFuelReceiptOptions): Promise<FuelReceiptSummary> {
  ensurePdfWorkerConfigured();

  const fileHash = createHash('sha256').update(bytes).digest('hex');

  // A byte-identical re-upload is answered before any parsing happens.
  const existingByHash = await prisma.fuelReceipt.findUnique({ where: { sourceFileHash: fileHash } });

  if (existingByHash) {
    throw new FuelReceiptError(
      `Tato účtenka už byla nahrána ${existingByHash.createdAt.toISOString().slice(0, 10)}`,
      'ALREADY_IMPORTED',
    );
  }

  const parser = new PDFParse({ data: Buffer.from(bytes) });
  let text: string;

  try {
    const result = await parser.getText();
    text = result.text;
  } finally {
    await parser.destroy();
  }

  let parsed: ParsedFuelReceipt;

  try {
    parsed = parseOrlenReceipt(text);
  } catch (error: unknown) {
    const reason = error instanceof ReceiptParseError ? error.message : 'Nečitelná účtenka (PDF)';

    throw new FuelReceiptError(reason, 'BAD_FORMAT');
  }

  const existingByDoc = await prisma.fuelReceipt.findUnique({ where: { docNumber: parsed.docNumber } });

  if (existingByDoc) {
    throw new FuelReceiptError(`Účtenka ${parsed.docNumber} už byla nahrána`, 'ALREADY_IMPORTED');
  }

  const candidates = await prisma.fuelPurchase.findMany({
    where: {
      stationCode: parsed.stationCode,
      purchasedAt: {
        gte: new Date(parsed.purchasedAt.getTime() - MATCH_WINDOW_MS),
        lte: new Date(parsed.purchasedAt.getTime() + MATCH_WINDOW_MS),
      },
      receipt: null,
    },
    select: { id: true, stationCode: true, purchasedAt: true, amountCzk: true },
  });

  const matchedPurchaseId = matchReceiptToPurchase(
    {
      stationCode: parsed.stationCode,
      purchasedAt: parsed.purchasedAt,
      totalAfterDiscount: new Prisma.Decimal(parsed.totalAfterDiscount),
    },
    candidates,
  );

  if (dryRun) {
    return {
      dryRun: true,
      receiptId: null,
      docNumber: parsed.docNumber,
      purchasedAt: parsed.purchasedAt.toISOString(),
      stationName: parsed.stationName,
      matchedPurchaseId,
      totalAfterDiscount: parsed.totalAfterDiscount,
      discountAmount: parsed.discountAmount,
    };
  }

  const receipt = await prisma.fuelReceipt.create({
    data: {
      purchaseId: matchedPurchaseId,
      purchasedAt: parsed.purchasedAt,
      stationCode: parsed.stationCode,
      stationName: parsed.stationName,
      docNumber: parsed.docNumber,
      transactionCode: parsed.transactionCode,
      quantityLiters: new Prisma.Decimal(parsed.quantityLiters),
      pricePerLiter: new Prisma.Decimal(parsed.pricePerLiter),
      grossBeforeDiscount: new Prisma.Decimal(parsed.grossBeforeDiscount),
      discountLabel: parsed.discountLabel,
      discountAmount: new Prisma.Decimal(parsed.discountAmount),
      totalAfterDiscount: new Prisma.Decimal(parsed.totalAfterDiscount),
      cardLast4: parsed.cardLast4,
      sourceFileHash: fileHash,
      rawText: parsed.rawText,
    },
  });

  return {
    dryRun: false,
    receiptId: receipt.id,
    docNumber: receipt.docNumber,
    purchasedAt: receipt.purchasedAt.toISOString(),
    stationName: receipt.stationName,
    matchedPurchaseId,
    totalAfterDiscount: receipt.totalAfterDiscount.toFixed(2),
    discountAmount: receipt.discountAmount.toFixed(2),
  };
}

export interface RematchResult {
  matched: number;
  stillUnmatched: number;
}

/**
 * Re-runs matching for every receipt still stuck at `purchaseId: null`.
 *
 * Matching otherwise only ever runs once, at upload time (see
 * `processFuelReceiptUpload` above) — a receipt uploaded before its
 * corresponding `Sales.xls` import has no `FuelPurchase` candidates to match
 * against yet, and nothing retries it afterward. Re-uploading the same PDF
 * doesn't help either: it's rejected as already imported by both `docNumber`
 * and file hash, before matching would even run.
 */
export async function rematchFuelReceipts(): Promise<RematchResult> {
  const unmatched = await prisma.fuelReceipt.findMany({
    where: { purchaseId: null },
    select: { id: true, stationCode: true, purchasedAt: true, totalAfterDiscount: true },
    orderBy: { purchasedAt: 'asc' },
  });

  if (unmatched.length === 0) {
    return { matched: 0, stillUnmatched: 0 };
  }

  const candidates = await prisma.fuelPurchase.findMany({
    where: { receipt: null },
    select: { id: true, stationCode: true, purchasedAt: true, amountCzk: true },
  });

  // A purchase claimed by one receipt in this pass must not also be offered
  // to the next — same one-purchase-one-receipt rule the unique constraint
  // on FuelReceipt.purchaseId enforces at the database level.
  const claimedPurchaseIds = new Set<string>();
  let matched = 0;

  for (const receipt of unmatched) {
    const remainingCandidates = candidates.filter((candidate) => !claimedPurchaseIds.has(candidate.id));

    const matchedPurchaseId = matchReceiptToPurchase(
      { stationCode: receipt.stationCode, purchasedAt: receipt.purchasedAt, totalAfterDiscount: receipt.totalAfterDiscount },
      remainingCandidates,
    );

    if (!matchedPurchaseId) {
      continue;
    }

    claimedPurchaseIds.add(matchedPurchaseId);
    await prisma.fuelReceipt.update({ where: { id: receipt.id }, data: { purchaseId: matchedPurchaseId } });
    matched += 1;
  }

  return { matched, stillUnmatched: unmatched.length - matched };
}
