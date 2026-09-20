'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { AmountField } from '@/components/ui/amount-field';
import { SelectField } from '@/components/ui/select-field';
import { Badge, StatusNotice } from '@/components/ui/status';
import { uploadToApi } from '@/lib/api-client';

interface AccountOption {
  id: string;
  name: string;
  externalId: string | null;
}

interface ImportRowPreview {
  externalId: string | null;
  date: string;
  amount: string;
  currency: string;
  merchant: string | null;
  sourceCategory: string | null;
  mappedCategory: string | null;
  internalTransfer: boolean;
  duplicate: boolean;
}

interface CheckpointResult {
  balance: string;
  asOf: string;
  expected: string | null;
  difference: string | null;
  matches: boolean;
}

interface StatementInfo {
  number: string;
  /** `null` on an account's first-ever statement — no prior coverage exists. */
  from: string | null;
  to: string;
  openingBalance: string;
  closingBalance: string;
  warnings: string[];
}

interface DerivedBalance {
  balance: string;
  anchoredAt: string | null;
  anchorSource: 'STATEMENT' | 'MANUAL' | 'NONE';
  incomplete: boolean;
}

interface ImportSummary {
  batchId: string | null;
  dryRun: boolean;
  dedupStrategy: string;
  encoding: string;
  rowCount: number;
  inserted: number;
  skipped: number;
  failed: number;
  periodFrom: string | null;
  periodTo: string | null;
  preview: ImportRowPreview[];
  failures: { rowNumber: number; reason: string }[];
  checkpoint: CheckpointResult | null;
  kind: 'STATEMENT' | 'MOVEMENTS';
  statement: StatementInfo | null;
  derivedBalance: DerivedBalance | null;
  needsAnchor: boolean;
}

type Phase = 'idle' | 'analyzing' | 'preview' | 'importing' | 'done';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.csv', '.xml', '.pdf'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCheckpoint(value: unknown): value is CheckpointResult | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.balance === 'string' &&
      typeof value.asOf === 'string' &&
      isNullableString(value.expected) &&
      isNullableString(value.difference) &&
      typeof value.matches === 'boolean')
  );
}

function isStatement(value: unknown): value is StatementInfo | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.number === 'string' &&
      isNullableString(value.from) &&
      typeof value.to === 'string' &&
      typeof value.openingBalance === 'string' &&
      typeof value.closingBalance === 'string' &&
      Array.isArray(value.warnings) &&
      value.warnings.every((warning) => typeof warning === 'string'))
  );
}

function isDerivedBalance(value: unknown): value is DerivedBalance | null {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.balance === 'string' &&
      isNullableString(value.anchoredAt) &&
      (value.anchorSource === 'STATEMENT' || value.anchorSource === 'MANUAL' || value.anchorSource === 'NONE') &&
      typeof value.incomplete === 'boolean')
  );
}

function isImportSummary(value: unknown): value is ImportSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.batchId === null || typeof value.batchId === 'string') &&
    typeof value.dryRun === 'boolean' &&
    typeof value.dedupStrategy === 'string' &&
    typeof value.encoding === 'string' &&
    typeof value.rowCount === 'number' &&
    typeof value.inserted === 'number' &&
    typeof value.skipped === 'number' &&
    typeof value.failed === 'number' &&
    Array.isArray(value.preview) &&
    value.preview.every(
      (row) =>
        isRecord(row) &&
        isNullableString(row.externalId) &&
        typeof row.date === 'string' &&
        typeof row.amount === 'string' &&
        typeof row.currency === 'string' &&
        isNullableString(row.merchant) &&
        isNullableString(row.sourceCategory) &&
        isNullableString(row.mappedCategory) &&
        typeof row.internalTransfer === 'boolean' &&
        typeof row.duplicate === 'boolean',
    ) &&
    Array.isArray(value.failures) &&
    value.failures.every(
      (failure) => isRecord(failure) && typeof failure.rowNumber === 'number' && typeof failure.reason === 'string',
    ) &&
    isNullableString(value.periodFrom) &&
    isNullableString(value.periodTo) &&
    isCheckpoint(value.checkpoint) &&
    (value.kind === 'STATEMENT' || value.kind === 'MOVEMENTS') &&
    isStatement(value.statement) &&
    isDerivedBalance(value.derivedBalance) &&
    typeof value.needsAnchor === 'boolean'
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Import se nezdařil. Zkuste to znovu.';
}

