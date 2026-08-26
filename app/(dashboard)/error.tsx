'use client';

import { WarningCircle } from '@phosphor-icons/react';
import { useEffect } from 'react';

import { PageShell } from '@/components/ui/page-container';

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): React.JSX.Element {
  useEffect(() => {
    console.error('Dashboard route failed', error);
  }, [error]);

  return (
    <PageShell width="narrow">
      <div className="surface flex flex-col items-start gap-4 p-6 md:p-8" role="alert">
        <span className="flex size-11 items-center justify-center rounded-xl bg-[var(--critical-soft)] text-critical">
          <WarningCircle size={24} weight="fill" aria-hidden="true" />
        </span>
        <div>
          <h1 className="page-title">Data se nepodařilo načíst</h1>
          <p className="page-description">Zobrazená stránka narazila na neočekávanou chybu. Žádná data nebyla změněna.</p>
        </div>
        <button type="button" onClick={retry} className="ui-button ui-button-primary">
          Zkusit znovu
        </button>
      </div>
    </PageShell>
  );
}
