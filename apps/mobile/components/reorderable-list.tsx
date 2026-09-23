import { DotsSixVerticalIcon } from 'phosphor-react-native';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { haptics } from '../lib/haptics';

function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

/**
 * A single draggable row. `positions` is shared across the whole list
 * (index -> current visual slot), so every row re-reads it on every frame
 * of every other row's drag and animates out of the way. `onDragEnd` fires
 * once, on release, with the origin index and the slot it was dropped in.
 */
function DraggableRow<T>({
  item,
  index,
  positions,
  rowCount,
  rowHeight,
  renderItem,
  onDragEnd,
}: {
  item: T;
  index: number;
  positions: SharedValue<number[]>;
  rowCount: number;
  rowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onDragEnd: (from: number, to: number) => void;
}): React.JSX.Element {
  const dragging = useSharedValue(false);
  const translateY = useSharedValue(0);
  const startSlot = useSharedValue(0);

  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      dragging.value = true;
      startSlot.value = positions.value[index] ?? index;
      runOnJS(haptics.tapMedium)();
    })
    .onUpdate((event) => {
      translateY.value = event.translationY;
      const proposedSlot = clamp(Math.round(startSlot.value + event.translationY / rowHeight), 0, rowCount - 1);
      const currentSlot = positions.value[index] ?? index;
      if (proposedSlot === currentSlot) return;

      // Shift whichever rows sit between the old and new slot by one, so
      // the dragged row always has somewhere to land.
      const next = [...positions.value];
      const movingUp = proposedSlot < currentSlot;
      for (let i = 0; i < next.length; i += 1) {
        if (i === index) continue;
        if (movingUp && next[i] >= proposedSlot && next[i] < currentSlot) next[i] += 1;
        else if (!movingUp && next[i] <= proposedSlot && next[i] > currentSlot) next[i] -= 1;
      }
      next[index] = proposedSlot;
      positions.value = next;
    })
    .onEnd(() => {
      const from = index;
      const to = positions.value[index] ?? index;
      dragging.value = false;
      translateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
      if (from !== to) runOnJS(onDragEnd)(from, to);
    });

  const style = useAnimatedStyle(() => {
    if (dragging.value) {
      // Follow the finger 1:1 from wherever the drag started — reading
      // positions.value[index] here instead would double-count the row's
      // own slot updates (set in onUpdate as it crosses each boundary) on
      // top of translateY, making the dragged row itself jump in
      // row-height increments while it's also being dragged continuously.
      const restingAtStart = (startSlot.value - index) * rowHeight;
      return {
        transform: [{ translateY: restingAtStart + translateY.value }],
        zIndex: 10,
        opacity: 0.97,
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      };
    }
    const slot = positions.value[index] ?? index;
    const resting = (slot - index) * rowHeight;
    return {
      transform: [{ translateY: withTiming(resting, { duration: 200, easing: Easing.out(Easing.cubic) }) }],
      zIndex: 0,
      opacity: 1,
      shadowOpacity: 0,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    };
  });

  return (
    <Animated.View style={[{ position: 'absolute', top: index * rowHeight, left: 0, right: 0 }, style]}>
      <View className="flex-row items-center bg-canvas">
        <GestureDetector gesture={pan}>
          <View className="items-center justify-center px-2 py-3" hitSlop={8}>
            <DotsSixVerticalIcon color="#bdcac6" size={18} weight="bold" />
          </View>
        </GestureDetector>
        <View className="flex-1">{renderItem(item, index)}</View>
      </View>
    </Animated.View>
  );
}

/**
 * Fixed-row-height drag-to-reorder list — replaces up/down arrow buttons
 * with a native long-press-and-drag handle. `onReorder` is called once per
 * completed drag with the moved item's id and its new index; the caller
 * owns persisting the order (optimistic local state + a reorder mutation)
 * and should pass a `data` array already in the new order on the next
 * render — this list has no order state of its own beyond mid-drag.
 */
export function ReorderableList<T>({
  data,
  keyExtractor,
  renderItem,
  rowHeight,
  onReorder,
}: {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  rowHeight: number;
  onReorder: (id: string, toIndex: number) => void;
}): React.JSX.Element {
  // Reset to identity on every render — the caller owns persisting order,
  // so `data` always arrives already sorted; this just seeds/reseeds the
  // shared value each render (cheap, and correct if `data` length changes).
  const positions = useSharedValue(data.map((_, index) => index));
  positions.value = data.map((_, index) => index);

  return (
    <View style={{ height: data.length * rowHeight }}>
      {data.map((item, index) => (
        <DraggableRow
          key={keyExtractor(item)}
          item={item}
          index={index}
          positions={positions}
          rowCount={data.length}
          rowHeight={rowHeight}
          renderItem={renderItem}
          onDragEnd={(from, to) => onReorder(keyExtractor(data[from]), to)}
        />
      ))}
    </View>
  );
}
