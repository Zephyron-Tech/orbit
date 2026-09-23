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
      // Mirrors apps/web/app/globals.css's CSS custom properties (light
      // mode values only for now — dark mode exists on web via
      // data-theme="dark" but has no mobile toggle yet, so these are the
      // unprefixed defaults; dark: variants get added once a real toggle
      // is planned, not before).
      colors: {
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
      },
    },
  },
  plugins: [],
};
