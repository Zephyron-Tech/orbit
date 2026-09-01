'use client';

import { Car, Plus, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createInsurancePolicy,
  deleteInsurancePolicy,
  updateInsurancePolicy,
  type InsurancePolicyInput,
} from '@/app/(dashboard)/insurance/actions';
import { AmountField } from '@/components/ui/amount-field';
import { DateField } from '@/components/ui/date-field';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeader } from '@/components/ui/page-container';
import { SelectField } from '@/components/ui/select-field';
import { StatusNotice } from '@/components/ui/status';

export interface InsurancePolicyRow extends InsurancePolicyInput {
  id: string;
}

type Confirmation = { id: string } | null;

const FREQUENCY_OPTIONS = [
  { value: 'ANNUAL', label: 'Ročně' },
  { value: 'SEMI_ANNUAL', label: 'Pololetně' },
  { value: 'MONTHLY', label: 'Měsíčně' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Aktivní' },
  { value: 'PENDING_RENEWAL', label: 'Blíží se obnova' },
  { value: 'PAID', label: 'Zaplaceno' },
  { value: 'TERMINATED', label: 'Ukončeno' },
];

function emptyValues(): InsurancePolicyInput {
  return {
    vehicleName: '',
    licensePlate: '',
    policyNumber: '',
    policyHolder: '',
    annualCost: '',
    paymentFrequency: 'ANNUAL',
    startDate: new Date().toISOString().slice(0, 10),
    status: 'ACTIVE',
  };
}

export function InsuranceManager({ policies }: { policies: InsurancePolicyRow[] }): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
    onSuccess?: () => void,
  ): void {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        const result = await action();

        if (!result.ok) {
          setError(result.error ?? 'Akce se nezdařila. Zkuste to znovu.');
          return;
        }

        setConfirmation(null);
        setSuccess(successMessage);
        onSuccess?.();
        router.refresh();
      } catch {
        setError('Akce se nezdařila. Zkontrolujte připojení a zkuste to znovu.');
      }
    });
  }

  function renderPolicy(policy: InsurancePolicyRow): React.JSX.Element {
    if (editingId === policy.id) {
      return (
        <li key={policy.id} className="surface p-4 sm:p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="font-semibold">Upravit pojistku</h3>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              disabled={isPending}
              className="ui-button ui-button-ghost size-10 p-0"
              aria-label="Zavřít úpravu pojistky"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <PolicyForm
            initial={policy}
            submitLabel="Uložit změny"
            pendingLabel="Ukládám…"
            onCancel={() => setEditingId(null)}
            onSubmit={(values) =>
              run(
                () => updateInsurancePolicy(policy.id, values),
                'Změny pojistky byly uloženy.',
                () => setEditingId(null),
              )
            }
            disabled={isPending}
          />
        </li>
      );
    }

    return (
      <li key={policy.id} className="surface overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="min-w-0">
            <h3 className="font-semibold" title={policy.vehicleName}>{policy.vehicleName}</h3>
            <p className="mt-1 text-xs text-ink-muted">
              {policy.licensePlate} · {policy.policyNumber} · {policy.policyHolder}
            </p>
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setConfirmation(null);
                setEditingId(policy.id);
                setCreating(false);
              }}
              disabled={isPending}
              className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
            >
              Upravit
            </button>
            <button
              type="button"
              onClick={() => setConfirmation({ id: policy.id })}
              disabled={isPending}
              className="ui-button ui-button-ghost min-h-9 px-3 py-2 text-xs text-critical"
            >
              Smazat
            </button>
          </div>
        </div>

        {confirmation?.id === policy.id ? (
          <div className="border-t border-line bg-surface-subtle p-4" role="group" aria-label="Potvrzení smazání">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold">Trvale smazat tuto pojistku?</p>
              <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmation(null)}
                  disabled={isPending}
                  className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
                >
                  Zrušit
                </button>
                <button
                  type="button"
                  onClick={() => run(() => deleteInsurancePolicy(policy.id), 'Pojistka byla smazána.')}
                  disabled={isPending}
                  className="ui-button ui-button-danger min-h-9 px-3 py-2 text-xs"
                >
                  {isPending ? 'Mažu…' : 'Smazat pojistku'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3" aria-live="polite">
        {error ? (
          <StatusNotice tone="danger" title="Akci se nepodařilo dokončit" live="assertive">
            {error}
          </StatusNotice>
        ) : null}
        {success ? (
          <StatusNotice tone="success" title="Hotovo" live="polite">
            {success}
          </StatusNotice>
        ) : null}
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Spravovat pojistky"
          description={`${policies.length} evidovaných smluv.`}
          action={
            !creating ? (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setEditingId(null);
                  setConfirmation(null);
                }}
                disabled={isPending}
                className="ui-button ui-button-primary"
              >
                <Plus size={17} weight="bold" aria-hidden="true" />
                Přidat pojistku
              </button>
            ) : undefined
          }
        />

        {creating ? (
          <div className="surface p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Nová pojistka</h3>
              <button
                type="button"
                onClick={() => setCreating(false)}
                disabled={isPending}
                className="ui-button ui-button-ghost size-10 p-0"
                aria-label="Zavřít formulář nové pojistky"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <PolicyForm
              initial={emptyValues()}
              submitLabel="Vytvořit pojistku"
              pendingLabel="Vytvářím…"
              onCancel={() => setCreating(false)}
              onSubmit={(values) =>
                run(() => createInsurancePolicy(values), 'Pojistka byla vytvořena.', () => setCreating(false))
              }
              disabled={isPending}
            />
          </div>
        ) : null}

        {policies.length > 0 ? (
          <ul className="flex flex-col gap-3">{policies.map(renderPolicy)}</ul>
        ) : !creating ? (
          <EmptyState
            icon={<Car size={21} aria-hidden="true" />}
            title="Zatím žádné evidované pojistky"
            description="Přidejte pojistnou smlouvu, ať víte, kolik na ni měsíčně odkládat."
            action={
              <button type="button" onClick={() => setCreating(true)} className="ui-button ui-button-primary">
                <Plus size={17} weight="bold" aria-hidden="true" />
                Přidat pojistku
              </button>
            }
          />
        ) : null}
      </section>
    </div>
  );
}

