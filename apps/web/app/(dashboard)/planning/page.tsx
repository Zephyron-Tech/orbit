import { headers } from 'next/headers';

import { PlanningManager, type IncomeSourceRuleRow, type InvestmentPlanRow } from '@/components/planning/planning-manager';
import { RecurringExpenseManager, type RecurringExpenseRow } from '@/components/recurring/recurring-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { apiClient } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface PlanningData {
  settings: { monthlySpendingTarget: string | null; transferHistoryFrom: string | null; hideHistoricalBrokerTransfers: boolean } | null;
  firstBankBatchPeriodFrom: string | null;
  plans: InvestmentPlanRow[];
  accounts: { id: string; name: string; type: 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT'; provider: 'MONETA' | 'REVOLUT' | 'TRADING212' | 'MANUAL'; currency: string }[];
  incomeSourceRules: IncomeSourceRuleRow[];
  expenses: RecurringExpenseRow[];
  categories: { id: string; name: string }[];
}

export default async function PlanningPage(): Promise<React.JSX.Element> {
  const cookie = (await headers()).get('cookie') ?? undefined;
  const response = await apiClient(cookie).planning.$get();
  const data = (await response.json()) as PlanningData;

  return (
    <PageShell>
      <PageHeader title="Plánování" description="Nastavte měsíční cíl výdajů a plánované pravidelné vklady do Trading 212." />
      <section className="flex flex-col gap-3">
        <h2 className="section-title">Fixní výdaje</h2>
        <p className="text-sm text-ink-muted">Po ručním přiřazení se worker naučí přesnou protistranu z daného exportu. Další importy přiřadí automaticky jen při jednoznačné shodě na stejném účtu; výpis a historie účtu mohou mít pro jednu platbu různé naučené aliasy. Změna sdílení se promítne do všech propojených nevyrovnaných plateb.</p>
        <RecurringExpenseManager expenses={data.expenses} categories={data.categories} paymentAccounts={data.accounts.filter((account) => account.type !== 'INVESTMENT')} />
      </section>
      <PlanningManager
        monthlySpendingTarget={data.settings?.monthlySpendingTarget ?? null}
        transferHistoryFrom={data.settings?.transferHistoryFrom ?? data.firstBankBatchPeriodFrom ?? null}
        hideHistoricalBrokerTransfers={data.settings?.hideHistoricalBrokerTransfers ?? false}
        plans={data.plans}
        incomeSourceRules={data.incomeSourceRules}
        accounts={data.accounts}
      />
    </PageShell>
  );
}
