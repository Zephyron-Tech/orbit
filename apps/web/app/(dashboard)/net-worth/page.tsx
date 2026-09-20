import { ArrowRight, Bank, CheckCircle, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { czk } from '@/components/charts/chart-theme';
import { NetWorthChart, type NetWorthPoint } from '@/components/charts/net-worth-chart';
import { AccountCards, type AccountCardData } from '@/components/net-worth/account-cards';
import { DismissTransferButton } from '@/components/net-worth/dismiss-transfer-button';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyValue } from '@/components/ui/money-value';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { Badge } from '@/components/ui/status';
import { apiClient } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

const DIAGNOSTIC_PREVIEW_LIMIT = 3;

type AccountDiagnostic = { accountId: string; name: string };
type CoverageDiagnostic = { name: string; gaps: { from: string; to: string }[] };
type TransferDiagnostic = { id: string; date: string; amount: number; amountCzk: number | null; currency: string; merchant: string | null; accountName: string };

interface NetWorthResponse {
  empty: boolean;
  totalWorth?: number;
  cashValue?: number;
  investmentValue?: number;
  liabilityValue?: number;
  cardAccounts?: AccountCardData[];
  fixedBaseline?: string;
  monthlyHistory?: NetWorthPoint[];
  confidenceIssueCount?: number;
  incompleteCash?: AccountDiagnostic[];
  incompleteCredit?: AccountDiagnostic[];
  unknown?: AccountDiagnostic[];
  gapsByAccount?: CoverageDiagnostic[];
  coverageGapCount?: number;
  historicalBrokerTransfers?: number;
  checkpointIssues?: AccountDiagnostic[];
  unmatchedTransfers?: TransferDiagnostic[];
}

