import { Hono } from 'hono';
import { z } from 'zod';

import { ImportError, processCsvImport } from '@orbit-api/lib/import/process-csv';
import { FuelReceiptError, processFuelReceiptUpload, rematchFuelReceipts, type FuelReceiptSummary } from '@orbit-api/lib/import/process-fuel-receipt';
import { FuelTopUpImportError, processFuelTopUpsImport } from '@orbit-api/lib/import/process-fuel-topups';
import { FuelImportError, processFuelXlsImport } from '@orbit-api/lib/import/process-fuel-xls';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FUEL_RECEIPT_FILES = 30;

const dryRunSchema = (value: string | File | null) => (value === null ? true : String(value) !== 'false');

type FuelReceiptFileResult = ({ ok: true } & FuelReceiptSummary & { filename: string }) | { ok: false; filename: string; error: string; code: string };

export const importRouter = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .post('/csv', async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const formSchema = z.object({
      accountId: z.uuid(),
      dryRun: z.string().optional().transform((value) => value !== 'false'),
      closingBalance: z
        .string()
        .optional()
        .transform((value) => (value ?? '').trim())
        .refine((value) => value === '' || /^-?[\d\s ]+([.,]\d{1,4})?$/.test(value), 'Zadejte zůstatek jako číslo, např. 12345,67')
        .transform((value) => (value === '' ? null : value.replace(/[\s ]/g, '').replace(',', '.'))),
    });

    const parsedForm = formSchema.safeParse({
      accountId: formData.get('accountId'),
      dryRun: formData.get('dryRun') ?? undefined,
      closingBalance: formData.get('closingBalance') ?? undefined,
    });
    if (!parsedForm.success) return c.json({ error: parsedForm.error.issues[0]?.message ?? 'Chybí platné ID účtu' }, 400);

    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'Nahrajte prosím CSV, XML nebo PDF soubor' }, 400);
    if (file.size === 0) return c.json({ error: 'Soubor je prázdný' }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: 'Soubor je větší než 5 MB' }, 413);
    if (!['.csv', '.xml', '.pdf'].some((extension) => file.name.toLowerCase().endsWith(extension))) {
      return c.json({ error: 'Podporovány jsou soubory .csv, .xml a .pdf' }, 415);
    }

    try {
      const summary = await processCsvImport({
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        accountId: parsedForm.data.accountId,
        dryRun: parsedForm.data.dryRun,
        closingBalance: parsedForm.data.closingBalance,
      });
      return c.json(summary);
    } catch (error: unknown) {
      if (error instanceof ImportError) {
        return c.json({ error: error.message, code: error.code }, error.code === 'ALREADY_IMPORTED' ? 409 : 400);
      }
      console.error('CSV import failed', error);
      return c.json({ error: 'Import se nezdařil' }, 500);
    }
  })
  .post('/fuel-receipt', async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const dryRun = dryRunSchema(formData.get('dryRun'));
    const files = formData.getAll('file');
    if (files.length === 0 || !files.every((file) => file instanceof File)) {
      return c.json({ error: 'Nahrajte prosím alespoň jednu účtenku ve formátu PDF' }, 400);
    }
    if (files.length > MAX_FUEL_RECEIPT_FILES) {
      return c.json({ error: `Nahrajte prosím nejvýše ${MAX_FUEL_RECEIPT_FILES} souborů najednou` }, 400);
    }

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
        console.error('Fuel receipt upload failed', file.name, error);
        results.push({ ok: false, filename: file.name, error: 'Nahrání účtenky se nezdařilo', code: 'INTERNAL' });
      }
    }

    return c.json({ results });
  })
  .post('/fuel-receipt/rematch', async (c) => {
    try {
      const result = await rematchFuelReceipts();
      return c.json(result);
    } catch (error: unknown) {
      console.error('Fuel receipt rematch failed', error);
      return c.json({ error: 'Spárování se nezdařilo' }, 500);
    }
  })
  .post('/fuel-topups', async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const dryRun = dryRunSchema(formData.get('dryRun'));
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'Nahrajte prosím soubor ChargingPrepaids.xls' }, 400);
    if (file.size === 0) return c.json({ error: 'Soubor je prázdný' }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: 'Soubor je větší než 5 MB' }, 413);
    if (!file.name.toLowerCase().endsWith('.xls')) return c.json({ error: 'Podporován je pouze soubor .xls' }, 415);

    try {
      const summary = await processFuelTopUpsImport({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, dryRun });
      return c.json(summary);
    } catch (error: unknown) {
      if (error instanceof FuelTopUpImportError) {
        return c.json({ error: error.message, code: error.code }, error.code === 'ALREADY_IMPORTED' ? 409 : 400);
      }
      console.error('Fuel top-up import failed', error);
      return c.json({ error: 'Import se nezdařil' }, 500);
    }
  })
  .post('/fuel', async (c) => {
    const formData = await c.req.formData().catch(() => null);
    if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

    const dryRun = dryRunSchema(formData.get('dryRun'));
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'Nahrajte prosím soubor Sales.xls' }, 400);
    if (file.size === 0) return c.json({ error: 'Soubor je prázdný' }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: 'Soubor je větší než 5 MB' }, 413);
    if (!file.name.toLowerCase().endsWith('.xls')) return c.json({ error: 'Podporován je pouze soubor .xls' }, 415);

    try {
      const summary = await processFuelXlsImport({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, dryRun });
      return c.json(summary);
    } catch (error: unknown) {
      if (error instanceof FuelImportError) {
        return c.json({ error: error.message, code: error.code }, error.code === 'ALREADY_IMPORTED' ? 409 : 400);
      }
      console.error('Fuel xls import failed', error);
      return c.json({ error: 'Import se nezdařil' }, 500);
    }
  });
