import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { PDFParse } from 'pdf-parse';

import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { matchReceiptToPurchase } from '@/lib/finance/fuel-matching';
import { parseOrlenReceipt, ReceiptParseError, type ParsedFuelReceipt } from '@/lib/parsers/pdf/orlen-receipt';

// pdfjs-dist (pdf-parse's dependency) resolves its worker script relative to
// its own compiled module by default ("./pdf.worker.mjs"), which breaks once
// Next's bundler moves the module into a chunk at an unrelated path — it
// only ever surfaces in the Docker/standalone build, never in `next dev` or
// a plain script, since those keep the real node_modules layout intact.
// `require.resolve`/`createRequire` don't help here: Turbopack replaces them
// with its own shim in the compiled server bundle, which returns an internal
// numeric module id instead of a real path, both at build time ("collect
// page data") and at runtime. Plain filesystem math from `process.cwd()`
// sidesteps the bundler entirely — the Docker runner's WORKDIR and `next
// dev`'s working directory are both the project root, and
// `next.config.ts`'s `outputFileTracingIncludes` guarantees this exact file
// exists at this path in the standalone build.
let workerConfigured = false;

function ensureWorkerConfigured(): void {
  if (workerConfigured) return;
  PDFParse.setWorker(join(process.cwd(), 'node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs'));
  workerConfigured = true;
}

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
  receiptId: string;
  docNumber: string;
  matchedPurchaseId: string | null;
  totalAfterDiscount: string;
  discountAmount: string;
}

const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Uploads and parses one Orlen receipt PDF, then attempts to match it to an
 * already-imported `FuelPurchase` row (station + amount + close timestamp —
 * see `lib/finance/fuel-matching.ts`). Left unmatched when ambiguous or when
 * the purchase hasn't been imported yet; the "receipts needing review" list
 * in the UI surfaces those.
 */
export async function processFuelReceiptUpload(bytes: Uint8Array): Promise<FuelReceiptSummary> {
  ensureWorkerConfigured();

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
    receiptId: receipt.id,
    docNumber: receipt.docNumber,
    matchedPurchaseId,
    totalAfterDiscount: receipt.totalAfterDiscount.toFixed(2),
    discountAmount: receipt.discountAmount.toFixed(2),
  };
}
