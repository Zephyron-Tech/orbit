import { Stack } from 'expo-router';

/** Stack navigator for everything behind the "Více" tab. */
export default function MoreLayout(): React.JSX.Element {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Více' }} />
      <Stack.Screen name="portfolio" options={{ title: 'Portfolio' }} />
      <Stack.Screen name="import" options={{ title: 'Import' }} />
      <Stack.Screen name="fuel" options={{ title: 'Palivo' }} />
      {/* insurance/ and accounts/ are their own nested Stack (list -> detail),
          each with its own header — hide this outer layout's header for them
          so the screen doesn't show two stacked headers. */}
      <Stack.Screen name="insurance" options={{ headerShown: false }} />
      <Stack.Screen name="planning" options={{ title: 'Plánování' }} />
      <Stack.Screen name="accounts" options={{ headerShown: false }} />
      <Stack.Screen name="users" options={{ title: 'Domácnost' }} />
      <Stack.Screen name="settings" options={{ title: 'Nastavení' }} />
    </Stack>
  );
}
