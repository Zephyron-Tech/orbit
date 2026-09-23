import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../lib/auth-context';
import { colors } from '../lib/colors';

/** Entry redirect — waits for the cold-start check, then routes to the right stack. */
export default function Index(): React.JSX.Element {
  const { isAuthenticated, locked } = useAuth();

  if (locked) {
    return <Redirect href="/(auth)/unlock" />;
  }

  if (isAuthenticated === null) {
    // Rarely paints on a real device — the native splash screen
    // (app/_layout.tsx's SplashGate) covers this window until bootstrap
    // settles. Kept as a true fallback, accent-colored for consistency.
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? '/(tabs)/dashboard' : '/(auth)/login'} />;
}
