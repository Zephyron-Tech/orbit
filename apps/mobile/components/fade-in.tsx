import type { ViewProps } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

const FADE_MS = 400;

/**
 * Screen-level entrance fade for first-paint content (hero cards on
 * dashboard/net-worth/settlement) — same duration convention as
 * app/(auth)/unlock.tsx's brand fade-in, extracted into a reusable
 * primitive instead of hand-rolling useAnimatedStyle per screen.
 */
export function FadeInView({ delay = 0, children, ...rest }: { delay?: number } & ViewProps): React.JSX.Element {
  return (
    <Animated.View entering={FadeIn.duration(FADE_MS).delay(delay)} {...rest}>
      {children}
    </Animated.View>
  );
}
