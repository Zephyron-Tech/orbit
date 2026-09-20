import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen(): React.JSX.Element {
  return (
    <>
      <Stack.Screen options={{ title: 'Stránka nenalezena' }} />
      <View className="flex-1 items-center justify-center gap-3 bg-white px-6">
        <Text className="text-lg font-semibold text-neutral-900">Tato obrazovka neexistuje.</Text>
        <Link href="/" className="text-base text-blue-600">
          Zpět na přehled
        </Link>
      </View>
    </>
  );
}
