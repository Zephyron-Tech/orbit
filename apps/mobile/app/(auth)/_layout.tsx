import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../lib/auth-context';

/** Unauthenticated-only stack — bounces to the tabs if a session already exists. */
export default function AuthLayout(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/dashboard" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
