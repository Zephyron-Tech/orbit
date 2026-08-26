'use client';

import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

interface Props {
  /** Invitation token, or null when creating the very first owner account. */
  token: string | null;
  email: string;
  endpoint: string;
  minPasswordLength: number;
}

const INPUT_CLASS_NAME = 'w-full px-3 py-2.5 text-base sm:text-sm';

export function AccountSetupForm({ token, email, endpoint, minPasswordLength }: Props): React.JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [passwordsInvalid, setPasswordsInvalid] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setPasswordsInvalid(false);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');

    try {
      if (password !== String(form.get('passwordConfirm') ?? '')) {
        setPasswordsInvalid(true);
        setError('Hesla se neshodují. Zadejte je znovu stejně.');
        return;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          email,
          name: String(form.get('name') ?? ''),
          password,
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Registraci se nepodařilo dokončit. Zkuste to znovu.';

        setError(message);
        return;
      }

      setDone(true);
      router.push('/signin');
    } catch {
      setError('Registraci se teď nepodařilo dokončit. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-xl border border-positive/25 bg-[var(--positive-soft)] p-4 text-sm text-ink" aria-live="polite">
        Účet je vytvořený. Přesměrovávám vás na přihlášení…
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5" aria-busy={pending}>
      <label className="ui-label" htmlFor="invite-email">
        E-mail
        <input
          id="invite-email"
          value={email}
          readOnly
          className={`${INPUT_CLASS_NAME} bg-surface-subtle text-ink-muted`}
        />
      </label>
      <label className="ui-label" htmlFor="invite-name">
        <span>Jméno <span className="font-normal text-ink-muted">(volitelné)</span></span>
        <input
          id="invite-name"
          name="name"
          autoComplete="name"
          autoFocus
          className={INPUT_CLASS_NAME}
        />
      </label>
      <label className="ui-label" htmlFor="invite-password">
        Heslo
        <span className="relative">
          <input
            id="invite-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={minPasswordLength}
            autoComplete="new-password"
            aria-invalid={passwordsInvalid}
            aria-describedby={`invite-password-help${passwordsInvalid ? ' invite-status' : ''}`}
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
        <span id="invite-password-help" className="ui-helper">Použijte alespoň {minPasswordLength} znaků.</span>
      </label>
      <label className="ui-label" htmlFor="invite-password-confirm">
        Heslo znovu
        <span className="relative">
          <input
            id="invite-password-confirm"
            name="passwordConfirm"
            type={showPasswordConfirm ? 'text' : 'password'}
            required
            autoComplete="new-password"
            aria-invalid={passwordsInvalid}
            aria-describedby={passwordsInvalid ? 'invite-status' : undefined}
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
      <div id="invite-status" className="min-h-5 text-sm leading-relaxed" aria-live="polite" aria-atomic="true">
        {error ? <p className="text-critical">{error}</p> : pending ? <p className="text-ink-muted">Dokončuji účet…</p> : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="ui-button ui-button-primary w-full"
      >
        {pending ? 'Zakládám…' : 'Vytvořit účet'}
      </button>
    </form>
  );
}
