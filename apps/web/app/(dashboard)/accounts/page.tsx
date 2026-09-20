import { headers } from 'next/headers';

import { AccountManager, type AccountRow } from '@/components/accounts/account-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { apiClient } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

export default async function AccountsPage(): Promise<React.JSX.Element> {
  const client = apiClient((await headers()).get('cookie') ?? undefined);
  const [accountsRes, candidatesRes] = await Promise.all([client.accounts.$get(), client.accounts['credit-repayment-candidates'].$get()]);

  const rows = (await accountsRes.json()) as AccountRow[];
  const repaymentCandidates = await candidatesRes.json();

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
