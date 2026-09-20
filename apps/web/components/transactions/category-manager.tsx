'use client';

import { CaretDown, CaretUp, PencilSimple, Plus, Tag } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createCategory, updateCategory } from '@/app/(dashboard)/transactions/category-actions';
import { Badge, StatusNotice } from '@/components/ui/status';

export interface CategoryRow {
  id: string;
  key: string;
  name: string;
  defaultIsShared: boolean;
  isActive: boolean;
  transactionCount: number;
}

export function CategoryManager({ categories }: { categories: CategoryRow[] }): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: () => void): void {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.error ?? 'Změnu se nepodařilo uložit.');
          return;
        }
        done();
        router.refresh();
      } catch {
        setError('Změnu se nepodařilo uložit. Zkuste to znovu.');
      }
    });
  }

  return (
    <section className="surface overflow-hidden" aria-label="Správa kategorií">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left md:px-5">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent"><Tag size={18} aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block font-semibold">Kategorie</span><span className="block text-xs text-ink-muted">Vytvářejte, přejmenovávejte nebo skrývejte kategorie bez ztráty historie.</span></span>
        </span>
        {open ? <CaretUp size={18} /> : <CaretDown size={18} />}
      </button>
      {open ? (
        <div className="border-t border-line bg-surface-subtle p-4 md:p-5">
          {error ? <StatusNotice tone="danger" title="Kategorie se nepodařilo uložit" live="assertive">{error}</StatusNotice> : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">Systémové klíče zůstávají stabilní i po přejmenování českého názvu.</p>
            <button type="button" disabled={isPending} onClick={() => { setCreating(true); setEditing(null); }} className="ui-button ui-button-primary"><Plus size={17} /> Nová kategorie</button>
          </div>
          {creating ? <CategoryForm submitLabel="Vytvořit kategorii" pending={isPending} onCancel={() => setCreating(false)} onSubmit={(value) => run(() => createCategory(value), () => setCreating(false))} /> : null}
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {categories.map((category) => (
              <li key={category.id} className="rounded-xl border border-line bg-[var(--surface-raised)] p-3">
                {editing === category.id ? (
                  <CategoryForm key={category.id} initial={category} submitLabel="Uložit kategorii" pending={isPending} onCancel={() => setEditing(null)} onSubmit={(value) => run(() => updateCategory({ id: category.id, ...value, isActive: value.isActive }), () => setEditing(null))} />
                ) : (
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="break-words font-semibold">{category.name}</p>{!category.isActive ? <Badge tone="warning">Skrytá</Badge> : null}{category.defaultIsShared ? <Badge tone="info">Sdílená výchozí</Badge> : null}</div><p className="mt-1 text-xs text-ink-muted">{category.transactionCount} {category.transactionCount === 1 ? 'transakce' : 'transakcí'} · {category.key.startsWith('custom-') ? 'vlastní' : 'systémová'}</p></div>
                    <button type="button" onClick={() => { setEditing(category.id); setCreating(false); }} className="ui-button ui-button-ghost shrink-0 px-2" aria-label={`Upravit ${category.name}`}><PencilSimple size={17} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CategoryForm({ initial, submitLabel, pending, onCancel, onSubmit }: { initial?: CategoryRow; submitLabel: string; pending: boolean; onCancel: () => void; onSubmit: (value: { name: string; isShared: boolean; isActive: boolean }) => void }): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [isShared, setShared] = useState(initial?.defaultIsShared ?? false);
  const [isActive, setActive] = useState(initial?.isActive ?? true);
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ name, isShared, isActive }); }} className="mt-4 grid gap-3 rounded-xl border border-accent/25 bg-[var(--accent-soft)] p-3 sm:grid-cols-2"><label className="ui-label">Název<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} disabled={pending} className="px-3 py-2" /></label><div className="flex flex-col justify-end gap-2"><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={isShared} onChange={(event) => setShared(event.target.checked)} disabled={pending} /> Výchozí sdílená</label><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(event) => setActive(event.target.checked)} disabled={pending} /> Nabízet pro nové transakce</label></div><div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" disabled={pending} className="ui-button ui-button-primary">{pending ? 'Ukládám…' : submitLabel}</button><button type="button" onClick={onCancel} disabled={pending} className="ui-button ui-button-secondary">Zrušit</button></div></form>;
}
