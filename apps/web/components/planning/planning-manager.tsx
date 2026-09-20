'use client';

import { Plus, TrendUp, X } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { AmountField } from '@/components/ui/amount-field';
import { DateField } from '@/components/ui/date-field';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyValue } from '@/components/ui/money-value';
import { SectionHeader } from '@/components/ui/page-container';
import { SelectField } from '@/components/ui/select-field';
import { Badge, StatusNotice } from '@/components/ui/status';
import {
  createIncomeSourceRuleViaApi as createIncomeSourceRule,
  createInvestmentPlanViaApi as createInvestmentPlan,
  deleteIncomeSourceRuleViaApi as deleteIncomeSourceRule,
  deleteInvestmentPlanViaApi as deleteInvestmentPlan,
  saveSpendingTargetViaApi as saveSpendingTarget,
  setIncomeSourceRuleActiveViaApi as setIncomeSourceRuleActive,
  setInvestmentPlanActiveViaApi as setInvestmentPlanActive,
  updateIncomeSourceRuleViaApi as updateIncomeSourceRule,
  updateInvestmentPlanViaApi as updateInvestmentPlan,
  type IncomeSourceRuleInput,
  type InvestmentPlanInput,
} from '@/lib/api-client';

interface Account { id: string; name: string; type: 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT'; provider: 'MONETA' | 'REVOLUT' | 'TRADING212' | 'MANUAL'; currency: string }
export interface InvestmentPlanRow extends InvestmentPlanInput { id: string; sourceAccountName: string | null; brokerAccountName: string }
export interface IncomeSourceRuleRow { id: string; name: string; merchantKey: string; accountId: string | null; accountName: string | null; isActive: boolean }

function emptyPlan(): InvestmentPlanInput { return { name: '', sourceAccountId: null, brokerAccountId: '', expectedAmount: '', currency: 'CZK', dueDay: 1, graceDays: 3, isActive: true, startsOn: null, endsOn: null }; }

export function PlanningManager({ monthlySpendingTarget, transferHistoryFrom, hideHistoricalBrokerTransfers, plans, incomeSourceRules, accounts }: { monthlySpendingTarget: string | null; transferHistoryFrom: string | null; hideHistoricalBrokerTransfers: boolean; plans: InvestmentPlanRow[]; incomeSourceRules: IncomeSourceRuleRow[]; accounts: Account[] }): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [target, setTarget] = useState(monthlySpendingTarget ?? '');
  const [historyFrom, setHistoryFrom] = useState(transferHistoryFrom ?? '');
  const [hideHistorical, setHideHistorical] = useState(hideHistoricalBrokerTransfers);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingIncomeSource, setCreatingIncomeSource] = useState(false);
  const [editingIncomeSourceId, setEditingIncomeSourceId] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, message: string, done?: () => void): void {
    setError(null); setSuccess(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) { setError(result.error ?? 'Akce se nezdařila.'); return; }
        setSuccess(message); done?.(); router.refresh();
      } catch { setError('Akce se nezdařila. Zkontrolujte připojení a zkuste to znovu.'); }
    });
  }

  const activePlans = plans.filter((plan) => plan.isActive);
  const inactivePlans = plans.filter((plan) => !plan.isActive);
  const activeIncomeSourceRules = incomeSourceRules.filter((rule) => rule.isActive);
  const inactiveIncomeSourceRules = incomeSourceRules.filter((rule) => !rule.isActive);
  const renderPlan = (plan: InvestmentPlanRow): React.JSX.Element => editingId === plan.id ? (
    <li key={plan.id} className="surface p-4 sm:p-5"><PlanForm initial={plan} accounts={accounts} disabled={isPending} submitLabel="Uložit změny" onCancel={() => setEditingId(null)} onSubmit={(input) => run(() => updateInvestmentPlan(plan.id, input), 'Plán byl uložen.', () => setEditingId(null))} /></li>
  ) : (
    <li key={plan.id} className="surface p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{plan.name}</h3>{!plan.isActive ? <Badge>Neaktivní</Badge> : null}</div><p className="mt-2 tabular text-base font-semibold"><MoneyValue>{formatAmount(plan.expectedAmount)} {plan.currency}</MoneyValue><span className="ml-1 text-xs font-normal text-ink-muted">měsíčně</span></p><p className="mt-2 text-xs text-ink-muted">{plan.sourceAccountName ? `${plan.sourceAccountName} → ` : ''}{plan.brokerAccountName} · den {plan.dueDay} · tolerance {plan.graceDays} dny{plan.startsOn ? ` · od ${plan.startsOn}` : ''}{plan.endsOn ? ` · do ${plan.endsOn}` : ''}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setEditingId(plan.id); setCreating(false); }} disabled={isPending} className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs">Upravit</button><button type="button" onClick={() => run(() => setInvestmentPlanActive(plan.id, !plan.isActive), plan.isActive ? 'Plán byl deaktivován.' : 'Plán byl aktivován.')} disabled={isPending} className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs">{plan.isActive ? 'Deaktivovat' : 'Aktivovat'}</button><button type="button" onClick={() => run(() => deleteInvestmentPlan(plan.id), 'Plán byl smazán.')} disabled={isPending} className="ui-button ui-button-ghost min-h-9 px-3 py-2 text-xs text-critical">Smazat</button></div></div>
    </li>
  );

  const renderIncomeSourceRule = (rule: IncomeSourceRuleRow): React.JSX.Element => editingIncomeSourceId === rule.id ? (
    <li key={rule.id} className="surface p-4 sm:p-5"><IncomeSourceRuleForm initial={{ name: rule.name, merchantText: rule.merchantKey, accountId: rule.accountId }} accounts={accounts} disabled={isPending} submitLabel="Uložit změny" onCancel={() => setEditingIncomeSourceId(null)} onSubmit={(input) => run(() => updateIncomeSourceRule(rule.id, input), 'Pravidlo bylo uloženo.', () => setEditingIncomeSourceId(null))} /></li>
  ) : (
    <li key={rule.id} className="surface p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{rule.name}</h3>{!rule.isActive ? <Badge>Neaktivní</Badge> : null}</div><p className="mt-2 text-xs text-ink-muted">Obchodník: {rule.merchantKey} · {rule.accountName ? `účet ${rule.accountName}` : 'všechny účty'}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setEditingIncomeSourceId(rule.id); setCreatingIncomeSource(false); }} disabled={isPending} className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs">Upravit</button><button type="button" onClick={() => run(() => setIncomeSourceRuleActive(rule.id, !rule.isActive), rule.isActive ? 'Pravidlo bylo deaktivováno.' : 'Pravidlo bylo aktivováno.')} disabled={isPending} className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs">{rule.isActive ? 'Deaktivovat' : 'Aktivovat'}</button><button type="button" onClick={() => run(() => deleteIncomeSourceRule(rule.id), 'Pravidlo bylo smazáno.')} disabled={isPending} className="ui-button ui-button-ghost min-h-9 px-3 py-2 text-xs text-critical">Smazat</button></div></div>
    </li>
  );

  return <div className="flex flex-col gap-8">
    {error ? <StatusNotice tone="danger" title="Akci se nepodařilo dokončit" live="assertive">{error}</StatusNotice> : null}
    {success ? <StatusNotice tone="success" title="Hotovo" live="polite">{success}</StatusNotice> : null}
    <section className="order-4 surface p-4 sm:p-5"><SectionHeader title="Měsíční cíl výdajů" description="Limit všech běžných měsíčních výdajů, bez převodů a vyrovnání." /><form onSubmit={(event) => { event.preventDefault(); run(() => saveSpendingTarget({ monthlySpendingTarget: target.trim() || null, transferHistoryFrom: historyFrom || null, hideHistoricalBrokerTransfers: hideHistorical }), 'Nastavení cílů a historie bylo uloženo.'); }} className="mt-4 flex flex-col gap-4"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="ui-label min-w-0"><span>Částka v CZK</span><AmountField value={target} onChange={setTarget} disabled={isPending} decimalSeparator="," placeholder="Např. 30000" className="px-3 py-2" /></label><button type="submit" disabled={isPending} className="ui-button ui-button-primary sm:mb-0.5">{isPending ? 'Ukládám…' : 'Uložit nastavení'}</button></div><details><summary className="cursor-pointer text-xs text-ink-muted">Historie bankovních převodů</summary><DateField label="Spolehlivá historie od" value={historyFrom} onValueChange={setHistoryFrom} disabled={isPending} helper="Při prázdném poli se hranice odvodí z nejstaršího dokončeného bankovního importu." className="mt-3 max-w-sm" /><label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={hideHistorical} onChange={(event) => setHideHistorical(event.target.checked)} disabled={isPending} className="mt-0.5" /><span>Skrýt upozornění na historické převody Trading 212 v Čistém jmění — jsou starší než dostupná bankovní historie a nikdy se nespárují.</span></label></details></form></section>
    <section className="order-3 flex flex-col gap-3"><SectionHeader title="Zdroje příjmů" description="Jen kladné běžné transakce z importu s přesnou normalizovanou shodou obchodníka se označí kategorií Příjmy. Vratky ani jiné příjmy se neodhadují." action={!creatingIncomeSource ? <button type="button" onClick={() => { setCreatingIncomeSource(true); setEditingIncomeSourceId(null); }} className="ui-button ui-button-primary"><Plus size={17} weight="bold" />Přidat zdroj</button> : undefined} />
      {creatingIncomeSource ? <div className="surface p-4 sm:p-5"><div className="mb-5 flex items-center justify-between"><h3 className="font-semibold">Nový zdroj příjmů</h3><button type="button" onClick={() => setCreatingIncomeSource(false)} disabled={isPending} className="ui-button ui-button-ghost size-10 p-0" aria-label="Zavřít formulář"><X size={18} /></button></div><IncomeSourceRuleForm initial={{ name: '', merchantText: '', accountId: null }} accounts={accounts} disabled={isPending} submitLabel="Vytvořit zdroj" onCancel={() => setCreatingIncomeSource(false)} onSubmit={(input) => run(() => createIncomeSourceRule(input), 'Zdroj příjmů byl vytvořen.', () => setCreatingIncomeSource(false))} /></div> : null}
      {activeIncomeSourceRules.length ? <ul className="flex flex-col gap-3">{activeIncomeSourceRules.map(renderIncomeSourceRule)}</ul> : !creatingIncomeSource ? <EmptyState icon={<TrendUp size={21} />} title="Zatím žádné aktivní zdroje" description="Přidejte obchodníka, jehož platby mají být příjmem." action={<button type="button" onClick={() => setCreatingIncomeSource(true)} className="ui-button ui-button-primary"><Plus size={17} weight="bold" />Přidat zdroj</button>} /> : null}
    </section>
    {inactiveIncomeSourceRules.length ? <section className="order-3 flex flex-col gap-3"><SectionHeader title="Neaktivní zdroje příjmů" description="Při importu se nepoužijí." /><ul className="flex flex-col gap-3">{inactiveIncomeSourceRules.map(renderIncomeSourceRule)}</ul></section> : null}
    <section className="order-2 flex flex-col gap-3"><SectionHeader title="DCA financování" description="Spárovaný bankovní převod potvrzuje financování brokera, ne nákup investice." action={!creating ? <button type="button" onClick={() => { setCreating(true); setEditingId(null); }} className="ui-button ui-button-primary"><Plus size={17} weight="bold" />Přidat plán</button> : undefined} />
      {creating ? <div className="surface p-4 sm:p-5"><div className="mb-5 flex items-center justify-between"><h3 className="font-semibold">Nový plán financování</h3><button type="button" onClick={() => setCreating(false)} disabled={isPending} className="ui-button ui-button-ghost size-10 p-0" aria-label="Zavřít formulář"><X size={18} /></button></div><PlanForm initial={emptyPlan()} accounts={accounts} disabled={isPending} submitLabel="Vytvořit plán" onCancel={() => setCreating(false)} onSubmit={(input) => run(() => createInvestmentPlan(input), 'Plán byl vytvořen.', () => setCreating(false))} /></div> : null}
      {activePlans.length ? <ul className="flex flex-col gap-3">{activePlans.map(renderPlan)}</ul> : !creating ? <EmptyState icon={<TrendUp size={21} />} title="Zatím žádné aktivní plány" description="Přidejte pravidelný vklad do Trading 212." action={<button type="button" onClick={() => setCreating(true)} className="ui-button ui-button-primary"><Plus size={17} weight="bold" />Přidat plán</button>} /> : null}
    </section>
    {inactivePlans.length ? <section className="order-2 flex flex-col gap-3"><SectionHeader title="Neaktivní plány" description="Nejsou zahrnuty do dashboardu." /><ul className="flex flex-col gap-3">{inactivePlans.map(renderPlan)}</ul></section> : null}
  </div>;
}

