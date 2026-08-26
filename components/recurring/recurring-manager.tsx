'use client';

import { Plus, Repeat, WarningCircle, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createRecurringExpense,
  deleteRecurringExpense,
  setRecurringExpenseActive,
  updateRecurringExpense,
  type RecurringExpenseInput,
} from '@/app/(dashboard)/settings/recurring/actions';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyValue } from '@/components/ui/money-value';
import { SectionHeader } from '@/components/ui/page-container';
import { SelectField } from '@/components/ui/select-field';
import { Badge, StatusNotice } from '@/components/ui/status';

interface Category {
  id: string;
  name: string;
}

interface PaymentAccount {
  id: string;
  name: string;
  currency: string;
}

export interface RecurringExpenseRow extends RecurringExpenseInput {
  id: string;
  paymentAccountName: string | null;
  transactionCount: number;
}

type Confirmation = { id: string; action: 'deactivate' | 'delete' } | null;

const SHARE_OPTIONS = [
  { value: '0.3', label: '30 %' },
  { value: '0.4', label: '40 %' },
  { value: '0.5', label: '50 %' },
  { value: '0.6', label: '60 %' },
  { value: '0.7', label: '70 %' },
  { value: '1', label: '100 %' },
];

function emptyValues(): RecurringExpenseInput {
  return {
    name: '',
    categoryId: null,
    expectedAmount: '',
    currency: 'CZK',
    isShared: false,
    myShareRatio: 0.5,
    isActive: true,
    dueDay: null,
    graceDays: 3,
    startsOn: null,
    endsOn: null,
    paymentAccountId: null,
  };
}

