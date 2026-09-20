'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  changeMyEmail,
  changeMyPassword,
  updateReportingStartMonth,
} from '@/app/(dashboard)/settings/actions';
import { SectionHeader } from '@/components/ui/page-container';
import { SelectField } from '@/components/ui/select-field';
import { StatusNotice } from '@/components/ui/status';
import { formatPeriod } from '@/lib/ui/period';

function useFormAction() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string, onSuccess?: () => void): void {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await action();

        if (!result.ok) {
          setError(result.error ?? 'Akce se nezdařila. Zkuste to znovu.');
          return;
        }

        setSuccess(successMessage);
        onSuccess?.();
        router.refresh();
      } catch {
        setError('Akce se nezdařila. Zkontrolujte připojení a zkuste to znovu.');
      }
    });
  }

  return { isPending, error, success, run };
}

function EmailForm({ email }: { email: string }): React.JSX.Element {
  const { isPending, error, success, run } = useFormAction();
  const [value, setValue] = useState(email);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => changeMyEmail(value), 'E-mail byl změněn.');
      }}
      className="surface flex flex-col gap-4 p-4 sm:p-5"
    >
      <h3 className="font-semibold">E-mail</h3>
      <label className="ui-label min-w-0">
        <span>Přihlašovací e-mail</span>
        <input
          type="email"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isPending}
          required
          className="px-3 py-2"
        />
      </label>
      {error ? <StatusNotice tone="danger" live="assertive">{error}</StatusNotice> : null}
      {success ? <StatusNotice tone="success" live="polite">{success}</StatusNotice> : null}
      <div>
        <button type="submit" disabled={isPending || value === email} className="ui-button ui-button-primary">
          {isPending ? 'Ukládám…' : 'Uložit e-mail'}
        </button>
      </div>
    </form>
  );
}

function PasswordForm(): React.JSX.Element {
  const { isPending, error, success, run } = useFormAction();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => changeMyPassword({ currentPassword, newPassword }), 'Heslo bylo změněno.', () => {
          setCurrentPassword('');
          setNewPassword('');
        });
      }}
      className="surface flex flex-col gap-4 p-4 sm:p-5"
    >
      <h3 className="font-semibold">Heslo</h3>
      <label className="ui-label min-w-0">
        <span>Současné heslo</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={isPending}
          required
          autoComplete="current-password"
          className="px-3 py-2"
        />
      </label>
      <label className="ui-label min-w-0">
        <span>Nové heslo</span>
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={isPending}
          required
          minLength={10}
          autoComplete="new-password"
          className="px-3 py-2"
        />
        <span className="text-xs text-ink-muted">Alespoň 10 znaků.</span>
      </label>
      {error ? <StatusNotice tone="danger" live="assertive">{error}</StatusNotice> : null}
      {success ? <StatusNotice tone="success" live="polite">{success}</StatusNotice> : null}
      <div>
        <button type="submit" disabled={isPending} className="ui-button ui-button-primary">
          {isPending ? 'Ukládám…' : 'Změnit heslo'}
        </button>
      </div>
    </form>
  );
}

function ReportingStartMonthForm({
  reportingStartMonth,
  availableMonths,
}: {
  reportingStartMonth: string | null;
  availableMonths: string[];
}): React.JSX.Element {
  const { isPending, error, success, run } = useFormAction();
  const [value, setValue] = useState(reportingStartMonth ?? '');
  const options = [
    { value: '', label: 'Bez omezení' },
    ...availableMonths.map((month) => ({ value: month, label: formatPeriod(month) })),
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => updateReportingStartMonth(value || null), 'Rozsah zobrazovaných dat byl uložen.');
      }}
      className="surface flex flex-col gap-4 p-4 sm:p-5"
    >
      <h3 className="font-semibold">Rozsah dat</h3>
      <p className="text-sm text-ink-muted">
        Od kterého měsíce se mají data zobrazovat ve výběru období (transakce, přehled). Starší měsíce v appce
        nezmizí ze záznamů, jen nepůjdou vybrat.
      </p>
      <SelectField
        label="Zobrazovat od"
        value={value}
        options={options}
        onValueChange={setValue}
        disabled={isPending}
      />
      {error ? <StatusNotice tone="danger" live="assertive">{error}</StatusNotice> : null}
      {success ? <StatusNotice tone="success" live="polite">{success}</StatusNotice> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={isPending} className="ui-button ui-button-primary">
          {isPending ? 'Ukládám…' : 'Uložit'}
        </button>
        {value ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setValue('');
              run(() => updateReportingStartMonth(null), 'Omezení bylo zrušeno.');
            }}
            className="ui-button ui-button-secondary"
          >
            Zrušit omezení
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function AccountSettingsManager({
  email,
  reportingStartMonth,
  availableMonths,
}: {
  email: string;
  reportingStartMonth: string | null;
  availableMonths: string[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHeader title="Můj účet" description="Vlastní přihlašovací údaje." />
        <div className="flex flex-col gap-3">
          <EmailForm email={email} />
          <PasswordForm />
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeader title="Zobrazení dat" description="Platí pro celou domácnost." />
        <ReportingStartMonthForm reportingStartMonth={reportingStartMonth} availableMonths={availableMonths} />
      </section>
    </div>
  );
}
