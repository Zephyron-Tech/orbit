'use client';

import { Archive, Bank, Plus, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createAccount,
  deleteAccount,
  recordCreditDebt,
  confirmCreditZeroStart,
  clearCreditCapacitySnapshot,
  confirmCreditRepayment,
  setAccountArchived,
  updateAccount,
  type AccountInput,
} from '@/app/(dashboard)/settings/accounts/actions';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeader } from '@/components/ui/page';
import { SelectField } from '@/components/ui/select-field';
import { Badge, StatusNotice } from '@/components/ui/status';

export interface AccountRow extends AccountInput {
  id: string;
  isArchived: boolean;
  transactionCount: number;
  creditDetails: { limit: string; debt: string; capacity: string; asOf: string | null; invalidCapacitySnapshot: boolean } | null;
  creditNeedsOpeningConfirmation: boolean;
}

export interface CreditRepaymentCandidate { creditTransactionId: string; sourceTransactionId: string; amount: string; date: string; sourceAccountName: string }

const TYPE_LABELS: Record<AccountInput['type'], string> = {
  CHECKING: 'Běžný účet',
  SAVINGS: 'Spořicí účet',
  INVESTMENT: 'Investiční účet',
  CREDIT: 'Kreditní účet',
};

const PROVIDER_LABELS: Record<AccountInput['provider'], string> = {
  MONETA: 'Moneta',
  REVOLUT: 'Revolut',
  TRADING212: 'Trading 212',
  MANUAL: 'Ruční evidence',
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));
const PROVIDER_OPTIONS = Object.entries(PROVIDER_LABELS).map(([value, label]) => ({ value, label }));

const EMPTY: AccountInput = {
  name: '',
  type: 'SAVINGS',
  provider: 'MONETA',
  externalId: null,
  currency: 'CZK',
  includeInNetWorth: true,
  creditLimit: null,
  cardLast4: null,
  emergencyReserveMonths: null,
  annualInterestRate: null,
  interestTaxRate: '15',
};

type Confirmation = { id: string; action: 'archive' | 'delete' } | null;

