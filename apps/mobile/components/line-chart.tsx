import { TrendDownIcon, TrendUpIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors } from '../lib/colors';

export interface LineChartPoint {
  x: number;
  y: number;
  label: string;
  /** Unrealized P/L at this point; when present the header change uses it, not the value. */
  pnl?: number | null;
}

/**
 * Hand-rolled SVG line chart with a gradient area fill under the line,
 * modeled on Trading 212's own portfolio chart: current value + the
 * selected period's change sit as a header above the line (not drawn on
 * the chart itself — duplicating the hero total there added nothing and
 * crowded the last point), no charting library dependency.
 */
export function LineChart({ points, height = 180, currency = '' }: { points: LineChartPoint[]; height?: number; currency?: string }): React.JSX.Element {
  const [width, setWidth] = useState(0);

  if (points.length < 2) {
    return (
      <View className="items-center justify-center rounded-xl border border-line bg-surface p-6" style={{ height }}>
        <Text className="text-sm text-ink-muted">Zatím málo dat pro graf.</Text>
      </View>
    );
  }

  const sidePadding = 4;
  const topPadding = 8;
  const bottomPadding = 8;
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const range = maxY - minY || 1;

  function toSvgX(index: number): number {
    return sidePadding + (index / (points.length - 1)) * (width - sidePadding * 2);
  }
  function toSvgY(y: number): number {
    return height - bottomPadding - ((y - minY) / range) * (height - bottomPadding - topPadding);
  }

  const pathData = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toSvgX(index)} ${toSvgY(point.y)}`).join(' ');
  const areaData = `${pathData} L ${toSvgX(points.length - 1)} ${height - bottomPadding} L ${toSvgX(0)} ${height - bottomPadding} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const delta =
    first && last
      ? typeof first.pnl === 'number' && typeof last.pnl === 'number'
        ? last.pnl - first.pnl
        : last.y - first.y
      : 0;

  return (
    <View className="rounded-xl border border-line bg-surface p-4">
      {last ? (
        <View className="mb-3">
          <Text className="font-sans-semibold text-lg text-ink">
            {last.y.toLocaleString('cs-CZ')} {currency}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-1">
            {delta < 0 ? <TrendDownIcon color={colors.critical} size={14} weight="bold" /> : <TrendUpIcon color={colors.positive} size={14} weight="bold" />}
            <Text className={`text-sm font-sans-medium ${delta < 0 ? 'text-critical' : 'text-positive'}`}>
              {delta >= 0 ? '+' : ''}
              {delta.toLocaleString('cs-CZ')} {currency}
            </Text>
            <Text className="text-xs text-ink-muted">za vybrané období</Text>
          </View>
        </View>
      ) : null}
      {/* No padding on this wrapper — Svg's width is set from its own measured
          layout, so any padding here would make Svg wider than the space
          actually left inside the card's own p-4, overflowing past the edge. */}
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <Defs>
              <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.accent} stopOpacity="0.25" />
                <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Line x1={sidePadding} y1={height - bottomPadding} x2={width - sidePadding} y2={height - bottomPadding} stroke={colors.line} strokeWidth={1} />
            <Path d={areaData} fill="url(#chartFill)" />
            <Path d={pathData} stroke={colors.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <Circle cx={toSvgX(points.length - 1)} cy={toSvgY(last?.y ?? 0)} r={3.5} fill={colors.accent} />
          </Svg>
        ) : null}
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-xs text-ink-faint">{points[0]?.label}</Text>
        <Text className="text-xs text-ink-faint">{last?.label}</Text>
      </View>
    </View>
  );
}