function IncomeSourceRuleForm({ initial, accounts, disabled, submitLabel, onCancel, onSubmit }: { initial: IncomeSourceRuleInput; accounts: Account[]; disabled: boolean; submitLabel: string; onCancel: () => void; onSubmit: (input: IncomeSourceRuleInput) => void }): React.JSX.Element {
  const [values, setValues] = useState<IncomeSourceRuleInput>(initial);
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit(values); }} className="flex flex-col gap-5"><div className="grid gap-4 sm:grid-cols-2">
    <label className="ui-label"><span>Zobrazovaný název</span><input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} disabled={disabled} required className="px-3 py-2" /></label>
    <label className="ui-label"><span>Text obchodníka</span><input value={values.merchantText} onChange={(event) => setValues({ ...values, merchantText: event.target.value })} disabled={disabled} required placeholder="Např. ČEZ, A. S." className="px-3 py-2" /></label>
    <SelectField value={values.accountId ?? ''} options={[{ value: '', label: 'Všechny aktivní účty' }, ...accounts.map((account) => ({ value: account.id, label: account.name, description: account.currency }))]} onValueChange={(accountId) => setValues({ ...values, accountId: accountId || null })} label="Omezit na účet" disabled={disabled} />
  </div><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={onCancel} disabled={disabled} className="ui-button ui-button-secondary">Zrušit</button><button type="submit" disabled={disabled} className="ui-button ui-button-primary">{submitLabel}</button></div></form>;
}