export function AccountManager({ accounts, repaymentCandidates }: { accounts: AccountRow[]; repaymentCandidates: CreditRepaymentCandidate[] }): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [recordingDebtId, setRecordingDebtId] = useState<string | null>(null);
  const activeAccounts = accounts.filter((account) => !account.isArchived);
  const archivedAccounts = accounts.filter((account) => account.isArchived);

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

  function renderAccount(account: AccountRow): React.JSX.Element {
    const pendingConfirmation = confirmation?.id === account.id ? confirmation.action : null;

    if (editingId === account.id) {
      return (
        <li key={account.id} className="surface p-4 sm:p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="font-semibold">Upravit účet</h3>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              disabled={isPending}
              className="ui-button ui-button-ghost size-10 p-0"
              aria-label="Zavřít úpravu účtu"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <AccountForm
            initial={account}
            submitLabel="Uložit změny"
            pendingLabel="Ukládám…"
            onCancel={() => setEditingId(null)}
            onSubmit={(values) =>
              run(() => updateAccount(account.id, values), 'Změny účtu byly uloženy.', () => setEditingId(null))
            }
            disabled={isPending}
          />
        </li>
      );
    }

    return (
      <li key={account.id} className="surface overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className="min-w-0 break-words font-semibold tracking-[-0.015em] [overflow-wrap:anywhere]"
                title={account.name}
              >
                {account.name}
              </h3>
              <Badge>{TYPE_LABELS[account.type]}</Badge>
              {account.isArchived ? <Badge tone="neutral">Archivováno</Badge> : null}
            </div>
            <p className="mt-2 min-w-0 break-words text-sm text-ink-muted [overflow-wrap:anywhere]">
              <span>{PROVIDER_LABELS[account.provider]}</span>
              {account.externalId ? (
                <>
                  {' · '}
                  <span title={account.externalId}>{account.externalId}</span>
                </>
              ) : null}
              {' · '}
              <span>{account.currency}</span>
            </p>
             <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
               <span>{formatTransactionCount(account.transactionCount)}</span>
               <span>{account.includeInNetWorth ? 'Součást čistého jmění' : 'Mimo čisté jmění'}</span>
             </div>
              {account.creditDetails ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                 <span>Limit: {formatMoney(account.creditDetails.limit, account.currency)}</span>
                 <span>Dluh: {formatMoney(account.creditDetails.debt, account.currency)}</span>
                  <span>Volná kapacita: {formatMoney(account.creditDetails.capacity, account.currency)}</span>
                </div>
              ) : null}
               {account.creditDetails?.invalidCapacitySnapshot ? (
                 <p className="mt-2 text-xs text-warning">Kladný ruční zůstatek se jako dostupný limit nepoužívá. Dluh je dopočítaný z importovaných karetních plateb.</p>
               ) : null}
               {account.type === 'SAVINGS' ? (
                 <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
                   {account.emergencyReserveMonths !== null ? <span>Rezerva: {account.emergencyReserveMonths} měs.</span> : null}
                   {account.annualInterestRate !== null ? <span>Roční úrok: {account.annualInterestRate} %</span> : null}
                   {account.interestTaxRate !== null ? <span>Daň z úroku: {account.interestTaxRate} %</span> : null}
                 </div>
               ) : null}
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setConfirmation(null);
                setEditingId(account.id);
                setCreating(false);
              }}
              disabled={isPending}
              className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
            >
              Upravit
            </button>
            {account.type === 'CREDIT' ? (
              <button
                type="button"
                onClick={() => {
                  setRecordingDebtId(account.id);
                  setEditingId(null);
                  setCreating(false);
                  setConfirmation(null);
                }}
                disabled={isPending}
                className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
              >
                Zadat dluh
              </button>
            ) : null}
            {account.creditNeedsOpeningConfirmation ? (
              <button type="button" onClick={() => run(() => confirmCreditZeroStart(account.id), 'Nulový stav před první importovanou platbou byl potvrzen.')} disabled={isPending} className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs">Potvrdit nulový start</button>
            ) : null}
            {account.creditDetails?.invalidCapacitySnapshot ? (
              <button type="button" onClick={() => run(() => clearCreditCapacitySnapshot(account.id), 'Chybný dostupný limit byl odstraněn.')} disabled={isPending} className="ui-button ui-button-ghost min-h-9 px-3 py-2 text-xs text-warning">Odstranit chybný zůstatek</button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (account.isArchived) {
                  run(() => setAccountArchived(account.id, false), 'Účet byl obnoven.');
                } else {
                  setConfirmation({ id: account.id, action: 'archive' });
                }
              }}
              disabled={isPending}
              className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
            >
              {account.isArchived ? 'Obnovit' : 'Archivovat'}
            </button>
            {account.transactionCount === 0 ? (
              <button
                type="button"
                onClick={() => setConfirmation({ id: account.id, action: 'delete' })}
                disabled={isPending}
                className="ui-button ui-button-ghost min-h-9 px-3 py-2 text-xs text-critical"
              >
                Smazat
              </button>
            ) : null}
          </div>
        </div>

        {pendingConfirmation ? (
          <div className="border-t border-line bg-surface-subtle p-4" role="group" aria-label="Potvrzení akce">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {pendingConfirmation === 'archive' ? 'Archivovat tento účet?' : 'Trvale smazat tento účet?'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {pendingConfirmation === 'archive'
                    ? 'Účet zmizí z importu a běžných výběrů. Historie transakcí zůstane zachována.'
                    : 'Účet nemá žádné transakce. Smazání nelze vrátit zpět.'}
                </p>
              </div>
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
                  onClick={() =>
                    pendingConfirmation === 'archive'
                      ? run(() => setAccountArchived(account.id, true), 'Účet byl archivován.')
                      : run(() => deleteAccount(account.id), 'Účet byl smazán.')
                  }
                  disabled={isPending}
                  className={`ui-button min-h-9 px-3 py-2 text-xs ${
                    pendingConfirmation === 'delete' ? 'ui-button-danger' : 'ui-button-primary'
                  }`}
                >
                  {isPending
                    ? pendingConfirmation === 'archive'
                      ? 'Archivuji…'
                      : 'Mažu…'
                    : pendingConfirmation === 'archive'
                      ? 'Archivovat účet'
                      : 'Smazat účet'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {recordingDebtId === account.id ? (
          <div className="border-t border-line bg-surface-subtle p-4">
            <CreditDebtForm
              currency={account.currency}
              disabled={isPending}
              onCancel={() => setRecordingDebtId(null)}
              onSubmit={(values) =>
                run(
                  () => recordCreditDebt({ accountId: account.id, ...values }),
                  'Aktuální dluh byl uložen.',
                  () => setRecordingDebtId(null),
                )
              }
            />
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
          title="Aktivní účty"
          description={`${activeAccounts.length} ${activeAccounts.length === 1 ? 'aktivní účet' : 'aktivních účtů'}`}
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
                Přidat účet
              </button>
            ) : undefined
          }
        />

        {creating ? (
          <div className="surface p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Nový účet</h3>
              <button
                type="button"
                onClick={() => setCreating(false)}
                disabled={isPending}
                className="ui-button ui-button-ghost size-10 p-0"
                aria-label="Zavřít formulář nového účtu"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <AccountForm
              initial={EMPTY}
              submitLabel="Vytvořit účet"
              pendingLabel="Vytvářím…"
              onCancel={() => setCreating(false)}
              onSubmit={(values) =>
                run(() => createAccount(values), 'Účet byl vytvořen.', () => setCreating(false))
              }
              disabled={isPending}
            />
          </div>
        ) : null}

        {activeAccounts.length > 0 ? (
          <ul className="flex flex-col gap-3">{activeAccounts.map(renderAccount)}</ul>
        ) : !creating ? (
          <EmptyState
            icon={<Bank size={21} aria-hidden="true" />}
            title="Zatím žádný aktivní účet"
            description="Přidejte první účet pro import transakcí nebo ruční sledování majetku."
            action={
              <button type="button" onClick={() => setCreating(true)} className="ui-button ui-button-primary">
                <Plus size={17} weight="bold" aria-hidden="true" />
                Přidat účet
              </button>
            }
          />
        ) : null}
      </section>

      {repaymentCandidates.length > 0 ? (
        <section className="surface border-accent/25 bg-[var(--accent-soft)] p-4 sm:p-5">
          <SectionHeader title="Nalezené splacení kreditky" description="Po ruční platbě v bance potvrďte odpovídající dvojici importovaných pohybů." />
          <div className="mt-4 flex flex-col gap-3">
            {repaymentCandidates.map((candidate) => (
              <div key={candidate.creditTransactionId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-[var(--surface-raised)] p-3">
                <p className="text-sm text-ink-muted">{candidate.date} · {candidate.sourceAccountName} → kreditní karta · <span className="font-semibold text-ink">{formatMoney(candidate.amount, 'CZK')}</span></p>
                <button type="button" disabled={isPending} onClick={() => run(() => confirmCreditRepayment(candidate.creditTransactionId, candidate.sourceTransactionId), 'Splacení kreditky bylo potvrzeno jako interní převod.')} className="ui-button ui-button-primary">Potvrdit splacení</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {archivedAccounts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader
            title="Archivované účty"
            description="Nezobrazují se v importu, jejich historie ale zůstává zachována."
          />
          <ul className="flex flex-col gap-3">{archivedAccounts.map(renderAccount)}</ul>
        </section>
      ) : (
        <div className="flex items-center gap-2 border-t border-line pt-5 text-sm text-ink-muted">
          <Archive size={18} aria-hidden="true" />
          Žádné archivované účty
        </div>
      )}
    </div>
  );
}

function AccountForm({
  initial,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
  disabled,
}: {
  initial: AccountInput;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: AccountInput) => void;
  onCancel: () => void;
  disabled: boolean;
}): React.JSX.Element {
  const [values, setValues] = useState<AccountInput>(initial);
  const identifier = accountIdentifierCopy(values.provider);

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
          <span>Název</span>
          <input
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            disabled={disabled}
            required
            placeholder="Spořicí účet"
            className="px-3 py-2"
          />
        </label>

        <SelectField
          value={values.type}
          options={TYPE_OPTIONS}
          onValueChange={(type) => {
            const nextType = type as AccountInput['type'];
            setValues({
              ...values,
              type: nextType,
              creditLimit: nextType === 'CREDIT' ? values.creditLimit : null,
              cardLast4: nextType === 'CREDIT' ? values.cardLast4 : null,
              emergencyReserveMonths: nextType === 'SAVINGS' ? values.emergencyReserveMonths : null,
              annualInterestRate: nextType === 'SAVINGS' ? values.annualInterestRate : null,
              interestTaxRate: nextType === 'SAVINGS' ? values.interestTaxRate : null,
            });
          }}
          label="Typ účtu"
          disabled={disabled}
        />

        <SelectField
          value={values.provider}
          options={PROVIDER_OPTIONS}
          onValueChange={(provider) =>
            setValues({ ...values, provider: provider as AccountInput['provider'] })
          }
          label="Poskytovatel"
          helper={providerCopy(values.provider)}
          disabled={disabled}
        />

        <label className="ui-label min-w-0">
          <span>{identifier.label}</span>
          <input
            value={values.externalId ?? ''}
            onChange={(event) => setValues({ ...values, externalId: event.target.value || null })}
            disabled={disabled}
            placeholder={identifier.placeholder}
            className="px-3 py-2"
          />
          <span className="ui-helper">{identifier.helper}</span>
        </label>

        <label className="ui-label min-w-0">
          <span>Měna</span>
          <input
            value={values.currency}
            onChange={(event) => setValues({ ...values, currency: event.target.value.toUpperCase() })}
            disabled={disabled}
            maxLength={3}
            required
            className="px-3 py-2 uppercase"
          />
        </label>

        <label className="flex min-h-11 min-w-0 items-center gap-3 self-end rounded-xl border border-line bg-surface-subtle px-3 py-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={values.includeInNetWorth}
            onChange={(event) => setValues({ ...values, includeInNetWorth: event.target.checked })}
            disabled={disabled}
            className="size-4"
          />
          Počítat do čistého jmění
        </label>
        {values.type === 'CREDIT' ? (
          <>
            <label className="ui-label min-w-0">
              <span>Kreditní limit</span>
              <input
                inputMode="decimal"
                value={values.creditLimit ?? ''}
                onChange={(event) => setValues({ ...values, creditLimit: event.target.value || null })}
                disabled={disabled}
                placeholder="30 000"
                className="px-3 py-2"
              />
              <span className="ui-helper">Například 30 000 Kč. Zadejte bez mezer.</span>
            </label>
            <label className="ui-label min-w-0">
              <span>Poslední 4 číslice karty</span>
              <input
                inputMode="numeric"
                value={values.cardLast4 ?? ''}
                onChange={(event) => setValues({ ...values, cardLast4: event.target.value || null })}
                disabled={disabled}
                maxLength={4}
                pattern="[0-9]{4}"
                placeholder="1234"
                className="px-3 py-2"
              />
              <span className="ui-helper">Volitelné. Nikdy nezadávejte celé číslo karty.</span>
            </label>
          </>
        ) : null}
        {values.type === 'SAVINGS' ? (
          <>
            <label className="ui-label min-w-0">
              <span>Rezerva v měsících</span>
              <input
                type="number"
                min="1"
                step="1"
                value={values.emergencyReserveMonths ?? ''}
                onChange={(event) => setValues({ ...values, emergencyReserveMonths: event.target.value === '' ? null : Number(event.target.value) })}
                disabled={disabled}
                className="px-3 py-2"
              />
              <span className="ui-helper">Volitelné. Počet měsíců fixních výdajů pro rezervu.</span>
            </label>
            <label className="ui-label min-w-0">
              <span>Roční úrok (%)</span>
              <input
                inputMode="decimal"
                value={values.annualInterestRate ?? ''}
                onChange={(event) => setValues({ ...values, annualInterestRate: event.target.value || null })}
                disabled={disabled}
                placeholder="2.9"
                className="px-3 py-2"
              />
              <span className="ui-helper">Například 2.9 % ročně.</span>
            </label>
            <label className="ui-label min-w-0">
              <span>Daň z úroku (%)</span>
              <input
                inputMode="decimal"
                value={values.interestTaxRate ?? ''}
                onChange={(event) => setValues({ ...values, interestTaxRate: event.target.value || null })}
                disabled={disabled}
                placeholder="15"
                className="px-3 py-2"
              />
              <span className="ui-helper">Například 15 % srážková daň.</span>
            </label>
          </>
        ) : null}
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

function accountIdentifierCopy(provider: AccountInput['provider']): {
  label: string;
  placeholder: string;
  helper: string;
} {
  switch (provider) {
    case 'MONETA':
      return {
        label: 'Číslo účtu',
        placeholder: '123456789/0600',
        helper: 'Použijte číslo zdrojového účtu ze sloupce „Číslo účtu“, nikdy číslo karty. Neshodný import Orbit odmítne.',
      };
    case 'TRADING212':
      return {
        label: 'Identifikátor účtu',
        placeholder: 'Volitelné',
        helper: 'Volitelné označení pro rozlišení účtu. Synchronizace Trading 212 používá propojení přes API.',
      };
    case 'REVOLUT':
      return {
        label: 'Identifikátor účtu',
        placeholder: 'Volitelné',
        helper: 'Slouží pouze pro evidenci. Import výpisů Revolut zatím Orbit nepodporuje.',
      };
    case 'MANUAL':
      return {
        label: 'Vlastní identifikátor',
        placeholder: 'Volitelné',
        helper: 'Volitelné označení pro vlastní orientaci. U ruční evidence se nekontroluje proti výpisu.',
      };
  }
}

function providerCopy(provider: AccountInput['provider']): string {
  switch (provider) {
    case 'MONETA':
      return 'Podporuje import CSV a XML výpisů Moneta.';
    case 'TRADING212':
      return 'Investiční data se synchronizují přes Trading 212 API.';
    case 'REVOLUT':
      return 'Účet lze evidovat, import výpisů Revolut ale není podporován.';
    case 'MANUAL':
      return 'Pro účty bez automatického importu nebo synchronizace.';
  }
}

function formatTransactionCount(count: number): string {
  if (count === 1) return '1 transakce';
  if (count >= 2 && count <= 4) return `${count} transakce`;
  return `${count} transakcí`;
}

function CreditDebtForm({
  currency,
  disabled,
  onCancel,
  onSubmit,
}: {
  currency: string;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (values: { debt: string; asOf: string }) => void;
}): React.JSX.Element {
  const [debt, setDebt] = useState('');
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ debt, asOf });
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-ink-muted">Zadejte kladný aktuální dluh. Uloží se jako záporný zůstatek účtu.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="ui-label min-w-0">
          <span>Aktuální dluh ({currency})</span>
          <input
            inputMode="decimal"
            value={debt}
            onChange={(event) => setDebt(event.target.value)}
            disabled={disabled}
            required
            placeholder="5 000"
            className="px-3 py-2"
          />
        </label>
        <label className="ui-label min-w-0">
          <span>Platný k datu</span>
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            disabled={disabled}
            required
            className="px-3 py-2"
          />
        </label>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" onClick={onCancel} disabled={disabled} className="ui-button ui-button-secondary">
          Zrušit
        </button>
        <button type="submit" disabled={disabled} className="ui-button ui-button-primary">
          {disabled ? 'Ukládám…' : 'Uložit dluh'}
        </button>
      </div>
    </form>
  );
}

function formatMoney(value: string, currency: string): string {
  const [whole, fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const trimmedFraction = fraction?.replace(/0+$/, '');
  return `${grouped}${trimmedFraction ? `,${trimmedFraction}` : ''}\u00a0${currency}`;
}
