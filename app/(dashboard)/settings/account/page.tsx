import { redirect } from 'next/navigation';

import { AccountSettingsManager } from '@/components/settings/account-settings-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage(): Promise<React.JSX.Element> {
  const user = await getActiveUser();

  if (!user) {
    redirect('/signin');
  }

  const settings = await prisma.planningSettings.findUnique({ where: { id: 'household' } });

  return (
    <PageShell width="narrow">
      <PageHeader title="Nastavení" description="Vlastní přihlašovací údaje a rozsah dat zobrazovaných v aplikaci." />
      <AccountSettingsManager
        email={user.email}
        reportingStartMonth={settings?.reportingStartMonth?.toISOString().slice(0, 7) ?? null}
      />
    </PageShell>
  );
}
