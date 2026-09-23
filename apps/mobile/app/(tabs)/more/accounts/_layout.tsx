import { Stack } from 'expo-router';

import { headerOptions } from '../../../../lib/navigation-theme';
import { useTheme } from '../../../../lib/theme';

/** Stack within the accounts area — list drills into a single account's detail/edit screen. */
export default function AccountsLayout(): React.JSX.Element {
  const { scheme } = useTheme();
  return (
    <Stack screenOptions={headerOptions(scheme)}>
      <Stack.Screen name="index" options={{ title: 'Účty' }} />
      <Stack.Screen name="[id]" options={{ title: 'Účet' }} />
      <Stack.Screen name="credit-repayment" options={{ title: 'Splacení kreditky' }} />
    </Stack>
  );
}
