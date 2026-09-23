import { Link } from 'expo-router';
import {
  BankIcon,
  CarIcon,
  DownloadSimpleIcon,
  GasPumpIcon,
  GearSixIcon,
  PlanetIcon,
  SignOutIcon,
  TargetIcon,
  TrendUpIcon,
  UsersThreeIcon,
  type Icon,
} from 'phosphor-react-native';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { useAuth } from '../../../lib/auth-context';

interface MoreItem {
  href: string;
  label: string;
  icon: Icon;
}

// Same route→icon mapping as apps/web/lib/ui/nav-items.ts's SETTINGS array,
// plus the two PRIMARY items mobile also parks under "Více" (Portfolio,
// Import — mobile's bottom bar only has 4 real tabs + this menu, unlike
// web's 5-wide mobile bar).
const MORE_ITEMS: MoreItem[] = [
  { href: '/(tabs)/more/portfolio', label: 'Portfolio', icon: TrendUpIcon },
  { href: '/(tabs)/more/import', label: 'Import', icon: DownloadSimpleIcon },
  { href: '/(tabs)/more/fuel', label: 'Palivo', icon: GasPumpIcon },
  { href: '/(tabs)/more/insurance', label: 'Pojistky', icon: CarIcon },
  { href: '/(tabs)/more/planning', label: 'Plánování', icon: TargetIcon },
  { href: '/(tabs)/more/accounts', label: 'Účty', icon: BankIcon },
  { href: '/(tabs)/more/users', label: 'Domácnost', icon: UsersThreeIcon },
  { href: '/(tabs)/more/settings', label: 'Nastavení', icon: GearSixIcon },
];

export default function MoreMenuScreen(): React.JSX.Element {
  const { user, logout } = useAuth();

  function handleSignOutPress(): void {
    // Matches web's ConfirmDialog gate on sign-out (app-shell.tsx) — same
    // behavior, native Alert instead of a custom dialog component since
    // this is a one-off confirm, not worth a reusable component yet.
    Alert.alert('Odhlásit se?', 'Opravdu se chcete odhlásit?', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Odhlásit se', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4">
      <View className="mb-6 flex-row items-center gap-3 px-2">
        <View className="size-9 items-center justify-center rounded-xl bg-accent">
          <PlanetIcon color="#f8fcfd" size={21} weight="fill" />
        </View>
        <Text className="font-sans-semibold text-lg text-ink">Orbit</Text>
      </View>

      <View className="overflow-hidden rounded-lg border border-line bg-surface">
        {MORE_ITEMS.map((item, index) => (
          <Link key={item.href} href={item.href} asChild>
            <Pressable
              className={`flex-row items-center gap-3 px-3 py-3 active:bg-surface-subtle ${
                index < MORE_ITEMS.length - 1 ? 'border-b border-line' : ''
              }`}
            >
              <item.icon color="#5d6c68" size={19} weight="regular" />
              <Text className="font-sans-medium text-sm text-ink-muted">{item.label}</Text>
            </Pressable>
          </Link>
        ))}
      </View>

      <View className="mt-6 border-t border-line pt-4">
        {user?.email ? <Text className="mb-2 truncate px-3 text-xs text-ink-muted">{user.email}</Text> : null}
        <Pressable onPress={handleSignOutPress} className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-surface-subtle">
          <SignOutIcon color="#5d6c68" size={18} weight="regular" />
          <Text className="font-sans-medium text-sm text-ink-muted">Odhlásit se</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
