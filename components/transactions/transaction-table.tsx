'use client';

import {
  ArrowsClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Funnel,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { bulkCategorize, runTransferMatching, updateTransaction } from '@/app/(dashboard)/transactions/actions';
import { applyMerchantCategory, countMerchantCategoryTargets } from '@/app/(dashboard)/transactions/category-actions';
import { mergeSplit, splitTransaction } from '@/app/(dashboard)/transactions/split-actions';
import { MoneyValue } from '@/components/ui/money-value';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Badge } from '@/components/ui/status';
import type { TransactionKind } from '@/lib/generated/prisma/enums';
import { formatPeriod } from '@/lib/ui/period';
import { normalizeMerchant } from '@/lib/finance/idempotency';

export interface TransactionRow {
  id: string;
  accountId: string;
  date: string;
  amount: string;
  currency: string;
  merchant: string | null;
  description: string | null;
  accountName: string;
  categoryId: string | null;
  bucketId: string | null;
  recurringExpenseId: string | null;
  kind: TransactionKind;
  parentId: string | null;
  transferCounterpartyAccount: string | null;
  isShared: boolean;
  paidBy: 'ME' | 'PARTNER';
  myShareRatio: number | null;
  notes: string | null;
  isSettled: boolean;
}

interface Option {
  id: string;
  name: string;
  isActive?: boolean;
}

interface Filters {
  period: string;
  accountId: string;
  categoryId: string;
  shared: boolean;
  uncategorized: boolean;
  q: string;
  flow: string;
  sort: string;
  direction: string;
  absoluteAmount: boolean;
  unmatchedTransfersOnly: boolean;
}

interface Props {
  transactions: TransactionRow[];
  categories: Option[];
  buckets: Option[];
  recurringExpenses: Option[];
  accounts: Option[];
  months: string[];
  filters: Filters;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  categoryManager: React.ReactNode;
  recommendations: MerchantRecommendation[];
  recommendationPeriod: { from: string; to: string } | null;
}

interface MerchantRecommendation {
  accountId: string;
  merchantKey: string;
  merchantLabel: string;
  categoryId: string;
  categoryName: string;
  supportingMonths: number;
  evidenceMonths: number;
  confidence: number;
  targetIds: string[];
  instant?: boolean;
}

const compactFieldClass = 'w-full px-2.5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50';

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function formatPeriodLabel(value: string): string {
  if (value === 'range:1m') return 'Posledních 30 dní';
  if (value === 'range:3m') return 'Poslední 3 měsíce';
  if (value === 'range:6m') return 'Posledních 6 měsíců';
  if (value === 'range:1y') return 'Poslední rok';
  if (value === 'range:all') return 'Od začátku vedení';
  return value.startsWith('month:') ? formatPeriod(value.slice(6)) : value;
}

/** Formats stored decimal strings without converting money through JS numbers. */
function formatTransactionAmount(amount: string, currency: string): string {
  const normalized = amount.trim().replace(',', '.');
  const negative = normalized.startsWith('-');
  const [wholeRaw, fractionRaw = ''] = (negative ? normalized.slice(1) : normalized).split('.');
  const whole = (wholeRaw || '0').replace(/^0+(?=\d)/, '') || '0';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const fraction = fractionRaw.replace(/0+$/, '');
  const value = `${negative ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''}`;

  return `${value}\u00a0${currency === 'CZK' ? 'Kč' : currency}`;
}

