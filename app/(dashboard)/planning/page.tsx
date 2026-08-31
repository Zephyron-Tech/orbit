import { PlanningManager, type IncomeSourceRuleRow, type InvestmentPlanRow } from '@/components/planning/planning-manager';
import { RecurringExpenseManager, type RecurringExpenseRow } from '@/components/recurring/recurring-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export default async function PlanningPage(): Promise<React.JSX.Element> {
  const [settings, plans, accounts, incomeSourceRules, expenses, categories, firstBankBatch] = await Promise.all([
    prisma.planningSettings.findUnique({ where: { id: 'household' } }),
    prisma.recurringInvestmentPlan.findMany({
      orderBy: [{ isActive: 'desc' }, { expectedAmount: 'desc' }, { name: 'asc' }],
      include: { sourceAccount: { select: { name: true } }, brokerAccount: { select: { name: true } } },
    }),
    prisma.account.findMany({
      where: { isArchived: false },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, provider: true, currency: true },
    }),
    prisma.incomeSourceRule.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { account: { select: { name: true } } },
    }),
    prisma.recurringExpense.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { transactions: true } }, paymentAccount: { select: { name: true } } },
    }),
    prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.importBatch.findFirst({ where: { status: 'COMPLETED', account: { provider: { not: 'TRADING212' } }, periodFrom: { not: null } }, orderBy: { periodFrom: 'asc' }, select: { periodFrom: true } }),
  ]);
  const rows: InvestmentPlanRow[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    sourceAccountId: plan.sourceAccountId,
    sourceAccountName: plan.sourceAccount?.name ?? null,
    brokerAccountId: plan.brokerAccountId,
    brokerAccountName: plan.brokerAccount.name,
    expectedAmount: plan.expectedAmount.toString(),
    currency: plan.currency,
    dueDay: plan.dueDay,
    graceDays: plan.graceDays,
    isActive: plan.isActive,
    startsOn: plan.startsOn?.toISOString().slice(0, 10) ?? null,
    endsOn: plan.endsOn?.toISOString().slice(0, 10) ?? null,
  }));
  const incomeSourceRuleRows: IncomeSourceRuleRow[] = incomeSourceRules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    merchantKey: rule.merchantKey,
    accountId: rule.accountId,
    accountName: rule.account?.name ?? null,
    isActive: rule.isActive,
  }));
  const recurringRows: RecurringExpenseRow[] = expenses.map((expense) => ({
    id: expense.id,
    name: expense.name,
    categoryId: expense.categoryId,
    expectedAmount: expense.expectedAmount.toFixed(2),
    currency: expense.currency,
    isShared: expense.isShared,
    myShareRatio: expense.myShareRatio ? expense.myShareRatio.toNumber() : null,
    isActive: expense.isActive,
    dueDay: expense.dueDay,
    graceDays: expense.graceDays,
    startsOn: expense.startsOn?.toISOString().slice(0, 10) ?? null,
    endsOn: expense.endsOn?.toISOString().slice(0, 10) ?? null,
    paymentAccountId: expense.paymentAccountId,
    paymentAccountName: expense.paymentAccount?.name ?? null,
    transactionCount: expense._count.transactions,
  }));

  return (
    <PageShell>
      <PageHeader title="Plánování" description="Nastavte měsíční cíl výdajů a plánované pravidelné vklady do Trading 212." />
      <section className="flex flex-col gap-3">
        <h2 className="section-title">Fixní výdaje</h2>
        <p className="text-sm text-ink-muted">Po ručním přiřazení se worker naučí přesnou protistranu z daného exportu. Další importy přiřadí automaticky jen při jednoznačné shodě na stejném účtu; výpis a historie účtu mohou mít pro jednu platbu různé naučené aliasy. Změna sdílení se promítne do všech propojených nevyrovnaných plateb.</p>
        <RecurringExpenseManager expenses={recurringRows} categories={categories} paymentAccounts={accounts.filter((account) => account.type !== 'INVESTMENT')} />
      </section>
      <PlanningManager monthlySpendingTarget={settings?.monthlySpendingTarget?.toString() ?? null} transferHistoryFrom={settings?.transferHistoryFrom?.toISOString().slice(0, 10) ?? firstBankBatch?.periodFrom?.toISOString().slice(0, 10) ?? null} plans={rows} incomeSourceRules={incomeSourceRuleRows} accounts={accounts} />
    </PageShell>
  );
}
