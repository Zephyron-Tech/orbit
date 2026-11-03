'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { useChartPalette } from '@/components/charts/use-chart-palette';
import { MoneyValue } from '@/components/ui/money-value';
import { SelectField } from '@/components/ui/select-field';
import { StatusNotice } from '@/components/ui/status';
import { usePrivacyMode } from '@/lib/ui/privacy-mode';

const AXIS_MASK = '••••';

/** Recharts renders axis ticks as SVG <text>, unreachable by wrapping JSX text — this reads privacy state directly. */
function MoneyTick({
  x,
  y,
  fill,
  payload,
  format,
}: {
  x?: number;
  y?: number;
  fill?: string;
  payload?: { value: number };
  format: (value: number) => string;
}): React.JSX.Element | null {
  const hidden = usePrivacyMode();

  if (x === undefined || y === undefined || !payload) return null;

  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={fill} fontSize={11}>
      {hidden ? AXIS_MASK : format(payload.value)}
    </text>
  );
}

export interface PortfolioHistoryPoint {
  capturedAt: string;
  total: number;
  /** Unrealized profit/loss of open positions; unaffected by deposits and purchases. */
  pnl: number | null;
  positions: Record<string, number>;
}

export interface PortfolioInstrument {
  id: string;
  ticker: string;
  name: string;
}

type Range = '1D' | '1W' | '1M' | '6M' | '1Y';

const RANGES: { value: Range; label: string; days: number }[] = [
  { value: '1D', label: 'Den', days: 1 },
  { value: '1W', label: 'Týden', days: 7 },
  { value: '1M', label: 'Měsíc', days: 31 },
  { value: '6M', label: 'Půl roku', days: 183 },
  { value: '1Y', label: 'Rok', days: 366 },
];

export function PortfolioHistoryChart({
  data,
  instruments,
  currency,
}: {
  data: PortfolioHistoryPoint[];
  instruments: PortfolioInstrument[];
  currency: string;
}): React.JSX.Element {
  const palette = useChartPalette();
  const [range, setRange] = useState<Range>('1M');
  const [instrumentId, setInstrumentId] = useState(instruments[0]?.id ?? '');
  const latestTime = data.at(-1) ? new Date(data.at(-1)?.capturedAt ?? '').getTime() : 0;
  const selectedRange = RANGES.find((option) => option.value === range) ?? RANGES[0];
  const filtered = useMemo(() => {
    if (!latestTime) return [];
    const cutoff = latestTime - selectedRange.days * 24 * 60 * 60 * 1000;
    return data.filter((point) => new Date(point.capturedAt).getTime() >= cutoff);
  }, [data, latestTime, selectedRange.days]);
  const money = useMemo(
    () => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 0 }),
    [currency],
  );
  const selectedInstrument = instruments.find((instrument) => instrument.id === instrumentId);
  const positionData = filtered
    .filter((point) => point.positions[instrumentId] !== undefined)
    .map((point) => ({ capturedAt: point.capturedAt, value: point.positions[instrumentId] }));
  const totalData = filtered.map((point) => ({ capturedAt: point.capturedAt, value: point.total, pnl: point.pnl }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-surface-subtle p-1" aria-label="Rozsah historie">
        {RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setRange(option.value)}
            aria-pressed={range === option.value}
            className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold transition-colors ${
              range === option.value ? 'bg-[var(--surface-raised)] text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <HistoryPanel
        title="Hodnota celého portfolia"
        description="Čára je hodnota účtu včetně vkladů; číslo vpravo je jen skutečný zisk / ztráta pozic za období, vklady a nákupy nezapočítává."
        data={totalData}
        money={money}
        color={palette.series1}
        palette={palette}
        range={range}
      />

      <section className="surface flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">Vývoj otevřené pozice</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">Historie začíná prvním uloženým snímkem. Uzavřené pozice zde nejsou.</p>
          </div>
          {instruments.length > 0 ? (
            <SelectField
              value={instrumentId}
              onValueChange={setInstrumentId}
              ariaLabel="Otevřená pozice"
              className="w-full sm:w-72"
              options={instruments.map((instrument) => ({
                value: instrument.id,
                label: instrument.ticker,
                description: instrument.name,
              }))}
            />
          ) : null}
        </div>
        {selectedInstrument ? (
          <HistoryChart
            data={positionData}
            money={money}
            color={palette.series2}
            palette={palette}
            range={range}
            emptyLabel={`Pro ${selectedInstrument.ticker} nejsou v tomto období alespoň dva uložené snímky.`}
          />
        ) : (
          <StatusNotice>Aktuální snímek neobsahuje otevřenou pozici.</StatusNotice>
        )}
      </section>
    </div>
  );
}

function HistoryPanel({
  title,
  description,
  data,
  money,
  color,
  palette,
  range,
}: {
  title: string;
  description: string;
  data: { capturedAt: string; value: number; pnl?: number | null }[];
  money: Intl.NumberFormat;
  color: string;
  palette: ReturnType<typeof useChartPalette>;
  range: Range;
}): React.JSX.Element {
  return (
    <section className="surface flex flex-col gap-4 p-4 sm:p-5">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
      </div>
      <HistoryChart data={data} money={money} color={color} palette={palette} range={range} emptyLabel="Pro toto období nejsou alespoň dva uložené snímky." />
    </section>
  );
}

/**
 * Compact notation at a fixed precision collapses distinct nearby values into
 * the same label (e.g. 14 383 and 14 414 both round to "14,4 tis."), making
 * the axis look broken on a narrow range. Picks the lowest fraction-digit
 * count that still tells the min and max apart, falling back to a plain
 * (non-compact) integer format if even 2 digits can't.
 */
function createAxisTickFormatter(values: number[]): (value: number) => string {
  const min = Math.min(...values);
  const max = Math.max(...values);

  for (let fractionDigits = 0; fractionDigits <= 2; fractionDigits += 1) {
    const formatter = new Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: fractionDigits });
    if (formatter.format(min) !== formatter.format(max)) {
      return (value: number) => formatter.format(value);
    }
  }

  const plain = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
  return (value: number) => plain.format(value);
}

