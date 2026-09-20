import {
  Bank,
  CarIcon as Car,
  DownloadSimple,
  GasPump,
  GearSix,
  Handshake,
  Receipt,
  SquaresFour,
  Target,
  TrendUp,
  UsersThree,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';

export interface NavItem {
  href: string;
  label: string;
  shortLabel?: string;
  icon: Icon;
}

/** Mobile bottom tab bar always shows these 5, in this order, regardless of the sidebar's custom order. */
export const PRIMARY: NavItem[] = [
  { href: '/dashboard', label: 'Přehled', icon: SquaresFour },
  { href: '/transactions', label: 'Transakce', shortLabel: 'Transakce', icon: Receipt },
  { href: '/net-worth', label: 'Čisté jmění', shortLabel: 'Jmění', icon: Wallet },
  { href: '/portfolio', label: 'Portfolio', icon: TrendUp },
  { href: '/settlement', label: 'Vyrovnání', icon: Handshake },
  { href: '/import', label: 'Import', icon: DownloadSimple },
];

const SETTINGS: NavItem[] = [
  { href: '/accounts', label: 'Účty', icon: Bank },
  { href: '/planning', label: 'Plánování', icon: Target },
  { href: '/insurance', label: 'Pojistky', icon: Car },
  { href: '/fuel', label: 'Palivo', icon: GasPump },
  { href: '/users', label: 'Domácnost', icon: UsersThree },
  { href: '/settings', label: 'Nastavení', icon: GearSix },
];

/** Default sidebar order, before any per-browser custom order is applied. */
export const ALL_NAV_ITEMS: NavItem[] = [...PRIMARY, ...SETTINGS];

export const NAV_ORDER_STORAGE_KEY = 'orbit-nav-order';
export const NAV_ORDER_EVENT = 'orbit-nav-order-change';

let snapshotCache: { items: readonly NavItem[]; result: NavItem[] } | null = null;

/** Cached wrapper around `applyStoredOrder`, so `useSyncExternalStore`'s getSnapshot returns a stable reference between renders (it would otherwise re-render forever). Invalidated by `subscribeNavOrder` whenever the stored order changes. */
export function getOrderedNavItems(items: readonly NavItem[]): NavItem[] {
  if (!snapshotCache || snapshotCache.items !== items) {
    snapshotCache = { items, result: applyStoredOrder(items) };
  }
  return snapshotCache.result;
}

/** Subscribes a useSyncExternalStore consumer to nav-order changes (this tab's toggle, or another tab via `storage`). */
export function subscribeNavOrder(callback: () => void): () => void {
  const handler = (): void => {
    snapshotCache = null;
    callback();
  };
  window.addEventListener(NAV_ORDER_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(NAV_ORDER_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** Reads the stored href order and applies it to `items`, dropping any href that no longer exists and appending any new item not yet in the stored order. */
function applyStoredOrder(items: readonly NavItem[]): NavItem[] {
  if (typeof window === 'undefined') return [...items];

  let storedHrefs: string[];

  try {
    const raw = window.localStorage.getItem(NAV_ORDER_STORAGE_KEY);
    storedHrefs = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [...items];
  }

  const byHref = new Map(items.map((item) => [item.href, item]));
  const ordered: NavItem[] = [];

  for (const href of storedHrefs) {
    const item = byHref.get(href);
    if (item) {
      ordered.push(item);
      byHref.delete(href);
    }
  }

  // Anything not in the stored order (new nav item, or first run) keeps its default position at the end.
  for (const item of items) {
    if (byHref.has(item.href)) ordered.push(item);
  }

  return ordered;
}
