'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { dismissUnmatchedTransferViaApi } from '@/lib/api-client';

/** "This will never find a match" — see dismissUnmatchedTransfer for what it does and doesn't change. */
export function DismissTransferButton({ transactionId }: { transactionId: string }): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(): void {
    setError(null);
    startTransition(async () => {
      const result = await dismissUnmatchedTransferViaApi(transactionId);

      if (!result.ok) {
        setError(result.error ?? 'Akce se nezdařila.');
        return;
      }

      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={run} disabled={isPending} className="ui-button ui-button-ghost min-h-0 px-2 py-0.5 text-xs">
        {isPending ? 'Ukládám…' : 'Nikdy se nespáruje'}
      </button>
      {error ? <span className="text-xs text-critical">{error}</span> : null}
    </span>
  );
}
