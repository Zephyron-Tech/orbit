'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

const INPUT_CLASS_NAME = 'w-full px-3 py-2.5 text-base sm:text-sm';

export function FirstUserForm({ minPasswordLength }: { minPasswordLength: number }): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passwordsInvalid, setPasswordsInvalid] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setPasswordsInvalid(false);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    try {
      if (password !== String(form.get('passwordConfirm') ?? '')) {
        setPasswordsInvalid(true);
        setError('Hesla se neshodují. Zadejte je znovu stejně.');
        return;
      }

      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          name: String(form.get('name') ?? ''),
          password,
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        setError(
          typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Účet se nepodařilo vytvořit. Zkuste to znovu.',
        );
        return;
      }

      const result = await signIn('credentials', { email, password, redirect: false });

      if (result?.error) {
        router.push('/signin');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Účet se teď nepodařilo vytvořit. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" aria-busy={pending}>
      <label className="ui-label" htmlFor="setup-email">
        E-mail
        <input
          id="setup-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          inputMode="email"
          className={INPUT_CLASS_NAME}
        />
      </label>
      <label className="ui-label" htmlFor="setup-name">
        <span>Jméno <span className="font-normal text-ink-muted">(volitelné)</span></span>
        <input
          id="setup-name"
          name="name"
          autoComplete="name"
          className={INPUT_CLASS_NAME}
        />
      </label>
      <label className="ui-label" htmlFor="setup-password">
        Heslo
        <span className="relative">
          <input
            id="setup-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={minPasswordLength}
            autoComplete="new-password"
            aria-invalid={passwordsInvalid}
            aria-describedby={`setup-password-help${passwordsInvalid ? ' setup-status' : ''}`}
            className={`${INPUT_CLASS_NAME} pr-12`}
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
        <span id="setup-password-help" className="ui-helper">Použijte alespoň {minPasswordLength} znaků.</span>
      </label>
      <label className="ui-label" htmlFor="setup-password-confirm">
        Heslo znovu
        <span className="relative">
          <input
            id="setup-password-confirm"
            name="passwordConfirm"
            type={showPasswordConfirm ? 'text' : 'password'}
            required
            autoComplete="new-password"
            aria-invalid={passwordsInvalid}
            aria-describedby={passwordsInvalid ? 'setup-status' : undefined}
            className={`${INPUT_CLASS_NAME} pr-12`}
          />
          <button
            type="button"
            onClick={() => setShowPasswordConfirm((visible) => !visible)}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-ink-muted hover:bg-surface-subtle hover:text-ink"
            aria-label={showPasswordConfirm ? 'Skrýt zopakované heslo' : 'Zobrazit zopakované heslo'}
            aria-pressed={showPasswordConfirm}
          >
            {showPasswordConfirm ? <EyeSlash size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
        </span>
      </label>
      <div id="setup-status" className="min-h-5 text-sm leading-relaxed" aria-live="polite" aria-atomic="true">
        {error ? <p className="text-critical">{error}</p> : pending ? <p className="text-ink-muted">Vytvářím účet…</p> : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="ui-button ui-button-primary w-full"
      >
        {pending ? 'Zakládám…' : 'Vytvořit vlastníka'}
      </button>
    </form>
  );
}
