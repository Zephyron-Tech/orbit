import { ChartBarHorizontal, GearSix, TrendDown, TrendUp, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

import { LocalTimestamp, SnapshotFreshness } from '@/components/charts/local-timestamp';
import { PortfolioHistoryChart, type PortfolioHistoryPoint } from '@/components/charts/portfolio-history-chart';
import { PortfolioChart, type PortfolioPosition } from '@/components/charts/portfolio-chart';
import { RefreshPortfolioButton } from '@/components/charts/refresh-portfolio-button';
import { Metric } from '@/components/ui/metric';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { StatusNotice } from '@/components/ui/status';
import { prisma } from '@/lib/db/prisma';
import { accountSummarySchema, positionsSchema } from '@/lib/providers/trading212/schemas';

export const dynamic = 'force-dynamic';

interface ParsedSnapshot {
  positions: PortfolioPosition[];
  totalCost: number | null;
  integrityIssues: string[];
}

/** Render stored provider data so page figures always match recorded snapshot. */
function parseSnapshot(rawData: unknown): ParsedSnapshot {
  const record =
    typeof rawData === 'object' && rawData !== null && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : {};
  const positions = positionsSchema.safeParse(record.positions);
  const summary = accountSummarySchema.safeParse(record.summary);
  const integrityIssues: string[] = [];

  if (!positions.success) integrityIssues.push('seznam pozic');
  if (!summary.success) integrityIssues.push('souhrn účtu');

  return {
    positions: positions.success
      ? positions.data.map((position) => ({
          id: position.instrument.isin ?? position.instrument.ticker,
          ticker: position.instrument.ticker,
          name: position.instrument.name ?? position.instrument.ticker,
          value: position.walletImpact.currentValue,
          unrealizedProfitLoss: position.walletImpact.unrealizedProfitLoss,
          quantity: position.quantity,
        }))
      : [],
    totalCost: summary.success ? summary.data.investments.totalCost : null,
    integrityIssues,
  };
}

function moneyFormatter(currency: string, precise = false): Intl.NumberFormat {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: precise ? 2 : 0,
    maximumFractionDigits: precise ? 2 : 0,
  });
}

const PERCENT = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const QUANTITY = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 4 });

