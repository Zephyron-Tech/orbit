/**
 * Blue, orange and green keep series distinguishable under common colour-vision
 * deficiencies. Axis labels intentionally carry more contrast than grid lines.
 *
 * Dark values are their own steps chosen for the dark surface, not an automatic
 * inversion of the light ones.
 */
export const CHART_COLORS = {
  light: {
    series1: '#2a78d6',
    series2: '#eb6834',
    series3: '#1baf7a',
    grid: '#d8e0dd',
    axis: '#7a8884',
    muted: '#5d6c68',
    text: '#17211f',
    surface: '#fdfefd',
    good: '#0ca30c',
    critical: '#d03b3b',
  },
  dark: {
    series1: '#70afff',
    series2: '#f29a62',
    series3: '#73d0a1',
    grid: '#2a3543',
    axis: '#8d99a8',
    muted: '#aab5c3',
    text: '#edf2f8',
    surface: '#151c26',
    good: '#73d0a1',
    critical: '#f09a98',
  },
} as const;

export type ChartMode = keyof typeof CHART_COLORS;
type ChartColor = keyof (typeof CHART_COLORS)['light'];
export type ChartPalette = Record<ChartColor, string>;

export const CHART_PALETTE: ChartPalette = {
  series1: `light-dark(${CHART_COLORS.light.series1}, ${CHART_COLORS.dark.series1})`,
  series2: `light-dark(${CHART_COLORS.light.series2}, ${CHART_COLORS.dark.series2})`,
  series3: `light-dark(${CHART_COLORS.light.series3}, ${CHART_COLORS.dark.series3})`,
  grid: `light-dark(${CHART_COLORS.light.grid}, ${CHART_COLORS.dark.grid})`,
  axis: `light-dark(${CHART_COLORS.light.axis}, ${CHART_COLORS.dark.axis})`,
  muted: `light-dark(${CHART_COLORS.light.muted}, ${CHART_COLORS.dark.muted})`,
  text: `light-dark(${CHART_COLORS.light.text}, ${CHART_COLORS.dark.text})`,
  surface: `light-dark(${CHART_COLORS.light.surface}, ${CHART_COLORS.dark.surface})`,
  good: `light-dark(${CHART_COLORS.light.good}, ${CHART_COLORS.dark.good})`,
  critical: `light-dark(${CHART_COLORS.light.critical}, ${CHART_COLORS.dark.critical})`,
};

/** Czech number formatting, no decimals — crowns, not halers, on an axis. */
export const czk = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
});

export const czkPrecise = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Compact axis labels: "14,6 tis." rather than a wall of digits. */
export const czkCompact = new Intl.NumberFormat('cs-CZ', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
