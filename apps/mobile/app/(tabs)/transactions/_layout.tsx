import { Stack } from 'expo-router';

/** Stack within the Transactions tab — list drills into a single transaction's edit/split screen. */
export default function TransactionsLayout(): React.JSX.Element {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Transakce' }} />
      <Stack.Screen name="[id]" options={{ title: 'Transakce' }} />
      <Stack.Screen name="categories" options={{ title: 'Kategorie' }} />
    </Stack>
  );
}
