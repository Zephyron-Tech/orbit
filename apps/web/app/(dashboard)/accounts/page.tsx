import { AccountManager, type AccountRow } from '@/components/accounts/account-manager';
import { findCreditRepaymentCandidates } from './actions';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { prisma } from '@/lib/db/prisma';
import { loadNetWorth } from '@/lib/finance/net-worth-service';

export const dynamic = 'force-dynamic';

export default async function AccountsPage(): Promise<React.JSX.Element> {
  const [accounts, netWorth, repaymentCandidates] = await Promise.all([prisma.account.findMany({
    orderBy: [{ isArchived: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { transactions: true } },
      snapshots: { orderBy: { capturedAt: 'desc' }, take: 1, select: { balance: true, capturedAt: true, source: true } },
    },
  }), loadNetWorth(), findCreditRepaymentCandidates()]);
  const derivedBalances = new Map(netWorth.accounts.map((entry) => [entry.accountId, entry.balance]));

  const rows: AccountRow[] = accounts.map((account) => {
    const snapshot = account.snapshots[0];
    const derivedBalance = derivedBalances.get(account.id);
    const creditDetails = account.type === 'CREDIT' && account.creditLimit && derivedBalance
      ? {
          limit: account.creditLimit.toString(),
          debt: derivedBalance.lessThan(0) ? derivedBalance.negated().toString() : '0',
          capacity: account.creditLimit.minus(derivedBalance.lessThan(0) ? derivedBalance.negated() : 0).toString(),
          asOf: snapshot?.capturedAt.toISOString() ?? null,
          invalidCapacitySnapshot: snapshot?.source === 'MANUAL' && snapshot.balance.isPositive(),
        }
      : null;

    return {
      id: account.id,
      name: account.name,
      type: account.type,
      provider: account.provider,
      externalId: account.externalId,
      currency: account.currency,
      includeInNetWorth: account.includeInNetWorth,
      creditLimit: account.creditLimit?.toString() ?? null,
      cardLast4: account.cardLast4,
      emergencyReserveMonths: account.type === 'SAVINGS' ? account.emergencyReserveMonths : null,
      annualInterestRate: account.type === 'SAVINGS' ? account.annualInterestRate?.times(100).toString() ?? null : null,
      interestTaxRate: account.type === 'SAVINGS' ? account.interestTaxRate?.times(100).toString() ?? null : null,
      isArchived: account.isArchived,
      transactionCount: account._count.transactions,
      creditDetails,
      creditNeedsOpeningConfirmation: account.type === 'CREDIT' && account.snapshots.length === 0 && account._count.transactions > 0,
    };
  });

  return (
    <PageShell>
      <PageHeader
        title="Účty"
        description="Spravujte bankovní, spořicí a investiční účty zahrnuté do přehledu financí. Způsob načítání dat závisí na poskytovateli."
      />
      <AccountManager accounts={rows} repaymentCandidates={repaymentCandidates} />
    </PageShell>
  );
}
