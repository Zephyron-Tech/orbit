import { Stack } from 'expo-router';

import { headerOptions } from '../../../../lib/navigation-theme';
import { useTheme } from '../../../../lib/theme';

/** Stack within the insurance area — list drills into a single policy's detail/edit screen. */
export default function InsuranceLayout(): React.JSX.Element {
  const { scheme } = useTheme();
  return (
    <Stack screenOptions={headerOptions(scheme)}>
      <Stack.Screen name="index" options={{ title: 'Pojistky' }} />
      <Stack.Screen name="[id]" options={{ title: 'Pojistka' }} />
    </Stack>
  );
}
