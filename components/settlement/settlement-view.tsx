'use client';

import {
  ArrowCounterClockwise,
  CheckCircle,
  CircleNotch,
  Handshake,
  LockKey,
  Receipt,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { closeSettlement, markSettled, reopenSettlement } from '@/app/(dashboard)/settlement/actions';
import { EmptyState } from '@/components/ui/empty-state';
import { Metric } from '@/components/ui/metric';
import { MonthSelect } from '@/components/ui/month-select';
import { SectionHeader } from '@/components/ui/page-container';
import { Badge, StatusNotice } from '@/components/ui/status';
import { formatPeriod } from '@/lib/ui/period';

interface Summary {
  paidByMe: string;
  paidByPartner: string;
  dueFromMe: string | null;
  dueFromPartner: string | null;
  settlementReceived: string | null;
  settlementSent: string | null;
  balance: string;
  exactBalance: string | null;
  direction: 'PARTNER_OWES_ME' | 'I_OWE_PARTNER' | 'EVEN';
  sharedCount: number;
}

interface Line {
  id: string;
  date: string;
  merchant: string;
  total: string;
  paidBy: 'ME' | 'PARTNER';
  myShare: string | null;
  partnerShare: string | null;
  currency: string;
  kind: 'EXPENSE' | 'SETTLEMENT' | 'UNCONVERTED';
}

interface HistoryEntry {
  id: string;
  period: string;
  balance: string;
  settledAt: string | null;
}

interface Props {
  period: { year: number; month: number };
  months: string[];
  isClosed: boolean;
  closedId: string | null;
  settledAt: string | null;
  closedNotes: string | null;
  summary: Summary;
  lines: Line[];
  lockedCount: number;
  unconvertedCount: number;
  history: HistoryEntry[];
}

function formatMoney(value: string): string {
  const negative = value.startsWith('-');
  const [whole, fraction] = (negative ? value.slice(1) : value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return `${negative ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''} Kč`;
}

function absoluteMoney(value: string): string {
  return formatMoney(value.startsWith('-') ? value.slice(1) : value);
}

function formatLineMoney(value: string, currency: string): string {
  if (currency === 'CZK') {
    return formatMoney(value);
  }

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);

  return value && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
    : '—';
}

export function SettlementView({
  period,
  months,
  isClosed,
  closedId,
  settledAt,
  closedNotes,
  summary,
  lines,
  lockedCount,
  unconvertedCount,
  history,
}: Props): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [confirmation, setConfirmation] = useState<'close' | 'reopen' | null>(null);
  const current = `${period.year}-${String(period.month).padStart(2, '0')}`;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string): void {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const result = await action();

        if (!result.ok) {
          setError(result.error ?? 'Akce se nepodařila. Zkuste to znovu.');
          return;
        }

        setConfirmation(null);
        setMessage(successMessage);
        router.refresh();
      } catch (actionError: unknown) {
        console.error('Settlement action failed', actionError);
        setError('Akce se nepodařila. Zkontrolujte připojení a zkuste to znovu.');
      }
    });
  }

  const directionLabel =
    summary.direction === 'EVEN'
      ? 'Nikdo nic nedluží'
      : summary.direction === 'PARTNER_OWES_ME'
        ? 'Partner dluží mně'
        : 'Dlužím partnerovi';
  const directionTone = summary.direction === 'I_OWE_PARTNER' ? 'critical' : summary.direction === 'PARTNER_OWES_ME' ? 'positive' : 'default';
  const periodOptions = months.includes(current) ? months : [current, ...months];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full sm:w-64">
          <MonthSelect
            label="Období"
            value={current}
            months={periodOptions}
            disabled={isPending}
            onValueChange={(value) => router.push(`/settlement?period=${value}`)}
          />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Stav období">
          {summary.direction === 'EVEN' ? <Badge tone="success">Vyrovnáno</Badge> : null}
          {!isClosed ? <Badge tone="info">Otevřené</Badge> : settledAt ? <Badge tone="success">Uzavřené · zaplaceno</Badge> : <Badge tone="warning">Uzavřené · nezaplaceno</Badge>}
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true" className="contents">
        {isPending ? (
          <StatusNotice title="Probíhá změna" tone="info">
            <span className="inline-flex items-center gap-2">
              <CircleNotch className="animate-spin" size={16} aria-hidden="true" /> Čekejte na dokončení.
            </span>
          </StatusNotice>
        ) : null}
        {error ? (
          <StatusNotice title="Akce selhala" tone="danger" live="assertive">
            {error}
          </StatusNotice>
        ) : null}
        {message ? (
          <StatusNotice title="Hotovo" tone="success">
            {message}
          </StatusNotice>
        ) : null}
      </div>

      {unconvertedCount > 0 ? (
        <StatusNotice title="Některé cizoměnové transakce nemají CZK přepočet" tone="warning">
          {isClosed ? (
            <>
              Uzávěrka obsahuje {unconvertedCount} {unconvertedCount === 1 ? 'transakci' : 'transakcí'} bez CZK přepočtu.
              Řádky zůstávají ve zdrojové měně; uloženou částku u této starší uzávěrky ověřte před potvrzením platby.
            </>
          ) : (
            <>
              {unconvertedCount} {unconvertedCount === 1 ? 'transakce je' : 'transakce jsou'} z aktuálního výpočtu
              vynechané, aby zdrojová měna nebyla vydávána za Kč.
            </>
          )}
        </StatusNotice>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)]">
        <div className="surface p-6 md:p-8">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <Handshake size={19} aria-hidden="true" />
            {directionLabel}
          </div>
          <p className={`tabular mt-3 text-4xl font-semibold tracking-[-0.05em] md:text-5xl ${directionTone === 'critical' ? 'text-critical' : directionTone === 'positive' ? 'text-positive' : 'text-ink'}`}>
            {absoluteMoney(summary.balance)}
          </p>
          <p className="mt-3 text-sm text-ink-muted">
            {summary.exactBalance !== null
              ? `Přesně ${formatMoney(summary.exactBalance)} před zaokrouhlením bankovního převodu.`
              : 'Přesná nezaokrouhlená částka se v uzavřené historii neukládá.'}
          </p>
        </div>

        <div className="surface-subtle flex flex-col justify-between gap-5 p-5 md:p-6">
          <div>
            <p className="text-sm font-semibold">{isClosed ? 'Uložená uzávěrka' : 'Aktuální výpočet'}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {isClosed
                ? `${lockedCount} transakcí je svázáno s touto uzávěrkou a nelze je upravit.`
                : `${lockedCount} transakcí bude při uzavření svázáno s tímto obdobím.`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
            {isClosed ? <LockKey size={17} aria-hidden="true" /> : <Receipt size={17} aria-hidden="true" />}
            {summary.sharedCount} sdílených výdajů
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Rozdělení výdajů"
          description={isClosed ? 'Částky uložené při uzavření období.' : 'Průběžný stav podle aktuálních transakcí.'}
        />
        <div className={`grid gap-3 ${isClosed ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
          <Metric label="Zaplaceno mnou" value={formatMoney(summary.paidByMe)} />
          <Metric label="Zaplaceno partnerem" value={formatMoney(summary.paidByPartner)} />
          {summary.dueFromMe !== null ? <Metric label="Můj podíl" value={formatMoney(summary.dueFromMe)} /> : null}
          {summary.dueFromPartner !== null ? <Metric label="Podíl partnera" value={formatMoney(summary.dueFromPartner)} /> : null}
          {summary.settlementReceived !== null ? <Metric label="Přijaté vyrovnání" value={formatMoney(summary.settlementReceived)} /> : null}
          {summary.settlementSent !== null ? <Metric label="Odeslané vyrovnání" value={formatMoney(summary.settlementSent)} /> : null}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title={isClosed ? 'Zamčené transakce' : 'Sdílené výdaje'}
          description={isClosed ? 'Detaily patřící k uložené uzávěrce.' : 'Položky, ze kterých vzniká aktuální zůstatek.'}
        />
        {lines.length > 0 ? (
          <>
            <div className="surface hidden overflow-x-auto md:block">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="border-b border-line bg-surface-subtle text-xs text-ink-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Datum</th>
                    <th className="px-4 py-3 font-medium">Protistrana</th>
                    <th className="px-4 py-3 font-medium">Platil</th>
                    <th className="px-4 py-3 text-right font-medium">Celkem</th>
                    <th className="px-4 py-3 text-right font-medium">Můj podíl</th>
                    <th className="px-4 py-3 text-right font-medium">Podíl partnera</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {lines.map((line) => (
                    <tr key={line.id} className="hover:bg-surface-subtle/60">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-muted">{formatDate(line.date)}</td>
                      <td className="px-4 py-3 font-medium">
                        {line.merchant}
                        {line.kind === 'SETTLEMENT' ? <span className="ml-2 text-xs font-normal text-ink-muted">vyrovnání</span> : null}
                        {line.kind === 'UNCONVERTED' ? <span className="ml-2 text-xs font-normal text-warning">bez CZK přepočtu</span> : null}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{line.paidBy === 'ME' ? 'já' : 'partner'}</td>
                       <td className="px-4 py-3 text-right tabular-nums">{formatLineMoney(line.total, line.currency)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{line.myShare ? formatMoney(line.myShare) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-muted">{line.partnerShare ? formatMoney(line.partnerShare) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:hidden">
              {lines.map((line) => (
                <article key={line.id} className="surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-semibold" title={line.merchant}>{line.merchant}</p>
                      <p className="mt-1 text-xs text-ink-muted">{formatDate(line.date)} · platil {line.paidBy === 'ME' ? 'já' : 'partner'}</p>
                    </div>
                     <p className="money-value font-semibold sm:text-right">{formatLineMoney(line.total, line.currency)}</p>
                  </div>
                  {line.kind === 'EXPENSE' ? (
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                      <div>
                        <dt className="text-xs text-ink-muted">Můj podíl</dt>
                        <dd className="mt-1 tabular-nums">{line.myShare ? formatMoney(line.myShare) : '—'}</dd>
                      </div>
                      <div className="text-right">
                        <dt className="text-xs text-ink-muted">Podíl partnera</dt>
                        <dd className="mt-1 tabular-nums">{line.partnerShare ? formatMoney(line.partnerShare) : '—'}</dd>
                      </div>
                    </dl>
                  ) : line.kind === 'SETTLEMENT' ? (
                    <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">Platba započtená do vyrovnání.</p>
                  ) : (
                    <p className="mt-3 border-t border-line pt-3 text-xs text-warning">Bez CZK přepočtu, nezahrnuto do výpočtu.</p>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Receipt size={21} aria-hidden="true" />}
            title="Žádné sdílené výdaje"
            description="V tomto období nejsou položky k vyrovnání. Sdílení lze nastavit v transakcích."
          />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Správa období" />
        {isClosed && closedId ? (
          <div className="surface flex flex-col gap-5 p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold">Období je uzavřené</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {settledAt ? `Platba potvrzena ${formatDate(settledAt)}.` : 'Čeká na potvrzení platby.'}
                </p>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => markSettled(closedId, settledAt === null), settledAt ? 'Označení platby bylo zrušeno.' : 'Vyrovnání bylo označeno jako zaplacené.')}
                className="ui-button ui-button-secondary"
              >
                <CheckCircle size={18} aria-hidden="true" />
                {settledAt ? 'Označit jako nezaplacené' : 'Označit jako zaplacené'}
              </button>
            </div>

            {closedNotes ? (
              <div className="rounded-xl border border-line bg-surface-subtle p-4">
                <p className="text-xs font-medium text-ink-muted">Poznámka k uzávěrce</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{closedNotes}</p>
              </div>
            ) : null}

            {!settledAt ? (
              confirmation === 'reopen' ? (
                <StatusNotice
                  title="Opravdu znovu otevřít období?"
                  tone="warning"
                  actions={
                    <>
                      <button type="button" disabled={isPending} onClick={() => setConfirmation(null)} className="ui-button ui-button-secondary">
                        Zrušit
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(() => reopenSettlement(closedId), 'Období bylo znovu otevřeno.')}
                        className="ui-button ui-button-danger"
                      >
                        <ArrowCounterClockwise size={18} aria-hidden="true" /> Otevřít období
                      </button>
                    </>
                  }
                >
                  Uzávěrka bude smazána a všech {lockedCount} transakcí se odemkne pro úpravy. Uložené částky ani poznámku už nepůjde obnovit.
                </StatusNotice>
              ) : (
                <button type="button" disabled={isPending} onClick={() => setConfirmation('reopen')} className="ui-button ui-button-ghost self-start">
                  <ArrowCounterClockwise size={18} aria-hidden="true" /> Znovu otevřít období
                </button>
              )
            ) : null}
          </div>
        ) : (
          <div className="surface flex flex-col gap-5 p-5 md:p-6">
            <label className="ui-label">
              Poznámka k vyrovnání <span className="font-normal text-ink-muted">(volitelné)</span>
              <textarea
                value={notes}
                disabled={isPending}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Například způsob úhrady nebo domluvená výjimka"
                className="resize-y px-3 py-2"
              />
            </label>

            {confirmation === 'close' ? (
              <StatusNotice
                title="Potvrdit uzavření období"
                tone="warning"
                actions={
                  <>
                    <button type="button" disabled={isPending} onClick={() => setConfirmation(null)} className="ui-button ui-button-secondary">
                      Zrušit
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => run(() => closeSettlement({ year: period.year, month: period.month, notes: notes.trim() || null }), 'Období bylo uzavřeno.')}
                      className="ui-button ui-button-primary"
                    >
                      <LockKey size={18} aria-hidden="true" /> Potvrdit a uzamknout
                    </button>
                  </>
                }
              >
                Uzavřením se {lockedCount} transakcí uzamkne k této částce. Dokud období znovu neotevřete, nepůjdou upravit ani zahrnout do jiného vyrovnání.
              </StatusNotice>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs text-ink-muted">
                  <WarningCircle size={17} aria-hidden="true" /> Kontrola proběhne ještě před potvrzením.
                </p>
                <button
                  type="button"
                  disabled={isPending || lockedCount === 0}
                  onClick={() => setConfirmation('close')}
                  className="ui-button ui-button-primary"
                >
                  <LockKey size={18} aria-hidden="true" /> Uzavřít období
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {history.length > 0 ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Historie" description="Posledních 12 uzavřených období." />
          <div className="surface divide-y divide-line overflow-hidden">
            {history.map((entry) => (
              <Link
                key={entry.id}
                href={`/settlement?period=${entry.period}`}
                aria-current={entry.period === current ? 'page' : undefined}
                aria-disabled={isPending || undefined}
                tabIndex={isPending ? -1 : undefined}
                onClick={(event) => {
                  if (isPending) event.preventDefault();
                }}
                className={`flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-subtle md:px-5 ${isPending ? 'pointer-events-none opacity-45' : ''}`}
              >
                 <span className="font-medium">{formatPeriod(entry.period)}</span>
                <span className="flex items-center gap-3 text-right">
                  <span className="hidden text-xs text-ink-muted sm:inline">{entry.settledAt ? 'zaplaceno' : 'nezaplaceno'}</span>
                  <span className="font-semibold tabular-nums">{formatMoney(entry.balance)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
