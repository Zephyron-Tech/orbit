import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, useFonts } from '@expo-google-fonts/geist';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { colors } from '../lib/colors';
import { queryClient } from '../lib/query-client';
import { getStoredThemePreference, setStoredThemePreference, ThemeContext, themeVars, type ThemeScheme } from '../lib/theme';

/**
 * Owns the live color scheme: loads the persisted preference once on mount
 * (defaulting to light, the app's existing look, while nothing's been
 * chosen yet), applies it as NativeWind vars() on the root view so every
 * `bg-canvas`-style className resolves through it, and exposes a setter via
 * ThemeContext for the settings toggle.
 */
function ThemeRoot({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [scheme, setSchemeState] = useState<ThemeScheme>('light');

  useEffect(() => {
    void getStoredThemePreference().then((stored) => {
      if (stored) setSchemeState(stored);
    });
  }, []);

  function setScheme(next: ThemeScheme): void {
    setSchemeState(next);
    void setStoredThemePreference(next);
  }

  return (
    <ThemeContext.Provider value={{ scheme, setScheme }}>
      <View style={[{ flex: 1 }, themeVars(scheme)]}>
        {children}
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </View>
    </ThemeContext.Provider>
  );
}

// Held until fonts are loaded AND the auth cold-start bootstrap has
// settled, so cold launch is one continuous native-branded hold instead
// of the bare-spinner flicker that used to show between the two.
void SplashScreen.preventAutoHideAsync();

/** Lives inside AuthProvider so it can read `bootstrapped` and release the native splash screen exactly once, when it's actually safe to. */
function SplashGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { bootstrapped } = useAuth();

  useEffect(() => {
    if (bootstrapped) void SplashScreen.hideAsync();
  }, [bootstrapped]);

  return <>{children}</>;
}

export default function RootLayout(): React.JSX.Element {
  // Matches web's Geist font (apps/web/app/layout.tsx, loaded via
  // next/font/google).
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  if (!fontsLoaded) {
    // Still covered by the native splash screen (preventAutoHideAsync above)
    // on a real device — this fallback view only matters on the Expo web
    // target, which has no native splash to hold.
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeRoot>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <SplashGate>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="+not-found" />
                </Stack>
              </SplashGate>
            </AuthProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </ThemeRoot>
    </GestureHandlerRootView>
  );
}
