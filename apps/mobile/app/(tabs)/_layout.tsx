import { GasPumpIcon, ListIcon, SquaresFourIcon, TrendUpIcon, WalletIcon, type Icon } from 'phosphor-react-native';
import { Redirect, Tabs } from 'expo-router';
import { Pressable, type ColorValue, type GestureResponderEvent } from 'react-native';

import { useAuth } from '../../lib/auth-context';
import { haptics } from '../../lib/haptics';
import { themeColors, useTheme } from '../../lib/theme';

function tabIcon(IconComponent: Icon) {
  return ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <IconComponent color={color as string} size={size} weight={focused ? 'fill' : 'regular'} />
  );
}

/**
 * expo-router's Tabs doesn't expose a lower-effort hook for tab-press
 * feedback than overriding tabBarButton — this stays a plain Pressable
 * (not the underlying PlatformPressable RN Navigation uses internally,
 * which isn't exported) passing every prop through unchanged except
 * onPress, so layout/icon/label composition (owned by `children`) is
 * untouched and only the press ripple/opacity style differs slightly.
 */
function tabBarButton({
  onPress,
  ...rest
}: {
  onPress?: (e: GestureResponderEvent) => void;
} & Omit<React.ComponentProps<typeof Pressable>, 'onPress' | 'ref'>): React.JSX.Element {
  return (
    <Pressable
      {...rest}
      onPress={(event) => {
        haptics.tapLight();
        onPress?.(event);
      }}
    />
  );
}

export default function TabsLayout(): React.JSX.Element {
  const { isAuthenticated } = useAuth();
  const { scheme } = useTheme();
  const colors = themeColors(scheme);

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTintColor: colors.accent,
        headerTitleStyle: { fontFamily: 'Geist_600SemiBold' },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.surface },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors['ink-muted'],
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: 'Geist_500Medium', fontSize: 10 },
        tabBarButton,
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Přehled', tabBarIcon: tabIcon(SquaresFourIcon) }} />
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: tabIcon(TrendUpIcon) }} />
      <Tabs.Screen name="net-worth" options={{ title: 'Čisté jmění', tabBarIcon: tabIcon(WalletIcon) }} />
      <Tabs.Screen name="fuel" options={{ title: 'Palivo', tabBarIcon: tabIcon(GasPumpIcon) }} />
      <Tabs.Screen name="more" options={{ title: 'Více', headerShown: false, tabBarIcon: tabIcon(ListIcon) }} />
    </Tabs>
  );
}
