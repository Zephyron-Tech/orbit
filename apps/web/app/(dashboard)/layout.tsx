import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';

import { AppShell } from '@/components/layout/app-shell';
import { apiClient } from '@/lib/api-client';
import { isPeriod, PERIOD_COOKIE } from '@/lib/ui/period';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get('cookie') ?? undefined;
  const sessionResponse = await apiClient(cookieHeader).auth.session.$get();

  // proxy.ts already guards these routes on cookie presence alone; this is
  // the real check (the API re-verifies the JWT and re-reads `isActive` from
  // the DB on every call) and gives the header a name to show.
  if (!sessionResponse.ok) {
    redirect('/signin');
  }
  const { user } = (await sessionResponse.json()) as { user: { name: string | null; email: string } };

  const storedPeriod = (await cookies()).get(PERIOD_COOKIE)?.value;

  return (
    <AppShell
      userLabel={user.name ?? user.email ?? 'Uživatel'}
      preferredPeriod={isPeriod(storedPeriod) ? storedPeriod : null}
    >
      {children}
    </AppShell>
  );
}
