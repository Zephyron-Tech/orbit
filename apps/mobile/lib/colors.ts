/**
 * Mirrors tailwind.config.js's `colors` block. Some React Native component
 * props (RefreshControl's tintColor, ActivityIndicator's color, Tabs'
 * screenOptions) don't accept a className, so those call sites need the raw
 * hex value — this is the one place it's duplicated from instead of being
 * inlined ad hoc per file.
 */
export const colors = {
  canvas: '#f3f6f5',
  surface: '#fdfefd',
  surfaceSubtle: '#eaf0ee',
  surfaceRaised: '#ffffff',
  ink: '#17211f',
  inkMuted: '#5d6c68',
  inkFaint: '#667570',
  line: '#d8e0dd',
  lineStrong: '#bdcac6',
  accent: '#17647c',
  accentHover: '#0f5268',
  accentForeground: '#f8fcfd',
  accentSoft: '#e1f0f4',
  positive: '#1c6b4c',
  positiveSoft: '#e2f2e9',
  warning: '#8a5a13',
  warningSoft: '#f7ecd5',
  critical: '#a43c3c',
  criticalSoft: '#f7e5e3',
} as const;
