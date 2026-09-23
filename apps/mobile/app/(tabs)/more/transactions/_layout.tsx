import { Stack } from 'expo-router';

import { headerOptions } from '../../../../lib/navigation-theme';
import { useTheme } from '../../../../lib/theme';

/** Stack within the Transactions tab — list drills into a single transaction's edit/split screen. */
export default function TransactionsLayout(): React.JSX.Element {
  const { scheme } = useTheme();
  return (
    <Stack screenOptions={headerOptions(scheme)}>
      <Stack.Screen name="index" options={{ title: 'Transakce' }} />
      <Stack.Screen name="[id]" options={{ title: 'Transakce' }} />
      <Stack.Screen name="categories" options={{ title: 'Kategorie' }} />
    </Stack>
  );
}
