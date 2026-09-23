import { Stack } from 'expo-router';

import { headerOptions } from '../../../../lib/navigation-theme';

/** Stack within the insurance area — list drills into a single policy's detail/edit screen. */
export default function InsuranceLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={headerOptions}>
      <Stack.Screen name="index" options={{ title: 'Pojistky' }} />
      <Stack.Screen name="[id]" options={{ title: 'Pojistka' }} />
    </Stack>
  );
}
