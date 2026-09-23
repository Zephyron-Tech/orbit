import { colors } from './colors';

/**
 * Base screenOptions for a nested Stack navigator's headers. Every stack
 * under app/(tabs)/ was previously left on RN Navigation's unstyled
 * default (only `title`/`headerShown` were ever set) — this brings headers
 * in line with the deliberately-styled tab bar (see app/(tabs)/_layout.tsx).
 * Not typed against expo-router's internal NativeStackNavigationOptions
 * (no stable public export for it) — structurally matches what
 * Stack's screenOptions prop expects, verified against
 * node_modules/expo-router/build/react-navigation/native-stack/types.d.ts.
 */
export const headerOptions = {
  headerTintColor: colors.accent,
  headerTitleStyle: { fontFamily: 'Geist_600SemiBold' },
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.surface },
  animation: 'default',
} as const;
