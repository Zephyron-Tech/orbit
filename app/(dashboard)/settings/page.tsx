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

  const [settings, earliest] = await Promise.all([
    prisma.planningSettings.findUnique({ where: { id: 'household' } }),
    prisma.transaction.aggregate({ _min: { date: true } }),
  ]);

  return (
    <PageShell>
      <PageHeader title="Nastavení" description="Vlastní přihlašovací údaje a rozsah dat zobrazovaných v aplikaci." />
      <AccountSettingsManager
        email={user.email}
        reportingStartMonth={settings?.reportingStartMonth?.toISOString().slice(0, 7) ?? null}
        availableMonths={monthsSince(earliest._min.date)}
      />
    </PageShell>
  );
}

/** Every calendar month from the earliest transaction through the current one, newest first. */
function monthsSince(earliestDate: Date | null): string[] {
  const now = new Date();
  const start = earliestDate ?? now;
  const startKey = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const nowKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const months: string[] = [];

  for (let key = nowKey; key >= startKey; key -= 1) {
    const year = Math.floor(key / 12);
    const month = key % 12;
    months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
  }

  return months;
}