function PolicyForm({
  initial,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
  disabled,
}: {
  initial: InsurancePolicyInput;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: InsurancePolicyInput) => void;
  onCancel: () => void;
  disabled: boolean;
}): React.JSX.Element {
  const [values, setValues] = useState<InsurancePolicyInput>(initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
      className="flex flex-col gap-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="ui-label min-w-0">
          <span>Vozidlo</span>
          <input
            value={values.vehicleName}
            onChange={(event) => setValues({ ...values, vehicleName: event.target.value })}
            disabled={disabled}
            required
            placeholder="Škoda Octavia"
            className="px-3 py-2"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>SPZ</span>
          <input
            value={values.licensePlate}
            onChange={(event) => setValues({ ...values, licensePlate: event.target.value.toUpperCase() })}
            disabled={disabled}
            required
            placeholder="1AB 2345"
            className="px-3 py-2 uppercase"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>Číslo pojistky</span>
          <input
            value={values.policyNumber}
            onChange={(event) => setValues({ ...values, policyNumber: event.target.value })}
            disabled={disabled}
            required
            className="px-3 py-2"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>Pojistník</span>
          <input
            value={values.policyHolder}
            onChange={(event) => setValues({ ...values, policyHolder: event.target.value })}
            disabled={disabled}
            required
            className="px-3 py-2"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>Roční pojistné</span>
          <AmountField
            value={values.annualCost}
            onChange={(annualCost) => setValues({ ...values, annualCost })}
            disabled={disabled}
            required
            decimalSeparator=","
            placeholder="12000"
            className="px-3 py-2"
          />
        </label>

        <SelectField
          value={values.paymentFrequency}
          options={FREQUENCY_OPTIONS}
          onValueChange={(paymentFrequency) => setValues({ ...values, paymentFrequency: paymentFrequency as InsurancePolicyInput['paymentFrequency'] })}
          label="Frekvence plateb"
          disabled={disabled}
        />

        <DateField
          label="Počátek smlouvy"
          value={values.startDate}
          onValueChange={(startDate) => setValues({ ...values, startDate })}
          disabled={disabled}
          required
        />

        <SelectField
          value={values.status}
          options={STATUS_OPTIONS}
          onValueChange={(status) => setValues({ ...values, status: status as InsurancePolicyInput['status'] })}
          label="Stav"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={onCancel} disabled={disabled} className="ui-button ui-button-secondary">
          Zrušit
        </button>
        <button type="submit" disabled={disabled} className="ui-button ui-button-primary">
          {disabled ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