function HistoryChart({
  data,
  money,
  color,
  palette,
  range,
  emptyLabel,
}: {
  data: { capturedAt: string; value: number; pnl?: number | null }[];
  money: Intl.NumberFormat;
  color: string;
  palette: ReturnType<typeof useChartPalette>;
  range: Range;
  emptyLabel: string;
}): React.JSX.Element {
  if (data.length < 2) {
    return <StatusNotice tone="info">{emptyLabel} Synchronizace bude historii postupně doplňovat.</StatusNotice>;
  }

  const first = data[0]?.value ?? 0;
  const last = data.at(-1)?.value ?? 0;
  // Value change mixes deposits with returns; when the points carry P/L, report that instead.
  const firstPnl = data[0]?.pnl;
  const lastPnl = data.at(-1)?.pnl;
  const difference = typeof firstPnl === 'number' && typeof lastPnl === 'number' ? lastPnl - firstPnl : last - first;
  const formatAxisTick = createAxisTickFormatter(data.map((point) => point.value));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-muted">{data.length} uložených bodů</span>
        <span className={`money-value font-semibold ${difference < 0 ? 'text-critical' : difference > 0 ? 'text-positive' : 'text-ink-muted'}`}>
          <MoneyValue>{difference > 0 ? '+' : ''}{money.format(difference)}</MoneyValue>
        </span>
      </div>
      <div className="h-64 w-full min-w-0" role="img" aria-label={`Vývoj hodnoty, změna ${money.format(difference)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis
              dataKey="capturedAt"
              stroke={palette.axis}
              tick={{ fill: palette.muted, fontSize: 11 }}
              tickFormatter={(value: string) => formatAxisDate(value, range)}
              minTickGap={28}
            />
            <YAxis
              stroke={palette.axis}
              tick={<MoneyTick fill={palette.muted} format={formatAxisTick} />}
              width={54}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{ background: palette.surface, border: `1px solid ${palette.grid}`, borderRadius: 12 }}
              labelFormatter={(value) => new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(value)))}
              formatter={(value) => [<MoneyValue key="value">{money.format(Number(value))}</MoneyValue>, 'Hodnota']}
            />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function formatAxisDate(value: string, range: Range): string {
  const date = new Date(value);
  return range === '1D'
    ? new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short' }).format(date);
}
