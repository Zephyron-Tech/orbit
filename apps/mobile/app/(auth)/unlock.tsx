import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/button';
import { haptics } from '../../lib/haptics';
import { useAuth } from '../../lib/auth-context';

const BRAND_FADE_MS = 450;

/**
 * Shown instead of the password form when a stored session exists and the
 * user has opted into biometric lock (see lib/auth-context.tsx's `locked`
 * state). The automatic first attempt is delayed until the Orbit wordmark
 * has faded in — firing Face ID immediately on mount left no readable
 * branded moment before the system sheet took over.
 */
export default function UnlockScreen(): React.JSX.Element {
  const router = useRouter();
  const { unlockWithBiometrics, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedOnMount = useRef(false);
  const brandOpacity = useSharedValue(0);

  const brandStyle = useAnimatedStyle(() => ({
    opacity: brandOpacity.value,
    transform: [{ scale: 0.96 + brandOpacity.value * 0.04 }],
  }));

  async function attemptUnlock(): Promise<void> {
    setPending(true);
    setError(null);

    const result = await unlockWithBiometrics();

    if (!result.ok && result.error) {
      haptics.notifyError();
      setError(result.error);
    }

    setPending(false);
  }

  useEffect(() => {
    brandOpacity.value = withTiming(1, { duration: BRAND_FADE_MS });

    if (attemptedOnMount.current) return;
    attemptedOnMount.current = true;
    const timer = setTimeout(() => void attemptUnlock(), BRAND_FADE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUsePasswordInstead(): Promise<void> {
    haptics.tapLight();
    await logout();
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas">
    <View className="flex-1 items-center justify-center gap-6 bg-canvas px-6">
      <Animated.View style={brandStyle} className="items-center gap-2">
        <Image source={require('../../assets/icon.png')} className="size-14 rounded-2xl" />
        <Text className="mt-2 text-2xl font-sans-semibold text-ink">Orbit</Text>
        <Text className="text-base text-ink-muted">Appka je uzamčená</Text>
      </Animated.View>

      {error ? <Text className="text-sm text-critical">{error}</Text> : null}

      <Button variant="primary" loading={pending} onPress={() => void attemptUnlock()} className="w-full">
        Odemknout Face ID / Touch ID
      </Button>

      <Pressable onPress={() => void handleUsePasswordInstead()} disabled={pending} hitSlop={8}>
        <Text className="text-sm text-ink-muted underline">Přihlásit se heslem místo toho</Text>
      </Pressable>
    </View>
    </SafeAreaView>
  );
}