export default async function NetWorthPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get('cookie') ?? undefined;
  const response = await apiClient(cookieHeader)['net-worth'].$get();
  if (!response.ok) redirect('/signin');
  const data = (await response.json()) as NetWorthResponse;

  if (data.empty) {
    return (
      <PageShell width="narrow">
        <PageHeader title="Čisté jmění" description="Hotovost a investice po odečtení závazků. Přehled se sestaví z účtů, zůstatků a importovaných pohybů." />
        <EmptyState
          icon={<Bank aria-hidden="true" size={22} weight="duotone" />}
          title="Nejdřív přidejte účet"
          description="Po přidání bankovního nebo investičního účtu zde uvidíte aktuální hodnotu, historii i kvalitu podkladových dat."
          action={<Link href="/accounts" className="ui-button ui-button-primary">Přidat účet<ArrowRight aria-hidden="true" size={16} /></Link>}
        />
      </PageShell>
    );
  }

  const cardAccounts = data.cardAccounts ?? [];
  const fixedBaseline = data.fixedBaseline ?? '0';

  return (
    <PageShell>
      <PageHeader title="Čisté jmění" description="Současná hodnota majetku v CZK. U každého čísla vidíte, z jak čerstvých a úplných dat vychází." />

      <section className="surface grid min-w-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]" aria-labelledby="net-worth-total">
        <div className="min-w-0 p-5 md:p-8">
          <p id="net-worth-total" className="text-sm font-medium text-ink-muted">Čisté jmění celkem</p>
          <p className="money-value mt-2 text-[clamp(2rem,8vw,3.75rem)] font-semibold tracking-[-0.055em] text-ink"><MoneyValue>{czk.format(data.totalWorth ?? 0)}</MoneyValue></p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">Hotovost a investice po odečtení závazků. Přesnost závisí na kontrolních zůstatcích a čerstvosti investičních snímků.</p>
        </div>
        <dl className="grid min-w-0 divide-y divide-line rounded-b-[0.875rem] border-t border-line bg-surface-subtle/60 lg:rounded-b-none lg:rounded-r-[0.875rem] lg:border-l lg:border-t-0" aria-label="Výpočet čistého jmění">
          <FormulaItem label="Hotovost" operator="" value={<MoneyValue>{czk.format(data.cashValue ?? 0)}</MoneyValue>} />
          <FormulaItem label="Investice" operator="+" value={<MoneyValue>{czk.format(data.investmentValue ?? 0)}</MoneyValue>} />
          <FormulaItem label="Závazky" operator="−" value={<MoneyValue>{czk.format(data.liabilityValue ?? 0)}</MoneyValue>} />
        </dl>
      </section>

      <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
        <div id="accounts-heading">
          <SectionHeader title="Účty" description={`${cardAccounts.length.toLocaleString('cs-CZ')} aktivních účtů zahrnutých do čistého jmění.`} action={<Link href="/accounts" className="ui-button ui-button-secondary">Spravovat účty</Link>} />
        </div>
        {cardAccounts.length > 0 ? (
          <AccountCards accounts={cardAccounts} fixedBaseline={fixedBaseline} />
        ) : (
          <EmptyState title="Žádný účet není zahrnutý" description="Aktivní účty existují, ale žádný se nyní nezapočítává do čistého jmění. Změňte nastavení účtů, které chcete sledovat." action={<Link href="/accounts" className="ui-button ui-button-primary">Nastavit účty</Link>} />
        )}
      </section>

      <section aria-labelledby="net-worth-history" className="flex flex-col gap-3">
        <SectionHeader title="Vývoj čistého jmění" description="Měsíční hodnoty ke konci měsíce; detail složení zobrazíte nad bodem grafu." />
        <span id="net-worth-history" className="sr-only">Vývoj čistého jmění</span>
        <NetWorthChart data={data.monthlyHistory ?? []} />
      </section>

      <DataConfidencePanel
        issueCount={data.confidenceIssueCount ?? 0}
        incomplete={data.incompleteCash ?? []}
        incompleteCredit={data.incompleteCredit ?? []}
        unknown={data.unknown ?? []}
        gapsByAccount={data.gapsByAccount ?? []}
        coverageGapCount={data.coverageGapCount ?? 0}
        unmatchedTransfers={data.unmatchedTransfers ?? []}
        historicalBrokerTransfers={data.historicalBrokerTransfers ?? 0}
        checkpointIssues={data.checkpointIssues ?? []}
      />
    </PageShell>
  );
}

function FormulaItem({ label, operator, value }: { label: string; operator: string; value: ReactNode }): React.JSX.Element {
  return (
    <div className="relative min-w-0 p-4 md:px-5 md:py-4">
      {operator ? (
        <span className="absolute -left-3 top-1/2 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-sm font-semibold text-ink-muted lg:flex" aria-hidden="true">
          {operator}
        </span>
      ) : null}
      <dt className="text-xs font-medium text-ink-muted">
        <span className="lg:hidden">{operator ? `${operator} ` : ''}</span>
        {label}
      </dt>
      <dd className="money-value mt-1 text-lg font-semibold tracking-[-0.025em]">{value}</dd>
    </div>
  );
}

