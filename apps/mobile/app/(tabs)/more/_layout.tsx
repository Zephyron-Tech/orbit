import { Stack } from 'expo-router';

/** Stack navigator for everything behind the "Více" tab. */
export default function MoreLayout(): React.JSX.Element {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Více' }} />
      <Stack.Screen name="portfolio" options={{ title: 'Portfolio' }} />
      <Stack.Screen name="import" options={{ title: 'Import' }} />
      <Stack.Screen name="fuel" options={{ title: 'Palivo' }} />
      <Stack.Screen name="insurance" options={{ title: 'Pojistky' }} />
      <Stack.Screen name="planning" options={{ title: 'Plánování' }} />
      <Stack.Screen name="accounts" options={{ title: 'Účty' }} />
      <Stack.Screen name="users" options={{ title: 'Domácnost' }} />
      <Stack.Screen name="settings" options={{ title: 'Nastavení' }} />
    </Stack>
  );
}
