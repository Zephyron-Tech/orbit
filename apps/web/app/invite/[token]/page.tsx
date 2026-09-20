import { PlanetIcon as Planet } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

import { AccountSetupForm } from '@/components/auth/account-setup-form';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';
import { findUsableInvite } from '@/lib/auth/users';

export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.JSX.Element> {
  const { token } = await params;
  const invite = await findUsableInvite(token);

  if (!invite) {
    return (
      <main className="min-h-svh px-4 py-5 sm:grid sm:place-items-center sm:px-6 sm:py-10">
        <div className="surface mx-auto w-full max-w-lg p-6 sm:p-10">
          <div className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center text-accent">
              <Planet size={28} weight="fill" aria-hidden="true" />
            </span>
            Orbit
          </div>
          <p className="mt-10 text-xs font-semibold uppercase tracking-[0.16em] text-critical">Pozvánka</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">Tento odkaz už neplatí</h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-muted">
            Pozvánka vypršela, byla odvolána nebo už ji někdo použil. Požádejte správce prostoru o nový odkaz.
          </p>
          <Link href="/signin" className="ui-button ui-button-primary mt-8 w-full sm:w-auto">
            Přejít na přihlášení
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-svh px-4 py-5 sm:grid sm:place-items-center sm:px-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.78fr)] lg:gap-6">
        <section className="surface-subtle relative flex min-h-64 flex-col justify-between overflow-hidden p-6 sm:p-8 lg:min-h-[40rem]">
          <div className="absolute -right-20 -top-20 size-64 rounded-full border border-accent/15" aria-hidden="true" />
          <div className="absolute -right-8 -top-8 size-32 rounded-full border border-accent/20" aria-hidden="true" />
          <div className="relative flex items-center gap-3 font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center text-accent">
              <Planet size={28} weight="fill" aria-hidden="true" />
            </span>
            Orbit
          </div>
          <div className="relative mt-14 max-w-lg lg:mt-20">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Osobní pozvánka</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
              Vítejte ve společném finančním prostoru.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted sm:text-base">
              Dokončete svůj účet. Potom se můžete bezpečně přihlásit a začít používat Orbit.
            </p>
          </div>
          <div className="relative mt-10 rounded-xl border border-line bg-surface/70 p-4">
            <p className="text-xs font-medium text-ink-muted">Pozvánka pro</p>
            <p className="mt-1 break-all text-sm font-semibold">{invite.email}</p>
          </div>
        </section>

        <section className="surface flex flex-col justify-center p-5 sm:p-8 lg:p-10" aria-labelledby="invite-title">
          <header className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Dokončení účtu</p>
            <h2 id="invite-title" className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
              Nastavte si přístup
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Zvolte jméno a bezpečné heslo. E-mail je pevně spojený s pozvánkou.
            </p>
          </header>
          <AccountSetupForm
            token={token}
            email={invite.email}
            endpoint="/api/invites/accept"
            minPasswordLength={MIN_PASSWORD_LENGTH}
          />
        </section>
      </div>
    </main>
  );
}
