import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '../../../lib/auth-context';

const MORE_ITEMS: { href: string; label: string }[] = [
  { href: '/(tabs)/more/portfolio', label: 'Portfolio' },
  { href: '/(tabs)/more/import', label: 'Import' },
  { href: '/(tabs)/more/fuel', label: 'Palivo' },
  { href: '/(tabs)/more/insurance', label: 'Pojistky' },
  { href: '/(tabs)/more/planning', label: 'Plánování' },
  { href: '/(tabs)/more/accounts', label: 'Účty' },
  { href: '/(tabs)/more/users', label: 'Domácnost' },
  { href: '/(tabs)/more/settings', label: 'Nastavení' },
];

export default function MoreMenuScreen(): React.JSX.Element {
  const { logout } = useAuth();

  return (
    <View className="flex-1 bg-white">
      {MORE_ITEMS.map((item) => (
        <Link key={item.href} href={item.href} asChild>
          <Pressable className="border-b border-neutral-100 px-4 py-4">
            <Text className="text-base text-neutral-900">{item.label}</Text>
          </Pressable>
        </Link>
      ))}
      <Pressable onPress={() => void logout()} className="mt-4 px-4 py-4">
        <Text className="text-base text-red-600">Odhlásit se</Text>
      </Pressable>
    </View>
  );
}
