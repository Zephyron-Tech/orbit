/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './hooks/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // React Native doesn't apply font-weight to a custom (non-variable)
      // font the way the web does — each weight is its own registered font
      // family (see app/_layout.tsx's useFonts call), so weight utilities
      // have to switch fontFamily, not font-weight. `font-sans` is the
      // default body weight; the others are used explicitly wherever web
      // uses font-medium/font-semibold/font-bold.
      fontFamily: {
        sans: ['Geist_400Regular'],
        'sans-medium': ['Geist_500Medium'],
        'sans-semibold': ['Geist_600SemiBold'],
        'sans-bold': ['Geist_700Bold'],
      },
      // Each color resolves through a CSS custom property instead of a
      // static hex value — lib/theme.ts's ThemeProvider sets the actual
      // hex per token via NativeWind's vars() on the app root, swapping
      // the whole set when the color scheme changes. Names/values mirror
      // apps/web/app/globals.css's :root / [data-theme="dark"] blocks
      // exactly, so light-mode here still matches what it always did.
      colors: {
        canvas: 'var(--color-canvas)',
        surface: 'var(--color-surface)',
        'surface-subtle': 'var(--color-surface-subtle)',
        'surface-raised': 'var(--color-surface-raised)',
        ink: 'var(--color-ink)',
        'ink-muted': 'var(--color-ink-muted)',
        'ink-faint': 'var(--color-ink-faint)',
        line: 'var(--color-line)',
        'line-strong': 'var(--color-line-strong)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-foreground': 'var(--color-accent-foreground)',
        'accent-soft': 'var(--color-accent-soft)',
        positive: 'var(--color-positive)',
        'positive-soft': 'var(--color-positive-soft)',
        warning: 'var(--color-warning)',
        'warning-soft': 'var(--color-warning-soft)',
        critical: 'var(--color-critical)',
        'critical-soft': 'var(--color-critical-soft)',
      },
    },
  },
  plugins: [],
};