function PlanForm({ initial, accounts, disabled, submitLabel, onCancel, onSubmit }: { initial: InvestmentPlanInput; accounts: Account[]; disabled: boolean; submitLabel: string; onCancel: () => void; onSubmit: (input: InvestmentPlanInput) => void }): React.JSX.Element {
  const [values, setValues] = useState<InvestmentPlanInput>(initial);
  const brokers = accounts.filter((account) => account.type === 'INVESTMENT' && account.provider === 'TRADING212');
  const sources = accounts.filter((account) => account.type !== 'INVESTMENT');
  return <form onSubmit={(event) => { event.preventDefault(); onSubmit(values); }} className="flex flex-col gap-5"><div className="grid gap-4 sm:grid-cols-2">
    <label className="ui-label"><span>Název</span><input value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} disabled={disabled} required className="px-3 py-2" /></label>
    <label className="ui-label"><span>Očekávaná částka</span><AmountField value={values.expectedAmount} onChange={(expectedAmount) => setValues({ ...values, expectedAmount })} disabled={disabled} required decimalSeparator="," className="px-3 py-2" /></label>
    <SelectField value={values.sourceAccountId ?? ''} options={[{ value: '', label: 'Bez zdrojového účtu' }, ...sources.map((account) => ({ value: account.id, label: account.name, description: account.currency }))]} onValueChange={(sourceAccountId) => setValues({ ...values, sourceAccountId: sourceAccountId || null })} label="Zdrojový účet" disabled={disabled} />
    <SelectField value={values.brokerAccountId} options={brokers.map((account) => ({ value: account.id, label: account.name, description: account.currency }))} onValueChange={(brokerAccountId) => setValues({ ...values, brokerAccountId })} label="Účet Trading 212" disabled={disabled} />
    <label className="ui-label"><span>Měna</span><input value={values.currency} onChange={(event) => setValues({ ...values, currency: event.target.value.toUpperCase() })} disabled={disabled} maxLength={3} required className="px-3 py-2 uppercase" /></label>
    <label className="ui-label"><span>Den splatnosti</span><input type="number" value={values.dueDay} onChange={(event) => setValues({ ...values, dueDay: Number(event.target.value) })} disabled={disabled} min={1} max={31} required className="px-3 py-2" /></label>
    <label className="ui-label"><span>Tolerance ve dnech</span><input type="number" value={values.graceDays} onChange={(event) => setValues({ ...values, graceDays: Number(event.target.value) })} disabled={disabled} min={0} max={31} required className="px-3 py-2" /></label>
    <DateField label="Platí od" value={values.startsOn ?? ''} onValueChange={(startsOn) => setValues({ ...values, startsOn: startsOn || null })} disabled={disabled} />
    <DateField label="Platí do" value={values.endsOn ?? ''} onValueChange={(endsOn) => setValues({ ...values, endsOn: endsOn || null })} disabled={disabled} />
    <label className="flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface-subtle px-3 py-2 text-sm font-medium sm:col-span-2"><input type="checkbox" checked={values.isActive} onChange={(event) => setValues({ ...values, isActive: event.target.checked })} disabled={disabled} className="size-4" />Aktivní plán</label>
  </div><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={onCancel} disabled={disabled} className="ui-button ui-button-secondary">Zrušit</button><button type="submit" disabled={disabled} className="ui-button ui-button-primary">{submitLabel}</button></div></form>;
}

function formatAmount(value: string): string { const amount = Number(value); return Number.isFinite(amount) ? new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 }).format(amount) : value; }
