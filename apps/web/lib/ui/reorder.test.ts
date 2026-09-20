import { describe, expect, it } from 'vitest';

import { moveItem } from './reorder';

describe('moveItem', () => {
  it('swaps an item with its next neighbor', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('swaps an item with its previous neighbor', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op moving the first item up', () => {
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op moving the last item down', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    moveItem(input, 0, 1);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op for an out-of-range index', () => {
    expect(moveItem(['a', 'b'], 5, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
  });

  it('handles a single-item array', () => {
    expect(moveItem(['a'], 0, 1)).toEqual(['a']);
    expect(moveItem(['a'], 0, -1)).toEqual(['a']);
  });

  it('handles an empty array', () => {
    expect(moveItem([], 0, 1)).toEqual([]);
  });
});
