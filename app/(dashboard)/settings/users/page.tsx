import { UsersThree } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';

import { InviteManager } from '@/components/auth/invite-manager';
import { HouseholdManager } from '@/components/auth/household-manager';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { StatusNotice } from '@/components/ui/status';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export default async function UsersPage(): Promise<React.JSX.Element> {
  const session = await auth();

  if (!session?.user) {
    redirect('/signin');
  }

  const [users, invites, databaseTime, currentUser] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLogin: true },
    }),
    prisma.invite.findMany({
      where: { acceptedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
    prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`,
    prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, isActive: true } }),
  ]);

  const isOwner = currentUser?.isActive === true && currentUser.role === 'OWNER';
  const now = databaseTime[0]?.now;

  return (
    <PageShell>
      <PageHeader
        title="Domácnost"
        description="Členové domácnosti pracují nad stejnými účty, transakcemi, rozpočtem i vyrovnáním. Nejde o oddělené uživatelské prostory."
      />

      <StatusNotice title="Role a přístup" tone="info">
        Vlastník může zvát další lidi a spravovat přístup. Člen vidí a používá společná finanční data, ale další
        lidi zvát nemůže.
      </StatusNotice>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Členové" description={`${users.length} ${users.length === 1 ? 'osoba' : 'osoby'} s přístupem`} />
        {users.length > 0 ? (
          <HouseholdManager
            canManage={isOwner}
            users={users.map((user) => ({
              ...user,
              lastLogin: user.lastLogin?.toISOString() ?? null,
              isCurrentUser: user.id === session.user.id,
            }))}
          />
        ) : (
          <EmptyState
            icon={<UsersThree size={21} aria-hidden="true" />}
            title="Domácnost zatím nemá členy"
            description="Po vytvoření prvního uživatele se zde zobrazí jeho přístup a role."
          />
        )}
      </section>

      {isOwner ? (
        <InviteManager
          pendingInvites={invites.map((invite) => ({
            ...invite,
            expiresAt: invite.expiresAt.toISOString(),
            isExpired: now ? invite.expiresAt <= now : false,
          }))}
        />
      ) : (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Pozvánky" />
          <StatusNotice>Nové členy domácnosti může pozvat pouze vlastník.</StatusNotice>
        </section>
      )}
    </PageShell>
  );
}
