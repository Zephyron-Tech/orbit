import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { ImportError, processCsvImport } from '@orbit-api/lib/import/process-csv';
import { FuelReceiptError, processFuelReceiptUpload, type FuelReceiptSummary } from '@orbit-api/lib/import/process-fuel-receipt';
import { FuelTopUpImportError, processFuelTopUpsImport } from '@orbit-api/lib/import/process-fuel-topups';
import { FuelImportError, processFuelXlsImport } from '@orbit-api/lib/import/process-fuel-xls';
import { MonetaSyncError, processMonetaSyncTransactions } from '@orbit-api/lib/import/process-moneta-sync';
import { ingestionAuth } from '@orbit-api/middleware/ingestion-auth';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FUEL_RECEIPT_FILES = 30;
const dryRunFlag = (value: string | File | null) => (value === null ? true : String(value) !== 'false');

type FuelReceiptFileResult = ({ ok: true } & FuelReceiptSummary & { filename: string }) | { ok: false; filename: string; error: string; code: string };

export const ingest = new Hono()
  /**
   * Lets the bank-statement automation bot discover which `accountId` to
   * send with each statement upload, keyed by the bank's own account
   * number — the same identifier the bot can read off the mailed statement.
   */
  .get('/accounts', ingestionAuth('BANK_STATEMENT_INGESTION_SECRET'), async (c) => {
    const rows = await prisma.account.findMany({
      where: { isArchived: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true, provider: true, externalId: true },
    });

    return c.json({
      accounts: rows.map((account) => ({ id: account.id, name: account.name, type: account.type, provider: account.provider, accountNumber: account.externalId })),
    });
  })
  // M2M counterpart of /import/csv — the bank now sends every statement
  // (current, savings, EUR, credit card) as a PDF by mail.
  .post('/bank-statement', ingestionAuth('BANK_STATEMENT_INGESTION_SECRET'), async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const parsedForm = z
      .object({ accountId: z.uuid(), dryRun: z.string().optional().transform((value) => value !== 'false') })
      .safeParse({ accountId: formData.get('account_id'), dryRun: formData.get('dryRun') ?? undefined });
    if (!parsedForm.success) return c.json({ error: 'Chybí platné ID účtu' }, 400);

    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'Nahrajte prosím PDF výpis' }, 400);
    if (file.size === 0) return c.json({ error: 'Soubor je prázdný' }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: 'Soubor je větší než 5 MB' }, 413);
    if (!file.name.toLowerCase().endsWith('.pdf')) return c.json({ error: 'Podporován je pouze soubor .pdf' }, 415);

    try {
      const summary = await processCsvImport({
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        accountId: parsedForm.data.accountId,
        dryRun: parsedForm.data.dryRun,
      });
      return c.json(summary);
    } catch (error: unknown) {
      if (error instanceof ImportError) return c.json({ error: error.message, code: error.code }, error.code === 'ALREADY_IMPORTED' ? 409 : 400);
      console.error('Bank statement ingest failed', error);
      return c.json({ error: 'Import se nezdařil' }, 500);
    }
  })
  .post('/fuel-receipt', ingestionAuth('FUEL_INGESTION_SECRET'), async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const dryRun = dryRunFlag(formData.get('dryRun'));
    const files = formData.getAll('file');
    if (files.length === 0 || !files.every((file) => file instanceof File)) {
      return c.json({ error: 'Nahrajte prosím alespoň jednu účtenku ve formátu PDF' }, 400);
    }
    if (files.length > MAX_FUEL_RECEIPT_FILES) return c.json({ error: `Nahrajte prosím nejvýše ${MAX_FUEL_RECEIPT_FILES} souborů najednou` }, 400);

    const results: FuelReceiptFileResult[] = [];

    for (const file of files as File[]) {
      if (file.size === 0) {
        results.push({ ok: false, filename: file.name, error: 'Soubor je prázdný', code: 'BAD_FORMAT' });
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        results.push({ ok: false, filename: file.name, error: 'Soubor je větší než 5 MB', code: 'BAD_FORMAT' });
        continue;
      }
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        results.push({ ok: false, filename: file.name, error: 'Podporován je pouze soubor .pdf', code: 'BAD_FORMAT' });
        continue;
      }

      try {
        const summary = await processFuelReceiptUpload({ bytes: new Uint8Array(await file.arrayBuffer()), dryRun });
        results.push({ ok: true, filename: file.name, ...summary });
      } catch (error: unknown) {
        if (error instanceof FuelReceiptError) {
          results.push({ ok: false, filename: file.name, error: error.message, code: error.code });
          continue;
        }
        console.error('Fuel receipt ingest failed', file.name, error);
        results.push({ ok: false, filename: file.name, error: 'Nahrání účtenky se nezdařilo', code: 'INTERNAL' });
      }
    }

    return c.json({ results });
  })
  .post('/fuel-topups', ingestionAuth('FUEL_INGESTION_SECRET'), async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const dryRun = dryRunFlag(formData.get('dryRun'));
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'Nahrajte prosím soubor ChargingPrepaids.xls' }, 400);
    if (file.size === 0) return c.json({ error: 'Soubor je prázdný' }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: 'Soubor je větší než 5 MB' }, 413);
    if (!file.name.toLowerCase().endsWith('.xls')) return c.json({ error: 'Podporován je pouze soubor .xls' }, 415);

    try {
      const summary = await processFuelTopUpsImport({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, dryRun });
      return c.json(summary);
    } catch (error: unknown) {
      if (error instanceof FuelTopUpImportError) return c.json({ error: error.message, code: error.code }, error.code === 'ALREADY_IMPORTED' ? 409 : 400);
      console.error('Fuel top-up ingest failed', error);
      return c.json({ error: 'Import se nezdařil' }, 500);
    }
  })
  .post('/fuel', ingestionAuth('FUEL_INGESTION_SECRET'), async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const dryRun = dryRunFlag(formData.get('dryRun'));
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'Nahrajte prosím soubor Sales.xls' }, 400);
    if (file.size === 0) return c.json({ error: 'Soubor je prázdný' }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: 'Soubor je větší než 5 MB' }, 413);
    if (!file.name.toLowerCase().endsWith('.xls')) return c.json({ error: 'Podporován je pouze soubor .xls' }, 415);

    try {
      const summary = await processFuelXlsImport({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, dryRun });
      return c.json(summary);
    } catch (error: unknown) {
      if (error instanceof FuelImportError) return c.json({ error: error.message, code: error.code }, error.code === 'ALREADY_IMPORTED' ? 409 : 400);
      console.error('Fuel xls ingest failed', error);
      return c.json({ error: 'Import se nezdařil' }, 500);
    }
  })
  /**
   * Moneta email-fallback bot: one transaction per call, parsed from a
   * "Info Servis" notification e-mail (docs/moneta-sync-ingest-api.md). No
   * bank reference exists on this source, so every row dedups via the
   * ATTRIBUTES idempotency fallback — a known, documented limitation.
   */
  .post('/moneta-sync/transactions', ingestionAuth('MONETA_SYNC_INGESTION_SECRET'), async (c) => {
    const bodySchema = z.object({
      transaction_id: z.string().trim().min(1).nullable(),
      account_id: z.uuid(),
      amount: z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'amount musí být desetinný řetězec s tečkou, ne číslo'),
      currency: z.string().length(3),
      booked_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'booked_date musí být ve tvaru YYYY-MM-DD'),
      counterparty: z.string().trim().min(1).nullable(),
      source: z.string().trim().min(1),
      dryRun: z.boolean().optional().default(true),
    });

    const body: unknown = await c.req.json().catch(() => null);
    if (body === null) return c.json({ error: 'Očekáván JSON' }, 400);

    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) return c.json({ error: parsedBody.error.issues[0]?.message ?? 'Neplatný požadavek' }, 400);

    try {
      const summary = await processMonetaSyncTransactions({
        accountId: parsedBody.data.account_id,
        dryRun: parsedBody.data.dryRun,
        transactions: [
          {
            transactionId: parsedBody.data.transaction_id,
            date: parsedBody.data.booked_date,
            amount: parsedBody.data.amount,
            currency: parsedBody.data.currency,
            merchant: parsedBody.data.counterparty,
            description: null,
            counterAccount: null,
            sourceCategory: null,
            sourceTag: parsedBody.data.source,
          },
        ],
      });
      return c.json(summary);
    } catch (error: unknown) {
      if (error instanceof MonetaSyncError) return c.json({ error: error.message, code: error.code }, error.code === 'ALREADY_IMPORTED' ? 409 : 400);
      console.error('Moneta sync ingest failed', error);
      return c.json({ error: 'Zpracování se nezdařilo' }, 500);
    }
  });
