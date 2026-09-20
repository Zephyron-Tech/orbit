import { cookies, headers } from 'next/headers';

import { TransactionTable } from '@/components/transactions/transaction-table';
import { CategoryManager } from '@/components/transactions/category-manager';
import { Metric } from '@/components/ui/metric';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { StatusNotice } from '@/components/ui/status';
import { apiClient } from '@/lib/api-client';
import { PERIOD_COOKIE } from '@/lib/ui/period';

export const dynamic = 'force-dynamic';

const CZK = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

interface SearchParams {
  month?: string;
  period?: string;
  accountId?: string;
  categoryId?: string;
  shared?: string;
  uncategorized?: string;
  q?: string;
  page?: string;
  flow?: string;
  sort?: string;
  direction?: string;
  absolute?: string;
  transfer?: string;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const cookieHeader = (await headers()).get('cookie') ?? undefined;
  const preferredMonth = (await cookies()).get(PERIOD_COOKIE)?.value;

  const response = await apiClient(cookieHeader).transactions.$get({
    query: {
      ...(params.period ? { period: params.period } : {}),
      ...(params.month ? { month: params.month } : {}),
      ...(preferredMonth ? { preferredMonth } : {}),
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.shared ? { shared: params.shared } : {}),
      ...(params.uncategorized ? { uncategorized: params.uncategorized } : {}),
      ...(params.q ? { q: params.q } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.flow ? { flow: params.flow } : {}),
      ...(params.sort ? { sort: params.sort } : {}),
      ...(params.direction ? { direction: params.direction } : {}),
      ...(params.absolute ? { absolute: params.absolute } : {}),
      ...(params.transfer ? { transfer: params.transfer } : {}),
    },
  });

  const data = await response.json();

  const balance = Number(data.balance);
  const income = Number(data.income);
  const expenses = Number(data.expenses);

  const filterKey = [
    data.period.value,
    params.accountId,
    params.categoryId,
    params.shared,
    params.uncategorized,
    params.q,
    data.page,
    data.absoluteAmount,
  ].join('|');

  return (
    <PageShell>
      <PageHeader
        title="Transakce"
        description="Přehled pohybů napříč účty. Souhrn vždy vychází ze všech výsledků aktuálního filtru."
      />

      <section aria-label="Cash flow" className="grid gap-3 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Metric
          label="Čistý tok peněz"
          value={CZK.format(balance)}
          tone={balance >= 0 ? 'positive' : 'critical'}
          detail="Příjmy minus výdaje. Převody mezi účty ani vyrovnání sem nevstupují."
          sensitive
        />
        <Metric label="Příjmy" value={CZK.format(income)} tone="positive" detail="běžné příjmy v aktuálním filtru" sensitive />
        <Metric label="Výdaje" value={CZK.format(expenses)} detail="běžné výdaje v aktuálním filtru" sensitive />
      </section>

      {data.missingConversions > 0 ? (
        <StatusNotice title="Neúplný přepočet do CZK" tone="warning">
          Souhrn nezahrnuje {data.missingConversions.toLocaleString('cs-CZ')} transakcí v cizí měně bez dostupného CZK přepočtu.
          Původní částky zůstávají v přehledu uvedené ve své měně.
        </StatusNotice>
      ) : null}

      <TransactionTable
        key={filterKey}
        transactions={data.transactions}
        categories={data.categories}
        categoryManager={<CategoryManager categories={data.categories} />}
        buckets={data.buckets}
        recurringExpenses={data.recurringExpenses}
        accounts={data.accounts}
        months={data.months}
        filters={{
          period: data.period.value,
          accountId: params.accountId ?? '',
          categoryId: params.categoryId ?? '',
          shared: params.shared === '1',
          uncategorized: params.uncategorized === '1',
          q: params.q ?? '',
          flow: data.flow,
          sort: data.sort,
          direction: data.direction,
          absoluteAmount: data.absoluteAmount,
          unmatchedTransfersOnly: data.unmatchedTransfersOnly,
        }}
        page={data.page}
        pageSize={data.pageSize}
        totalCount={data.totalCount}
        totalPages={data.totalPages}
        recommendations={data.recommendations}
        recommendationPeriod={data.period.from && data.period.to ? { from: data.period.from, to: data.period.to } : null}
      />
    </PageShell>
  );
}
