'use client';

import { CaretDown, ChartLineUp, CreditCard, PiggyBank, Wallet } from '@phosphor-icons/react';
import { useState } from 'react';

import { MoneyValue } from '@/components/ui/money-value';
import { Badge } from '@/components/ui/status';

export interface AccountCardData {
  id: string;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT';
  provider: string;
  balance: string;
  source: string;
  asOf: string | null;
  incomplete: boolean;
  creditLimit: string | null;
  annualInterestRate: string | null;
  interestTaxRate: string | null;
  emergencyReserveMonths: number | null;
  portfolio: { cashBalance: string | null; investedValue: string | null; unrealizedPnl: string | null; updatedAt: string; currency: string } | null;
  analytics: { averageIncome: string; medianIncome: string; averageExpense: string; medianExpense: string; monthToDateIncome: string; monthToDateExpense: string; refunds: string; interestEarned: string; months: number; fromMonth: string | null; toMonth: string | null };
}

const CZK = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
const TYPE_LABEL: Record<AccountCardData['type'], string> = { CHECKING: 'Běžný účet', SAVINGS: 'Spořicí účet', INVESTMENT: 'Investice', CREDIT: 'Kreditní karta' };

function icon(type: AccountCardData['type']): React.JSX.Element {
  if (type === 'SAVINGS') return <PiggyBank size={20} />;
  if (type === 'CREDIT') return <CreditCard size={20} />;
  if (type === 'INVESTMENT') return <ChartLineUp size={20} />;
  return <Wallet size={20} />;
}

export function AccountCards({ accounts, fixedBaseline }: { accounts: AccountCardData[]; fixedBaseline: string }): React.JSX.Element {
  return <div className="grid gap-3">{accounts.map((account) => <AccountCard key={account.id} account={account} fixedBaseline={fixedBaseline} />)}</div>;
}

