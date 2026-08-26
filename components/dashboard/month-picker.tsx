'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { MonthSelect } from '@/components/ui/month-select';
import { formatPeriod, offsetPeriod, storePeriod } from '@/lib/ui/period';

export function MonthPicker({ current, months }: { current: string; months: string[] }): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigate(period: string): void {
    storePeriod(period);
    startTransition(() => router.push(`/dashboard?period=${period}`));
  }

  return (
    <div className={`flex w-full max-w-md items-center gap-1 ${isPending ? 'opacity-60' : ''}`} aria-label="Výběr měsíce">
      <button
        type="button"
        className="ui-button ui-button-secondary shrink-0 px-2.5"
        onClick={() => navigate(offsetPeriod(current, -1))}
        disabled={isPending}
        aria-label={`Předchozí měsíc: ${formatPeriod(offsetPeriod(current, -1))}`}
        title="Předchozí měsíc"
      >
        <CaretLeft size={17} weight="bold" />
      </button>
      <MonthSelect
        value={current}
        months={[current, ...months]}
        onValueChange={navigate}
        disabled={isPending}
        className="min-w-0 flex-1 sm:min-w-40"
      />
      <button
        type="button"
        className="ui-button ui-button-secondary shrink-0 px-2.5"
        onClick={() => navigate(offsetPeriod(current, 1))}
        disabled={isPending}
        aria-label={`Následující měsíc: ${formatPeriod(offsetPeriod(current, 1))}`}
        title="Následující měsíc"
      >
        <CaretRight size={17} weight="bold" />
      </button>
    </div>
  );
}
