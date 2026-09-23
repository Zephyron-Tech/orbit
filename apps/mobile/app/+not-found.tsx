import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';

export default function NotFoundScreen(): React.JSX.Element {
  return (
    <>
      <Stack.Screen options={{ title: 'Stránka nenalezena' }} />
      <View className="flex-1 items-center justify-center gap-3 bg-canvas px-6">
        <Text className="font-sans-semibold text-lg text-ink">Tato obrazovka neexistuje.</Text>
        <Link href="/" className="text-base text-accent">
          Zpět na přehled
        </Link>
      </View>
    </>
  );
}