function DataConfidencePanel({
  issueCount,
  incomplete,
  incompleteCredit,
  unknown,
  gapsByAccount,
  coverageGapCount,
  unmatchedTransfers,
  historicalBrokerTransfers,
  checkpointIssues,
}: {
  issueCount: number;
  incomplete: AccountDiagnostic[];
  incompleteCredit: AccountDiagnostic[];
  unknown: AccountDiagnostic[];
  gapsByAccount: CoverageDiagnostic[];
  coverageGapCount: number;
  unmatchedTransfers: TransferDiagnostic[];
  historicalBrokerTransfers: number;
  checkpointIssues: AccountDiagnostic[];
}): React.JSX.Element {
  const hasIssues = issueCount > 0;

  return (
    <details className="surface overflow-hidden">
      <summary className={`flex cursor-default list-none items-start gap-3 p-4 md:p-5 ${hasIssues ? 'bg-[var(--warning-soft)]' : 'bg-[var(--positive-soft)]'}`}>
        {hasIssues ? <WarningCircle className="mt-0.5 shrink-0 text-warning" aria-hidden="true" size={22} weight="fill" /> : <CheckCircle className="mt-0.5 shrink-0 text-positive" aria-hidden="true" size={22} weight="fill" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="data-confidence-heading" className="font-semibold tracking-[-0.015em]">Důvěra v data</h2>
            <Badge tone={hasIssues ? 'warning' : 'success'}>{hasIssues ? `${issueCount.toLocaleString('cs-CZ')} upozornění` : 'Bez známých problémů'}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">{hasIssues ? 'Celková hodnota může být neúplná. Níže najdete konkrétní příčiny a místa, kde je opravíte.' : 'Všechny sledované účty mají potřebný zdroj hodnoty a importy nevykazují známé mezery.'}</p>
        </div>
      </summary>

      {hasIssues ? (
        <div className="divide-y divide-line">
          {incomplete.length > 0 ? (
            <DiagnosticItem title="Chybí kontrolní zůstatek" count={incomplete.length} actionHref="/import" actionLabel="Doplnit při importu">
              <p>U účtů {formatNamePreview(incomplete.map((account) => account.name))} se hodnota počítá jen z dostupných výpisů. Výsledek proto může být nižší než skutečný stav.</p>
              <CollapsedNames names={incomplete.map((account) => account.name)} />
            </DiagnosticItem>
          ) : null}

          {incompleteCredit.length > 0 ? (
            <DiagnosticItem title="Kreditní karta nemá potvrzený počáteční dluh" count={incompleteCredit.length} actionHref="/accounts" actionLabel="Potvrdit start nebo zadat dluh">
              <p>U karty {formatNamePreview(incompleteCredit.map((account) => account.name))} se dluh počítá jen z importovaných karetních plateb. Pokud existoval dluh před prvním importem, skutečný závazek může být vyšší.</p>
              <p className="mt-2">Až budete mít úplný výpis, import ho vytvoří jako kontrolní bod. Do té doby zadejte aktuální skutečný dluh v nastavení účtu, ne dostupný limit. Pokud karta před prvním importem začínala na nule, potvrďte nulový start.</p>
            </DiagnosticItem>
          ) : null}

          {unknown.length > 0 ? (
            <DiagnosticItem title="Chybí hodnota investic" count={unknown.length} actionHref="/portfolio" actionLabel="Aktualizovat portfolio">
              <p>U účtů {formatNamePreview(unknown.map((account) => account.name))} chybí aktuální snímek, proto do součtu vstupují nulovou hodnotou.</p>
              <CollapsedNames names={unknown.map((account) => account.name)} />
            </DiagnosticItem>
          ) : null}

          {checkpointIssues.length > 0 ? (
            <DiagnosticItem title="Kontrolní bod nesedí" count={checkpointIssues.length} actionHref="/import" actionLabel="Doplnit kontrolní bod">
              <p>U účtů {formatNamePreview(checkpointIssues.map((account) => account.name))} chybí kontrolní bod, nebo se neshoduje s tím, co ledger očekával z předchozí kotvy a importovaných pohybů.</p>
              <CollapsedNames names={checkpointIssues.map((account) => account.name)} />
            </DiagnosticItem>
          ) : null}

          {coverageGapCount > 0 ? (
            <DiagnosticItem title="Mezery v pokrytí výpisů" count={coverageGapCount} actionHref="/import" actionLabel="Nahrát chybějící výpis">
              <p>Některá období nejsou pokryta dokončeným importem. Zkontrolujte návaznost výpisů.</p>
              <details className="mt-2">
                <summary className="cursor-pointer font-medium text-ink">Zobrazit chybějící období</summary>
                <ul className="mt-2 grid gap-1.5">
                  {gapsByAccount.map((entry) => (
                    <li key={entry.name}>
                      <span className="font-medium text-ink">{entry.name}:</span> {entry.gaps.map((gap) => `${gap.from} až ${gap.to}`).join(', ')}
                    </li>
                  ))}
                </ul>
              </details>
            </DiagnosticItem>
          ) : null}

          {unmatchedTransfers.length > 0 ? (
            <DiagnosticItem title="Nespárované převody" count={unmatchedTransfers.length} actionHref="/transactions" actionLabel="Zkontrolovat transakce">
              <p>Převod vypadá jako pohyb mezi vlastními účty, ale protistrana se nenašla nebo není jednoznačná.</p>
              <ul className="mt-2 grid gap-1.5">
                {unmatchedTransfers.slice(0, DIAGNOSTIC_PREVIEW_LIMIT).map((transaction) => (
                  <TransferRow key={transaction.id} transaction={transaction} />
                ))}
              </ul>
              {unmatchedTransfers.length > DIAGNOSTIC_PREVIEW_LIMIT ? (
                <details className="mt-2">
                  <summary className="cursor-pointer font-medium text-ink">Zobrazit dalších {(unmatchedTransfers.length - DIAGNOSTIC_PREVIEW_LIMIT).toLocaleString('cs-CZ')}</summary>
                  <ul className="mt-2 grid gap-1.5">
                    {unmatchedTransfers.slice(DIAGNOSTIC_PREVIEW_LIMIT).map((transaction) => (
                      <TransferRow key={transaction.id} transaction={transaction} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </DiagnosticItem>
          ) : null}

          {historicalBrokerTransfers > 0 ? (
            <DiagnosticItem title="Historické převody Trading 212" count={historicalBrokerTransfers} actionHref="/portfolio" actionLabel="Zobrazit portfolio">
              <p>Tyto brokerové vklady a výběry jsou starší než importovaná bankovní historie. Nejsou zahrnuté mezi aktuální úkoly, protože odpovídající bankovní noha v Orbitu nemůže existovat.</p>
            </DiagnosticItem>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function DiagnosticItem({ title, count, actionHref, actionLabel, children }: { title: string; count: number; actionHref: string; actionLabel: string; children: ReactNode }): React.JSX.Element {
  return (
    <article className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge tone="warning">{count.toLocaleString('cs-CZ')}</Badge>
        </div>
        <div className="mt-1 text-sm leading-relaxed text-ink-muted">{children}</div>
      </div>
      <Link href={actionHref} className="ui-button ui-button-secondary self-start">{actionLabel}<ArrowRight aria-hidden="true" size={15} /></Link>
    </article>
  );
}

function CollapsedNames({ names }: { names: string[] }): React.JSX.Element | null {
  if (names.length <= DIAGNOSTIC_PREVIEW_LIMIT) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer font-medium text-ink">Zobrazit všechny účty</summary>
      <p className="mt-1">{names.join(', ')}</p>
    </details>
  );
}

function TransferRow({ transaction }: { transaction: TransferDiagnostic }): React.JSX.Element {
  const currency = transaction.amountCzk !== null ? 'CZK' : transaction.currency;
  const amount = transaction.amountCzk ?? transaction.amount;
  const formatter = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = new Date(transaction.date);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 break-words">
      <span>
        <time dateTime={date.toISOString()}>{date.toLocaleDateString('cs-CZ')}</time> · {transaction.accountName} · {transaction.merchant ?? 'Bez popisu'} · <span className="tabular text-ink"><MoneyValue>{formatter.format(amount)}</MoneyValue></span>
      </span>
      <DismissTransferButton transactionId={transaction.id} />
    </li>
  );
}

function formatNamePreview(names: string[]): string {
  const preview = names.slice(0, DIAGNOSTIC_PREVIEW_LIMIT).join(', ');
  const remaining = names.length - DIAGNOSTIC_PREVIEW_LIMIT;
  return remaining > 0 ? `${preview} a ${remaining.toLocaleString('cs-CZ')} dalších účtů` : preview;
}