export function RecurringExpenseManager({
  expenses,
  categories,
  paymentAccounts,
}: {
  expenses: RecurringExpenseRow[];
  categories: Category[];
  paymentAccounts: PaymentAccount[];
}): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const activeExpenses = expenses.filter((expense) => expense.isActive);
  const inactiveExpenses = expenses.filter((expense) => !expense.isActive);

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

  function renderExpense(expense: RecurringExpenseRow): React.JSX.Element {
    const pendingConfirmation = confirmation?.id === expense.id ? confirmation.action : null;
    const categoryName = expense.categoryId ? (categoryNames.get(expense.categoryId) ?? 'Neznámá kategorie') : 'Bez kategorie';

    if (editingId === expense.id) {
      return (
        <li key={expense.id} className="surface p-4 sm:p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="font-semibold">Upravit fixní výdaj</h3>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              disabled={isPending}
              className="ui-button ui-button-ghost size-10 p-0"
              aria-label="Zavřít úpravu fixního výdaje"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <RecurringExpenseForm
              initial={expense}
              categories={categories}
              paymentAccounts={paymentAccounts}
            submitLabel="Uložit změny"
            pendingLabel="Ukládám…"
            showShareWarning
            onCancel={() => setEditingId(null)}
            onSubmit={(values) =>
              run(
                () => updateRecurringExpense(expense.id, values),
                'Změny fixního výdaje byly uloženy.',
                () => setEditingId(null),
              )
            }
            disabled={isPending}
          />
        </li>
      );
    }

    return (
      <li key={expense.id} className="surface overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className="min-w-0 break-words font-semibold tracking-[-0.015em] [overflow-wrap:anywhere]"
                title={expense.name}
              >
                {expense.name}
              </h3>
              <Badge tone={expense.isShared ? 'info' : 'neutral'}>
                {expense.isShared ? 'Sdílený výdaj' : 'Osobní výdaj'}
              </Badge>
              {!expense.isActive ? <Badge>Neaktivní</Badge> : null}
            </div>
            <p className="mt-2 tabular text-base font-semibold">
              <MoneyValue>{formatAmount(expense.expectedAmount)} {expense.currency}</MoneyValue>
              <span className="ml-1 text-xs font-normal text-ink-muted">měsíčně</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              <span className="min-w-0 break-words [overflow-wrap:anywhere]" title={categoryName}>
                {categoryName}
              </span>
              {expense.isShared ? <span>Váš podíl {Math.round((expense.myShareRatio ?? 0.5) * 100)} %</span> : null}
              <span>{formatLinkedCount(expense.transactionCount)}</span>
            </div>
            <p className="mt-2 text-xs text-ink-muted">{formatSchedule(expense)}</p>
          </div>
          <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setConfirmation(null);
                setEditingId(expense.id);
                setCreating(false);
              }}
              disabled={isPending}
              className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
            >
              Upravit
            </button>
            <button
              type="button"
              onClick={() => {
                if (expense.isActive) {
                  setConfirmation({ id: expense.id, action: 'deactivate' });
                } else {
                  run(() => setRecurringExpenseActive(expense.id, true), 'Fixní výdaj byl aktivován.');
                }
              }}
              disabled={isPending}
              className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
            >
              {expense.isActive ? 'Deaktivovat' : 'Aktivovat'}
            </button>
            {expense.transactionCount === 0 ? (
              <button
                type="button"
                onClick={() => setConfirmation({ id: expense.id, action: 'delete' })}
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
                  {pendingConfirmation === 'deactivate' ? 'Deaktivovat tento výdaj?' : 'Trvale smazat tento výdaj?'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {pendingConfirmation === 'deactivate'
                    ? 'Nebude dostupný pro nové přiřazení. Již propojené transakce zůstanou beze změny.'
                    : 'Výdaj nemá přiřazené transakce. Smazání nelze vrátit zpět.'}
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
                    pendingConfirmation === 'deactivate'
                      ? run(() => setRecurringExpenseActive(expense.id, false), 'Fixní výdaj byl deaktivován.')
                      : run(() => deleteRecurringExpense(expense.id), 'Fixní výdaj byl smazán.')
                  }
                  disabled={isPending}
                  className={`ui-button min-h-9 px-3 py-2 text-xs ${
                    pendingConfirmation === 'delete' ? 'ui-button-danger' : 'ui-button-primary'
                  }`}
                >
                  {isPending
                    ? pendingConfirmation === 'deactivate'
                      ? 'Deaktivuji…'
                      : 'Mažu…'
                    : pendingConfirmation === 'deactivate'
                      ? 'Deaktivovat výdaj'
                      : 'Smazat výdaj'}
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
          title="Aktivní výdaje"
          description={`${activeExpenses.length} ${activeExpenses.length === 1 ? 'aktivní položka' : 'aktivních položek'}`}
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
                Přidat výdaj
              </button>
            ) : undefined
          }
        />

        {creating ? (
          <div className="surface p-4 sm:p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Nový fixní výdaj</h3>
              <button
                type="button"
                onClick={() => setCreating(false)}
                disabled={isPending}
                className="ui-button ui-button-ghost size-10 p-0"
                aria-label="Zavřít formulář nového fixního výdaje"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <RecurringExpenseForm
              initial={emptyValues()}
              categories={categories}
              paymentAccounts={paymentAccounts}
              submitLabel="Vytvořit výdaj"
              pendingLabel="Vytvářím…"
              onCancel={() => setCreating(false)}
              onSubmit={(values) =>
                run(() => createRecurringExpense(values), 'Fixní výdaj byl vytvořen.', () => setCreating(false))
              }
              disabled={isPending}
            />
          </div>
        ) : null}

        {activeExpenses.length > 0 ? (
          <ul className="flex flex-col gap-3">{activeExpenses.map(renderExpense)}</ul>
        ) : !creating ? (
          <EmptyState
            icon={<Repeat size={21} aria-hidden="true" />}
            title="Zatím žádné aktivní fixní výdaje"
            description="Přidejte pravidelný náklad a přiřazujte k němu odpovídající transakce."
            action={
              <button type="button" onClick={() => setCreating(true)} className="ui-button ui-button-primary">
                <Plus size={17} weight="bold" aria-hidden="true" />
                Přidat výdaj
              </button>
            }
          />
        ) : null}
      </section>

      {inactiveExpenses.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader
            title="Neaktivní výdaje"
            description="Nejsou dostupné pro nové přiřazení, jejich dřívější transakce zůstávají zachované."
          />
          <ul className="flex flex-col gap-3">{inactiveExpenses.map(renderExpense)}</ul>
        </section>
      ) : (
        <div className="flex items-center gap-2 border-t border-line pt-5 text-sm text-ink-muted">
          <Repeat size={18} aria-hidden="true" />
          Žádné neaktivní výdaje
        </div>
      )}
    </div>
  );
}

