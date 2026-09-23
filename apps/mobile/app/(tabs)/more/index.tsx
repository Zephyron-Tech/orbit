import { Link } from 'expo-router';
import {
  BankIcon,
  CarIcon,
  CaretRightIcon,
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
import { Alert, ScrollView, Text, View } from 'react-native';

import { Pressable } from '../../../components/pressable';
import { useAuth } from '../../../lib/auth-context';
import { colors } from '../../../lib/colors';

interface MoreItem {
  href: string;
  label: string;
  description: string;
  icon: Icon;
}

// Same route→icon mapping as apps/web/lib/ui/nav-items.ts's SETTINGS array,
// plus the two PRIMARY items mobile also parks under "Více" (Portfolio,
// Import — mobile's bottom bar only has 4 real tabs + this menu, unlike
// web's 5-wide mobile bar).
const MORE_ITEMS: MoreItem[] = [
  { href: '/(tabs)/more/portfolio', label: 'Portfolio', description: 'Investiční pozice a vývoj hodnoty', icon: TrendUpIcon },
  { href: '/(tabs)/more/import', label: 'Import', description: 'Nahrání výpisů a transakcí', icon: DownloadSimpleIcon },
  { href: '/(tabs)/more/fuel', label: 'Palivo', description: 'Spotřeba a tankování vozidel', icon: GasPumpIcon },
  { href: '/(tabs)/more/insurance', label: 'Pojistky', description: 'Přehled aktivních pojistek', icon: CarIcon },
  { href: '/(tabs)/more/planning', label: 'Plánování', description: 'Cíle a finanční plán', icon: TargetIcon },
  { href: '/(tabs)/more/accounts', label: 'Účty', description: 'Bankovní a investiční účty', icon: BankIcon },
  { href: '/(tabs)/more/users', label: 'Domácnost', description: 'Členové a sdílený rozpočet', icon: UsersThreeIcon },
  { href: '/(tabs)/more/settings', label: 'Nastavení', description: 'Účet, zabezpečení, preference', icon: GearSixIcon },
];

function MoreListItem({ item }: { item: MoreItem }): React.JSX.Element {
  return (
    <Link href={item.href} asChild>
      <Pressable
        accessibilityLabel={item.label}
        className="flex-row items-center gap-3 rounded-xl border border-line bg-surface p-4 active:bg-surface-subtle"
      >
        <View className="size-12 items-center justify-center rounded-xl bg-accent-soft">
          <item.icon color={colors.accent} size={22} weight="regular" />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-base text-ink">{item.label}</Text>
          <Text className="mt-0.5 text-sm text-ink-muted" numberOfLines={1}>
            {item.description}
          </Text>
        </View>
        <CaretRightIcon color={colors.inkFaint} size={18} weight="regular" />
      </Pressable>
    </Link>
  );
}

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
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="pb-8">
      <View className="mx-4 mb-6 mt-4 gap-1">
        <View className="flex-row items-center gap-3">
          <View className="size-11 items-center justify-center rounded-xl bg-accent">
            <PlanetIcon color={colors.accentForeground} size={24} weight="fill" />
          </View>
          <Text className="font-sans-semibold text-xl text-ink">Orbit</Text>
        </View>
        <Text className="text-sm text-ink-muted">Rychlý přístup ke všem sekcím</Text>
      </View>

      <View className="mx-4 gap-3">
        {MORE_ITEMS.map((item) => (
          <MoreListItem key={item.href} item={item} />
        ))}
      </View>

      <View className="mx-4 mt-6 gap-2 border-t border-line pt-4">
        {user?.email ? <Text className="truncate px-1 text-xs text-ink-muted">{user.email}</Text> : null}
        <Pressable
          accessibilityLabel="Odhlásit se"
          onPress={handleSignOutPress}
          className="flex-row items-center gap-3 rounded-xl border border-line bg-surface p-4 active:bg-surface-subtle"
        >
          <View className="size-12 items-center justify-center rounded-xl bg-critical-soft">
            <SignOutIcon color={colors.critical} size={20} weight="regular" />
          </View>
          <Text className="font-sans-medium text-base text-ink">Odhlásit se</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
