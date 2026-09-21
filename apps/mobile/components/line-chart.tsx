import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

export interface LineChartPoint {
  x: number;
  y: number;
  label: string;
}

/**
 * Minimal hand-rolled SVG line chart — no charting library dependency.
 * Functionality-first pass (see the mobile parity plan): a single readable
 * line over time is the bar, not a polished design.
 */
export function LineChart({ points, height = 160, currency = '' }: { points: LineChartPoint[]; height?: number; currency?: string }): React.JSX.Element {
  const [width, setWidth] = useState(0);

  if (points.length < 2) {
    return (
      <View className="items-center justify-center rounded-xl border border-neutral-200 p-6" style={{ height }}>
        <Text className="text-sm text-neutral-500">Zatím málo dat pro graf.</Text>
      </View>
    );
  }

  const padding = 12;
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const range = maxY - minY || 1;

  function toSvgX(index: number): number {
    return padding + (index / (points.length - 1)) * (width - padding * 2);
  }
  function toSvgY(y: number): number {
    return height - padding - ((y - minY) / range) * (height - padding * 2);
  }

  const pathData = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toSvgX(index)} ${toSvgY(point.y)}`).join(' ');
  const last = points[points.length - 1];

  return (
    <View className="rounded-xl border border-neutral-200 p-3" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e5e5" strokeWidth={1} />
          <Path d={pathData} stroke="#171717" strokeWidth={2} fill="none" />
          {points.map((point, index) => (
            <Circle key={index} cx={toSvgX(index)} cy={toSvgY(point.y)} r={index === points.length - 1 ? 3 : 0} fill="#171717" />
          ))}
          {last ? (
            <SvgText x={toSvgX(points.length - 1)} y={toSvgY(last.y) - 8} fontSize={11} fill="#171717" textAnchor="end">
              {last.y.toLocaleString('cs-CZ')} {currency}
            </SvgText>
          ) : null}
        </Svg>
      ) : null}
      <View className="mt-1 flex-row justify-between">
        <Text className="text-xs text-neutral-400">{points[0]?.label}</Text>
        <Text className="text-xs text-neutral-400">{last?.label}</Text>
      </View>
    </View>
  );
}
