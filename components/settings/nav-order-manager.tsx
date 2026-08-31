'use client';

import { ArrowClockwise, ArrowDown, ArrowUp } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';

import { ALL_NAV_ITEMS, getOrderedNavItems, NAV_ORDER_EVENT, NAV_ORDER_STORAGE_KEY, subscribeNavOrder } from '@/lib/ui/nav-items';
import { moveItem } from '@/lib/ui/reorder';

function persist(hrefs: string[]): void {
  localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(hrefs));
  window.dispatchEvent(new Event(NAV_ORDER_EVENT));
}

export function NavOrderManager(): React.JSX.Element {
  const items = useSyncExternalStore(
    subscribeNavOrder,
    () => getOrderedNavItems(ALL_NAV_ITEMS),
    () => ALL_NAV_ITEMS,
  );

  function move(index: number, direction: -1 | 1): void {
    const reordered = moveItem(items, index, direction);
    persist(reordered.map((item) => item.href));
  }

  function reset(): void {
    localStorage.removeItem(NAV_ORDER_STORAGE_KEY);
    window.dispatchEvent(new Event(NAV_ORDER_EVENT));
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {items.map((item, index) => {
          const IconComponent = item.icon;

          return (
            <li key={item.href} className="flex items-center gap-3 px-3 py-2">
              <IconComponent size={17} className="text-ink-muted" aria-hidden="true" />
              <span className="flex-1 text-sm">{item.label}</span>
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label="Posunout výš"
                title="Posunout výš"
                className="ui-button ui-button-ghost size-9 p-0"
              >
                <ArrowUp size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                aria-label="Posunout níž"
                title="Posunout níž"
                className="ui-button ui-button-ghost size-9 p-0"
              >
                <ArrowDown size={15} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={reset} className="ui-button ui-button-ghost gap-2 text-xs">
        <ArrowClockwise size={14} aria-hidden="true" />
        Obnovit výchozí pořadí
      </button>
    </div>
  );
}
