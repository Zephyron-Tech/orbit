import { createContext, useContext } from 'react';
import { colorScheme, vars } from 'nativewind';

import { store } from './auth-storage';

const THEME_PREFERENCE_KEY = 'orbit_theme_preference';

export type ThemeScheme = 'light' | 'dark';

interface ThemeColorSet {
  canvas: string;
  surface: string;
  'surface-subtle': string;
  'surface-raised': string;
  ink: string;
  'ink-muted': string;
  'ink-faint': string;
  line: string;
  'line-strong': string;
  accent: string;
  'accent-hover': string;
  'accent-foreground': string;
  'accent-soft': string;
  positive: string;
  'positive-soft': string;
  warning: string;
  'warning-soft': string;
  critical: string;
  'critical-soft': string;
}

/** Mirrors apps/web/app/globals.css's :root block exactly. */
const lightColors: ThemeColorSet = {
  canvas: '#f3f6f5',
  surface: '#fdfefd',
  'surface-subtle': '#eaf0ee',
  'surface-raised': '#ffffff',
  ink: '#17211f',
  'ink-muted': '#5d6c68',
  'ink-faint': '#667570',
  line: '#d8e0dd',
  'line-strong': '#bdcac6',
  accent: '#17647c',
  'accent-hover': '#0f5268',
  'accent-foreground': '#f8fcfd',
  'accent-soft': '#e1f0f4',
  positive: '#1c6b4c',
  'positive-soft': '#e2f2e9',
  warning: '#8a5a13',
  'warning-soft': '#f7ecd5',
  critical: '#a43c3c',
  'critical-soft': '#f7e5e3',
} as const;

/** Mirrors apps/web/app/globals.css's [data-theme="dark"] block exactly. */
const darkColors: ThemeColorSet = {
  canvas: '#0e131b',
  surface: '#151c26',
  'surface-subtle': '#1c2531',
  'surface-raised': '#202a37',
  ink: '#edf2f8',
  'ink-muted': '#aab5c3',
  'ink-faint': '#8d99a8',
  line: '#2a3543',
  'line-strong': '#3b4858',
  accent: '#70afff',
  'accent-hover': '#8abfff',
  'accent-foreground': '#0b1728',
  'accent-soft': '#182e4a',
  positive: '#73d0a1',
  'positive-soft': '#173529',
  warning: '#efbd67',
  'warning-soft': '#3a2c16',
  critical: '#f09a98',
  'critical-soft': '#412324',
} as const;

const THEME_COLORS: Record<ThemeScheme, ThemeColorSet> = { light: lightColors, dark: darkColors };

/** Plain hex values for the current scheme — for the handful of native props (tintColor, icon `color`) that can't read a CSS variable. */
export function themeColors(scheme: ThemeScheme): ThemeColorSet {
  return THEME_COLORS[scheme];
}

/** NativeWind `vars()` style object for the current scheme, applied on the app root so every `bg-canvas`-style className resolves through it. */
export function themeVars(scheme: ThemeScheme) {
  const colors = THEME_COLORS[scheme];
  return vars({
    '--color-canvas': colors.canvas,
    '--color-surface': colors.surface,
    '--color-surface-subtle': colors['surface-subtle'],
    '--color-surface-raised': colors['surface-raised'],
    '--color-ink': colors.ink,
    '--color-ink-muted': colors['ink-muted'],
    '--color-ink-faint': colors['ink-faint'],
    '--color-line': colors.line,
    '--color-line-strong': colors['line-strong'],
    '--color-accent': colors.accent,
    '--color-accent-hover': colors['accent-hover'],
    '--color-accent-foreground': colors['accent-foreground'],
    '--color-accent-soft': colors['accent-soft'],
    '--color-positive': colors.positive,
    '--color-positive-soft': colors['positive-soft'],
    '--color-warning': colors.warning,
    '--color-warning-soft': colors['warning-soft'],
    '--color-critical': colors.critical,
    '--color-critical-soft': colors['critical-soft'],
  });
}

/** Persisted preference — defaults to light (matches the app's existing look) when nothing's been chosen yet. */
export async function getStoredThemePreference(): Promise<ThemeScheme | null> {
  const value = await store.getItemAsync(THEME_PREFERENCE_KEY);
  return value === 'dark' || value === 'light' ? value : null;
}

export async function setStoredThemePreference(scheme: ThemeScheme): Promise<void> {
  await store.setItemAsync(THEME_PREFERENCE_KEY, scheme);
  colorScheme.set(scheme);
}

export const ThemeContext = createContext<{ scheme: ThemeScheme; setScheme: (scheme: ThemeScheme) => void } | null>(null);

export function useTheme(): { scheme: ThemeScheme; setScheme: (scheme: ThemeScheme) => void } {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeContext.Provider');
  return context;
}
