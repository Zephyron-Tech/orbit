import { Redirect, Tabs } from 'expo-router';

import { useAuth } from '../../lib/auth-context';

/**
 * Bottom tab bar — 5 tabs chosen by realistic usage frequency for this
 * couple's finance hub (see the plan file's navigation-split reasoning),
 * not a 1:1 mirror of web's flat 12-item sidebar. The remaining 8 resource
 * areas live behind the "Více" (More) tab.
 *
 * No icon library is wired up yet (no @expo/vector-icons/phosphor-icons
 * dependency exists in this app yet) — text-only labels for now.
 */
export default function TabsLayout(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Přehled' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transakce', headerShown: false }} />
      <Tabs.Screen name="net-worth" options={{ title: 'Čisté jmění' }} />
      <Tabs.Screen name="settlement" options={{ title: 'Vyrovnání' }} />
      <Tabs.Screen name="more" options={{ title: 'Více', headerShown: false }} />
    </Tabs>
  );
}
