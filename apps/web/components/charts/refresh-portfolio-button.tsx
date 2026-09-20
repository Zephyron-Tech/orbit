'use client';

import { ArrowsClockwise } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { LocalTimestamp } from '@/components/charts/local-timestamp';
import { StatusNotice } from '@/components/ui/status';
import { refreshPortfolioViaApi } from '@/lib/api-client';

interface RefreshStatus {
  tone: 'success' | 'danger';
  title: string;
  message: React.ReactNode;
}

export function RefreshPortfolioButton({ capturedAt }: { capturedAt?: string }): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<RefreshStatus | null>(null);

  const onClick = (): void => {
    setStatus(null);

    startTransition(async () => {
      try {
        const result = await refreshPortfolioViaApi();

        if (!result.ok) {
          setStatus({
            tone: 'danger',
            title: 'Portfolio se nepodařilo obnovit',
            message: result.error ?? 'Synchronizace selhala. Zkuste to znovu.',
          });
          return;
        }

        const completedAt = new Date().toISOString();
        const reusedHour = Boolean(capturedAt && result.capturedAt === capturedAt);

        setStatus({
          tone: 'success',
          title: 'Portfolio je obnoveno',
          message: (
            <>
              {reusedHour ? 'Aktuální hodinový snímek byl přepsán čerstvými daty' : 'Nový snímek byl načten'} v{' '}
              <LocalTimestamp iso={completedAt} />.
            </>
          ),
        });
        router.refresh();
      } catch {
        setStatus({
          tone: 'danger',
          title: 'Portfolio se nepodařilo obnovit',
          message: 'Spojení se synchronizací selhalo. Zkontrolujte připojení a zkuste to znovu.',
        });
      }
    });
  };

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="ui-button ui-button-secondary w-full sm:w-auto"
      >
        <ArrowsClockwise aria-hidden className={isPending ? 'animate-spin' : ''} size={18} />
        {isPending ? 'Obnovuji portfolio…' : 'Obnovit portfolio'}
      </button>
      {status ? (
        <div className="fixed inset-x-4 bottom-20 z-50 text-left sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-96">
          <StatusNotice
            tone={status.tone}
            title={status.title}
            live={status.tone === 'danger' ? 'assertive' : 'polite'}
            onDismiss={() => setStatus(null)}
            autoDismissMs={5000}
          >
            {status.message}
          </StatusNotice>
        </div>
      ) : null}
    </div>
  );
}
