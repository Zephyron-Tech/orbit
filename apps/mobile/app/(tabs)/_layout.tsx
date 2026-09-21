import { HandshakeIcon, ListIcon, ReceiptIcon, SquaresFourIcon, WalletIcon, type Icon } from 'phosphor-react-native';
import { Redirect, Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { useAuth } from '../../lib/auth-context';

// Same accent/ink-muted colors as apps/web/app/globals.css's --accent /
// --ink-muted tokens (also in tailwind.config.js as the `accent`/`ink-muted`
// classes) — React Navigation's tab bar options don't accept className, so
// the hex values are duplicated here rather than resolved from NativeWind.
const ACCENT = '#17647c';
const INK_MUTED = '#5d6c68';
const SURFACE = '#fdfefd';
const LINE = '#d8e0dd';

function tabIcon(IconComponent: Icon) {
  return ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <IconComponent color={color as string} size={size} weight={focused ? 'fill' : 'regular'} />
  );
}

export default function TabsLayout(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: INK_MUTED,
        tabBarStyle: { backgroundColor: SURFACE, borderTopColor: LINE },
        tabBarLabelStyle: { fontFamily: 'Geist_500Medium', fontSize: 10 },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Přehled', tabBarIcon: tabIcon(SquaresFourIcon) }} />
      <Tabs.Screen name="transactions" options={{ title: 'Transakce', headerShown: false, tabBarIcon: tabIcon(ReceiptIcon) }} />
      <Tabs.Screen name="net-worth" options={{ title: 'Čisté jmění', tabBarIcon: tabIcon(WalletIcon) }} />
      <Tabs.Screen name="settlement" options={{ title: 'Vyrovnání', tabBarIcon: tabIcon(HandshakeIcon) }} />
      <Tabs.Screen name="more" options={{ title: 'Více', headerShown: false, tabBarIcon: tabIcon(ListIcon) }} />
    </Tabs>
  );
}
