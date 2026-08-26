import { StatusNotice } from '@/components/ui/status';

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  value: number;
  unrealizedProfitLoss: number;
  quantity: number;
}

const PERCENT = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** CSS bars retain readable labels and exact textual values at every viewport width. */
export function PortfolioChart({
  positions,
  currency,
}: {
  positions: PortfolioPosition[];
  currency: string;
}): React.JSX.Element {
  if (positions.length === 0) {
    return <StatusNotice title="Žádné otevřené pozice">Snímek neobsahuje žádné pozice k rozložení.</StatusNotice>;
  }

  const money = new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  const sorted = [...positions].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, position) => sum + Math.max(position.value, 0), 0);

  return (
    <ol className="surface grid gap-5 p-4 sm:p-6" aria-label={`Rozložení pozic v měně ${currency}`}>
      {sorted.map((position) => {
        const share = total > 0 ? (Math.max(position.value, 0) / total) * 100 : 0;

        return (
          <li key={position.id}>
            <div className="mb-2 flex items-end justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="font-semibold">{position.ticker}</span>
                <span className="ml-2 hidden truncate text-ink-muted sm:inline">{position.name}</span>
              </div>
              <span className="tabular shrink-0 text-right font-medium">
                {money.format(position.value)} <span className="text-ink-muted">· {PERCENT.format(share)} %</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
              <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
            </div>
            <p className="mt-1 truncate text-xs text-ink-muted sm:hidden">{position.name}</p>
          </li>
        );
      })}
    </ol>
  );
}
