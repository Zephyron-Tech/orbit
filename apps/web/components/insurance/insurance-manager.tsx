'use client';

import { ArrowDown, ArrowUp, Car, CloudArrowUp, DownloadSimple, Plus, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { AmountField } from '@/components/ui/amount-field';
import { DateField } from '@/components/ui/date-field';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeader } from '@/components/ui/page-container';
import { SelectField } from '@/components/ui/select-field';
import { StatusNotice } from '@/components/ui/status';
import {
  apiBaseUrl,
  createInsurancePolicyViaApi,
  deleteInsurancePolicyViaApi,
  reorderInsurancePolicyViaApi,
  updateInsurancePolicyViaApi,
  type InsurancePolicyInput,
} from '@/lib/api-client';
import { formatLicensePlate } from '@/lib/finance/license-plate';

export interface InsuranceDocumentInfo {
  id: string;
  filename: string;
  uploadedAt: string;
}

export interface InsurancePolicyRow extends InsurancePolicyInput {
  id: string;
  isFirst: boolean;
  isLast: boolean;
  documents: { contract: InsuranceDocumentInfo | null; greenCard: InsuranceDocumentInfo | null };
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

const VEHICLE_TYPE_OPTIONS = [
  { value: 'CAR', label: 'Osobní auto' },
  { value: 'MOTORCYCLE', label: 'Motocykl' },
  { value: 'TRUCK_OR_TRACTOR', label: 'Nákladní auto / traktor' },
  { value: 'MOPED', label: 'Moped' },
  { value: 'BUS', label: 'Autobus' },
  { value: 'TRAILER', label: 'Přívěs / návěs' },
  { value: 'OTHER', label: 'Ostatní' },
];

function emptyValues(): InsurancePolicyInput {
  return {
    vehicleName: '',
    licensePlate: '',
    policyNumber: '',
    policyHolder: '',
    vehicleType: 'CAR',
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
            policyId={policy.id}
            documents={policy.documents}
            submitLabel="Uložit změny"
            pendingLabel="Ukládám…"
            onCancel={() => setEditingId(null)}
            onSubmit={(values) =>
              run(
                () => updateInsurancePolicyViaApi(policy.id, values),
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
              {formatLicensePlate(policy.licensePlate, policy.vehicleType)} · {policy.policyNumber} · {policy.policyHolder}
            </p>
            {policy.documents.contract || policy.documents.greenCard ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {policy.documents.contract ? (
                  <DocumentLink policyId={policy.id} document={policy.documents.contract} label="Smlouva" />
                ) : null}
                {policy.documents.greenCard ? (
                  <DocumentLink policyId={policy.id} document={policy.documents.greenCard} label="Zelená karta" />
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={() => run(() => reorderInsurancePolicyViaApi(policy.id, -1), 'Pořadí bylo změněno.')}
              disabled={isPending || policy.isFirst}
              aria-label="Posunout výš"
              title="Posunout výš"
              className="ui-button ui-button-ghost size-9 p-0"
            >
              <ArrowUp size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => run(() => reorderInsurancePolicyViaApi(policy.id, 1), 'Pořadí bylo změněno.')}
              disabled={isPending || policy.isLast}
              aria-label="Posunout níž"
              title="Posunout níž"
              className="ui-button ui-button-ghost size-9 p-0"
            >
              <ArrowDown size={15} aria-hidden="true" />
            </button>
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
                  onClick={() => run(() => deleteInsurancePolicyViaApi(policy.id), 'Pojistka byla smazána.')}
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
              policyId={null}
              documents={{ contract: null, greenCard: null }}
              submitLabel="Vytvořit pojistku"
              pendingLabel="Vytvářím…"
              onCancel={() => setCreating(false)}
              onSubmit={(values) =>
                run(() => createInsurancePolicyViaApi(values), 'Pojistka byla vytvořena.', () => setCreating(false))
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

function DocumentLink({
  policyId,
  document,
  label,
}: {
  policyId: string;
  document: InsuranceDocumentInfo;
  label: string;
}): React.JSX.Element {
  return (
    <a
      href={`${apiBaseUrl()}/insurance/${policyId}/documents/${document.id}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-subtle px-2 py-1 text-xs text-ink-muted hover:text-ink"
    >
      <DownloadSimple size={13} aria-hidden="true" />
      {label}
    </a>
  );
}

type GreenCardParsed = {
  policyNumber: string;
  plateOrVin: string;
  vehicleType: InsurancePolicyInput['vehicleType'];
  validFrom: string;
};

type ContractParsed = {
  policyNumber: string | null;
  licensePlate: string | null;
  vehicleName: string | null;
  vehicleType: InsurancePolicyInput['vehicleType'] | null;
  annualCost: string | null;
  startDate: string | null;
};

function DocumentUploader({
  kind,
  label,
  policyId,
  existing,
  disabled,
  onParsed,
}: {
  kind: 'CONTRACT' | 'GREEN_CARD';
  label: string;
  policyId: string | null;
  existing: InsuranceDocumentInfo | null;
  disabled: boolean;
  onParsed: (fields: GreenCardParsed | ContractParsed) => void;
}): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [justUploaded, setJustUploaded] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setBusy(true);
    setLocalError(null);
    setJustUploaded(null);

    try {
      const parseBody = new FormData();
      parseBody.set('file', file);
      parseBody.set('kind', kind);

      const parseResponse = await fetch(`${apiBaseUrl()}/insurance/documents/parse`, { method: 'POST', body: parseBody, credentials: 'include' });
      const parsed: unknown = await parseResponse.json();

      if (!parseResponse.ok) {
        const message = parsed && typeof parsed === 'object' && 'error' in parsed ? String(parsed.error) : 'Nepodařilo se přečíst PDF';
        setLocalError(message);
        return;
      }

      onParsed(parsed as GreenCardParsed | ContractParsed);

      if (policyId) {
        const storeBody = new FormData();
        storeBody.set('file', file);
        storeBody.set('kind', kind);

        const storeResponse = await fetch(`${apiBaseUrl()}/insurance/${policyId}/documents`, { method: 'POST', body: storeBody, credentials: 'include' });

        if (!storeResponse.ok && storeResponse.status !== 409) {
          const storeError: unknown = await storeResponse.json().catch(() => null);
          const message = storeError && typeof storeError === 'object' && 'error' in storeError ? String(storeError.error) : 'Uložení dokumentu se nezdařilo';
          setLocalError(message);
        } else {
          // 409 (byte-identical file already stored) counts as success here —
          // the document is attached either way. `existing` won't reflect the
          // new upload until the server component re-renders, so this local
          // confirmation is the only immediate feedback the upload landed.
          setJustUploaded(file.name);
          router.refresh();
        }
      }
    } catch {
      setLocalError('Nahrání se nezdařilo. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        className="ui-button ui-button-secondary min-h-9 justify-start px-3 py-2 text-xs"
      >
        <CloudArrowUp size={15} aria-hidden="true" />
        {busy ? 'Zpracovávám…' : existing ? `Nahradit — ${label}` : `Nahrát — ${label}`}
      </button>
      {existing ? (
        <a
          href={policyId ? `${apiBaseUrl()}/insurance/${policyId}/documents/${existing.id}` : undefined}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-muted hover:text-ink"
        >
          Aktuální soubor: {existing.filename}
        </a>
      ) : justUploaded ? (
        <p className="text-xs text-positive">Nahráno: {justUploaded}</p>
      ) : null}
      {localError ? <p className="text-xs text-critical">{localError}</p> : null}
      {!policyId ? <p className="text-xs text-ink-faint">Soubor se uloží po vytvoření pojistky — nejdřív ji uložte, pak dokument nahrajte znovu v úpravě.</p> : null}
    </div>
  );
}

function PolicyForm({
  initial,
  policyId,
  documents,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
  disabled,
}: {
  initial: InsurancePolicyInput;
  policyId: string | null;
  documents: { contract: InsuranceDocumentInfo | null; greenCard: InsuranceDocumentInfo | null };
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: InsurancePolicyInput) => void;
  onCancel: () => void;
  disabled: boolean;
}): React.JSX.Element {
  const [values, setValues] = useState<InsurancePolicyInput>(initial);

  // Deliberately does NOT touch `startDate`: a green card's "PLATNÁ OD" is
  // that card's own validity window, not the policy's payment-cadence
  // anniversary — confirmed with real data this session (the TT policy's
  // contract start is 2026-01-21, but its green card, reissued after a
  // mid-term vehicle change, is valid from 2026-03-16). Letting this feed
  // `startDate` would silently shift the sinking-fund due-date math on
  // every reissued card. Only the contract parser, which extracts the
  // policy's actual "účinná od"/"počátkem pojištění" line, may set it.
  function applyGreenCard(fields: GreenCardParsed): void {
    setValues((current) => ({
      ...current,
      policyNumber: fields.policyNumber || current.policyNumber,
      licensePlate: fields.plateOrVin || current.licensePlate,
      vehicleType: fields.vehicleType ?? current.vehicleType,
    }));
  }

  function applyContract(fields: ContractParsed): void {
    setValues((current) => ({
      ...current,
      policyNumber: fields.policyNumber ?? current.policyNumber,
      licensePlate: fields.licensePlate ?? current.licensePlate,
      vehicleName: fields.vehicleName ?? current.vehicleName,
      vehicleType: fields.vehicleType ?? current.vehicleType,
      annualCost: fields.annualCost ?? current.annualCost,
      startDate: fields.startDate ?? current.startDate,
    }));
  }

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

        <SelectField
          value={values.vehicleType}
          options={VEHICLE_TYPE_OPTIONS}
          onValueChange={(vehicleType) => setValues({ ...values, vehicleType: vehicleType as InsurancePolicyInput['vehicleType'] })}
          label="Druh vozidla"
          disabled={disabled}
        />

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

      <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
        <DocumentUploader
          kind="CONTRACT"
          label="smlouva"
          policyId={policyId}
          existing={documents.contract}
          disabled={disabled}
          onParsed={(fields) => applyContract(fields as ContractParsed)}
        />
        <DocumentUploader
          kind="GREEN_CARD"
          label="zelená karta"
          policyId={policyId}
          existing={documents.greenCard}
          disabled={disabled}
          onParsed={(fields) => applyGreenCard(fields as GreenCardParsed)}
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
