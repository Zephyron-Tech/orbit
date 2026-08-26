import { CsvDropzone } from '@/components/import/csv-dropzone';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export default async function ImportPage(): Promise<React.JSX.Element> {
  const [accounts, batches] = await Promise.all([
    prisma.account.findMany({
      where: { isArchived: false },
      select: { id: true, name: true, externalId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.importBatch.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { account: { select: { name: true } } },
    }),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Import výpisu"
        description="Vyberte účet a nahrajte výpis. Nejdřív zkontrolujete náhled; data se uloží až po potvrzení importu."
      />

      <CsvDropzone accounts={accounts} />

      <section aria-label="Poslední importy" className="flex flex-col gap-3">
        <SectionHeader title="Poslední importy" description="Deset naposledy zpracovaných souborů." />
        {batches.length > 0 ? (
          <ol className="surface divide-y divide-line">
            {batches.map((batch) => (
              <li key={batch.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p title={batch.filename} className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{batch.filename}</p>
                  <p title={batch.account.name} className="mt-0.5 break-words text-xs text-ink-muted [overflow-wrap:anywhere]">
                    {batch.account.name}
                    {batch.statementNumber ? ` · výpis č. ${batch.statementNumber}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                  <span><strong className="font-semibold text-positive tabular">{batch.insertedCount}</strong> nových</span>
                  <span><strong className="font-semibold text-ink tabular">{batch.skippedCount}</strong> duplicit</span>
                  <span><strong className="font-semibold text-critical tabular">{batch.failedCount}</strong> chyb</span>
                  <time dateTime={batch.createdAt.toISOString()}>{batch.createdAt.toISOString().slice(0, 10)}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="Zatím žádné importy"
            description="Po prvním dokončeném importu zde uvidíte soubor, účet a výsledek zpracování."
          />
        )}
      </section>
    </PageShell>
  );
}
