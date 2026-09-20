import { UsersThree } from '@phosphor-icons/react/dist/ssr';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { InviteManager } from '@/components/auth/invite-manager';
import { HouseholdManager, type HouseholdUser } from '@/components/auth/household-manager';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { StatusNotice } from '@/components/ui/status';
import { apiClient } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface ApiInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export default async function UsersPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get('cookie') ?? undefined;
  const client = apiClient(cookieHeader);

  const usersResponse = await client.users.$get();
  if (!usersResponse.ok) {
    redirect('/signin');
  }
  const { users, isOwner } = (await usersResponse.json()) as { users: HouseholdUser[]; isOwner: boolean };

  let pendingInvites: { id: string; email: string; role: string; expiresAt: string; isExpired: boolean }[] = [];
  if (isOwner) {
    const invitesResponse = await client.invites.$get();
    const { invites } = (await invitesResponse.json()) as { invites: ApiInvite[] };
    const now = new Date();
    pendingInvites = invites
      .filter((invite) => invite.acceptedAt === null)
      .map((invite) => ({ ...invite, isExpired: new Date(invite.expiresAt) <= now }));
  }

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
          <HouseholdManager canManage={isOwner} users={users} />
        ) : (
          <EmptyState
            icon={<UsersThree size={21} aria-hidden="true" />}
            title="Domácnost zatím nemá členy"
            description="Po vytvoření prvního uživatele se zde zobrazí jeho přístup a role."
          />
        )}
      </section>

      {isOwner ? (
        <InviteManager pendingInvites={pendingInvites} />
      ) : (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Pozvánky" />
          <StatusNotice>Nové členy domácnosti může pozvat pouze vlastník.</StatusNotice>
        </section>
      )}
    </PageShell>
  );
}
