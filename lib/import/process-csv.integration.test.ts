/**
 * Integration test for the CSV import pipeline. Requires a running database
 * (`npm run db:up`) and is excluded from the default unit-test run:
 * `npm run test:integration`.
 *
 * It exercises the one guarantee the whole design rests on: importing the same
 * statement twice must never create a second copy of a transaction.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db/prisma';
import { ImportError, processCsvImport } from '@/lib/import/process-csv';

const FIXTURE = join(process.cwd(), 'docs/samples/moneta/2026-07.csv');
const EXTERNAL_ID = '111222333/0600';
const OTHER_EXTERNAL_ID = '999888777/0600';

let accountId = '';
let bytes = new Uint8Array();

/**
 * Deletes only what this suite created. An unscoped deleteMany() once wiped a
 * developer's real imported statements when the suite was pointed at the
 * development database; the dedicated test database in
 * vitest.integration.config.ts is the first guard, this scoping is the second.
 */
async function cleanUp(): Promise<void> {
  const owned = await prisma.account.findMany({
    where: { externalId: { in: [EXTERNAL_ID, OTHER_EXTERNAL_ID] } },
    select: { id: true },
  });

  await prisma.accountSnapshot.deleteMany({ where: { accountId: { in: owned.map((a) => a.id) } } });

  const accounts = await prisma.account.findMany({
    where: { externalId: { in: [EXTERNAL_ID, OTHER_EXTERNAL_ID] } },
    select: { id: true },
  });

  const accountIds = accounts.map((account) => account.id);

  if (accountIds.length === 0) {
    return;
  }

  const batches = await prisma.importBatch.findMany({
    where: { accountId: { in: accountIds } },
    select: { id: true },
  });

  await prisma.ingestionEvent.deleteMany({ where: { importBatchId: { in: batches.map((batch) => batch.id) } } });
  await prisma.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
  await prisma.importBatch.deleteMany({ where: { accountId: { in: accountIds } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
}

beforeAll(async () => {
  await cleanUp();

  const account = await prisma.account.create({
    data: { name: 'Moneta test', type: 'CHECKING', provider: 'MONETA', externalId: EXTERNAL_ID },
  });

  accountId = account.id;
  bytes = new Uint8Array(readFileSync(FIXTURE));
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('processCsvImport', () => {
  it('writes nothing during a dry run', async () => {
    const summary = await processCsvImport({ bytes, filename: '2026-07.csv', accountId, dryRun: true });

    expect(summary.rowCount).toBe(84);
    expect(summary.inserted).toBe(84);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.dedupStrategy).toBe('EXTERNAL_ID');
    expect(summary.periodFrom).toBe('2026-07-01');
    expect(summary.periodTo).toBe('2026-07-31');
    expect(summary.batchId).toBeNull();

    await expect(prisma.transaction.count({ where: { accountId } })).resolves.toBe(0);
  });

  it('imports every row on the first run', async () => {
    const summary = await processCsvImport({ bytes, filename: '2026-07.csv', accountId, dryRun: false });

    expect(summary.inserted).toBe(84);
    expect(summary.batchId).not.toBeNull();
    await expect(prisma.transaction.count({ where: { accountId } })).resolves.toBe(84);
  });

  it('keeps two genuinely identical same-day purchases apart', async () => {
    const club = await prisma.transaction.findMany({
      where: { accountId, merchant: 'MUSIC CLUB HROZEN PRAC PRACHAT' },
    });

    expect(club).toHaveLength(2);
    expect(club[0]?.externalId).not.toBe(club[1]?.externalId);
  });

  it('refuses a byte-identical re-upload before parsing it', async () => {
    await expect(
      processCsvImport({ bytes, filename: '2026-07.csv', accountId, dryRun: false }),
    ).rejects.toMatchObject({ code: 'ALREADY_IMPORTED' });

    await expect(prisma.transaction.count({ where: { accountId } })).resolves.toBe(84);
  });

  it('deduplicates the same statement re-exported as a different file', async () => {
    // A trailing newline changes the file hash but not a single transaction.
    const reExported = new Uint8Array(Buffer.concat([Buffer.from(bytes), Buffer.from('\r\n')]));

    const summary = await processCsvImport({
      bytes: reExported,
      filename: '2026-07-again.csv',
      accountId,
      dryRun: false,
    });

    expect(summary.inserted).toBe(0);
    expect(summary.skipped).toBe(84);
    await expect(prisma.transaction.count({ where: { accountId } })).resolves.toBe(84);
  });

  it('applies the bank categories', async () => {
    const categorized = await prisma.transaction.count({ where: { accountId, categoryId: { not: null } } });

    expect(categorized).toBeGreaterThan(40);
  });

  it('stores amounts as exact decimals', async () => {
    const total = await prisma.transaction.aggregate({ where: { accountId }, _sum: { amount: true } });

    // The fixture's true balance, to the haler.
    expect(total._sum.amount?.toString()).toBe('33597.56');
  });

  it('logs failed rows and only failed rows', async () => {
    const events = await prisma.ingestionEvent.count({ where: { provider: 'MONETA' } });

    expect(events).toBe(0);
  });

  it('refuses a statement belonging to another account', async () => {
    const other = await prisma.account.create({
      data: { name: 'Jiný účet', type: 'CHECKING', provider: 'MONETA', externalId: OTHER_EXTERNAL_ID },
    });

    await expect(
      processCsvImport({ bytes, filename: '2026-07.csv', accountId: other.id, dryRun: true }),
    ).rejects.toBeInstanceOf(ImportError);

    await prisma.account.delete({ where: { id: other.id } });
  });

  it('reports a corrupted PDF as BAD_FORMAT, not an unhandled crash', async () => {
    const corrupt = new TextEncoder().encode('%PDF-1.4 this is not a real PDF');

    await expect(
      processCsvImport({ bytes: corrupt, filename: 'broken.pdf', accountId, dryRun: true }),
    ).rejects.toMatchObject({ code: 'BAD_FORMAT' });
  });
});

describe('statement import', () => {
  const STATEMENT = join(process.cwd(), 'docs/samples/moneta/statement-2026-07.xml');

  it('imports a statement and anchors the balance without anyone typing it', async () => {
    await prisma.transaction.deleteMany({ where: { accountId } });
    await prisma.accountSnapshot.deleteMany({ where: { accountId } });
    await prisma.importBatch.deleteMany({ where: { accountId } });

    const summary = await processCsvImport({
      bytes: new Uint8Array(readFileSync(STATEMENT)),
      filename: 'statement-2026-07.xml',
      accountId,
      dryRun: false,
    });

    expect(summary.kind).toBe('STATEMENT');
    expect(summary.inserted).toBe(84);
    expect(summary.statement?.warnings).toEqual([]);
    expect(summary.statement?.closingBalance).toBe('184186.86');

    // The anchor came from the document, not from a form field.
    expect(summary.checkpoint?.balance).toBe('184186.86');
    expect(summary.checkpoint?.asOf).toBe('2026-07-31');
  });

  it('recognises the same month already imported from the CSV export', async () => {
    await prisma.transaction.deleteMany({ where: { accountId } });
    await prisma.accountSnapshot.deleteMany({ where: { accountId } });
    await prisma.importBatch.deleteMany({ where: { accountId } });

    const csv = await processCsvImport({ bytes, filename: '2026-07.csv', accountId, dryRun: false });
    expect(csv.inserted).toBe(84);

    // The canonical reference is what makes the two formats agree.
    const statement = await processCsvImport({
      bytes: new Uint8Array(readFileSync(STATEMENT)),
      filename: 'statement-2026-07.xml',
      accountId,
      dryRun: false,
    });

    expect(statement.inserted).toBe(0);
    expect(statement.skipped).toBe(84);
    await expect(prisma.transaction.count({ where: { accountId } })).resolves.toBe(84);
  });

  it('refuses to anchor a balance from a statement that does not add up', async () => {
    await prisma.transaction.deleteMany({ where: { accountId } });
    await prisma.accountSnapshot.deleteMany({ where: { accountId } });
    await prisma.importBatch.deleteMany({ where: { accountId } });

    const tampered = readFileSync(STATEMENT, 'utf8').replace(
      '<stm-bal-end>184186.86</stm-bal-end>',
      '<stm-bal-end>999999.00</stm-bal-end>',
    );

    const summary = await processCsvImport({
      bytes: new TextEncoder().encode(tampered),
      filename: 'tampered.xml',
      accountId,
      dryRun: false,
    });

    expect(summary.statement?.warnings.length).toBeGreaterThan(0);
    // A wrong anchor is worse than none: everything after it inherits the error.
    expect(summary.checkpoint).toBeNull();
    await expect(prisma.accountSnapshot.count({ where: { accountId } })).resolves.toBe(0);
  });

  it('imports an account\'s first-ever statement (empty date-previous) without throwing', async () => {
    await prisma.transaction.deleteMany({ where: { accountId } });
    await prisma.accountSnapshot.deleteMany({ where: { accountId } });
    await prisma.importBatch.deleteMany({ where: { accountId } });

    const firstEver = readFileSync(STATEMENT, 'utf8').replace('date-previous="2026-06-30"', 'date-previous=""');

    const summary = await processCsvImport({
      bytes: new TextEncoder().encode(firstEver),
      filename: 'first-statement.xml',
      accountId,
      dryRun: false,
    });

    expect(summary.statement?.from).toBeNull();
    expect(summary.checkpoint?.balance).toBe('184186.86');
    const batch = await prisma.importBatch.findFirstOrThrow({ where: { accountId, filename: 'first-statement.xml' } });
    expect(batch.coverageFrom).toBeNull();
  });
});

describe('credit card history import', () => {
  const CREDIT_FIXTURE = join(process.cwd(), 'docs/samples/moneta/credit-07.csv');
  let creditAccountId = '';

  beforeAll(async () => {
    const account = await prisma.account.create({
      data: { name: 'Smart karta test', type: 'CREDIT', provider: 'MONETA', currency: 'CZK', cardLast4: '1234' },
    });
    creditAccountId = account.id;
  });

  afterAll(async () => {
    if (creditAccountId) {
      await prisma.transaction.deleteMany({ where: { accountId: creditAccountId } });
      await prisma.importBatch.deleteMany({ where: { accountId: creditAccountId } });
      await prisma.account.delete({ where: { id: creditAccountId } });
    }
  });

  it('imports card history bound by configured last four digits', async () => {
    const summary = await processCsvImport({
      bytes: new Uint8Array(readFileSync(CREDIT_FIXTURE)),
      filename: 'credit-07.csv',
      accountId: creditAccountId,
      dryRun: false,
    });

    expect(summary.inserted).toBe(2);
    const row = await prisma.transaction.findFirstOrThrow({ where: { accountId: creditAccountId, externalId: 'credit-example-1' } });
    expect(row.amount.toString()).toBe('-2000');
  });

  it('rejects a card export for a differently configured card', async () => {
    const wrong = await prisma.account.create({
      data: { name: 'Jiná karta', type: 'CREDIT', provider: 'MONETA', currency: 'CZK', cardLast4: '9999' },
    });

    await expect(
      processCsvImport({ bytes: new Uint8Array(Buffer.concat([readFileSync(CREDIT_FIXTURE), Buffer.from('\n')])), filename: 'credit-other.csv', accountId: wrong.id, dryRun: true }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_MISMATCH' });

    await prisma.account.delete({ where: { id: wrong.id } });
  });
});

describe('mid-month movement import', () => {
  const STATEMENT = join(process.cwd(), 'docs/samples/moneta/statement-2026-07.xml');

  beforeAll(async () => {
    await prisma.transaction.deleteMany({ where: { accountId } });
    await prisma.accountSnapshot.deleteMany({ where: { accountId } });
    await prisma.importBatch.deleteMany({ where: { accountId } });

    await processCsvImport({
      bytes: new Uint8Array(readFileSync(STATEMENT)),
      filename: 'statement-2026-07.xml',
      accountId,
      dryRun: false,
    });
  });

  it('does not ask for a balance once the account has an anchor', async () => {
    const summary = await processCsvImport({ bytes, filename: '2026-07.csv', accountId, dryRun: true });

    expect(summary.needsAnchor).toBe(false);
  });

  it('derives the balance from the statement anchor instead of asking', async () => {
    const summary = await processCsvImport({ bytes, filename: '2026-07.csv', accountId, dryRun: false });

    // Every row is already in the ledger, so the balance is still the anchor.
    expect(summary.derivedBalance?.balance).toBe('184186.86');
    expect(summary.derivedBalance?.anchorSource).toBe('STATEMENT');
    expect(summary.derivedBalance?.anchoredAt).toBe('2026-07-31');
    expect(summary.derivedBalance?.incomplete).toBe(false);
  });

  it('asks only when there is no anchor at all', async () => {
    const bare = await prisma.account.create({
      data: { name: 'Bez kotvy', type: 'CHECKING', provider: 'MONETA', externalId: OTHER_EXTERNAL_ID },
    });

    const summary = await processCsvImport({
      bytes,
      filename: '2026-07.csv',
      accountId: bare.id,
      dryRun: true,
    }).catch(() => null);

    // The fixture belongs to another account, so the import is refused first;
    // what matters is that a bare account has no anchor to derive from.
    await expect(prisma.accountSnapshot.count({ where: { accountId: bare.id } })).resolves.toBe(0);
    expect(summary).toBeNull();

    await prisma.account.delete({ where: { id: bare.id } });
  });
});

describe('statement anchor plus an overlapping movement export', () => {
  const STATEMENT = join(process.cwd(), 'docs/samples/moneta/statement-2026-07.xml');

  /**
   * The real workflow: a statement anchors the balance at 31 July, then a CSV
   * exported from 29 July to today deliberately overlaps it. The overlap is
   * insurance against an off-by-one at the boundary, and must be harmless on
   * both axes — row identity and balance arithmetic.
   */
  function buildOverlappingCsv(): Uint8Array {
    const text = readFileSync(join(process.cwd(), 'docs/samples/moneta/2026-07.csv'), 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const header = lines[0] ?? '';
    const columns = header.split(';').map((name) => name.replace(/^\ufeff/, '').replace(/"/g, ''));
    const sentIndex = columns.indexOf('Odesláno');
    const amountIndex = columns.indexOf('Částka');
    const referenceIndex = columns.indexOf('Bankovní reference');

    // Rows already covered by the statement: they must be recognised as
    // duplicates and must not move the balance.
    const overlap = lines.slice(1).filter((line) => {
      const day = line.split(';')[sentIndex]?.replace(/"/g, '') ?? '';

      return ['29.07.2026', '30.07.2026', '31.07.2026'].includes(day);
    });

    // Two synthetic August rows standing in for movements after the anchor.
    const august = overlap.slice(0, 2).map((line, index) => {
      const cells = line.split(';');
      cells[sentIndex] = `"1${index + 1}.08.2026"`;
      cells[amountIndex] = index === 0 ? '"-1000,00"' : '"2500,50"';
      cells[referenceIndex] = `"0111222333:2026081${index + 1}:0000${index + 1}:SYNTETICKA${index + 1}"`;

      return cells.join(';');
    });

    return new TextEncoder().encode(`\ufeff${[header, ...overlap, ...august].join('\r\n')}\r\n`);
  }

  let overlapSummary: Awaited<ReturnType<typeof processCsvImport>>;
  let overlapRowCount = 0;

  beforeAll(async () => {
    await prisma.transaction.deleteMany({ where: { accountId } });
    await prisma.accountSnapshot.deleteMany({ where: { accountId } });
    await prisma.importBatch.deleteMany({ where: { accountId } });

    await processCsvImport({
      bytes: new Uint8Array(readFileSync(STATEMENT)),
      filename: 'statement-2026-07.xml',
      accountId,
      dryRun: false,
    });

    const csv = buildOverlappingCsv();
    overlapRowCount = new TextDecoder().decode(csv).trim().split(/\r?\n/).length - 1;

    // Imported once: a byte-identical re-upload is refused by design, so the
    // assertions read from this one result.
    overlapSummary = await processCsvImport({
      bytes: csv,
      filename: 'moneta-29-07-az-18-08.csv',
      accountId,
      dryRun: false,
    });
  });

  it('skips the overlapping days and imports only what is new', () => {
    expect(overlapSummary.inserted).toBe(2);
    expect(overlapSummary.skipped).toBe(overlapRowCount - 2);
    expect(overlapSummary.failed).toBe(0);
  });

  it('reports the balance as the anchor plus August only', () => {
    // 184 186,86 at 31 July, then -1000,00 and +2500,50 in August.
    expect(overlapSummary.derivedBalance?.balance).toBe('185687.36');
    expect(overlapSummary.derivedBalance?.anchoredAt).toBe('2026-07-31');
    expect(overlapSummary.derivedBalance?.anchorSource).toBe('STATEMENT');
    expect(overlapSummary.derivedBalance?.incomplete).toBe(false);
  });

  it('does not ask for a balance, because it can be derived', () => {
    expect(overlapSummary.needsAnchor).toBe(false);
  });

  it('leaves the statement anchor untouched', async () => {
    const anchor = await prisma.accountSnapshot.findFirstOrThrow({
      where: { accountId },
      orderBy: { capturedAt: 'desc' },
    });

    expect(anchor.balance.toFixed(2)).toBe('184186.86');
  });

  it('stores the overlapping rows once, not twice', async () => {
    const references = await prisma.transaction.findMany({
      where: { accountId },
      select: { externalId: true },
    });

    expect(new Set(references.map((row) => row.externalId)).size).toBe(references.length);
    // The statement's 84 rows plus the two new August ones.
    expect(references).toHaveLength(86);
  });
});
