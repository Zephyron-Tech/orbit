'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent, type KeyboardEvent } from 'react';

import { apiClient } from '@/lib/api-client';

const INPUT_CLASS_NAME = 'w-full px-3 py-2.5 text-base sm:text-sm';

function submitOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

export function SignInForm(): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [credentialsInvalid, setCredentialsInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setCredentialsInvalid(false);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const redirectTo = searchParams.get('callbackUrl') ?? '/dashboard';

    try {
      const response = await apiClient().auth.login.$post({ json: { email, password } });

      if (!response.ok) {
        // Keep message vague to avoid revealing whether e-mail exists.
        setCredentialsInvalid(true);
        setError('Nesprávný e-mail nebo heslo. Zkontrolujte údaje a zkuste to znovu.');
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      setError('Přihlášení se teď nepodařilo. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" aria-busy={pending}>
      <label className="ui-label" htmlFor="signin-email">
        E-mail
        <input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          inputMode="email"
          aria-invalid={credentialsInvalid}
          aria-describedby={credentialsInvalid ? 'signin-status' : undefined}
          className={INPUT_CLASS_NAME}
          onKeyDown={submitOnEnter}
        />
      </label>
      <label className="ui-label" htmlFor="signin-password">
        Heslo
        <span className="relative">
          <input
            id="signin-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            aria-invalid={credentialsInvalid}
            aria-describedby={credentialsInvalid ? 'signin-status' : undefined}
            className={`${INPUT_CLASS_NAME} pr-12`}
            onKeyDown={submitOnEnter}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-surface-subtle hover:text-ink"
            aria-label={showPassword ? 'Skrýt heslo' : 'Zobrazit heslo'}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeSlash size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
        </span>
      </label>
      <div id="signin-status" className="min-h-5 text-sm leading-relaxed" aria-live="polite" aria-atomic="true">
        {error ? <p className="text-critical">{error}</p> : pending ? <p className="text-ink-muted">Ověřuji přístup…</p> : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="ui-button ui-button-primary w-full"
      >
        {pending ? 'Přihlašuji…' : 'Přihlásit se'}
      </button>
    </form>
  );
}