export default async function PortfolioPage(): Promise<React.JSX.Element> {
  const latestSnapshot = await prisma.accountSnapshot.findFirst({
    where: { account: { provider: 'TRADING212', isArchived: false } },
    orderBy: { capturedAt: 'desc' },
    include: { account: { select: { name: true } } },
  });
  const snapshots = latestSnapshot ? await prisma.accountSnapshot.findMany({
    where: { accountId: latestSnapshot.accountId },
    orderBy: { capturedAt: 'desc' },
    take: 10_000,
    include: { account: { select: { name: true } } },
  }) : [];
  snapshots.reverse();
  const snapshot = snapshots.at(-1);

  if (!snapshot) {
    return (
      <PageShell width="narrow">
        <PageHeader
          title="Portfolio"
          description="Aktuální stav investic z Trading 212. Synchronizace vytvoří první ověřitelný snímek."
          actions={
            <div className="w-[calc(100vw-2rem)] sm:w-auto">
              <RefreshPortfolioButton />
            </div>
          }
        />

        <StatusNotice
          tone="info"
          title="Začněte nastavením investičního účtu"
          actions={
            <Link href="/settings/accounts" className="ui-button ui-button-primary">
              <GearSix aria-hidden size={18} />
              Nastavit účty
            </Link>
          }
        >
          V nastavení přidejte účet Trading 212 a zkontrolujte jeho měnu. Potom nahoře zvolte Obnovit portfolio.
          Orbit načte aktuální zůstatek a otevřené pozice.
        </StatusNotice>
      </PageShell>
    );
  }

  const { positions, totalCost, integrityIssues } = parseSnapshot(snapshot.rawData);
  const currency = snapshot.currency.trim().toUpperCase();
  const money = moneyFormatter(currency);
  const moneyPrecise = moneyFormatter(currency, true);
  const total = snapshot.balance.toNumber();
  const invested = snapshot.investedValue?.toNumber() ?? 0;
  const unrealized = snapshot.unrealizedPnl?.toNumber() ?? 0;
  const cost = totalCost ?? invested - unrealized;
  const changePercent = cost !== 0 ? (unrealized / cost) * 100 : 0;
  const balanceCzk = snapshot.balanceCzk?.toNumber() ?? null;
  const sortedPositions = [...positions].sort((a, b) => b.value - a.value);
  const instruments = sortedPositions.map((position) => ({ id: position.id, ticker: position.ticker, name: position.name }));
  const history: PortfolioHistoryPoint[] = snapshots.flatMap((item) => {
    if (item.currency.trim().toUpperCase() !== currency) return [];
    const parsed = parseSnapshot(item.rawData);
    return [{
      capturedAt: item.capturedAt.toISOString(),
      total: item.balance.toNumber(),
      positions: parsed.integrityIssues.includes('seznam pozic')
        ? {}
        : Object.fromEntries(parsed.positions.map((position) => [position.id, position.value])),
    }];
  });
  const pnlTone = unrealized < 0 ? 'critical' : unrealized > 0 ? 'positive' : 'default';

  return (
    <PageShell>
      <PageHeader
        title="Portfolio"
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {snapshot.account.name} · aktualizováno <LocalTimestamp iso={snapshot.updatedAt.toISOString()} />
            </span>
            <SnapshotFreshness iso={snapshot.updatedAt.toISOString()} />
          </span>
        }
        actions={
          <div className="w-[calc(100vw-2rem)] sm:w-auto">
            <RefreshPortfolioButton capturedAt={snapshot.capturedAt.toISOString()} />
          </div>
        }
      />

      {integrityIssues.length > 0 ? (
        <StatusNotice tone="danger" title="Uložený snímek má porušenou integritu">
          <span className="inline-flex items-start gap-2">
            <WarningCircle aria-hidden className="mt-0.5 shrink-0 text-critical" size={18} />
            Poskytovatel uložil neplatný {integrityIssues.join(' a ')}. Základní hodnoty níže pocházejí z databázového
            záznamu, ale neúplné podrobnosti nepovažujte za spolehlivé. Zkuste portfolio obnovit.
          </span>
        </StatusNotice>
      ) : null}

      {balanceCzk === null ? (
        <StatusNotice tone="info" title={`Zobrazení v nativní měně ${currency}`}>
          Pro tento snímek není uložen přepočet do CZK. Všechny hodnoty na stránce proto zůstávají v měně účtu a
          nelze je přímo porovnávat s korunovými přehledy.
        </StatusNotice>
      ) : null}

      <section aria-label="Souhrn portfolia" className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr]">
        <Metric
          label="Hodnota portfolia"
          value={money.format(total)}
          detail={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`inline-flex items-center gap-1 ${pnlTone === 'critical' ? 'text-critical' : pnlTone === 'positive' ? 'text-positive' : ''}`}>
                {unrealized < 0 ? <TrendDown aria-hidden size={16} /> : <TrendUp aria-hidden size={16} />}
                {moneyPrecise.format(unrealized)} zatím neprodaný zisk / ztráta ({PERCENT.format(changePercent)} %)
              </span>
              <span>Pořizovací cena pozic {money.format(cost)}</span>
            </span>
          }
          tone={pnlTone}
          featured
        />
        <Metric label="Hodnota otevřených pozic" value={money.format(invested)} detail={`Nativní měna ${currency}`} />
        <Metric label="Hotovost" value={money.format(snapshot.cashBalance?.toNumber() ?? 0)} detail="Mimo otevřené pozice" />
      </section>

      {balanceCzk !== null && currency !== 'CZK' ? (
        <section aria-label="Podrobné metriky portfolia" className="grid gap-3 sm:grid-cols-2">
          <Metric label="Hodnota pro CZK přehledy" value={moneyFormatter('CZK').format(balanceCzk)} detail="Uložený přepočet" />
        </section>
      ) : null}

      <section className="flex flex-col gap-4" aria-label="Historie portfolia">
        <SectionHeader
          title="Vývoj hodnoty"
          description="Historie od prvního uloženého snímku; starší období se doplní až dalšími synchronizacemi."
        />
        <PortfolioHistoryChart data={history} instruments={instruments} currency={currency} />
      </section>

      <section className="flex flex-col gap-4" aria-label="Rozložení portfolia">
        <SectionHeader
          title="Rozložení portfolia"
          description="Podíl jednotlivých otevřených pozic na jejich celkové hodnotě."
          action={<ChartBarHorizontal aria-hidden className="text-ink-muted" size={24} />}
        />
        <PortfolioChart positions={positions} currency={currency} />
      </section>

      {sortedPositions.length > 0 ? (
        <section className="flex flex-col gap-4" aria-label="Otevřené pozice">
          <SectionHeader title="Otevřené pozice" description={`${sortedPositions.length} pozic · hodnoty v ${currency}`} />

          <div className="surface hidden overflow-x-auto md:block">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="sr-only">Otevřené investiční pozice v měně {currency}</caption>
              <thead className="border-b border-line bg-surface-subtle text-xs font-medium uppercase tracking-wide text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">Instrument</th>
                  <th scope="col" className="px-4 py-3 text-right">Množství</th>
                  <th scope="col" className="px-4 py-3 text-right">Hodnota</th>
                  <th scope="col" className="px-4 py-3 text-right">Nerealizovaný výsledek</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedPositions.map((position) => (
                  <tr key={position.id}>
                    <th scope="row" className="px-4 py-3 font-semibold">
                      {position.ticker}
                      <span className="mt-0.5 block font-normal text-ink-muted">{position.name}</span>
                    </th>
                    <td className="tabular px-4 py-3 text-right">{QUANTITY.format(position.quantity)}</td>
                    <td className="tabular px-4 py-3 text-right font-medium">{money.format(position.value)}</td>
                    <td className={`tabular px-4 py-3 text-right font-medium ${position.unrealizedProfitLoss < 0 ? 'text-critical' : position.unrealizedProfitLoss > 0 ? 'text-positive' : ''}`}>
                      {moneyPrecise.format(position.unrealizedProfitLoss)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 md:hidden" aria-label="Otevřené investiční pozice">
            {sortedPositions.map((position) => (
              <li key={position.id} className="surface min-w-0 p-4">
                <div className="grid min-w-0 gap-2 xs:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="font-semibold">{position.ticker}</p>
                    <p className="break-words text-sm text-ink-muted" title={position.name}>{position.name}</p>
                  </div>
                  <p className="money-value font-semibold xs:text-right">{money.format(position.value)}</p>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-muted">Množství</dt>
                    <dd className="tabular mt-1">{QUANTITY.format(position.quantity)}</dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-xs text-ink-muted">Zisk / ztráta</dt>
                    <dd className={`tabular mt-1 font-medium ${position.unrealizedProfitLoss < 0 ? 'text-critical' : position.unrealizedProfitLoss > 0 ? 'text-positive' : ''}`}>
                      {moneyPrecise.format(position.unrealizedProfitLoss)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageShell>
  );
}
