import { Pressable as RNPressable, type PressableProps } from 'react-native';

import { haptics } from '../lib/haptics';

/**
 * Drop-in replacement for RN's Pressable for icon-only or unstyled touch
 * targets that don't go through the visual `Button` component — fires a
 * light haptic on press by default and requires an accessibilityLabel,
 * since this wrapper exists specifically to fix icon-only controls that
 * had neither.
 */
export function Pressable({
  onPress,
  haptic = true,
  accessibilityLabel,
  ...rest
}: {
  haptic?: boolean;
  accessibilityLabel: string;
} & PressableProps): React.JSX.Element {
  return (
    <RNPressable
      accessibilityLabel={accessibilityLabel}
      onPress={(event) => {
        if (haptic) haptics.tapLight();
        onPress?.(event);
      }}
      {...rest}
    />
  );
}
