'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { MoneyValue } from '@/components/ui/money-value';
import { usePrivacyMode } from '@/lib/ui/privacy-mode';

import { czk, czkCompact } from './chart-theme';
import { useChartPalette } from './use-chart-palette';

const AXIS_MASK = '••••';

/** Recharts renders axis ticks as SVG <text>, unreachable by wrapping JSX text — this reads privacy state directly. */
function MoneyTick({ x, y, fill, payload }: { x?: number; y?: number; fill?: string; payload?: { value: number } }): React.JSX.Element | null {
  const hidden = usePrivacyMode();

  if (x === undefined || y === undefined || !payload) return null;

  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={fill} fontSize={12}>
      {hidden ? AXIS_MASK : czkCompact.format(payload.value)}
    </text>
  );
}

export interface NetWorthPoint {
  month: string;
  totalWorth: number;
  cashValue: number;
  investmentValue: number;
  liabilityValue: number;
  isComplete?: boolean;
}

const AXIS_DATE_FORMAT = new Intl.DateTimeFormat('cs-CZ', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const FULL_DATE_FORMAT = new Intl.DateTimeFormat('cs-CZ', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatAxisDate(value: string): string {
  return AXIS_DATE_FORMAT.format(new Date(`${value}-01T00:00:00Z`));
}

function formatFullDate(value: string): string {
  return FULL_DATE_FORMAT.format(new Date(`${value}-01T00:00:00Z`));
}

export function NetWorthChart({ data }: { data: NetWorthPoint[] }): React.JSX.Element {
  const palette = useChartPalette();

  if (data.length === 0) {
    return (
      <div className="surface p-6 text-center md:p-8">
        <p className="font-semibold">Historie zatím není k dispozici</p>
        <p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-ink-muted">
          První měsíční bod se vytvoří po načtení historie. Potom zde uvidíte vývoj hodnoty v čase.
        </p>
      </div>
    );
  }

  const first = data[0];
  const latest = data[data.length - 1];
  const change = latest.totalWorth - first.totalWorth;
  const singlePoint = data.length === 1;
  // Plain-text version for the (non-visual) chart aria-label — screen-reader
  // text isn't reachable by a shoulder-surfer, so it stays unmasked regardless
  // of privacy mode, same as it always has been.
  const changeSummaryText = singlePoint
    ? 'Zatím je dostupná jedna měsíční hodnota.'
    : change === 0
      ? 'Za zobrazené období beze změny.'
      : `${change > 0 ? 'Nárůst' : 'Pokles'} za období: ${czk.format(Math.abs(change))}.`;
  const changeText = singlePoint ? (
    'Zatím je dostupná jedna měsíční hodnota.'
  ) : change === 0 ? (
    'Za zobrazené období beze změny.'
  ) : (
    <>
      {change > 0 ? 'Nárůst' : 'Pokles'} za období: <MoneyValue>{czk.format(Math.abs(change))}</MoneyValue>.
    </>
  );
  const chartSummary = singlePoint
    ? `Čisté jmění ke konci ${formatFullDate(latest.month)} bylo ${czk.format(latest.totalWorth)}.`
    : `Vývoj čistého jmění od konce ${formatFullDate(first.month)} do konce ${formatFullDate(latest.month)}. ` +
      `Počáteční hodnota ${czk.format(first.totalWorth)}, poslední hodnota ${czk.format(latest.totalWorth)}. ${changeSummaryText}`;

  return (
    <figure className="surface overflow-hidden">
      <figcaption className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <p className="text-sm text-ink-muted">
          Konec {formatFullDate(first.month)} až konec {formatFullDate(latest.month)} · {data.length.toLocaleString('cs-CZ')}{' '}
          {data.length === 1 ? 'měsíc' : data.length < 5 ? 'měsíce' : 'měsíců'}
        </p>
        <span className="flex flex-wrap items-center gap-2"><p className={`tabular text-sm font-semibold ${change < 0 ? 'text-critical' : 'text-ink'}`}>{changeText}</p>{!latest.isComplete ? <span className="rounded-full border border-warning/25 bg-[var(--warning-soft)] px-2 py-1 text-xs font-medium text-warning">Částečný podklad</span> : null}</span>
      </figcaption>

        <div className="p-2 sm:p-4">
        {singlePoint ? (
          <p className="px-2 pb-1 text-xs text-ink-muted">Křivka se objeví po uložení další hodnoty.</p>
        ) : null}
          <div className="h-56 w-full sm:h-64" role="img" aria-label={chartSummary}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              accessibilityLayer
              data={data}
              margin={{ top: 16, right: 12, bottom: 8, left: 4 }}
            >
              <CartesianGrid stroke={palette.grid} strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={formatAxisDate}
                stroke={palette.axis}
                tick={{ fill: palette.muted, fontSize: 12 }}
                tickLine={false}
                tickMargin={10}
                axisLine={{ stroke: palette.axis }}
                minTickGap={28}
              />
              <YAxis
                stroke={palette.axis}
                tick={<MoneyTick fill={palette.muted} />}
                tickLine={false}
                tickMargin={8}
                axisLine={false}
                width={68}
              />
              <Tooltip
                content={<NetWorthTooltip />}
                cursor={{ stroke: palette.axis, strokeDasharray: '3 3', strokeWidth: 1 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="totalWorth"
                name="Čisté jmění"
                stroke={palette.series1}
                strokeWidth={2.5}
                dot={singlePoint ? { r: 4, fill: palette.series1, stroke: palette.surface, strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: palette.series1, stroke: palette.surface, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

    </figure>
  );
}

interface TooltipRenderProps {
  active?: boolean;
  payload?: { payload?: unknown }[];
}

function NetWorthTooltip({ active, payload }: TooltipRenderProps): React.JSX.Element | null {
  const point = payload?.[0]?.payload as NetWorthPoint | undefined;

  if (!active || !point) {
    return null;
  }

  return (
    <div className="min-w-52 rounded-xl border border-line-strong bg-[var(--surface-raised)] p-3 text-xs shadow-[var(--shadow-sm)]">
      <p className="font-medium text-ink-muted">Konec {formatFullDate(point.month)}</p>
      <p className="tabular mt-0.5 text-lg font-semibold tracking-[-0.025em] text-ink">
        <MoneyValue>{czk.format(point.totalWorth)}</MoneyValue>
      </p>
      <div className="my-2 border-t border-line" />
      <dl className="grid grid-cols-[auto_auto] gap-x-5 gap-y-1 text-ink-muted">
        <dt>Hotovost</dt>
        <dd className="tabular text-right text-ink"><MoneyValue>{czk.format(point.cashValue)}</MoneyValue></dd>
        <dt>+ Investice</dt>
        <dd className="tabular text-right text-ink"><MoneyValue>{czk.format(point.investmentValue)}</MoneyValue></dd>
        <dt>− Závazky</dt>
        <dd className="tabular text-right text-ink"><MoneyValue>{czk.format(point.liabilityValue)}</MoneyValue></dd>
        {!point.isComplete ? <><dt>Podklad</dt><dd className="text-right text-warning">Částečný</dd></> : null}
      </dl>
    </div>
  );
}
