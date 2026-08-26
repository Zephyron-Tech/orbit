import { createHash } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { FUEL_DATA_CUTOFF } from '@/lib/finance/fuel';
import { buildFuelPurchaseKey } from '@/lib/finance/idempotency';
import { parseOrlenSales, XlsStructureError, type ParsedFuelPurchase } from '@/lib/parsers/xls/orlen-sales';

/** Same dry-run/commit shape as `processCsvImport`, minus everything that only makes sense for a bank Account. */

export class FuelImportError extends Error {
  constructor(
    message: string,
    readonly code: 'ALREADY_IMPORTED' | 'BAD_FORMAT',
  ) {
    super(message);
    this.name = 'FuelImportError';
  }
}

export interface FuelPurchasePreview {
  purchasedAt: string;
  stationName: string;
  product: string;
  quantityLiters: string;
  amountCzk: string;
  duplicate: boolean;
}

export interface FuelImportSummary {
  batchId: string | null;
  filename: string;
  dryRun: boolean;
  rowCount: number;
  inserted: number;
  skipped: number;
  /** Rows before FUEL_DATA_CUTOFF, in scope for the export but not for Orbit. */
  excludedBeforeCutoff: number;
  failed: number;
  preview: FuelPurchasePreview[];
  failures: { rowNumber: number; reason: string }[];
}

const PREVIEW_LIMIT = 25;

export interface ProcessFuelXlsOptions {
  bytes: Uint8Array;
  filename: string;
  /** When true nothing is written; the caller shows the summary for confirmation. */
  dryRun: boolean;
}

export async function processFuelXlsImport(options: ProcessFuelXlsOptions): Promise<FuelImportSummary> {
  const fileHash = createHash('sha256').update(options.bytes).digest('hex');

  // A byte-identical re-upload is answered before any parsing happens.
  const previousBatch = await prisma.fuelImportBatch.findUnique({ where: { fileHash } });

  if (previousBatch) {
    throw new FuelImportError(
      `Tento soubor už byl importován ${previousBatch.importedAt.toISOString().slice(0, 10)}`,
      'ALREADY_IMPORTED',
    );
  }

  let parsed: { purchases: ParsedFuelPurchase[]; failures: { rowNumber: number; reason: string; raw: Record<string, string> }[] };

  try {
    parsed = parseOrlenSales(Buffer.from(options.bytes));
  } catch (error: unknown) {
    const reason = error instanceof XlsStructureError ? error.message : 'Nečitelný soubor Sales.xls';

    throw new FuelImportError(reason, 'BAD_FORMAT');
  }

  // Fuel tracking only covers FUEL_DATA_CUTOFF onward — older rows in the
  // export (tankarta.cz history goes back years) are out of scope and never
  // stored, not just hidden from a report.
  const inScope = parsed.purchases.filter((purchase) => purchase.purchasedAt >= FUEL_DATA_CUTOFF);
  const excludedBeforeCutoff = parsed.purchases.length - inScope.length;

  const keyed = inScope.map((purchase) => ({
    purchase,
    key: buildFuelPurchaseKey({
      cardLast4: purchase.cardLast4,
      purchasedAt: purchase.purchasedAt,
      stationCode: purchase.stationCode,
      amountCzk: purchase.amountCzk,
    }),
  }));

  // One query for every key, rather than one query per row.
  const existing = await prisma.fuelPurchase.findMany({
    where: { idempotencyKey: { in: keyed.map(({ key }) => key) } },
    select: { idempotencyKey: true },
  });
  const existingKeys = new Set(existing.map((row) => row.idempotencyKey));

  const seenInFile = new Set<string>();
  const fresh: typeof keyed = [];
  let skipped = 0;

  for (const entry of keyed) {
    if (existingKeys.has(entry.key) || seenInFile.has(entry.key)) {
      skipped += 1;
      continue;
    }

    seenInFile.add(entry.key);
    fresh.push(entry);
  }

  const preview: FuelPurchasePreview[] = keyed.slice(0, PREVIEW_LIMIT).map(({ purchase, key }) => ({
    purchasedAt: purchase.purchasedAt.toISOString(),
    stationName: purchase.stationName,
    product: purchase.product,
    quantityLiters: purchase.quantityLiters,
    amountCzk: purchase.amountCzk,
    duplicate: existingKeys.has(key),
  }));

  const summary: FuelImportSummary = {
    batchId: null,
    filename: options.filename,
    dryRun: options.dryRun,
    rowCount: parsed.purchases.length + parsed.failures.length,
    inserted: fresh.length,
    skipped,
    excludedBeforeCutoff,
    failed: parsed.failures.length,
    preview,
    failures: parsed.failures.map((failure) => ({ rowNumber: failure.rowNumber, reason: failure.reason })),
  };

  if (options.dryRun) {
    return summary;
  }

  const batch = await prisma.$transaction(async (tx) => {
    if (fresh.length > 0) {
      // skipDuplicates plus the unique index on idempotencyKey makes a
      // repeated import a no-op, even if two uploads race each other.
      await tx.fuelPurchase.createMany({
        skipDuplicates: true,
        data: fresh.map(({ purchase, key }) => ({
          purchasedAt: purchase.purchasedAt,
          cardLast4: purchase.cardLast4,
          stationCode: purchase.stationCode,
          stationName: purchase.stationName,
          product: purchase.product,
          quantityLiters: new Prisma.Decimal(purchase.quantityLiters),
          amountCzk: new Prisma.Decimal(purchase.amountCzk),
          idempotencyKey: key,
          rawData: purchase.raw,
        })),
      });
    }

    return tx.fuelImportBatch.create({
      data: {
        fileHash,
        insertedCount: fresh.length,
        skippedCount: skipped,
        failedCount: parsed.failures.length,
      },
    });
  });

  return { ...summary, batchId: batch.id };
}
