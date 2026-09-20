import { Stack } from 'expo-router';

/** Stack within the accounts area — list drills into a single account's detail/edit screen. */
export default function AccountsLayout(): React.JSX.Element {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Účty' }} />
      <Stack.Screen name="[id]" options={{ title: 'Účet' }} />
    </Stack>
  );
}
