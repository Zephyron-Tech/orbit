'use client';

import { useSyncExternalStore } from 'react';

import { Badge } from '@/components/ui/status';

const FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});
function subscribe(callback: () => void): () => void {
  const interval = window.setInterval(callback, 60_000);

  return () => window.clearInterval(interval);
}

function utcFallback(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return 'neplatný čas';

  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Hydrate deterministic UTC text first, then switch to viewer timezone. */
export function LocalTimestamp({ iso }: { iso: string }): React.JSX.Element {
  const timestamp = useSyncExternalStore(
    subscribe,
    () => FORMATTER.format(new Date(iso)),
    () => utcFallback(iso),
  );

  return <time dateTime={iso}>{timestamp}</time>;
}

export function SnapshotFreshness({ iso }: { iso: string }): React.JSX.Element | null {
  const isStale = useSyncExternalStore(
    subscribe,
    () => Date.now() - new Date(iso).getTime() > 2 * 60 * 60 * 1000,
    () => false,
  );

  return isStale ? <Badge tone="warning">Data jsou starší než 2 hodiny</Badge> : null;
}
