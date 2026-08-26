'use client';

import { CHART_PALETTE, type ChartPalette } from './chart-theme';

/**
 * Returns CSS-resolved colours. `light-dark()` follows inherited color-scheme,
 * so server and first client render match without a light chart flash.
 */
export function useChartPalette(): ChartPalette {
  return CHART_PALETTE;
}
