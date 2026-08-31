/** Swaps `items[index]` with its neighbor in `direction`. Clamped at the ends — moving the first item up (or the last item down) is a no-op, not an error. */
export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;

  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return [...items];
  }

  const next = [...items];
  const [item] = next.splice(index, 1);

  if (item === undefined) {
    return next;
  }

  next.splice(target, 0, item);

  return next;
}
