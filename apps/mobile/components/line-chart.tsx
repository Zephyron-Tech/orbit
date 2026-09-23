import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

import { colors } from '../lib/colors';

export interface LineChartPoint {
  x: number;
  y: number;
  label: string;
}

/**
 * Hand-rolled SVG line chart with a gradient area fill under the line,
 * modeled on Trading 212's own portfolio chart (solid line, soft fade to
 * transparent below it, value label pinned above the last point) — no
 * charting library dependency.
 */
export function LineChart({ points, height = 200, currency = '' }: { points: LineChartPoint[]; height?: number; currency?: string }): React.JSX.Element {
  const [width, setWidth] = useState(0);

  if (points.length < 2) {
    return (
      <View className="items-center justify-center rounded-xl border border-line bg-surface p-6" style={{ height }}>
        <Text className="text-sm text-ink-muted">Zatím málo dat pro graf.</Text>
      </View>
    );
  }

  const sidePadding = 4;
  // The last point's value label is drawn above its dot — reserve extra
  // headroom so it never gets clipped by the Svg's hard canvas edge when
  // the last point sits near the top of the range.
  const topPadding = 28;
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
  const last = points[points.length - 1];
  // Anchor the last-point label to "start" instead of "end" once it would
  // otherwise run past the canvas edge, so it's never clipped.
  const lastLabelAnchor = last && toSvgX(points.length - 1) > width - 60 ? 'end' : 'middle';

  return (
    <View className="rounded-xl border border-line bg-surface p-4" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
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
          {points.map((point, index) => (
            <Circle key={index} cx={toSvgX(index)} cy={toSvgY(point.y)} r={index === points.length - 1 ? 3.5 : 0} fill={colors.accent} />
          ))}
          {last ? (
            <SvgText x={toSvgX(points.length - 1)} y={toSvgY(last.y) - 10} fontSize={13} fontWeight="600" fill={colors.ink} textAnchor={lastLabelAnchor}>
              {last.y.toLocaleString('cs-CZ')} {currency}
            </SvgText>
          ) : null}
        </Svg>
      ) : null}
      <View className="mt-1 flex-row justify-between">
        <Text className="text-xs text-ink-faint">{points[0]?.label}</Text>
        <Text className="text-xs text-ink-faint">{last?.label}</Text>
      </View>
    </View>
  );
}
