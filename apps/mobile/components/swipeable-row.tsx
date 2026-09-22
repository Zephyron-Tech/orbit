import type { Icon } from 'phosphor-react-native';
import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { haptics } from '../lib/haptics';

const ACTION_WIDTH = 88;

function Action({
  label,
  icon: IconComponent,
  tone,
  progress,
  onPress,
}: {
  label: string;
  icon: Icon;
  tone: 'critical' | 'accent';
  progress: SharedValue<number>;
  onPress: () => void;
}): React.JSX.Element {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - progress.value) * ACTION_WIDTH }] }));
  const bg = tone === 'critical' ? '#a43c3c' : '#17647c';

  return (
    <Animated.View style={[{ width: ACTION_WIDTH }, style]}>
      <Pressable onPress={onPress} className="flex-1 items-center justify-center gap-1" style={{ backgroundColor: bg }}>
        <IconComponent color="#ffffff" size={18} weight="regular" />
        <Text className="text-xs font-sans-medium text-white">{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * iOS-native swipe-to-act row: swipe left reveals a single action button.
 * Wraps react-native-gesture-handler's Reanimated Swipeable so it works
 * alongside the rest of the app's reanimated-based animations.
 */
export function SwipeableRow({
  children,
  actionLabel,
  actionIcon,
  actionTone = 'critical',
  onAction,
}: {
  children: React.ReactNode;
  actionLabel: string;
  actionIcon: Icon;
  actionTone?: 'critical' | 'accent';
  onAction: () => void;
}): React.JSX.Element {
  const ref = useRef<SwipeableMethods>(null);

  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableWillOpen={() => haptics.tapLight()}
      renderRightActions={(progress) => (
        <Action
          label={actionLabel}
          icon={actionIcon}
          tone={actionTone}
          progress={progress}
          onPress={() => {
            ref.current?.close();
            onAction();
          }}
        />
      )}
    >
      <View className="bg-surface">{children}</View>
    </Swipeable>
  );
}
