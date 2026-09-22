import { Stack } from 'expo-router';

import { headerOptions } from '../../../lib/navigation-theme';

/** Stack within the Transactions tab — list drills into a single transaction's edit/split screen. */
export default function TransactionsLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={headerOptions}>
      <Stack.Screen name="index" options={{ title: 'Transakce' }} />
      <Stack.Screen name="[id]" options={{ title: 'Transakce' }} />
      <Stack.Screen name="categories" options={{ title: 'Kategorie' }} />
    </Stack>
  );
}
