import { PlanetIcon as Planet } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';

import { FirstUserForm } from '@/components/auth/first-user-form';
import { apiClient } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

/** The API's own source of truth is `lib/auth/password.ts`'s `MIN_PASSWORD_LENGTH` — mirrored here since only the API needs the hashing logic that constant lives next to. */
const MIN_PASSWORD_LENGTH = 10;

export default async function SetupPage(): Promise<React.JSX.Element> {
  const response = await apiClient().auth.setup.$get();
  const { needsFirstUser } = response.ok ? await response.json() : { needsFirstUser: false };
  if (!needsFirstUser) {
    redirect('/signin');
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
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">První spuštění</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
              Váš finanční prostor začíná tady.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted sm:text-base">
              Vytvořte účet vlastníka. Po přihlášení nastavíte finance a pozvete další členy.
            </p>
          </div>
          <div className="relative mt-10 rounded-xl border border-line bg-surface/70 p-4 text-sm leading-relaxed text-ink-muted">
            První účet spravuje domácnost a pozvánky. Přístupové údaje nikomu nesdílejte.
          </div>
        </section>

        <section className="surface flex flex-col justify-center p-5 sm:p-8 lg:p-10" aria-labelledby="setup-title">
          <header className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Účet vlastníka</p>
            <h2 id="setup-title" className="mt-2 text-2xl font-semibold tracking-[-0.025em]">
              Založení Orbitu
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Vyplňte údaje prvního uživatele. Další lidi pozvete později odkazem.
            </p>
          </header>
          <FirstUserForm minPasswordLength={MIN_PASSWORD_LENGTH} />
        </section>
      </div>
    </main>
  );
}
