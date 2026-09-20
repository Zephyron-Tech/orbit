import { PlanetIcon as Planet } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { needsFirstUser } from '@/lib/auth/users';

export const dynamic = 'force-dynamic';

export default async function SignInPage(): Promise<React.JSX.Element> {
  // With an empty user table nobody could ever sign in; send them to setup.
  if (await needsFirstUser()) {
    redirect('/setup');
  }

  return (
    <main className="min-h-svh px-4 py-5 sm:grid sm:place-items-center sm:px-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,0.78fr)] lg:gap-6">
        <section className="surface-subtle relative flex min-h-64 flex-col justify-between overflow-hidden p-6 sm:p-8 lg:min-h-[36rem]">
          <div className="absolute -right-20 -top-20 size-64 rounded-full border border-accent/15" aria-hidden="true" />
          <div className="absolute -right-8 -top-8 size-32 rounded-full border border-accent/20" aria-hidden="true" />
          <div className="relative flex items-center gap-3 font-semibold tracking-tight">
            <span className="flex size-9 items-center justify-center text-accent">
              <Planet size={36} weight="fill" aria-hidden="true" />
            </span>
            Orbit
          </div>
          <div className="relative mt-14 max-w-lg lg:mt-20">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Rodinné finance</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
              Finance v klidném orbitu.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted sm:text-base">
              Účty, investice i společné výdaje na jednom bezpečném místě.
            </p>
          </div>
          <p className="relative mt-10 text-xs leading-relaxed text-ink-muted">
            Soukromý prostor pro vás a lidi, se kterými finance sdílíte.
          </p>
        </section>

        <section className="surface flex flex-col justify-center p-5 sm:p-8 lg:p-10" aria-labelledby="signin-title">
          <header className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Vítejte zpět</p>
            <h2 id="signin-title" className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
              Přihlášení
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Přihlaste se e-mailem a heslem ke svému přehledu.
            </p>
          </header>
          <SignInForm />
        </section>
      </div>
    </main>
  );
}