function AccountCard({ account, fixedBaseline }: { account: AccountCardData; fixedBaseline: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const balance = Number(account.balance);
  const debt = Math.max(0, -balance);
  const limit = Number(account.creditLimit ?? 0);
  const reserveTarget = account.emergencyReserveMonths ? Number(fixedBaseline) * account.emergencyReserveMonths : null;
  const monthlyGross = account.annualInterestRate ? balance * Number(account.annualInterestRate) / 12 : null;
  const monthlyNet = monthlyGross === null ? null : monthlyGross * (1 - Number(account.interestTaxRate ?? '0.15'));
  const projectionBase = account.asOf ? new Date(account.asOf) : new Date();
  const yearEnd = new Date(Date.UTC(projectionBase.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
  const daysToYearEnd = Math.max(0, Math.ceil((yearEnd.getTime() - projectionBase.getTime()) / 86_400_000));
  const projectedYearEndBalance = account.annualInterestRate && balance > 0
    ? balance * (1 + Number(account.annualInterestRate) * (1 - Number(account.interestTaxRate ?? '0.15')) * daysToYearEnd / 365)
    : null;
  const analyticsPeriod = account.analytics.fromMonth && account.analytics.toMonth
    ? `${formatMonth(account.analytics.fromMonth)} až ${formatMonth(account.analytics.toMonth)} · ${account.analytics.months} měs.`
    : 'Zatím bez dokončené historie';
  return <details className="surface group" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
    <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-4 sm:p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-accent">{icon(account.type)}</span>
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="break-words font-semibold">{account.name}</span>{account.incomplete ? <Badge tone="warning">Neúplný podklad</Badge> : null}</span><span className="mt-1 block text-xs text-ink-muted">{account.provider} · {TYPE_LABEL[account.type]} · {account.source}{account.asOf ? ` · ${new Date(account.asOf).toLocaleDateString('cs-CZ', { timeZone: 'UTC' })}` : ''}</span></span>
      <span className={`money-value text-right font-semibold ${account.type === 'CREDIT' && debt > 0 ? 'text-critical' : ''}`}><MoneyValue>{account.type === 'CREDIT' && debt > 0 ? '−' : ''}{CZK.format(account.type === 'CREDIT' ? debt : balance)}</MoneyValue></span><CaretDown size={18} className="shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-line bg-surface-subtle/45 p-4 sm:p-5"><p className="mb-3 text-xs text-ink-muted">Měsíční statistiky: {analyticsPeriod}. Aktuální měsíc je uvedený zvlášť.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {account.type === 'CHECKING' ? <><Detail label="Průměr příjmů / měsíc" value={CZK.format(Number(account.analytics.averageIncome))} sensitive /><Detail label="Medián příjmů / měsíc" value={CZK.format(Number(account.analytics.medianIncome))} sensitive /><Detail label="Průměr výdajů / měsíc" value={CZK.format(Number(account.analytics.averageExpense))} sensitive /><Detail label="Medián výdajů / měsíc" value={CZK.format(Number(account.analytics.medianExpense))} sensitive /><Detail label="Příjmy tento měsíc" value={CZK.format(Number(account.analytics.monthToDateIncome))} sensitive /><Detail label="Výdaje tento měsíc" value={CZK.format(Number(account.analytics.monthToDateExpense))} sensitive /></> : null}
      {account.type === 'CREDIT' ? <><Detail label="Aktuální dluh" value={CZK.format(debt)} sensitive /><Detail label="Limit" value={limit ? CZK.format(limit) : 'Nenastaven'} sensitive={limit > 0} /><Detail label="Volná kapacita" value={limit ? CZK.format(Math.max(0, limit - debt)) : '—'} sensitive={limit > 0} /><Detail label="Průměrná útrata / měsíc" value={CZK.format(Number(account.analytics.averageExpense))} sensitive /><Detail label="Medián útraty / měsíc" value={CZK.format(Number(account.analytics.medianExpense))} sensitive /><Detail label="Útrata tento měsíc" value={CZK.format(Number(account.analytics.monthToDateExpense))} sensitive /><Detail label="Refundace v okně" value={CZK.format(Number(account.analytics.refunds))} sensitive /></> : null}
      {account.type === 'SAVINGS' ? <><Detail label="Skutečné úroky v okně" value={CZK.format(Number(account.analytics.interestEarned))} sensitive /><Detail label="Roční sazba / daň" value={account.annualInterestRate ? `${(Number(account.annualInterestRate) * 100).toFixed(2)} % / ${(Number(account.interestTaxRate ?? '0.15') * 100).toFixed(0)} %` : 'Nastavte sazbu'} /><Detail label="Hrubý odhad úroku / měsíc" value={monthlyGross === null ? '—' : CZK.format(monthlyGross)} sensitive={monthlyGross !== null} /><Detail label="Čistý odhad úroku / měsíc" value={monthlyNet === null ? '—' : CZK.format(monthlyNet)} sensitive={monthlyNet !== null} /><Detail label={`Odhad zůstatku k 31. 12. (${daysToYearEnd} dní)`} value={projectedYearEndBalance === null ? 'Nastavte sazbu' : CZK.format(projectedYearEndBalance)} sensitive={projectedYearEndBalance !== null} /><Detail label="Železná rezerva" value={reserveTarget === null ? 'Nastavte měsíce' : <>{CZK.format(Math.max(0, balance))} / {CZK.format(reserveTarget)}</>} sensitive={reserveTarget !== null} /><Detail label="Krytí fixních výdajů" value={Number(fixedBaseline) > 0 ? `${(Math.max(0, balance) / Number(fixedBaseline)).toFixed(1)} měs.` : '—'} /></> : null}
      {account.type === 'INVESTMENT' ? <><Detail label="Hodnota pozic" value={account.portfolio?.investedValue ? CZK.format(Number(account.portfolio.investedValue)) : '—'} sensitive={Boolean(account.portfolio?.investedValue)} /><Detail label="Broker hotovost" value={account.portfolio?.cashBalance ? CZK.format(Number(account.portfolio.cashBalance)) : '—'} sensitive={Boolean(account.portfolio?.cashBalance)} /><Detail label="Nerealizovaný P/L" value={account.portfolio?.unrealizedPnl ? CZK.format(Number(account.portfolio.unrealizedPnl)) : '—'} sensitive={Boolean(account.portfolio?.unrealizedPnl)} /><Detail label="Poslední snapshot" value={account.portfolio?.updatedAt ? new Date(account.portfolio.updatedAt).toLocaleString('cs-CZ') : 'Chybí'} /><Detail label="Dividend / úrok v okně" value={CZK.format(Number(account.analytics.averageIncome) * account.analytics.months)} sensitive /><Detail label="Stav" value={account.incomplete ? 'Chybí snímek' : 'Provider snapshot'} /></> : null}
    </div></div>
  </details>;
}

function Detail({ label, value, sensitive = false }: { label: string; value: React.ReactNode; sensitive?: boolean }): React.JSX.Element {
  return <div><p className="text-xs text-ink-muted">{label}</p><p className="money-value mt-1 text-sm font-semibold">{sensitive ? <MoneyValue>{value}</MoneyValue> : value}</p></div>;
}

function formatMonth(value: string): string {
  return new Intl.DateTimeFormat('cs-CZ', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
}