function RecurringExpenseForm({
  initial,
  categories,
  paymentAccounts,
  submitLabel,
  pendingLabel,
  onSubmit,
  onCancel,
  disabled,
  showShareWarning = false,
}: {
  initial: RecurringExpenseInput;
  categories: Category[];
  paymentAccounts: PaymentAccount[];
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: RecurringExpenseInput) => void;
  onCancel: () => void;
  disabled: boolean;
  showShareWarning?: boolean;
}): React.JSX.Element {
  const [values, setValues] = useState<RecurringExpenseInput>(initial);
  const sharingChanged =
    showShareWarning && (values.isShared !== initial.isShared || values.myShareRatio !== initial.myShareRatio);

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
            placeholder="Nájem"
            className="px-3 py-2"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>Očekávaná měsíční částka</span>
          <input
            value={values.expectedAmount}
            onChange={(event) => setValues({ ...values, expectedAmount: event.target.value })}
            disabled={disabled}
            required
            inputMode="decimal"
            placeholder="18200"
            className="px-3 py-2"
          />
        </label>

        <SelectField
          value={values.categoryId ?? ''}
          options={[
            { value: '', label: 'Bez kategorie' },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
          onValueChange={(categoryId) => setValues({ ...values, categoryId: categoryId || null })}
          label="Kategorie"
          disabled={disabled}
        />


        <label className="ui-label min-w-0">
          <span>Den splatnosti</span>
          <input
            type="number"
            value={values.dueDay ?? ''}
            onChange={(event) => setValues({ ...values, dueDay: event.target.value ? Number(event.target.value) : null })}
            disabled={disabled}
            min={1}
            max={31}
            className="px-3 py-2"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>Tolerance ve dnech</span>
          <input
            type="number"
            value={values.graceDays}
            onChange={(event) => setValues({ ...values, graceDays: Number(event.target.value) })}
            disabled={disabled}
            min={0}
            max={31}
            required
            className="px-3 py-2"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>Platí od</span>
          <input
            type="date"
            value={values.startsOn ?? ''}
            onChange={(event) => setValues({ ...values, startsOn: event.target.value || null })}
            disabled={disabled}
            className="px-3 py-2"
          />
        </label>

        <label className="ui-label min-w-0">
          <span>Platí do</span>
          <input
            type="date"
            value={values.endsOn ?? ''}
            onChange={(event) => setValues({ ...values, endsOn: event.target.value || null })}
            disabled={disabled}
            className="px-3 py-2"
          />
        </label>

        <SelectField
          value={values.paymentAccountId ?? ''}
          options={[
            { value: '', label: 'Bez platebního účtu' },
            ...paymentAccounts.map((account) => ({ value: account.id, label: account.name, description: account.currency })),
          ]}
          onValueChange={(paymentAccountId) => setValues({ ...values, paymentAccountId: paymentAccountId || null })}
          label="Platební účet"
          helper="Volitelné. Musí být aktivní neinvestiční účet."
          disabled={disabled}
        />

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

        <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-line bg-surface-subtle px-3 py-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={values.isShared}
            onChange={(event) => setValues({ ...values, isShared: event.target.checked })}
            disabled={disabled}
            className="size-4"
          />
          Sdílený výdaj domácnosti
        </label>

        <SelectField
          value={String(values.myShareRatio ?? 0.5)}
          options={SHARE_OPTIONS}
          onValueChange={(myShareRatio) => setValues({ ...values, myShareRatio: Number(myShareRatio) })}
          label="Váš podíl"
          helper="Určuje vaši část sdíleného nákladu při vyrovnání."
          disabled={disabled || !values.isShared}
        />

        <label className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-line bg-surface-subtle px-3 py-2 text-sm font-medium sm:col-span-2">
          <input
            type="checkbox"
            checked={values.isActive}
            onChange={(event) => setValues({ ...values, isActive: event.target.checked })}
            disabled={disabled}
            className="size-4"
          />
          Aktivní a dostupný pro přiřazení
        </label>
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        Harmonogram určuje na dashboardu stav nadcházející, splatné a po splatnosti. Neodvozuje se z obchodníka transakce.
      </p>

      {sharingChanged ? (
        <div className="flex gap-3 rounded-xl border border-warning/25 bg-[var(--warning-soft)] p-4 text-sm" role="status">
          <WarningCircle size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <p className="leading-relaxed text-ink-muted">
            Uložením se nové sdílení použije i na propojené nevyrovnané transakce.
          </p>
        </div>
      ) : null}

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

function formatAmount(value: string): string {
  const normalized = Number(value);
  return Number.isFinite(normalized)
    ? new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(normalized)
    : value;
}

function formatLinkedCount(count: number): string {
  if (count === 1) return '1 přiřazená transakce';
  if (count >= 2 && count <= 4) return `${count} přiřazené transakce`;
  return `${count} přiřazených transakcí`;
}

function formatSchedule(expense: RecurringExpenseRow): string {
  if (!expense.dueDay) return 'Harmonogram není nastaven';

  const parts = [`Splatnost ${expense.dueDay}. den`, `tolerance ${expense.graceDays} ${expense.graceDays === 1 ? 'den' : 'dny'}`];
  if (expense.startsOn) parts.push(`od ${formatDate(expense.startsOn)}`);
  if (expense.endsOn) parts.push(`do ${formatDate(expense.endsOn)}`);
  if (expense.paymentAccountName) parts.push(`účet ${expense.paymentAccountName}`);
  return parts.join(' · ');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('cs-CZ', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
}
