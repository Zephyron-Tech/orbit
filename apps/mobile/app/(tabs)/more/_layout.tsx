import { Stack } from 'expo-router';

import { headerOptions } from '../../../lib/navigation-theme';
import { useTheme } from '../../../lib/theme';

/** Stack navigator for everything behind the "Více" tab. */
export default function MoreLayout(): React.JSX.Element {
  const { scheme } = useTheme();
  return (
    <Stack screenOptions={headerOptions(scheme)}>
      <Stack.Screen name="index" options={{ title: 'Více' }} />
      <Stack.Screen name="import" options={{ title: 'Import' }} />
      {/* insurance/, accounts/, and transactions/ are their own nested Stack
          (list -> detail), each with its own header — hide this outer
          layout's header for them so the screen doesn't show two stacked
          headers. */}
      <Stack.Screen name="insurance" options={{ headerShown: false }} />
      <Stack.Screen name="planning" options={{ title: 'Plánování' }} />
      <Stack.Screen name="accounts" options={{ headerShown: false }} />
      <Stack.Screen name="transactions" options={{ headerShown: false }} />
      <Stack.Screen name="settlement" options={{ title: 'Vyrovnání' }} />
      <Stack.Screen name="users" options={{ title: 'Domácnost' }} />
      <Stack.Screen name="settings" options={{ title: 'Nastavení' }} />
      <Stack.Screen name="notifications" options={{ title: 'Push notifikace' }} />
      <Stack.Screen name="notification-log" options={{ title: 'Oznámení' }} />
    </Stack>
  );
}
