import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

/** A single pulsing placeholder block — the shimmer primitive every skeleton layout below is built from. */
export function Skeleton({ className, style }: { className?: string; style?: object }): React.JSX.Element {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View className={`rounded-md bg-line ${className ?? ''}`} style={[animatedStyle, style]} />;
}

/** Icon-square + two text lines, matching the app's common list-row shape. */
export function SkeletonRow(): React.JSX.Element {
  return (
    <View className="flex-row items-center gap-3 border-b border-line bg-surface px-4 py-3">
      <Skeleton className="size-10 rounded-xl" />
      <View className="flex-1 gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </View>
    </View>
  );
}

/** A stack of SkeletonRow — the default loading state for list screens (transactions, accounts, insurance, users, imports…). */
export function ListSkeleton({ rows = 6 }: { rows?: number }): React.JSX.Element {
  return (
    <View>
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
}

/** A bordered card with a heading line and a big value line, matching hero/metric cards (dashboard, net-worth, portfolio, settlement). */
export function SkeletonCard(): React.JSX.Element {
  return (
    <View className="gap-3 rounded-lg border border-line bg-surface p-5">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </View>
  );
}

/** A short label + input-shaped block, for form screens (account/insurance/transaction detail, settings). */
export function SkeletonField(): React.JSX.Element {
  return (
    <View className="gap-2">
      <Skeleton className="h-3 w-1/4" />
      <Skeleton className="h-11 w-full rounded-lg" />
    </View>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }): React.JSX.Element {
  return (
    <View className="gap-4 p-4">
      {Array.from({ length: fields }, (_, index) => (
        <SkeletonField key={index} />
      ))}
    </View>
  );
}
