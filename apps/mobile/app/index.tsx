import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../lib/auth-context';

/** Entry redirect — waits for the cold-start check, then routes to the right stack. */
export default function Index(): React.JSX.Element {
  const { isAuthenticated, locked } = useAuth();

  if (locked) {
    return <Redirect href="/(auth)/unlock" />;
  }

  if (isAuthenticated === null) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? '/(tabs)/dashboard' : '/(auth)/login'} />;
}
