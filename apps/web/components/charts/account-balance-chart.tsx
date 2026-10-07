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

export interface AccountBalancePoint {
  date: string;
  balance: number;
  cumulativeInterest: number;
}

const AXIS_DATE_FORMAT = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const FULL_DATE_FORMAT = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

function formatAxisDate(value: string): string {
  return AXIS_DATE_FORMAT.format(new Date(`${value}T00:00:00Z`));
}

function formatFullDate(value: string): string {
  return FULL_DATE_FORMAT.format(new Date(`${value}T00:00:00Z`));
}

export function AccountBalanceChart({ data }: { data: AccountBalancePoint[] }): React.JSX.Element {
  const palette = useChartPalette();

  if (data.length === 0) {
    return (
      <div className="surface p-6 text-center">
        <p className="font-semibold">Historie zatím není k dispozici</p>
        <p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-ink-muted">
          První bod se objeví po dnešním zápisu. Potom zde uvidíte, jak se zůstatek a úrok vyvíjejí v čase.
        </p>
      </div>
    );
  }

  const first = data[0];
  const latest = data[data.length - 1];
  const interestInPeriod = latest.cumulativeInterest - first.cumulativeInterest;
  const singlePoint = data.length === 1;
  const chartSummary = singlePoint
    ? `Zůstatek k ${formatFullDate(latest.date)} je ${czk.format(latest.balance)}.`
    : `Vývoj zůstatku od ${formatFullDate(first.date)} do ${formatFullDate(latest.date)}. ` +
      `Počáteční zůstatek ${czk.format(first.balance)}, aktuální zůstatek ${czk.format(latest.balance)}. ` +
      `Úrok připsaný za toto období: ${czk.format(interestInPeriod)}.`;

  return (
    <figure className="surface overflow-hidden">
      <figcaption className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <p className="text-sm text-ink-muted">
          {formatFullDate(first.date)} až {formatFullDate(latest.date)}
        </p>
        <p className="tabular text-sm font-semibold text-ink">
          Úrok za období: <MoneyValue>{czk.format(interestInPeriod)}</MoneyValue>
        </p>
      </figcaption>

      <div className="p-2 sm:p-4">
        {singlePoint ? <p className="px-2 pb-1 text-xs text-ink-muted">Křivka se objeví po dalším dni s daty.</p> : null}
        <div className="h-56 w-full sm:h-64" role="img" aria-label={chartSummary}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart accessibilityLayer data={data} margin={{ top: 16, right: 12, bottom: 8, left: 4 }}>
              <CartesianGrid stroke={palette.grid} strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="date"
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
              <Tooltip content={<AccountBalanceTooltip />} cursor={{ stroke: palette.axis, strokeDasharray: '3 3', strokeWidth: 1 }} isAnimationActive={false} />
              <Line
                type="monotone"
                dataKey="balance"
                name="Zůstatek"
                stroke={palette.series1}
                strokeWidth={2.5}
                dot={singlePoint ? { r: 4, fill: palette.series1, stroke: palette.surface, strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: palette.series1, stroke: palette.surface, strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="cumulativeInterest"
                name="Připsaný úrok"
                stroke={palette.series3}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: palette.series3, stroke: palette.surface, strokeWidth: 2 }}
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

function AccountBalanceTooltip({ active, payload }: TooltipRenderProps): React.JSX.Element | null {
  const point = payload?.[0]?.payload as AccountBalancePoint | undefined;

  if (!active || !point) {
    return null;
  }

  return (
    <div className="min-w-52 rounded-xl border border-line-strong bg-[var(--surface-raised)] p-3 text-xs shadow-[var(--shadow-sm)]">
      <p className="font-medium text-ink-muted">{formatFullDate(point.date)}</p>
      <p className="tabular mt-0.5 text-lg font-semibold tracking-[-0.025em] text-ink">
        <MoneyValue>{czk.format(point.balance)}</MoneyValue>
      </p>
      <div className="my-2 border-t border-line" />
      <dl className="grid grid-cols-[auto_auto] gap-x-5 gap-y-1 text-ink-muted">
        <dt>Připsaný úrok (celkem)</dt>
        <dd className="tabular text-right text-ink"><MoneyValue>{czk.format(point.cumulativeInterest)}</MoneyValue></dd>
      </dl>
    </div>
  );
}
