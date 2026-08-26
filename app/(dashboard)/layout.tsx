import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { AppShell } from '@/components/layout/app-shell';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { isPeriod, PERIOD_COOKIE } from '@/lib/ui/period';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const session = await auth();

  // proxy.ts already guards these routes; this keeps the layout honest when
  // rendered directly and gives the header a name to show.
  if (!session?.user) {
    redirect('/signin');
  }

  const currentUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true } });
  if (!currentUser?.isActive) redirect('/signin');

  const storedPeriod = (await cookies()).get(PERIOD_COOKIE)?.value;

  return (
    <AppShell
      userLabel={session.user.name ?? session.user.email ?? 'Uživatel'}
      preferredPeriod={isPeriod(storedPeriod) ? storedPeriod : null}
    >
      {children}
    </AppShell>
  );
}