function validateFile(file: File): string | null {
  if (file.size === 0) {
    return 'Soubor je prázdný.';
  }

  if (file.size > MAX_FILE_BYTES) {
    return 'Soubor je větší než 5 MB.';
  }

  if (!ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
    return 'Podporované jsou pouze soubory .csv, .xml a .pdf.';
  }

  return null;
}

async function upload(
  file: File,
  accountId: string,
  dryRun: boolean,
  closingBalance?: string,
): Promise<ImportSummary> {
  const body = new FormData();
  body.set('file', file);
  body.set('accountId', accountId);
  body.set('dryRun', String(dryRun));

  if (closingBalance) {
    body.set('closingBalance', closingBalance);
  }

  let response: Response;

  try {
    response = await uploadToApi('/import/csv', body);
  } catch {
    throw new Error('Server není dostupný. Zkontrolujte připojení a zkuste to znovu.');
  }

  let payload: unknown;

  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new Error(
      response.ok ? 'Server vrátil neplatnou odpověď.' : `Import se nezdařil (chyba ${response.status}).`,
    );
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Import se nezdařil.';
    throw new Error(message);
  }

  if (!isImportSummary(payload)) {
    throw new Error('Server vrátil neúplný výsledek importu.');
  }

  return payload;
}

export function CsvDropzone({ accounts }: { accounts: AccountOption[] }): React.JSX.Element {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [closingBalance, setClosingBalance] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = phase === 'analyzing' || phase === 'importing';

  const analyze = useCallback(
    async (candidate: File) => {
      if (busy) {
        return;
      }

      const validationError = validateFile(candidate);

      if (validationError) {
        setError(validationError);
        setFile(null);
        setSummary(null);
        setPhase('idle');
        if (inputRef.current) inputRef.current.value = '';
        return;
      }

      setError(null);
      setFile(candidate);
      setSummary(null);
      setClosingBalance('');
      setPhase('analyzing');

      try {
        // Dry run is mandatory: user confirms exact result before writes occur.
        setSummary(await upload(candidate, accountId, true));
        setPhase('preview');
      } catch (cause: unknown) {
        setError(errorMessage(cause));
        setPhase('idle');
      }
    },
    [accountId, busy],
  );

  const commit = useCallback(async () => {
    if (!file || !summary || phase !== 'preview') {
      return;
    }

    setError(null);
    setPhase('importing');

    try {
      setSummary(await upload(file, accountId, false, closingBalance.trim() || undefined));
      setPhase('done');
      router.refresh();
    } catch (cause: unknown) {
      setError(errorMessage(cause));
      setPhase('preview');
    }
  }, [accountId, closingBalance, file, phase, router, summary]);

  const reset = useCallback(() => {
    setFile(null);
    setSummary(null);
    setPhase('idle');
    setError(null);
    setClosingBalance('');
    setDragging(false);

    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, []);

  if (accounts.length === 0) {
    return (
      <StatusNotice
        tone="warning"
        title="Nejdřív přidejte účet"
        actions={
          <Link href="/accounts" className="ui-button ui-button-primary">
            Nastavit účty
          </Link>
        }
      >
        Výpis musí být při importu přiřazený ke konkrétnímu účtu. V nastavení založte účet a potom se vraťte sem.
      </StatusNotice>
    );
  }

  return (
    <section aria-label="Průběh importu" className="surface overflow-hidden">
      <StepIndicator phase={phase} />

      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="grid gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <SelectField
            className="self-start"
            label="Účet"
            value={accountId}
            onValueChange={setAccountId}
            disabled={busy || summary !== null}
            options={accounts.map((account) => ({
              value: account.id,
              label: `${account.name}${account.externalId ? ` · ${account.externalId}` : ''}`,
            }))}
            helper={summary ? 'Účet je pro tento náhled uzamčený. Pro změnu začněte znovu.' : 'Číslo účtu musí odpovídat výpisu.'}
          />

          <div
            onDragEnter={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              if (!busy) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (busy) return;
              const dropped = event.dataTransfer.files[0];
              if (dropped) void analyze(dropped);
            }}
            aria-disabled={busy}
            className={`flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              busy
                ? 'cursor-not-allowed border-line bg-surface-subtle opacity-60'
                : dragging
                  ? 'border-accent bg-[var(--accent-soft)]'
                  : 'border-line-strong bg-surface-raised'
            }`}
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] font-mono text-xs font-semibold text-accent" aria-hidden="true">
              CSV
            </div>
            <p className="text-sm font-semibold">Přetáhněte výpis sem</p>
            <p className="text-xs text-ink-muted">Soubory .csv, .xml nebo .pdf, nejvýše 5 MB</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="ui-button ui-button-secondary mt-1"
              disabled={busy}
            >
              Vybrat soubor
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xml,.pdf,text/csv,text/xml,application/xml,application/pdf"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.currentTarget.value = '';
                if (selected) void analyze(selected);
              }}
            />
            {file ? <p title={file.name} className="max-w-full break-words text-xs font-medium text-ink-muted [overflow-wrap:anywhere]">{file.name}</p> : null}
          </div>
        </div>

        {busy ? (
          <div role="status" aria-live="polite" className="rounded-xl border border-accent/25 bg-[var(--accent-soft)] p-4 text-sm font-medium">
            {phase === 'analyzing' ? 'Kontroluji soubor a připravuji náhled…' : 'Ukládám transakce…'}
          </div>
        ) : null}

        {error ? (
          <StatusNotice tone="danger" title="Import nelze dokončit" live="assertive">
            {error}
          </StatusNotice>
        ) : null}

        {summary ? <ImportReport summary={summary} /> : null}

        {phase === 'preview' && summary?.kind === 'MOVEMENTS' && summary.needsAnchor ? (
          <label className="ui-label max-w-md rounded-xl border border-warning/25 bg-[var(--warning-soft)] p-4">
            <span>Konečný zůstatek podle banky k {summary.periodTo ?? 'konci období'}</span>
            <AmountField
              value={closingBalance}
              onChange={setClosingBalance}
              decimalSeparator=","
              placeholder="např. 42 350,18"
              className="px-3 py-2"
              disabled={busy}
            />
            <span className="ui-helper">
              Orbit zatím nemá ověřený výchozí zůstatek. Nahrajte měsíční XML výpis, nebo zůstatek jednorázově zadejte. Uloží se jako kontrolní bod pro další výpočty.
            </span>
          </label>
        ) : null}

        {phase === 'preview' && summary ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={reset} className="ui-button ui-button-secondary">
              Začít znovu
            </button>
            <button
              type="button"
              onClick={() => void commit()}
               disabled={summary.inserted === 0 && summary.kind !== 'STATEMENT'}
              className="ui-button ui-button-primary"
            >
               {summary.inserted > 0 ? `Importovat ${summary.inserted} transakcí` : 'Uložit ověřený výpis'}
            </button>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="flex flex-col gap-3">
            <StatusNotice tone="success" title="Import je hotový" live="polite">
              Uloženo {summary?.inserted} nových transakcí, přeskočeno {summary?.skipped} duplicit.
            </StatusNotice>
            {summary?.checkpoint ? <CheckpointReport checkpoint={summary.checkpoint} /> : null}
            {summary?.derivedBalance ? <BalanceReport balance={summary.derivedBalance} /> : null}
            <button type="button" onClick={reset} className="ui-button ui-button-secondary self-start">
              Nahrát další soubor
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StepIndicator({ phase }: { phase: Phase }): React.JSX.Element {
  const current = phase === 'done' ? 3 : phase === 'preview' || phase === 'importing' ? 2 : 1;
  const steps = ['Účet a soubor', 'Náhled', 'Výsledek'];

  return (
    <ol aria-label="Kroky importu" className="grid grid-cols-3 border-b border-line bg-surface-subtle">
      {steps.map((label, index) => {
        const number = index + 1;
        const active = number === current;
        const complete = number < current;
        return (
          <li
            key={label}
            aria-current={active ? 'step' : undefined}
            className={`flex min-w-0 items-center justify-center gap-2 border-r border-line px-2 py-3 text-xs last:border-r-0 sm:text-sm ${
              active ? 'bg-surface-raised font-semibold text-ink' : complete ? 'font-medium text-positive' : 'text-ink-muted'
            }`}
          >
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] ${
                active ? 'border-accent bg-accent text-[var(--accent-foreground)]' : complete ? 'border-positive bg-[var(--positive-soft)]' : 'border-line-strong'
              }`}
              aria-hidden="true"
            >
              {number}
            </span>
            <span className="min-w-0 break-words text-center leading-tight">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function BalanceReport({ balance }: { balance: DerivedBalance }): React.JSX.Element {
  if (balance.incomplete) {
    return (
      <StatusNotice tone="warning" title="Účetní zůstatek zatím není ověřený">
        Částka {balance.balance} Kč je pouze součet naimportovaných pohybů. Pro skutečný zůstatek nahrajte měsíční XML výpis s konečným zůstatkem.
      </StatusNotice>
    );
  }

  return (
    <StatusNotice title="Účetní zůstatek v Orbitu">
      <strong className="tabular text-ink">{balance.balance} Kč</strong>
      <span className="block text-xs">
        Vypočteno z {balance.anchorSource === 'STATEMENT' ? 'posledního ověřeného zůstatku ve výpisu' : 'ručně zadaného kontrolního bodu'} k {balance.anchoredAt} a následných pohybů.
      </span>
    </StatusNotice>
  );
}

function StatementPanel({ statement }: { statement: StatementInfo }): React.JSX.Element {
  if (statement.warnings.length > 0) {
    return (
      <StatusNotice tone="danger" title={`Výpis č. ${statement.number} má nesrovnalosti`}>
        <ul className="flex flex-col gap-1">
          {statement.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
        <p className="mt-2">Konečný zůstatek se nepoužije jako kontrolní bod, aby nezkreslil další výpočty.</p>
      </StatusNotice>
    );
  }

  const period = statement.from ? `${statement.from} až ${statement.to}` : `první výpis účtu, do ${statement.to}`;

  return (
    <StatusNotice title={`Výpis č. ${statement.number} · ${period}`}>
      Počáteční zůstatek {statement.openingBalance} Kč, konečný zůstatek {statement.closingBalance} Kč. Výpis je vnitřně konzistentní; konečný zůstatek se automaticky uloží jako ověřený kontrolní bod.
    </StatusNotice>
  );
}

function CheckpointReport({ checkpoint }: { checkpoint: CheckpointResult }): React.JSX.Element {
  if (checkpoint.expected === null) {
    return (
      <StatusNotice title="Kontrolní bod uložen">
        Zůstatek {checkpoint.balance} Kč k {checkpoint.asOf} bude výchozím bodem pro kontrolu návaznosti dalších importů.
      </StatusNotice>
    );
  }

  if (checkpoint.matches) {
    return (
      <StatusNotice tone="success" title="Zůstatek navazuje">
        Výpisy jsou souvislé. Ověřený zůstatek je {checkpoint.balance} Kč k {checkpoint.asOf}.
      </StatusNotice>
    );
  }

  return (
    <StatusNotice tone="warning" title={`Rozdíl proti účetnímu zůstatku: ${checkpoint.difference} Kč`}>
      Podle transakcí měl zůstatek být {checkpoint.expected} Kč, zadaný zůstatek je {checkpoint.balance} Kč. Může chybět výpis nebo být zůstatek k jinému dni. Zadaná částka se uložila jako nový kontrolní bod pro další výpočty.
    </StatusNotice>
  );
}

function RowBadge({ row }: { row: ImportRowPreview }): React.JSX.Element {
  return (
    <span className="flex flex-wrap gap-1">
      {row.duplicate ? <Badge>Duplicita</Badge> : <Badge tone="success">Nová</Badge>}
      {row.internalTransfer ? <Badge tone="info">Interní převod</Badge> : null}
    </span>
  );
}

function ImportReport({ summary }: { summary: ImportSummary }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Náhled importu</p>
        <h2 className="mt-1 text-lg font-semibold">Zkontrolujte výsledek před uložením</h2>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Řádků" value={String(summary.rowCount)} />
        <Stat label="Nových" value={String(summary.inserted)} tone="positive" />
        <Stat label="Duplicit" value={String(summary.skipped)} />
        <Stat label="Chyb" value={String(summary.failed)} tone={summary.failed > 0 ? 'critical' : 'default'} />
      </dl>

      <p className="text-xs text-ink-muted">
        {summary.periodFrom ?? 'Období neurčeno'} až {summary.periodTo ?? 'období neurčeno'} · kódování {summary.encoding} · deduplikace {summary.dedupStrategy === 'EXTERNAL_ID' ? 'podle bankovní reference' : 'podle atributů'}
      </p>

      {summary.statement ? <StatementPanel statement={summary.statement} /> : null}

      {summary.dedupStrategy === 'ATTRIBUTES' ? (
        <StatusNotice tone="warning">
          Výpis nemá bankovní referenci u všech řádků. Dvě shodné platby ve stejný den nelze bezpečně rozlišit.
        </StatusNotice>
      ) : null}

      {summary.failures.length > 0 ? (
        <details className="min-w-0 rounded-xl border border-critical/25 bg-[var(--critical-soft)] p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Chybné řádky ({summary.failures.length})</summary>
          <ul className="mt-3 flex flex-col gap-1 text-xs text-ink-muted">
            {summary.failures.map((failure, index) => (
              <li key={`${failure.rowNumber}-${index}`} className="break-words [overflow-wrap:anywhere]">Řádek {failure.rowNumber}: {failure.reason}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {summary.preview.length > 0 ? (
        <>
          <div className="grid gap-2 sm:hidden">
            {summary.preview.map((row, index) => (
              <article key={`${row.externalId ?? `${row.date}-${row.amount}`}-${index}`} className="surface-subtle p-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="min-w-0">
                    <p title={row.merchant ?? undefined} className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{row.merchant ?? 'Bez protistrany'}</p>
                    <p className="mt-0.5 break-words text-xs text-ink-muted [overflow-wrap:anywhere]">{row.date} · {row.mappedCategory ?? 'Bez kategorie'}</p>
                  </div>
                  <p className="max-w-full break-words text-sm font-semibold tabular [overflow-wrap:anywhere]">{row.amount} {row.currency}</p>
                </div>
                <div className="mt-3"><RowBadge row={row} /></div>
              </article>
            ))}
          </div>

          <div className="hidden max-w-full overflow-x-auto rounded-xl border border-line sm:block">
            <table className="data-table min-w-[40rem]">
              <thead>
                <tr>
                  <th className="px-4 py-3">Datum</th>
                  <th className="px-4 py-3">Protistrana</th>
                  <th className="px-4 py-3">Kategorie</th>
                  <th className="px-4 py-3 text-right">Částka</th>
                  <th className="px-4 py-3">Stav</th>
                </tr>
              </thead>
              <tbody>
                {summary.preview.map((row, index) => (
                  <tr key={`${row.externalId ?? `${row.date}-${row.amount}`}-${index}`}>
                    <td className="whitespace-nowrap px-4 py-3">{row.date}</td>
                    <td title={row.merchant ?? undefined} className="break-words px-4 py-3 [overflow-wrap:anywhere]">{row.merchant ?? 'Bez protistrany'}</td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{row.mappedCategory ?? 'Bez kategorie'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular">{row.amount} {row.currency}</td>
                    <td className="px-4 py-3"><RowBadge row={row} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'positive' | 'critical' }): React.JSX.Element {
  const valueColor = tone === 'positive' ? 'text-positive' : tone === 'critical' ? 'text-critical' : 'text-ink';
  return (
    <div className="surface-subtle p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular ${valueColor}`}>{value}</dd>
    </div>
  );
}