export function TransactionTable({
  transactions,
  categories,
  buckets,
  recurringExpenses,
  accounts,
  months,
  filters,
  page,
  pageSize,
  totalCount,
  totalPages,
  categoryManager,
  recommendations,
  recommendationPeriod,
}: Props): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchInfo, setMatchInfo] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [dismissedRecommendations, setDismissedRecommendations] = useState<Set<string>>(new Set());
  const [instantRecommendation, setInstantRecommendation] = useState<MerchantRecommendation | null>(null);

  const navigate = useCallback(
    (update: (params: URLSearchParams) => void, resetPage = false) => {
      const next = new URLSearchParams(searchParams.toString());
      update(next);

      if (resetPage) {
        next.delete('page');
      }

      setSelected(new Set());
      setExpanded(null);
      setError(null);
      startTransition(() => router.push(next.size > 0 ? `/transactions?${next.toString()}` : '/transactions'));
    },
    [router, searchParams],
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      navigate((next) => {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }

        if (key === 'uncategorized' && value) {
          next.delete('categoryId');
        }

        if (key === 'categoryId' && value) {
          next.delete('uncategorized');
        }
      }, true);
    },
    [navigate],
  );

  const resetFilters = useCallback(() => {
    setSearchDraft('');
    navigate((next) => {
      for (const key of ['accountId', 'categoryId', 'shared', 'uncategorized', 'q', 'flow', 'transfer', 'sort', 'direction', 'absolute', 'page']) {
        next.delete(key);
      }
      next.set('period', 'range:3m');
    });
  }, [navigate]);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const activeCategories = useMemo(() => categories.filter((category) => category.isActive !== false), [categories]);
  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);

  const selectableIds = transactions.filter((transaction) => !transaction.isSettled).map((transaction) => transaction.id);
  const allPageSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const activeFilterCount = [
    filters.period === 'range:3m' ? '' : filters.period,
    filters.accountId,
    filters.categoryId,
    filters.shared,
    filters.uncategorized,
    filters.q, filters.flow, filters.unmatchedTransfersOnly,
  ].filter(Boolean).length;
  const firstResult = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResult = Math.min(page * pageSize, totalCount);

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }, []);

  const togglePage = (): void => {
    setSelected((current) => {
      const next = new Set(current);

      for (const id of selectableIds) {
        if (allPageSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });
  };

  const applyBulkCategory = useCallback(
    (categoryId: string) => {
      if (selected.size === 0) {
        return;
      }

      startTransition(async () => {
        const result = await bulkCategorize([...selected], categoryId || null);

        if (!result.ok) {
          setError(result.error ?? 'Uložení selhalo');
          return;
        }

        setSelected(new Set());
        setError(null);
        router.refresh();
      });
    },
    [router, selected],
  );

  const onMatchTransfers = useCallback(() => {
    startTransition(async () => {
      const result = await runTransferMatching();

      if (!result.ok) {
        setError(result.error ?? 'Párování selhalo');
        return;
      }

      setError(null);
      setMatchInfo(
        `Spárováno ${result.matched ?? 0}${result.ambiguous ? `, nejednoznačných ${result.ambiguous}` : ''}`,
      );
      router.refresh();
    });
  }, [router]);

  const suggestSameMerchant = useCallback(
    (transaction: TransactionRow, categoryId: string): void => {
      if (!recommendationPeriod || !transaction.merchant) return;
      const merchantKey = normalizeMerchant(transaction.merchant);
      const categoryName = categoryNames.get(categoryId);
      if (!merchantKey || !categoryName) return;
      void countMerchantCategoryTargets({
        accountId: transaction.accountId,
        categoryId,
        merchantKey,
        from: recommendationPeriod.from,
        to: recommendationPeriod.to,
      })
        .then((result) => {
          if (!result.ok || !result.count) return;
          setInstantRecommendation({
            accountId: transaction.accountId,
            merchantKey,
            merchantLabel: transaction.merchant ?? merchantKey,
            categoryId,
            categoryName,
            supportingMonths: 0,
            evidenceMonths: 0,
            confidence: 0,
            targetIds: Array.from({ length: result.count }, (_, index) => String(index)),
            instant: true,
          });
        })
        .catch(() => undefined);
    },
    [categoryNames, recommendationPeriod],
  );

  const submitSearch = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFilter('q', searchDraft.trim());
  };

  const clearSearch = (): void => {
    setSearchDraft('');
    setFilter('q', '');
  };

  const setPage = (nextPage: number): void => {
    navigate((next) => {
      if (nextPage <= 1) {
        next.delete('page');
      } else {
        next.set('page', String(nextPage));
      }
    });
  };

  const setSort = (sort: 'date' | 'amount'): void => {
    const direction = filters.sort === sort && filters.direction === 'desc' ? 'asc' : 'desc';
    navigate((next) => {
      next.set('sort', sort);
      next.set('direction', direction);
      if (sort === 'date') next.delete('absolute');
    }, true);
  };

  const setSortValue = (value: string): void => {
    const [sort, direction] = value.split('-');
    navigate((next) => {
      next.set('sort', sort === 'amount' ? 'amount' : 'date');
      next.set('direction', direction === 'asc' ? 'asc' : 'desc');
      if (sort !== 'amount') next.delete('absolute');
    }, true);
  };

  const setAbsoluteAmount = (checked: boolean): void => {
    navigate((next) => {
      if (checked) next.set('absolute', '1');
      else next.delete('absolute');
    }, true);
  };

  const sortLabel = (sort: 'date' | 'amount'): React.JSX.Element => {
    const active = filters.sort === sort;
    const ascending = active && filters.direction === 'asc';
    return (
      <button type="button" onClick={() => setSort(sort)} className="inline-flex items-center gap-1 font-semibold hover:text-ink" aria-label={`Řadit podle ${sort === 'date' ? 'data' : 'částky'} ${ascending ? 'sestupně' : 'vzestupně'}`}>
        {sort === 'date' ? 'Datum' : 'Částka'}
        {active ? ascending ? <CaretUp size={13} aria-hidden="true" /> : <CaretDown size={13} aria-hidden="true" /> : null}
      </button>
    );
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="ledger-heading" aria-busy={isPending}>
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-subtle px-4 py-3 md:px-5">
          <div>
            <div className="flex items-center gap-2">
              <Funnel size={18} aria-hidden="true" className="text-accent" />
              <h2 id="ledger-heading" className="section-title">Přehled transakcí</h2>
              {activeFilterCount > 0 ? <Badge tone="info">{activeFilterCount} aktivní</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-ink-muted">{firstResult}–{lastResult} z {totalCount.toLocaleString('cs-CZ')}</p>
          </div>
          <button type="button" onClick={onMatchTransfers} disabled={isPending} className="ui-button ui-button-secondary">
            <ArrowsClockwise size={17} aria-hidden="true" />
            Spárovat převody
          </button>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-2 md:p-5 xl:grid-cols-4">
          <SelectField
            label="Období"
            value={filters.period}
            disabled={isPending}
            onValueChange={(value) => setFilter('period', value)}
            options={[
              { value: 'range:1m', label: 'Posledních 30 dní' },
              { value: 'range:3m', label: 'Poslední 3 měsíce' },
              { value: 'range:6m', label: 'Posledních 6 měsíců' },
              { value: 'range:1y', label: 'Poslední rok' },
              { value: 'range:all', label: 'Od začátku vedení' },
              ...months.map((month) => ({ value: `month:${month}`, label: formatPeriod(month) })),
            ]}
          />
          <SelectField
            label="Účet"
            value={filters.accountId}
            disabled={isPending}
            onValueChange={(value) => setFilter('accountId', value)}
            options={[{ value: '', label: 'Všechny účty' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]}
          />
          <SelectField label="Tok" value={filters.flow} disabled={isPending} onValueChange={(value) => setFilter('flow', value)} options={[{ value: '', label: 'Příjmy i výdaje' }, { value: 'expense', label: 'Jen výdaje' }, { value: 'income', label: 'Jen příjmy' }]} />
          <SelectField
            label="Kategorie"
            value={filters.categoryId}
            disabled={isPending}
            onValueChange={(value) => setFilter('categoryId', value)}
            options={[{ value: '', label: 'Všechny kategorie' }, ...activeCategories.map((category) => ({ value: category.id, label: category.name }))]}
          />
          <form onSubmit={submitSearch} className="flex flex-col gap-1.5 md:col-span-2 xl:col-span-1">
            <label htmlFor="transaction-search" className="text-sm font-medium">Hledat</label>
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-0 flex-[1_1_12rem]">
                <MagnifyingGlass size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
                <input
                  id="transaction-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Protistrana nebo poznámka"
                  className="w-full py-2 pl-9 pr-3 text-sm"
                />
              </div>
              <button type="submit" className="ui-button ui-button-primary" disabled={isPending}>Hledat</button>
              {filters.q || searchDraft ? (
                <button type="button" onClick={clearSearch} className="ui-button ui-button-secondary px-3" aria-label="Vymazat hledání">
                  <X size={17} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </form>
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-line bg-surface-subtle/45 px-4 py-3 md:px-5">
          <SelectField label="Řazení" value={`${filters.sort}-${filters.direction}`} className="w-full sm:w-56" disabled={isPending} onValueChange={setSortValue} options={[{ value: 'date-desc', label: 'Nejnovější datum' }, { value: 'date-asc', label: 'Nejstarší datum' }, { value: 'amount-desc', label: 'Částka: nejvyšší' }, { value: 'amount-asc', label: 'Částka: nejnižší' }]} />
          {filters.sort === 'amount' ? (
            <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={filters.absoluteAmount} onChange={(event) => setAbsoluteAmount(event.target.checked)} disabled={isPending} className="size-4" />
              Podle absolutní hodnoty
            </label>
          ) : null}
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={filters.uncategorized}
              onChange={(event) => setFilter('uncategorized', event.target.checked ? '1' : '')}
              className="size-4"
            />
            Bez kategorie
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={filters.shared}
              onChange={(event) => setFilter('shared', event.target.checked ? '1' : '')}
              className="size-4"
            />
            Jen sdílené
          </label>
          {activeFilterCount > 0 ? (
            <button type="button" onClick={resetFilters} className="ui-button ui-button-ghost ml-auto">
              <X size={16} aria-hidden="true" />
              Zrušit všechny filtry
            </button>
          ) : null}
        </div>

        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-line bg-surface-subtle px-4 py-3 md:px-5" aria-label="Aktivní filtry">
            {filters.period ? <FilterChip label={formatPeriodLabel(filters.period)} onRemove={() => setFilter('period', 'range:3m')} /> : null}
            {filters.accountId ? <FilterChip label={accountNames.get(filters.accountId) ?? 'Účet'} onRemove={() => setFilter('accountId', '')} /> : null}
            {filters.categoryId ? <FilterChip label={categoryNames.get(filters.categoryId) ?? 'Kategorie'} onRemove={() => setFilter('categoryId', '')} /> : null}
            {filters.uncategorized ? <FilterChip label="Bez kategorie" onRemove={() => setFilter('uncategorized', '')} /> : null}
            {filters.shared ? <FilterChip label="Jen sdílené" onRemove={() => setFilter('shared', '')} /> : null}
            {filters.q ? <FilterChip label={`Hledání: ${filters.q}`} onRemove={clearSearch} /> : null}
            {filters.flow ? <FilterChip label={filters.flow === 'income' ? 'Jen příjmy' : 'Jen výdaje'} onRemove={() => setFilter('flow', '')} /> : null}
            {filters.unmatchedTransfersOnly ? <FilterChip label="Nespárované převody" onRemove={() => setFilter('transfer', '')} /> : null}
          </div>
        ) : null}
      </div>

      {categoryManager}

      {instantRecommendation && recommendationPeriod ? (
        <section className="surface border-accent/25 bg-[var(--accent-soft)] p-4 md:p-5" aria-label="Hromadná kategorie">
          <div className="mb-3">
            <h3 className="section-title">Použít stejnou kategorii?</h3>
            <p className="mt-1 text-sm text-ink-muted">Právě jste přiřadili kategorii jedné platbě. Stejný obchodník má další nezařazené platby v tomto měsíci.</p>
          </div>
          <MerchantRecommendationCard recommendation={instantRecommendation} period={recommendationPeriod} onDismiss={() => setInstantRecommendation(null)} onApplied={() => { setInstantRecommendation(null); router.refresh(); }} />
        </section>
      ) : null}

      {recommendationPeriod && recommendations.some((item) => !dismissedRecommendations.has(item.merchantKey)) ? (
        <section className="surface border-accent/20 bg-[var(--accent-soft)] p-4 md:p-5" aria-label="Návrhy kategorií">
          <div className="mb-3">
            <h3 className="section-title">Návrhy kategorií</h3>
            <p className="mt-1 text-sm text-ink-muted">Stejná protistrana byla v minulých měsících zařazená shodně. Použití vždy potvrdíte.</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {recommendations.filter((item) => !dismissedRecommendations.has(item.merchantKey)).map((item) => (
              <MerchantRecommendationCard
                key={`${item.accountId}-${item.merchantKey}-${item.categoryId}`}
                recommendation={item}
                period={recommendationPeriod}
                onDismiss={() => setDismissedRecommendations((current) => new Set([...current, item.merchantKey]))}
                onApplied={() => router.refresh()}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={allPageSelected}
            onChange={togglePage}
            disabled={selectableIds.length === 0}
            className="size-4"
          />
          Vybrat upravitelné na této stránce
        </label>
        {selected.size > 0 ? <span className="text-sm text-ink-muted">Vybráno {selected.size}</span> : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-critical/25 bg-[var(--critical-soft)] px-4 py-3 text-sm text-critical">
          <span className="font-semibold">Změnu se nepodařilo uložit.</span> {error}
        </div>
      ) : null}
      {matchInfo ? <p role="status" className="rounded-xl border border-positive/25 bg-[var(--positive-soft)] px-4 py-3 text-sm text-ink">{matchInfo}</p> : null}
      {isPending ? <p role="status" aria-live="polite" className="text-sm text-ink-muted">Zpracovávám změnu…</p> : null}

      {transactions.length > 0 ? (
        <>
          <div className="surface hidden overflow-x-auto md:block">
            <table className="data-table min-w-[58rem]">
              <thead>
                <tr>
                  <th className="w-12 px-4 py-3"><span className="sr-only">Výběr</span></th>
                  <th className="px-3 py-3">{sortLabel('date')}</th>
                  <th className="px-3 py-3">Protistrana</th>
                  <th className="px-3 py-3">Kategorie</th>
                  <th className="px-3 py-3">Stav</th>
                  <th className="px-4 py-3 text-right">{sortLabel('amount')}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <TransactionRowView
                    key={transaction.id}
                    transaction={transaction}
                    categories={categories}
                    buckets={buckets}
                    recurringExpenses={recurringExpenses}
                    categoryName={transaction.categoryId ? categoryNames.get(transaction.categoryId) : undefined}
                    selected={selected.has(transaction.id)}
                    onToggleSelected={() => toggleSelected(transaction.id)}
                    expanded={expanded === transaction.id}
                    onToggleExpanded={() => setExpanded(expanded === transaction.id ? null : transaction.id)}
                    onError={setError}
                    onCategoryAssigned={suggestSameMerchant}
                    layout="desktop"
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {transactions.map((transaction) => (
              <TransactionRowView
                key={transaction.id}
                transaction={transaction}
                categories={categories}
                buckets={buckets}
                recurringExpenses={recurringExpenses}
                categoryName={transaction.categoryId ? categoryNames.get(transaction.categoryId) : undefined}
                selected={selected.has(transaction.id)}
                onToggleSelected={() => toggleSelected(transaction.id)}
                expanded={expanded === transaction.id}
                onToggleExpanded={() => setExpanded(expanded === transaction.id ? null : transaction.id)}
                    onError={setError}
                    onCategoryAssigned={suggestSameMerchant}
                    layout="mobile"
              />
            ))}
          </div>
        </>
      ) : (
        <div className="surface px-6 py-12 text-center">
          <p className="font-semibold">Žádné odpovídající transakce</p>
          <p className="mt-1 text-sm text-ink-muted">Zkuste upravit hledání nebo zrušit některý filtr.</p>
          {activeFilterCount > 0 ? <button type="button" onClick={resetFilters} className="ui-button ui-button-secondary mt-4">Zrušit filtry</button> : null}
        </div>
      )}

      {selected.size > 0 ? (
        <div className="sticky bottom-4 z-20 flex max-w-full flex-wrap items-center gap-3 rounded-xl border border-accent/25 bg-[var(--surface-raised)] p-3 shadow-[0_12px_40px_rgb(23_33_31/18%)] md:px-4" aria-label="Hromadné úpravy">
          <span className="mr-auto min-w-0 text-sm font-semibold">Vybráno {selected.size} transakcí</span>
          <SelectField
            value="bulk-category"
            ariaLabel="Nastavit kategorii vybraným transakcím"
            disabled={isPending}
            className="w-full max-w-full sm:w-64"
            onValueChange={applyBulkCategory}
            options={[
              { value: 'bulk-category', label: 'Vybrat kategorii…', disabled: true },
              { value: '', label: 'Bez kategorie' },
               ...activeCategories.map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
          <button type="button" onClick={() => setSelected(new Set())} className="ui-button ui-button-ghost">Zrušit výběr</button>
        </div>
      ) : null}

      {totalPages > 1 ? (
        <nav aria-label="Stránkování transakcí" className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-sm text-ink-muted">Stránka {page} z {totalPages}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPage(page - 1)} disabled={page <= 1 || isPending} className="ui-button ui-button-secondary">
              <CaretLeft size={17} aria-hidden="true" /> Předchozí
            </button>
            <button type="button" onClick={() => setPage(page + 1)} disabled={page >= totalPages || isPending} className="ui-button ui-button-secondary">
              Další <CaretRight size={17} aria-hidden="true" />
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onRemove} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-accent/25 bg-[var(--accent-soft)] px-3 text-xs font-medium text-ink">
      {label}<X size={13} aria-hidden="true" /><span className="sr-only">Odebrat filtr {label}</span>
    </button>
  );
}

function MerchantRecommendationCard({
  recommendation,
  period,
  onDismiss,
  onApplied,
}: {
  recommendation: MerchantRecommendation;
  period: { from: string; to: string };
  onDismiss: () => void;
  onApplied: () => void;
}): React.JSX.Element {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply(): void {
    startTransition(async () => {
      const result = await applyMerchantCategory({
        accountId: recommendation.accountId,
        categoryId: recommendation.categoryId,
        merchantKey: recommendation.merchantKey,
        from: period.from,
        to: period.to,
      });
      if (!result.ok) {
        setError(result.error ?? 'Návrh už není platný.');
        return;
      }
      onApplied();
    });
  }

  return (
    <article className="rounded-xl border border-line bg-[var(--surface-raised)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold">{recommendation.merchantLabel}</p>
          <p className="mt-1 text-sm text-ink-muted">Doporučená kategorie: <span className="font-semibold text-ink">{recommendation.categoryName}</span></p>
        </div>
        <Badge tone="info">{recommendation.instant ? 'Právě vybráno' : `${Math.round(recommendation.confidence * 100)} % shoda`}</Badge>
      </div>
      <p className="mt-3 text-xs text-ink-muted">
        {recommendation.instant
          ? `${recommendation.targetIds.length} dalších nezařazených plateb v tomto měsíci`
          : `${recommendation.supportingMonths} z ${recommendation.evidenceMonths} předchozích měsíců · ${recommendation.targetIds.length} nezařazených plateb v tomto měsíci`}
      </p>
      {error ? <p role="alert" className="mt-2 text-xs text-critical">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={apply} disabled={isPending} className="ui-button ui-button-primary">{isPending ? 'Používám…' : `Použít na ${recommendation.targetIds.length} plateb`}</button>
        <button type="button" onClick={onDismiss} disabled={isPending} className="ui-button ui-button-ghost">Skrýt pro tento měsíc</button>
      </div>
    </article>
  );
}

function TransactionRowView({
  transaction,
  categories,
  buckets,
  recurringExpenses,
  categoryName,
  selected,
  onToggleSelected,
  expanded,
  onToggleExpanded,
  onError,
  onCategoryAssigned,
  layout,
}: {
  transaction: TransactionRow;
  categories: Option[];
  buckets: Option[];
  recurringExpenses: Option[];
  categoryName: string | undefined;
  selected: boolean;
  onToggleSelected: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onError: (message: string | null) => void;
  onCategoryAssigned: (transaction: TransactionRow, categoryId: string) => void;
  layout: 'desktop' | 'mobile';
}): React.JSX.Element {
  const router = useRouter();
  const [rowPending, startTransition] = useTransition();
  const [draft, setDraft] = useState(transaction);
  const [splitting, setSplitting] = useState(false);
  const editorId = `transaction-editor-${layout}-${transaction.id}`;

  const save = useCallback(
    (patch: Partial<TransactionRow>) => {
      const next = { ...draft, ...patch };
      setDraft(next);

      startTransition(async () => {
        if (next.kind === 'SPLIT_PARENT') {
          return;
        }

        const result = await updateTransaction({
          id: next.id,
          categoryId: next.categoryId,
          bucketId: next.bucketId,
          recurringExpenseId: next.recurringExpenseId,
          kind: next.kind,
          isShared: next.kind === 'NORMAL' ? next.isShared : false,
          paidBy: next.paidBy,
          myShareRatio: next.kind === 'NORMAL' && next.isShared ? (next.myShareRatio ?? 0.5) : null,
          notes: next.notes,
        });

        if (!result.ok) {
          onError(result.error ?? 'Uložení selhalo');
          setDraft(transaction);
          return;
        }

        onError(null);
        if (patch.categoryId && transaction.categoryId === null) {
          onCategoryAssigned(next, patch.categoryId);
        }
        router.refresh();
      });
    },
    [draft, onCategoryAssigned, onError, router, transaction],
  );

  const onMerge = useCallback(() => {
    if (!draft.parentId) {
      return;
    }

    startTransition(async () => {
      const result = await mergeSplit(draft.parentId as string);

      if (!result.ok) {
        onError(result.error ?? 'Zrušení rozdělení selhalo');
        return;
      }

      onError(null);
      router.refresh();
    });
  }, [draft.parentId, onError, router]);

  const isExpense = draft.amount.startsWith('-');
  const merchant = draft.merchant ?? draft.description ?? 'Bez názvu';
  const status = draft.kind === 'PENDING_TRANSFER'
    ? 'Broker převod · čeká na banku'
    : draft.kind === 'INTERNAL_TRANSFER'
    ? draft.transferCounterpartyAccount
      ? `Převod · ${draft.transferCounterpartyAccount}`
      : 'Převod · nespárováno'
    : draft.kind === 'SETTLEMENT'
      ? 'Vyrovnání'
      : draft.isShared
        ? `Sdílené · ${Math.round((draft.myShareRatio ?? 0.5) * 100)} %`
        : 'Osobní';

  const editor = (
    <div id={editorId} className="flex min-w-0 flex-col gap-5" aria-busy={rowPending}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">Podrobnosti a zařazení</h3>
          {draft.description ? <p title={draft.description} className="mt-1 break-words text-sm text-ink-muted">{draft.description}</p> : null}
        </div>
        {draft.isSettled ? <Badge tone="neutral">Uzavřeno ve vyrovnání</Badge> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <EditorSelect
          label="Druh"
          value={draft.kind}
          disabled={draft.isSettled || rowPending}
          onChange={(value) => save({ kind: value as TransactionRow['kind'] })}
          options={[
            { value: 'NORMAL', label: 'Běžná transakce' },
            { value: 'INTERNAL_TRANSFER', label: 'Převod mezi mými účty' },
            { value: 'PENDING_TRANSFER', label: 'Broker převod čekající na banku' },
            { value: 'SETTLEMENT', label: 'Vyrovnání s partnerem' },
          ]}
        />
        <EditorSelect
          label="Platil"
          value={draft.paidBy}
          disabled={draft.isSettled || rowPending}
          onChange={(value) => save({ paidBy: value === 'PARTNER' ? 'PARTNER' : 'ME' })}
          options={[{ value: 'ME', label: 'Já' }, { value: 'PARTNER', label: 'Partner' }]}
        />
        <label className="ui-label">
          Sdílení
          <span className="flex min-h-[2.625rem] items-center gap-2 rounded-[0.625rem] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 text-sm font-normal">
            <input
              type="checkbox"
              checked={draft.isShared}
              disabled={draft.isSettled || draft.kind !== 'NORMAL' || rowPending}
              onChange={(event) => save({ isShared: event.target.checked })}
              className="size-4"
            />
            Sdílená transakce
          </span>
        </label>
        <EditorSelect
          label="Můj podíl"
          value={String(draft.myShareRatio ?? 0.5)}
          disabled={!draft.isShared || draft.isSettled || rowPending}
          onChange={(value) => save({ myShareRatio: Number(value) })}
          options={[
            { value: '0.5', label: '50 %' }, { value: '0.6', label: '60 %' }, { value: '0.7', label: '70 %' },
            { value: '0.4', label: '40 %' }, { value: '0.3', label: '30 %' }, { value: '1', label: '100 %' },
          ]}
        />
        <EditorSelect
          label="Obálka"
          value={draft.bucketId ?? ''}
          disabled={draft.isSettled || rowPending}
          onChange={(value) => save({ bucketId: value || null })}
          options={[{ value: '', label: 'Žádná' }, ...buckets.map((bucket) => ({ value: bucket.id, label: bucket.name }))]}
        />
        <EditorSelect
          label="Fixní výdaj"
          value={draft.recurringExpenseId ?? ''}
          disabled={draft.isSettled || rowPending}
          onChange={(value) => save({ recurringExpenseId: value || null })}
          options={[{ value: '', label: 'Žádný' }, ...recurringExpenses.map((expense) => ({ value: expense.id, label: expense.name }))]}
        />
        <label className="ui-label">
          Poznámka
          <input
            defaultValue={draft.notes ?? ''}
            disabled={draft.isSettled || rowPending}
            onBlur={(event) => {
              if (event.target.value !== (draft.notes ?? '')) {
                save({ notes: event.target.value || null });
              }
            }}
            className={compactFieldClass}
          />
        </label>
      </div>

      {rowPending ? <p role="status" aria-live="polite" className="text-sm text-ink-muted">Ukládám změny…</p> : null}

      {draft.parentId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/25 bg-[var(--warning-soft)] p-3 text-sm">
          <span>Tato položka je část rozdělené platby.</span>
          {!draft.isSettled ? <button type="button" onClick={onMerge} disabled={rowPending} className="ui-button ui-button-secondary">Zrušit rozdělení</button> : null}
        </div>
      ) : null}

      {draft.kind === 'NORMAL' && !draft.isSettled ? (
        splitting ? (
          <SplitEditor
            parentId={draft.id}
            parentAmount={draft.amount}
            currency={draft.currency}
            categories={categories}
            onDone={() => {
              setSplitting(false);
              onError(null);
              router.refresh();
            }}
            onCancel={() => setSplitting(false)}
            onError={onError}
          />
        ) : (
          <button type="button" onClick={() => setSplitting(true)} className="ui-button ui-button-secondary self-start">Rozdělit transakci</button>
        )
      ) : null}
    </div>
  );

  if (layout === 'mobile') {
    return (
      <article className={`surface overflow-hidden ${expanded ? 'ring-1 ring-accent/25' : ''}`}>
        <div className="p-4">
          <div className="flex items-start gap-3">
            <label className="mt-1 flex items-center">
              <input type="checkbox" checked={selected} onChange={onToggleSelected} disabled={draft.isSettled} className="size-4" />
              <span className="sr-only">Vybrat transakci {merchant}</span>
            </label>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p title={merchant} className="break-words font-semibold text-ink">{merchant}</p>
                  <p title={draft.accountName} className="mt-0.5 break-words text-xs text-ink-muted">{formatDate(draft.date)} · {draft.accountName}</p>
                </div>
                <p className={`tabular max-w-full break-words font-semibold sm:shrink-0 sm:text-right ${isExpense ? 'text-ink' : 'text-positive'}`}><MoneyValue>{formatTransactionAmount(draft.amount, draft.currency)}</MoneyValue></p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={draft.kind === 'NORMAL' ? (draft.isShared ? 'info' : 'neutral') : 'warning'}>{status}</Badge>
                {draft.isSettled ? <Badge tone="neutral">Vyrovnáno</Badge> : null}
              </div>
              <SelectField
                label="Kategorie"
                value={draft.categoryId ?? ''}
                onValueChange={(value) => save({ categoryId: value || null })}
                disabled={draft.isSettled || rowPending}
                className="mt-4"
                options={[
                  { value: '', label: categoryName ? 'Odebrat kategorii' : 'Bez kategorie' },
                   ...categories.filter((category) => category.isActive !== false).map((category) => ({ value: category.id, label: category.name })),
                ]}
              />
              <button type="button" onClick={onToggleExpanded} aria-expanded={expanded} aria-controls={editorId} className="ui-button ui-button-ghost mt-3 w-full">
                {expanded ? <CaretUp size={17} aria-hidden="true" /> : <CaretDown size={17} aria-hidden="true" />}
                {expanded ? 'Skrýt podrobnosti' : 'Zobrazit a upravit podrobnosti'}
              </button>
            </div>
          </div>
        </div>
        {expanded ? <div className="border-t border-line bg-surface-subtle p-4">{editor}</div> : null}
      </article>
    );
  }

  return (
    <>
      <tr className={expanded ? 'bg-[var(--accent-soft)]/35' : 'hover:bg-surface-subtle/60'}>
        <td className="px-4 py-3 align-middle">
          <label className="flex items-center">
            <input type="checkbox" checked={selected} onChange={onToggleSelected} disabled={draft.isSettled} className="size-4" />
            <span className="sr-only">Vybrat transakci {merchant}</span>
          </label>
        </td>
        <td className="tabular whitespace-nowrap px-3 py-3 text-ink-muted">{formatDate(draft.date)}</td>
        <td className="max-w-xs px-3 py-3">
          <p title={merchant} className="truncate font-semibold text-ink">{merchant}</p>
          <p title={draft.accountName} className="mt-0.5 truncate text-xs text-ink-muted">{draft.accountName}{draft.parentId ? ' · část rozdělené platby' : ''}</p>
        </td>
        <td className="px-3 py-3">
          <SelectField
            value={draft.categoryId ?? ''}
            ariaLabel={`Kategorie transakce ${merchant}`}
            onValueChange={(value) => save({ categoryId: value || null })}
            disabled={draft.isSettled || rowPending}
            className="max-w-48"
            buttonClassName="text-xs"
            options={[
              { value: '', label: categoryName ? 'Odebrat kategorii' : 'Bez kategorie' },
                ...categories.filter((category) => category.isActive !== false).map((category) => ({ value: category.id, label: category.name })),
            ]}
          />
        </td>
        <td className="px-3 py-3"><Badge tone={draft.kind === 'NORMAL' ? (draft.isShared ? 'info' : 'neutral') : 'warning'}>{status}</Badge></td>
        <td className="px-4 py-3 text-right">
          <p className={`tabular whitespace-nowrap font-semibold ${isExpense ? 'text-ink' : 'text-positive'}`}><MoneyValue>{formatTransactionAmount(draft.amount, draft.currency)}</MoneyValue></p>
          <button type="button" onClick={onToggleExpanded} aria-expanded={expanded} aria-controls={editorId} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            {expanded ? 'Skrýt' : 'Podrobnosti'}
            {expanded ? <CaretUp size={13} aria-hidden="true" /> : <CaretDown size={13} aria-hidden="true" />}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6} className="bg-surface-subtle px-5 py-5">{editor}</td>
        </tr>
      ) : null}
    </>
  );
}

function EditorSelect({
  label,
  value,
  disabled,
  onChange,
  options,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
}): React.JSX.Element {
  return <SelectField label={label} value={value} disabled={disabled} onValueChange={onChange} options={options} />;
}

interface SplitLineDraft {
  amount: string;
  categoryId: string | null;
  isShared: boolean;
  myShareRatio: number;
  notes: string;
}

/** Exact cents keep live split balance free from floating-point rounding. */
function toCents(raw: string): bigint | null {
  const match = /^-?\d+(?:[.,]\d{1,2})?$/.exec(raw.trim());

  if (!match) {
    return null;
  }

  const normalized = raw.trim().replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  const sign = whole.startsWith('-') ? -1n : 1n;
  const digits = BigInt(whole.replace('-', '') || '0') * 100n + BigInt(fraction.padEnd(2, '0'));

  return sign * digits;
}

function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;

  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function SplitEditor({
  parentId,
  parentAmount,
  currency,
  categories,
  onDone,
  onCancel,
  onError,
}: {
  parentId: string;
  parentAmount: string;
  currency: string;
  categories: Option[];
  onDone: () => void;
  onCancel: () => void;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const [isPending, startTransition] = useTransition();
  const [lines, setLines] = useState<SplitLineDraft[]>([
    { amount: '', categoryId: null, isShared: false, myShareRatio: 0.5, notes: '' },
    { amount: '', categoryId: null, isShared: false, myShareRatio: 0.5, notes: '' },
  ]);

  const parentCents = toCents(parentAmount) ?? 0n;
  const lineCents = lines.map((line) => toCents(line.amount));
  const allLinesValid = lineCents.every((cents) => cents !== null);
  const remainingCents = allLinesValid
    ? lineCents.reduce<bigint>((remaining, cents) => remaining - (cents as bigint), parentCents)
    : null;
  const isBalanced = remainingCents === 0n;

  const updateLine = (index: number, patch: Partial<SplitLineDraft>): void => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const submit = (): void => {
    if (!isBalanced) {
      return;
    }

    startTransition(async () => {
      const result = await splitTransaction({
        parentId,
        lines: lines.map((line) => ({
          amount: line.amount,
          categoryId: line.categoryId,
          isShared: line.isShared,
          myShareRatio: line.isShared ? line.myShareRatio : null,
          notes: line.notes || null,
        })),
      });

      if (!result.ok) {
        onError(result.error ?? 'Rozdělení selhalo');
        return;
      }

      onDone();
    });
  };

  return (
    <div className="rounded-xl border border-accent/20 bg-surface p-4 md:p-5">
      <div className="mb-4">
        <h4 className="font-semibold">Rozdělit transakci</h4>
        <p className="mt-1 text-sm text-ink-muted">Součet částí musí přesně odpovídat původní částce {parentAmount} {currency}.</p>
      </div>
      <div className="flex flex-col gap-3">
        {lines.map((line, index) => (
          <fieldset key={index} className="grid min-w-0 gap-3 rounded-xl border border-line bg-[var(--surface-raised)] p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,8rem)_minmax(0,12rem)_minmax(0,1fr)_auto]">
            <legend className="px-1 text-xs font-semibold text-ink-muted">Část {index + 1}</legend>
            <label className="ui-label">Částka<input value={line.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} inputMode="decimal" placeholder="0,00" className={compactFieldClass} /></label>
            <SelectField
              label="Kategorie"
              value={line.categoryId ?? ''}
              onValueChange={(value) => updateLine(index, { categoryId: value || null })}
               options={[{ value: '', label: 'Bez kategorie' }, ...categories.filter((category) => category.isActive !== false).map((category) => ({ value: category.id, label: category.name }))]}
            />
            <label className="ui-label">Poznámka<input value={line.notes} onChange={(event) => updateLine(index, { notes: event.target.value })} placeholder="Volitelné" className={compactFieldClass} /></label>
            <div className="flex items-end gap-2">
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={line.isShared} onChange={(event) => updateLine(index, { isShared: event.target.checked })} className="size-4" />Sdílené</label>
              {lines.length > 2 ? <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="ui-button ui-button-ghost px-2" aria-label={`Odebrat část ${index + 1}`}><X size={16} aria-hidden="true" /></button> : null}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setLines((current) => [...current, { amount: '', categoryId: null, isShared: false, myShareRatio: 0.5, notes: '' }])} className="ui-button ui-button-secondary">Přidat část</button>
        <p role="status" className={`text-sm font-semibold ${isBalanced ? 'text-positive' : 'text-critical'}`}>
          {remainingCents === null ? 'Zadejte platné částky' : `Zbývá rozdělit: ${formatCents(remainingCents)} ${currency}`}
        </p>
      </div>

      {isPending ? <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">Rozděluji transakci…</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={submit} disabled={!isBalanced || isPending} className="ui-button ui-button-primary">Potvrdit rozdělení</button>
        <button type="button" onClick={onCancel} disabled={isPending} className="ui-button ui-button-secondary">Zrušit</button>
      </div>
    </div>
  );
}
