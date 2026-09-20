import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { reorderRows } from '@orbit-api/lib/db/reorder';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { PaymentFrequency, PolicyStatus, VehicleCategory } from '@orbit-api/lib/generated/prisma/enums';
import { CsvStructureError } from '@orbit-api/lib/parsers/csv/types';
import { parseGeneraliContract } from '@orbit-api/lib/parsers/pdf/generali-contract';
import { parseGreenCard } from '@orbit-api/lib/parsers/pdf/generali-green-card';
import { ensurePdfWorkerConfigured } from '@orbit-api/lib/parsers/pdf/pdf-worker';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const kindSchema = z.enum(['CONTRACT', 'GREEN_CARD']);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum zadejte ve formátu RRRR-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Zadejte platné datum');

const insurancePolicySchema = z.object({
  vehicleName: z.string().trim().min(1, 'Zadejte název vozidla').max(120),
  licensePlate: z.string().trim().min(1, 'Zadejte SPZ').max(20),
  policyNumber: z.string().trim().min(1, 'Zadejte číslo pojistky').max(60),
  policyHolder: z.string().trim().min(1, 'Zadejte pojistníka').max(120),
  vehicleType: z.enum(VehicleCategory),
  annualCost: z
    .string()
    .trim()
    .refine((value) => /^\d+([.,]\d{1,4})?$/.test(value), 'Zadejte kladnou částku, např. 12000')
    .transform((value) => value.replace(',', '.')),
  paymentFrequency: z.enum(PaymentFrequency),
  startDate: dateString,
  status: z.enum(PolicyStatus),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Neplatná data';
}

function toPrismaData(input: z.infer<typeof insurancePolicySchema>) {
  return {
    vehicleName: input.vehicleName,
    licensePlate: input.licensePlate,
    policyNumber: input.policyNumber,
    policyHolder: input.policyHolder,
    vehicleType: input.vehicleType,
    annualCost: new Prisma.Decimal(input.annualCost),
    paymentFrequency: input.paymentFrequency,
    startDate: new Date(`${input.startDate}T00:00:00.000Z`),
    status: input.status,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function readUploadedFile(c: import('hono').Context): Promise<{ kind: 'CONTRACT' | 'GREEN_CARD'; file: File } | Response> {
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: 'Očekáván multipart/form-data' }, 400);

  const parsedKind = kindSchema.safeParse(formData.get('kind'));
  if (!parsedKind.success) return c.json({ error: 'Chybí platný typ dokumentu' }, 400);

  const file = formData.get('file');
  if (!(file instanceof File)) return c.json({ error: 'Nahrajte prosím PDF soubor' }, 400);
  if (file.size === 0) return c.json({ error: 'Soubor je prázdný' }, 400);
  if (file.size > MAX_FILE_BYTES) return c.json({ error: 'Soubor je větší než 5 MB' }, 413);
  if (!file.name.toLowerCase().endsWith('.pdf')) return c.json({ error: 'Podporován je pouze soubor .pdf' }, 415);

  return { kind: parsedKind.data, file };
}

export const insurance = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const rows = await prisma.insurancePolicy.findMany({ orderBy: [{ sortOrder: 'asc' }, { annualCost: 'desc' }] });
    return c.json(rows);
  })
  .post('/', async (c) => {
    const parsed = insurancePolicySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

    try {
      const policy = await prisma.insurancePolicy.create({ data: toPrismaData(parsed.data) });
      return c.json(policy, 201);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return c.json({ error: 'Toto číslo pojistky už je evidované' }, 409);
      throw error;
    }
  })
  .patch('/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    const parsed = insurancePolicySchema.safeParse(await c.req.json());
    if (!parsedId.success) return c.json({ error: 'Neplatná pojistka' }, 400);
    if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400);

    try {
      const policy = await prisma.insurancePolicy.update({ where: { id: parsedId.data }, data: toPrismaData(parsed.data) });
      return c.json(policy);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return c.json({ error: 'Toto číslo pojistky už je evidované' }, 409);
      throw error;
    }
  })
  .delete('/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatná pojistka' }, 400);

    await prisma.insurancePolicy.delete({ where: { id: parsedId.data } });
    return c.body(null, 204);
  })
  .post('/reorder', async (c) => {
    const parsed = z.object({ id: z.uuid(), direction: z.union([z.literal(-1), z.literal(1)]) }).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatný požadavek' }, 400);

    const result = await reorderRows(
      parsed.data.id,
      parsed.data.direction,
      (tx) => tx.insurancePolicy.findMany({ orderBy: [{ sortOrder: 'asc' }, { annualCost: 'desc' }], select: { id: true } }),
      (tx, policyId, position) => tx.insurancePolicy.update({ where: { id: policyId }, data: { sortOrder: position } }),
    );

    if (!result.ok) {
      return c.json(
        { error: result.error === 'CONFLICT' ? 'Někdo jiný právě měnil pořadí, zkuste to znovu.' : 'Neplatná pojistka' },
        result.error === 'CONFLICT' ? 409 : 400,
      );
    }

    return c.json({ ok: true });
  })
  .post('/documents/parse', async (c) => {
    const uploaded = await readUploadedFile(c);
    if (uploaded instanceof Response) return uploaded;

    ensurePdfWorkerConfigured();
    const pdf = new PDFParse({ data: Buffer.from(await uploaded.file.arrayBuffer()) });

    try {
      const { text } = await pdf.getText();
      if (uploaded.kind === 'GREEN_CARD') return c.json(parseGreenCard(text));
      return c.json(parseGeneraliContract(text));
    } catch (error: unknown) {
      if (error instanceof CsvStructureError) return c.json({ error: error.message }, 400);
      console.error('Insurance document parse failed', error);
      return c.json({ error: 'Nečitelný soubor PDF' }, 400);
    } finally {
      await pdf.destroy();
    }
  })
  .post('/:policyId/documents', async (c) => {
    const parsedPolicyId = z.uuid().safeParse(c.req.param('policyId'));
    if (!parsedPolicyId.success) return c.json({ error: 'Neplatná pojistka' }, 400);

    const policy = await prisma.insurancePolicy.findUnique({ where: { id: parsedPolicyId.data }, select: { id: true } });
    if (!policy) return c.json({ error: 'Pojistka nenalezena' }, 404);

    const uploaded = await readUploadedFile(c);
    if (uploaded instanceof Response) return uploaded;

    const bytes = Buffer.from(await uploaded.file.arrayBuffer());
    const sourceFileHash = createHash('sha256').update(bytes).digest('hex');

    try {
      const document = await prisma.insurancePolicyDocument.create({
        data: { policyId: policy.id, kind: uploaded.kind, filename: uploaded.file.name, contentType: 'application/pdf', bytes, sourceFileHash },
        select: { id: true, kind: true, filename: true, uploadedAt: true },
      });
      return c.json(document, 201);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return c.json({ error: 'Tento soubor už je nahraný' }, 409);
      throw error;
    }
  })
  .get('/:policyId/documents/:documentId', async (c) => {
    const parsedPolicyId = z.uuid().safeParse(c.req.param('policyId'));
    const parsedDocumentId = z.uuid().safeParse(c.req.param('documentId'));
    if (!parsedPolicyId.success || !parsedDocumentId.success) return c.json({ error: 'Neplatný dokument' }, 400);

    const document = await prisma.insurancePolicyDocument.findUnique({
      where: { id: parsedDocumentId.data },
      select: { policyId: true, filename: true, contentType: true, bytes: true },
    });

    if (!document || document.policyId !== parsedPolicyId.data) {
      return c.json({ error: 'Dokument nenalezen' }, 404);
    }

    // Strips quotes and any control character before this reaches a raw
    // header value — the stored filename is the uploader's own File.name,
    // never re-validated after upload.
    const safeFilename = document.filename.replace(/[" -]/g, '');

    return new Response(new Uint8Array(document.bytes), {
      headers: {
        'Content-Type': document.contentType,
        'Content-Disposition': `inline; filename="${safeFilename}"`,
      },
    });
  });
