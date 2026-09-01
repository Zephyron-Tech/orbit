import { ArrowRight, Bank, CheckCircle, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { czk } from '@/components/charts/chart-theme';
import { NetWorthChart } from '@/components/charts/net-worth-chart';
import { AccountCards, type AccountCardData } from '@/components/net-worth/account-cards';
import { DismissTransferButton } from '@/components/net-worth/dismiss-transfer-button';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyValue } from '@/components/ui/money-value';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { Badge } from '@/components/ui/status';
import { prisma } from '@/lib/db/prisma';
import { loadAccountAnalytics } from '@/lib/finance/account-analytics-service';
import { countIncompleteOrUnknown, findCheckpointIssues, isActionableTransfer, totalDataConfidenceIssues } from '@/lib/finance/data-confidence';
import { loadMonthlyNetWorthHistory, rebuildMonthlyNetWorth } from '@/lib/finance/monthly-net-worth-service';
import { loadNetWorth } from '@/lib/finance/net-worth-service';
import { findCoverageGaps } from '@/lib/import/coverage';

export const dynamic = 'force-dynamic';

const DIAGNOSTIC_PREVIEW_LIMIT = 3;

export default async function NetWorthPage(): Promise<React.JSX.Element> {
  const activeAccountCount = await prisma.account.count({ where: { isArchived: false } });

  if (activeAccountCount === 0) {
    return (
      <PageShell width="narrow">
        <PageHeader
          title="Čisté jmění"
          description="Hotovost a investice po odečtení závazků. Přehled se sestaví z účtů, zůstatků a importovaných pohybů."
        />
        <EmptyState
          icon={<Bank aria-hidden="true" size={22} weight="duotone" />}
          title="Nejdřív přidejte účet"
          description="Po přidání bankovního nebo investičního účtu zde uvidíte aktuální hodnotu, historii i kvalitu podkladových dat."
          action={
            <Link href="/accounts" className="ui-button ui-button-primary">
              Přidat účet
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          }
        />
      </PageShell>
    );
  }

  const [current, batches, unmatchedTransfers, firstBankBatch, planningSettings, accounts, recurringExpenses] = await Promise.all([
    loadNetWorth(),
    prisma.importBatch.findMany({
      where: { status: 'COMPLETED' },
      select: { accountId: true, coverageFrom: true, coverageTo: true, account: { select: { name: true } } },
    }),
    prisma.transaction.findMany({
       where: { kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null, transferDismissedAt: null },
       select: { id: true, date: true, amount: true, amountCzk: true, currency: true, merchant: true, account: { select: { name: true, provider: true } } },
      orderBy: { date: 'desc' },
    }),
    prisma.importBatch.findFirst({
      where: { status: 'COMPLETED', account: { provider: { not: 'TRADING212' } }, periodFrom: { not: null } },
      orderBy: { periodFrom: 'asc' },
      select: { periodFrom: true },
    }),
    prisma.planningSettings.findUnique({ where: { id: 'household' }, select: { transferHistoryFrom: true, hideHistoricalBrokerTransfers: true } }),
    prisma.account.findMany({
      where: { isArchived: false, includeInNetWorth: true },
      select: {
        id: true,
        name: true,
        type: true,
        provider: true,
        currency: true,
        creditLimit: true,
        annualInterestRate: true,
        interestTaxRate: true,
        emergencyReserveMonths: true,
        snapshots: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: { cashBalance: true, investedValue: true, unrealizedPnl: true, updatedAt: true, currency: true, balance: true, expectedBalance: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.recurringExpense.findMany({
      where: { isActive: true, currency: 'CZK' },
      select: { expectedAmount: true },
    }),
  ]);
  let monthlyHistory = await loadMonthlyNetWorthHistory();
  if (monthlyHistory.length === 0 && firstBankBatch?.periodFrom) {
    await rebuildMonthlyNetWorth(firstBankBatch.periodFrom, new Date());
    monthlyHistory = await loadMonthlyNetWorthHistory();
  }
  const analytics = await Promise.all(accounts.map((account) => loadAccountAnalytics(account.id, account.currency)));
  const analyticsByAccount = new Map(analytics.map((item) => [item.accountId, item]));
  const worthByAccount = new Map(current.accounts.map((account) => [account.accountId, account]));
  const cardAccounts: AccountCardData[] = accounts.flatMap((account) => {
    const worth = worthByAccount.get(account.id);
    const accountAnalytics = analyticsByAccount.get(account.id);
    if (!worth || !accountAnalytics) return [];
    return [{
      id: account.id,
      name: account.name,
      type: account.type,
      provider: account.provider,
      balance: worth.balance.toFixed(2),
      source: worth.source,
      asOf: worth.asOf?.toISOString() ?? null,
      incomplete: worth.incompleteHistory || worth.source === 'UNKNOWN',
      creditLimit: account.creditLimit?.toFixed(2) ?? null,
      annualInterestRate: account.annualInterestRate?.toFixed(6) ?? null,
      interestTaxRate: account.interestTaxRate?.toFixed(4) ?? null,
      emergencyReserveMonths: account.emergencyReserveMonths,
      portfolio: account.snapshots[0]
        ? {
            cashBalance: account.snapshots[0].cashBalance?.toFixed(2) ?? null,
            investedValue: account.snapshots[0].investedValue?.toFixed(2) ?? null,
            unrealizedPnl: account.snapshots[0].unrealizedPnl?.toFixed(2) ?? null,
            updatedAt: account.snapshots[0].updatedAt.toISOString(),
            currency: account.snapshots[0].currency,
          }
        : null,
      analytics: accountAnalytics,
    }];
  });
  const fixedBaseline = recurringExpenses.reduce((total, expense) => total.plus(expense.expectedAmount), current.cashValue.minus(current.cashValue)).toFixed(2);

  // Only statements declare a covered period. Movement exports do not: a quiet
  // fortnight between transactions is not necessarily a missing statement.
  const gapsByAccount = [...new Map(batches.map((batch) => [batch.accountId, batch.account.name])).entries()]
    .map(([accountId, name]) => ({
      name,
      gaps: findCoverageGaps(batches.filter((batch) => batch.accountId === accountId)),
    }))
    .filter((entry) => entry.gaps.length > 0);

  const unknown = current.accounts.filter((account) => account.source === 'UNKNOWN');
  const incomplete = current.accounts.filter((account) => account.incompleteHistory);
  const incompleteCredit = incomplete.filter((account) => account.type === 'CREDIT');
  const incompleteCash = incomplete.filter((account) => account.type !== 'CREDIT');
  const transferBaseline = planningSettings?.transferHistoryFrom ?? firstBankBatch?.periodFrom ?? null;
  const actionableTransfers = unmatchedTransfers.filter((transaction) =>
    isActionableTransfer({ date: transaction.date, provider: transaction.account.provider }, transferBaseline),
  );
  // Permanently dismissible (see /planning "Historie bankovních převodů"): a
  // transfer older than the imported bank history can never find its
  // matching leg, unlike every other diagnostic here, so it never resolves
  // itself the normal way.
  const historicalBrokerTransfers = planningSettings?.hideHistoricalBrokerTransfers
    ? 0
    : unmatchedTransfers.length - actionableTransfers.length;
  const coverageGapCount = gapsByAccount.reduce((count, entry) => count + entry.gaps.length, 0);
  const checkpointIssues = findCheckpointIssues(
    accounts.map((account) => ({
      accountId: account.id,
      name: account.name,
      latestSnapshot: account.snapshots[0] ? { balance: account.snapshots[0].balance, expectedBalance: account.snapshots[0].expectedBalance } : null,
    })),
  );
  // Same union rule dashboard's own incompleteWorthAccounts already used —
  // an account tripping both incompleteHistory and source: 'UNKNOWN' is one
  // problem, not two.
  const confidenceIssueCount = totalDataConfidenceIssues({
    incompleteOrUnknown: countIncompleteOrUnknown(current.accounts.map((a) => ({ accountId: a.accountId, name: a.name, incompleteHistory: a.incompleteHistory, source: a.source }))).length,
    coverageGaps: coverageGapCount,
    actionableTransfers: actionableTransfers.length,
    checkpointIssues: checkpointIssues.length,
  });

  return (
    <PageShell>
      <PageHeader
        title="Čisté jmění"
        description="Současná hodnota majetku v CZK. U každého čísla vidíte, z jak čerstvých a úplných dat vychází."
      />

      <section className="surface grid min-w-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]" aria-labelledby="net-worth-total">
        <div className="min-w-0 p-5 md:p-8">
          <p id="net-worth-total" className="text-sm font-medium text-ink-muted">Čisté jmění celkem</p>
          <p className="money-value mt-2 text-[clamp(2rem,8vw,3.75rem)] font-semibold tracking-[-0.055em] text-ink">
            <MoneyValue>{czk.format(current.totalWorth.toNumber())}</MoneyValue>
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            Hotovost a investice po odečtení závazků. Přesnost závisí na kontrolních zůstatcích a čerstvosti investičních snímků.
          </p>
        </div>
        <dl className="grid min-w-0 divide-y divide-line rounded-b-[0.875rem] border-t border-line bg-surface-subtle/60 lg:rounded-b-none lg:rounded-r-[0.875rem] lg:border-l lg:border-t-0" aria-label="Výpočet čistého jmění">
          <FormulaItem label="Hotovost" operator="" value={<MoneyValue>{czk.format(current.cashValue.toNumber())}</MoneyValue>} />
          <FormulaItem label="Investice" operator="+" value={<MoneyValue>{czk.format(current.investmentValue.toNumber())}</MoneyValue>} />
          <FormulaItem label="Závazky" operator="−" value={<MoneyValue>{czk.format(current.liabilityValue.toNumber())}</MoneyValue>} />
        </dl>
      </section>

      <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
        <div id="accounts-heading">
          <SectionHeader
            title="Účty"
            description={`${cardAccounts.length.toLocaleString('cs-CZ')} aktivních účtů zahrnutých do čistého jmění.`}
            action={<Link href="/accounts" className="ui-button ui-button-secondary">Spravovat účty</Link>}
          />
        </div>
        {cardAccounts.length > 0 ? <AccountCards accounts={cardAccounts} fixedBaseline={fixedBaseline} /> : (
          <EmptyState title="Žádný účet není zahrnutý" description="Aktivní účty existují, ale žádný se nyní nezapočítává do čistého jmění. Změňte nastavení účtů, které chcete sledovat." action={<Link href="/accounts" className="ui-button ui-button-primary">Nastavit účty</Link>} />
        )}
      </section>

      <section aria-labelledby="net-worth-history" className="flex flex-col gap-3">
        <SectionHeader
          title="Vývoj čistého jmění"
          description="Měsíční hodnoty ke konci měsíce; detail složení zobrazíte nad bodem grafu."
        />
        <span id="net-worth-history" className="sr-only">Vývoj čistého jmění</span>
        <NetWorthChart data={monthlyHistory} />
      </section>

      <DataConfidencePanel issueCount={confidenceIssueCount} incomplete={incompleteCash} incompleteCredit={incompleteCredit} unknown={unknown} gapsByAccount={gapsByAccount} coverageGapCount={coverageGapCount} unmatchedTransfers={actionableTransfers} historicalBrokerTransfers={historicalBrokerTransfers} checkpointIssues={checkpointIssues.map((a) => ({ accountId: a.accountId, name: a.name }))} />
    </PageShell>
  );
}

function FormulaItem({ label, operator, value }: { label: string; operator: string; value: ReactNode }): React.JSX.Element {
  return (
    <div className="relative min-w-0 p-4 md:px-5 md:py-4">
      {operator ? (
        <span
          className="absolute -left-3 top-1/2 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-sm font-semibold text-ink-muted lg:flex"
          aria-hidden="true"
        >
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

type AccountDiagnostic = {
  accountId: string;
  name: string;
};

type CoverageDiagnostic = {
  name: string;
  gaps: { from: string; to: string }[];
};

type TransferDiagnostic = {
  id: string;
  date: Date;
  amount: { toNumber(): number };
  amountCzk: { toNumber(): number } | null;
  currency: string;
  merchant: string | null;
  account: { name: string };
};

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
        {hasIssues ? (
          <WarningCircle className="mt-0.5 shrink-0 text-warning" aria-hidden="true" size={22} weight="fill" />
        ) : (
          <CheckCircle className="mt-0.5 shrink-0 text-positive" aria-hidden="true" size={22} weight="fill" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="data-confidence-heading" className="font-semibold tracking-[-0.015em]">
              Důvěra v data
            </h2>
            <Badge tone={hasIssues ? 'warning' : 'success'}>
              {hasIssues ? `${issueCount.toLocaleString('cs-CZ')} upozornění` : 'Bez známých problémů'}
            </Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">
            {hasIssues
              ? 'Celková hodnota může být neúplná. Níže najdete konkrétní příčiny a místa, kde je opravíte.'
              : 'Všechny sledované účty mají potřebný zdroj hodnoty a importy nevykazují známé mezery.'}
          </p>
        </div>
      </summary>

      {hasIssues ? (
        <div className="divide-y divide-line">
          {incomplete.length > 0 ? (
            <DiagnosticItem
              title="Chybí kontrolní zůstatek"
              count={incomplete.length}
              actionHref="/import"
              actionLabel="Doplnit při importu"
            >
              <p>
                U účtů {formatNamePreview(incomplete.map((account) => account.name))} se hodnota počítá jen z
                dostupných výpisů. Výsledek proto může být nižší než skutečný stav.
              </p>
              <CollapsedNames names={incomplete.map((account) => account.name)} />
            </DiagnosticItem>
          ) : null}

          {incompleteCredit.length > 0 ? (
            <DiagnosticItem
              title="Kreditní karta nemá potvrzený počáteční dluh"
              count={incompleteCredit.length}
              actionHref="/accounts"
              actionLabel="Potvrdit start nebo zadat dluh"
            >
              <p>
                U karty {formatNamePreview(incompleteCredit.map((account) => account.name))} se dluh počítá jen z
                importovaných karetních plateb. Pokud existoval dluh před prvním importem, skutečný závazek může být vyšší.
              </p>
              <p className="mt-2">
                Až budete mít úplný výpis, import ho vytvoří jako kontrolní bod. Do té doby zadejte aktuální skutečný dluh
                v nastavení účtu, ne dostupný limit. Pokud karta před prvním importem začínala na nule, potvrďte nulový start.
              </p>
            </DiagnosticItem>
          ) : null}

          {unknown.length > 0 ? (
            <DiagnosticItem
              title="Chybí hodnota investic"
              count={unknown.length}
              actionHref="/portfolio"
              actionLabel="Aktualizovat portfolio"
            >
              <p>
                U účtů {formatNamePreview(unknown.map((account) => account.name))} chybí aktuální snímek, proto do
                součtu vstupují nulovou hodnotou.
              </p>
              <CollapsedNames names={unknown.map((account) => account.name)} />
            </DiagnosticItem>
          ) : null}

          {checkpointIssues.length > 0 ? (
            <DiagnosticItem
              title="Kontrolní bod nesedí"
              count={checkpointIssues.length}
              actionHref="/import"
              actionLabel="Doplnit kontrolní bod"
            >
              <p>
                U účtů {formatNamePreview(checkpointIssues.map((account) => account.name))} chybí kontrolní bod, nebo
                se neshoduje s tím, co ledger očekával z předchozí kotvy a importovaných pohybů.
              </p>
              <CollapsedNames names={checkpointIssues.map((account) => account.name)} />
            </DiagnosticItem>
          ) : null}

          {coverageGapCount > 0 ? (
            <DiagnosticItem
              title="Mezery v pokrytí výpisů"
              count={coverageGapCount}
              actionHref="/import"
              actionLabel="Nahrát chybějící výpis"
            >
              <p>Některá období nejsou pokryta dokončeným importem. Zkontrolujte návaznost výpisů.</p>
              <details className="mt-2">
                <summary className="cursor-pointer font-medium text-ink">Zobrazit chybějící období</summary>
                <ul className="mt-2 grid gap-1.5">
                  {gapsByAccount.map((entry) => (
                    <li key={entry.name}>
                      <span className="font-medium text-ink">{entry.name}:</span>{' '}
                      {entry.gaps.map((gap) => `${gap.from} až ${gap.to}`).join(', ')}
                    </li>
                  ))}
                </ul>
              </details>
            </DiagnosticItem>
          ) : null}

          {unmatchedTransfers.length > 0 ? (
            <DiagnosticItem
              title="Nespárované převody"
              count={unmatchedTransfers.length}
              actionHref="/transactions"
              actionLabel="Zkontrolovat transakce"
            >
              <p>Převod vypadá jako pohyb mezi vlastními účty, ale protistrana se nenašla nebo není jednoznačná.</p>
              <ul className="mt-2 grid gap-1.5">
                {unmatchedTransfers.slice(0, DIAGNOSTIC_PREVIEW_LIMIT).map((transaction) => (
                  <TransferRow key={transaction.id} transaction={transaction} />
                ))}
              </ul>
              {unmatchedTransfers.length > DIAGNOSTIC_PREVIEW_LIMIT ? (
                <details className="mt-2">
                  <summary className="cursor-pointer font-medium text-ink">
                    Zobrazit dalších {(unmatchedTransfers.length - DIAGNOSTIC_PREVIEW_LIMIT).toLocaleString('cs-CZ')}
                  </summary>
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
            <DiagnosticItem
              title="Historické převody Trading 212"
              count={historicalBrokerTransfers}
              actionHref="/portfolio"
              actionLabel="Zobrazit portfolio"
            >
              <p>
                Tyto brokerové vklady a výběry jsou starší než importovaná bankovní historie. Nejsou zahrnuté mezi aktuální
                úkoly, protože odpovídající bankovní noha v Orbitu nemůže existovat.
              </p>
            </DiagnosticItem>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function DiagnosticItem({
  title,
  count,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  count: number;
  actionHref: string;
  actionLabel: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <article className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge tone="warning">{count.toLocaleString('cs-CZ')}</Badge>
        </div>
        <div className="mt-1 text-sm leading-relaxed text-ink-muted">{children}</div>
      </div>
      <Link href={actionHref} className="ui-button ui-button-secondary self-start">
        {actionLabel}
        <ArrowRight aria-hidden="true" size={15} />
      </Link>
    </article>
  );
}

function CollapsedNames({ names }: { names: string[] }): React.JSX.Element | null {
  if (names.length <= DIAGNOSTIC_PREVIEW_LIMIT) {
    return null;
  }

  return (
    <details className="mt-2">
      <summary className="cursor-pointer font-medium text-ink">Zobrazit všechny účty</summary>
      <p className="mt-1">{names.join(', ')}</p>
    </details>
  );
}

function TransferRow({ transaction }: { transaction: TransferDiagnostic }): React.JSX.Element {
  const currency = transaction.amountCzk ? 'CZK' : transaction.currency;
  const amount = transaction.amountCzk?.toNumber() ?? transaction.amount.toNumber();
  const formatter = new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 break-words">
      <span>
        <time dateTime={transaction.date.toISOString()}>{transaction.date.toLocaleDateString('cs-CZ')}</time>
        {' · '}
        {transaction.account.name}
        {' · '}
        {transaction.merchant ?? 'Bez popisu'}
        {' · '}
        <span className="tabular text-ink"><MoneyValue>{formatter.format(amount)}</MoneyValue></span>
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
