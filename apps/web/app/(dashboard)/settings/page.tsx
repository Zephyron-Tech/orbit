import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AccountSettingsManager } from '@/components/settings/account-settings-manager';
import { NavOrderManager } from '@/components/settings/nav-order-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { apiClient } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get('cookie') ?? undefined;
  const client = apiClient(cookieHeader);

  const sessionResponse = await client.auth.session.$get();
  if (!sessionResponse.ok) {
    redirect('/signin');
  }
  const { user } = (await sessionResponse.json()) as { user: { email: string } };

  const settingsResponse = await client.settings.$get();
  const { reportingStartMonth, availableMonths } = (await settingsResponse.json()) as {
    reportingStartMonth: string | null;
    availableMonths: string[];
  };

  return (
    <PageShell>
      <PageHeader title="Nastavení" description="Vlastní přihlašovací údaje a rozsah dat zobrazovaných v aplikaci." />
      <AccountSettingsManager email={user.email} reportingStartMonth={reportingStartMonth} availableMonths={availableMonths} />

      <section className="mt-8 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Pořadí navigace</h2>
          <p className="text-sm text-ink-muted">Vlastní pořadí položek v levém menu. Uloženo jen v tomto prohlížeči.</p>
        </div>
        <NavOrderManager />
      </section>
    </PageShell>
  );
}
