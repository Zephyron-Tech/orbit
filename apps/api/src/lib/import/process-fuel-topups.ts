import { createHash } from 'node:crypto';

import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { buildFuelTopUpKey } from '@orbit-api/lib/finance/idempotency';
import { parseOrlenTopUps, XlsStructureError, type ParsedFuelTopUp } from '@orbit-api/lib/parsers/xls/orlen-topups';

/** Same dry-run/commit shape as `process-fuel-xls.ts`, targeting `FuelTopUp` instead of `FuelPurchase`. */

export class FuelTopUpImportError extends Error {
  constructor(
    message: string,
    readonly code: 'ALREADY_IMPORTED' | 'BAD_FORMAT',
  ) {
    super(message);
    this.name = 'FuelTopUpImportError';
  }
}

export interface FuelTopUpPreview {
  toppedUpAt: string;
  method: string;
  station: string;
  amountCzk: string;
  duplicate: boolean;
}

export interface FuelTopUpImportSummary {
  batchId: string | null;
  filename: string;
  dryRun: boolean;
  rowCount: number;
  inserted: number;
  skipped: number;
  failed: number;
  preview: FuelTopUpPreview[];
  failures: { rowNumber: number; reason: string }[];
}

const PREVIEW_LIMIT = 25;

export interface ProcessFuelTopUpsOptions {
  bytes: Uint8Array;
  filename: string;
  /** When true nothing is written; the caller shows the summary for confirmation. */
  dryRun: boolean;
}

export async function processFuelTopUpsImport(options: ProcessFuelTopUpsOptions): Promise<FuelTopUpImportSummary> {
  const fileHash = createHash('sha256').update(options.bytes).digest('hex');

  // A byte-identical re-upload is answered before any parsing happens.
  const previousBatch = await prisma.fuelImportBatch.findUnique({ where: { fileHash } });

  if (previousBatch) {
    throw new FuelTopUpImportError(
      `Tento soubor už byl importován ${previousBatch.importedAt.toISOString().slice(0, 10)}`,
      'ALREADY_IMPORTED',
    );
  }

  let parsed: { topUps: ParsedFuelTopUp[]; failures: { rowNumber: number; reason: string; raw: Record<string, string> }[] };

  try {
    parsed = parseOrlenTopUps(Buffer.from(options.bytes));
  } catch (error: unknown) {
    const reason = error instanceof XlsStructureError ? error.message : 'Nečitelný soubor ChargingPrepaids.xls';

    throw new FuelTopUpImportError(reason, 'BAD_FORMAT');
  }

  // Full history is stored, even though only FUEL_DATA_CUTOFF onward is ever
  // shown: an all-time wallet balance needs every top-up, including ones
  // from before the reporting window, or it silently starts from zero
  // instead of the real prepaid-card balance. FUEL_DATA_CUTOFF filtering
  // happens at display time, in `fuel-service.ts`.
  const keyed = parsed.topUps.map((topUp) => ({
    topUp,
    key: buildFuelTopUpKey({
      toppedUpAt: topUp.toppedUpAt,
      method: topUp.method,
      station: topUp.station,
      amountCzk: topUp.amountCzk,
    }),
  }));

  // One query for every key, rather than one query per row.
  const existing = await prisma.fuelTopUp.findMany({
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

  const preview: FuelTopUpPreview[] = keyed.slice(0, PREVIEW_LIMIT).map(({ topUp, key }) => ({
    toppedUpAt: topUp.toppedUpAt.toISOString(),
    method: topUp.method,
    station: topUp.station,
    amountCzk: topUp.amountCzk,
    duplicate: existingKeys.has(key),
  }));

  const summary: FuelTopUpImportSummary = {
    batchId: null,
    filename: options.filename,
    dryRun: options.dryRun,
    rowCount: parsed.topUps.length + parsed.failures.length,
    inserted: fresh.length,
    skipped,
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
      await tx.fuelTopUp.createMany({
        skipDuplicates: true,
        data: fresh.map(({ topUp, key }) => ({
          toppedUpAt: topUp.toppedUpAt,
          method: topUp.method,
          station: topUp.station,
          operationType: topUp.operationType,
          amountCzk: new Prisma.Decimal(topUp.amountCzk),
          idempotencyKey: key,
          rawData: topUp.raw,
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
