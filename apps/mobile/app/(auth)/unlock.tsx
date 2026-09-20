import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth-context';

/**
 * Shown instead of the password form when a stored session exists and the
 * user has opted into biometric lock (see lib/auth-context.tsx's `locked`
 * state). Triggers Face ID / Touch ID automatically on mount so the common
 * case — open the app, glance, unlock — never needs a tap.
 */
export default function UnlockScreen(): React.JSX.Element {
  const router = useRouter();
  const { unlockWithBiometrics, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedOnMount = useRef(false);

  async function attemptUnlock(): Promise<void> {
    setPending(true);
    setError(null);

    const result = await unlockWithBiometrics();

    if (!result.ok && result.error) {
      setError(result.error);
    }

    setPending(false);
  }

  useEffect(() => {
    if (attemptedOnMount.current) return;
    attemptedOnMount.current = true;
    void attemptUnlock();
  }, []);

  async function handleUsePasswordInstead(): Promise<void> {
    await logout();
    router.replace('/(auth)/login');
  }

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-white px-6">
      <Text className="text-2xl font-semibold text-neutral-900">Orbit</Text>
      <Text className="text-base text-neutral-500">Appka je uzamčená</Text>

      {error ? <Text className="text-sm text-red-600">{error}</Text> : null}

      <Pressable
        onPress={() => void attemptUnlock()}
        disabled={pending}
        className="w-full items-center rounded-lg bg-neutral-900 py-3"
      >
        {pending ? <ActivityIndicator color="#fff" /> : <Text className="font-medium text-white">Odemknout Face ID / Touch ID</Text>}
      </Pressable>

      <Pressable onPress={() => void handleUsePasswordInstead()} disabled={pending}>
        <Text className="text-sm text-neutral-500 underline">Přihlásit se heslem místo toho</Text>
      </Pressable>
    </View>
  );
}
