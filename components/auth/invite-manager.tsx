'use client';

import { Check, Copy, EnvelopeSimple, LinkSimple, WarningCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { revokeInvite } from '@/app/(dashboard)/settings/users/actions';
import { SectionHeader } from '@/components/ui/page-container';
import { SelectField } from '@/components/ui/select-field';
import { Badge, StatusNotice } from '@/components/ui/status';

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  isExpired: boolean;
}

interface CreatedInvite {
  email: string;
  url: string;
  expiresAt: string;
}

export function InviteManager({ pendingInvites }: { pendingInvites: PendingInvite[] }): React.JSX.Element {
  const router = useRouter();
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [role, setRole] = useState('MEMBER');
  const urlRef = useRef<HTMLInputElement>(null);
  const dateFormatter = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' });

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setError(null);
    setCreated(null);
    setCopyMessage(null);

    try {
      const form = new FormData(formElement);
      const response = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: String(form.get('email') ?? ''),
          role,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(readApiError(payload));
        return;
      }

      if (!isCreatedInvite(payload)) {
        setError('Server vrátil neplatnou odpověď. Pozvánku vytvořte znovu.');
        return;
      }

      setCreated(payload);
      setRole('MEMBER');
      formElement.reset();
      router.refresh();
    } catch {
      setError('Pozvánku se nepodařilo vytvořit. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      setPending(false);
    }
  }

  async function copyInviteUrl(): Promise<void> {
    if (!created) return;

    setCopyMessage(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(created.url);
      setCopyMessage('Odkaz byl zkopírován.');
    } catch {
      urlRef.current?.focus();
      urlRef.current?.select();
      setCopyMessage('Automatické kopírování není dostupné. Odkaz je označený, zkopírujte ho ručně.');
    }
  }

  function removeInvite(id: string): void {
    setPending(true);
    setError(null);
    void revokeInvite(id)
      .then((result) => {
        if (!result.ok) setError(result.error ?? 'Pozvánku se nepodařilo zrušit.');
        else router.refresh();
      })
      .catch(() => setError('Pozvánku se nepodařilo zrušit.'))
      .finally(() => setPending(false));
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Pozvánky"
        description="Pozvěte dalšího člena do společného prostoru domácnosti."
      />

      <div className="surface p-4 sm:p-5">
        <h3 className="font-semibold tracking-[-0.015em]">Nová pozvánka</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Vytvořený odkaz se zobrazí pouze jednou. Pošlete ho bezpečnou cestou konkrétní osobě.
        </p>
        <form onSubmit={(event) => void onSubmit(event)} className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <label className="ui-label">
            <span>E-mail</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              disabled={pending}
              required
              placeholder="jmeno@example.cz"
              className="px-3 py-2"
            />
          </label>
          <SelectField
            name="role"
            label="Role"
            value={role}
            onValueChange={setRole}
            disabled={pending}
            options={[
              { value: 'MEMBER', label: 'Člen' },
              { value: 'OWNER', label: 'Vlastník' },
            ]}
          />
          <p className="ui-helper sm:col-span-2">
            Vlastník může zvát další osoby. Člen má přístup ke společným finančním datům bez správy pozvánek.
          </p>
          <button type="submit" disabled={pending} className="ui-button ui-button-primary sm:col-span-2 sm:justify-self-start">
            <LinkSimple size={17} weight="bold" aria-hidden="true" />
            {pending ? 'Vytvářím odkaz…' : 'Vytvořit odkaz'}
          </button>
        </form>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {error ? (
          <StatusNotice title="Pozvánku se nepodařilo vytvořit" tone="danger" live="assertive">
            {error}
          </StatusNotice>
        ) : null}

        {created ? (
          <StatusNotice title={`Pozvánka pro ${created.email} je připravena`} tone="success" live="polite">
            <div className="flex flex-col gap-3">
              <p>Odkaz platí do {dateFormatter.format(new Date(created.expiresAt))}.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  ref={urlRef}
                  value={created.url}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label="Odkaz pozvánky"
                  className="min-w-0 flex-1 px-3 py-2 font-mono text-xs"
                />
                <button type="button" onClick={() => void copyInviteUrl()} className="ui-button ui-button-secondary">
                  {copyMessage === 'Odkaz byl zkopírován.' ? (
                    <Check size={17} weight="bold" aria-hidden="true" />
                  ) : (
                    <Copy size={17} aria-hidden="true" />
                  )}
                  {copyMessage === 'Odkaz byl zkopírován.' ? 'Zkopírováno' : 'Kopírovat'}
                </button>
              </div>
              {copyMessage ? <p className="text-xs" role="status">{copyMessage}</p> : null}
            </div>
          </StatusNotice>
        ) : null}
      </div>

      <div className="mt-2 flex flex-col gap-3">
        <SectionHeader
          title="Nevyužité pozvánky"
          description={
            pendingInvites.length > 0
              ? `${pendingInvites.length} ${pendingInvites.length === 1 ? 'čekající pozvánka' : 'čekajících pozvánek'}`
              : 'Žádné čekající pozvánky'
          }
        />
        {pendingInvites.length > 0 ? (
          <ul className="surface divide-y divide-line overflow-hidden">
            {pendingInvites.map((invite) => (
              <li
                key={invite.id}
                className={`flex min-w-0 flex-wrap items-start gap-3 p-4 sm:p-5 ${invite.isExpired ? 'bg-[var(--critical-soft)]' : ''}`}
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                    invite.isExpired ? 'bg-surface text-critical' : 'bg-[var(--accent-soft)] text-accent'
                  }`}
                >
                  {invite.isExpired ? (
                    <WarningCircle size={21} weight="fill" aria-hidden="true" />
                  ) : (
                    <EnvelopeSimple size={21} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-all font-medium">{invite.email}</p>
                    <Badge>{invite.role === 'OWNER' ? 'Vlastník' : 'Člen'}</Badge>
                    {invite.isExpired ? <Badge tone="danger">Platnost vypršela</Badge> : <Badge tone="warning">Čeká na přijetí</Badge>}
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    {invite.isExpired ? 'Platnost skončila' : 'Platí do'}{' '}
                    {dateFormatter.format(new Date(invite.expiresAt))}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeInvite(invite.id)}
                  className="ui-button ui-button-ghost shrink-0 text-critical"
                >
                  Zrušit pozvánku
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<EnvelopeSimple size={21} aria-hidden="true" />}
            title="Žádné nevyužité pozvánky"
            description="Nově vytvořené odkazy se zde zobrazí do přijetí nebo vypršení platnosti."
          />
        )}
      </div>
    </section>
  );
}

function readApiError(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
    ? payload.error
    : 'Pozvánku se nepodařilo vytvořit.';
}

function isCreatedInvite(payload: unknown): payload is CreatedInvite {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'email' in payload &&
    typeof payload.email === 'string' &&
    'url' in payload &&
    typeof payload.url === 'string' &&
    'expiresAt' in payload &&
    typeof payload.expiresAt === 'string'
  );
}
