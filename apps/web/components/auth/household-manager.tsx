'use client';

import { PencilSimple, UserCircle } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { updateHouseholdUser } from '@/app/(dashboard)/users/actions';
import { SelectField } from '@/components/ui/select-field';
import { Badge, StatusNotice } from '@/components/ui/status';

export interface HouseholdUser {
  id: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'MEMBER';
  isActive: boolean;
  lastLogin: string | null;
  isCurrentUser: boolean;
}

const DATE = new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' });

export function HouseholdManager({ users, canManage }: { users: HouseholdUser[]; canManage: boolean }): React.JSX.Element {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function save(user: HouseholdUser): void {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await updateHouseholdUser(user);
        if (!result.ok) {
          setError(result.error ?? 'Účet se nepodařilo uložit.');
          return;
        }
        setEditingId(null);
        setMessage('Změny účtu byly uložené.');
        router.refresh();
      } catch {
        setError('Účet se nepodařilo uložit. Zkuste to znovu.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <StatusNotice tone="danger" title="Změnu se nepodařilo uložit" live="assertive">{error}</StatusNotice> : null}
      {message ? <StatusNotice tone="success" title="Hotovo" live="polite">{message}</StatusNotice> : null}
      <ul className="surface divide-y divide-line overflow-hidden">
        {users.map((user) => (
          <HouseholdUserRow
            key={user.id}
            user={user}
            editing={editingId === user.id}
            disabled={isPending}
            canManage={canManage}
            onEdit={() => setEditingId(user.id)}
            onCancel={() => setEditingId(null)}
            onSave={save}
          />
        ))}
      </ul>
    </div>
  );
}

function HouseholdUserRow({
  user,
  editing,
  disabled,
  canManage,
  onEdit,
  onCancel,
  onSave,
}: {
  user: HouseholdUser;
  editing: boolean;
  disabled: boolean;
  canManage: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (user: HouseholdUser) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(user);

  function cancel(): void {
    setDraft(user);
    onCancel();
  }

  if (editing) {
    return (
      <li className="bg-surface-subtle p-4 sm:p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(draft);
          }}
          className="grid min-w-0 gap-4 sm:grid-cols-2"
        >
          <label className="ui-label min-w-0">Jméno<input value={draft.name ?? ''} onChange={(event) => setDraft({ ...draft, name: event.target.value || null })} disabled={disabled} className="px-3 py-2" /></label>
          <label className="ui-label min-w-0">E-mail<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} disabled={disabled} required className="px-3 py-2" /></label>
          <SelectField
            label="Role"
            value={draft.role}
            onValueChange={(role) => setDraft({ ...draft, role: role === 'OWNER' ? 'OWNER' : 'MEMBER' })}
            options={[{ value: 'MEMBER', label: 'Člen' }, { value: 'OWNER', label: 'Vlastník' }]}
            disabled={disabled || user.isCurrentUser}
          />
          <SelectField
            label="Přístup"
            value={draft.isActive ? 'active' : 'inactive'}
            onValueChange={(status) => setDraft({ ...draft, isActive: status === 'active' })}
            options={[{ value: 'active', label: 'Aktivní' }, { value: 'inactive', label: 'Deaktivovaný' }]}
            disabled={disabled || user.isCurrentUser}
          />
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={disabled} className="ui-button ui-button-primary">{disabled ? 'Ukládám…' : 'Uložit změny'}</button>
            <button type="button" disabled={disabled} onClick={cancel} className="ui-button ui-button-secondary">Zrušit</button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`flex min-w-0 flex-wrap items-start gap-3 p-4 sm:p-5 ${user.isActive ? '' : 'bg-surface-subtle'}`}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-accent"><UserCircle size={22} weight="fill" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-words font-semibold tracking-[-0.015em]">{user.name ?? user.email}</h3>
          {user.isCurrentUser ? <Badge tone="info">Vy</Badge> : null}
          <Badge>{user.role === 'OWNER' ? 'Vlastník' : 'Člen'}</Badge>
          {!user.isActive ? <Badge tone="danger">Deaktivovaný</Badge> : null}
        </div>
        <p className="mt-1 break-all text-sm text-ink-muted">{user.email}</p>
        <p className="mt-2 text-xs text-ink-faint">{user.lastLogin ? `Poslední přihlášení ${DATE.format(new Date(user.lastLogin))}` : 'Zatím bez přihlášení'}</p>
      </div>
      {canManage ? (
        <button type="button" onClick={onEdit} className="ui-button ui-button-ghost shrink-0"><PencilSimple size={17} aria-hidden="true" /> Upravit</button>
      ) : null}
    </li>
  );
}
