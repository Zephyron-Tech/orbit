'use client';

import { GasPump, Receipt, UploadSimple } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Metric } from '@/components/ui/metric';
import { MoneyValue } from '@/components/ui/money-value';
import { Badge, StatusNotice } from '@/components/ui/status';

interface MonthlyRow {
  month: string;
  totalCzk: string;
  liters: string;
}

interface ReceiptRow {
  id: string;
  purchasedAt: string;
  stationName: string;
  totalAfterDiscount: string;
  discountAmount: string;
  matched: boolean;
}

interface FuelPurchasePreview {
  purchasedAt: string;
  stationName: string;
  product: string;
  quantityLiters: string;
  amountCzk: string;
  duplicate: boolean;
}

interface FuelImportSummary {
  batchId: string | null;
  dryRun: boolean;
  rowCount: number;
  inserted: number;
  skipped: number;
  excludedBeforeCutoff: number;
  failed: number;
  preview: FuelPurchasePreview[];
  failures: { rowNumber: number; reason: string }[];
}

type ReceiptUploadResult =
  | {
      ok: true;
      filename: string;
      dryRun: boolean;
      receiptId: string | null;
      docNumber: string;
      purchasedAt: string;
      stationName: string;
      matchedPurchaseId: string | null;
      totalAfterDiscount: string;
      discountAmount: string;
    }
  | { ok: false; filename: string; error: string; code: string };

interface Props {
  monthly: MonthlyRow[];
  walletBalanceCzk: string;
  topUpCount: number;
  purchaseCount: number;
  totalDiscountCzk: string;
  receiptCount: number;
  receipts: ReceiptRow[];
}

const MONTH_FORMAT = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const CZK = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
const LITERS = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });

function formatMonth(month: string): string {
  return MONTH_FORMAT.format(new Date(`${month}-01T00:00:00Z`));
}

export function FuelManager({ monthly, walletBalanceCzk, topUpCount, purchaseCount, totalDiscountCzk, receiptCount, receipts }: Props): React.JSX.Element {
  const unmatchedCount = receipts.filter((receipt) => !receipt.matched).length;

  // "You have a purchase but no receipt for it" signal: compare the xls
  // purchase total for the latest month against however much of that month
  // is actually backed by an uploaded receipt. A real gap (not rounding
  // noise) means receipts are still missing for that month.
  const latestMonth = monthly.length > 0 ? monthly[monthly.length - 1] : null;
  const latestMonthReceiptsTotal = latestMonth
    ? receipts.filter((receipt) => receipt.purchasedAt.slice(0, 7) === latestMonth.month).reduce((sum, receipt) => sum + Number(receipt.totalAfterDiscount), 0)
    : 0;
  const latestMonthGapCzk = latestMonth ? Math.max(0, Number(latestMonth.totalCzk) - latestMonthReceiptsTotal) : 0;

  const router = useRouter();
  const [xlsPending, setXlsPending] = useState(false);
  const [xlsError, setXlsError] = useState<string | null>(null);
  const [xlsPreview, setXlsPreview] = useState<FuelImportSummary | null>(null);
  const [xlsFileName, setXlsFileName] = useState<string | null>(null);
  const xlsInputRef = useRef<HTMLInputElement>(null);

  const [receiptPending, setReceiptPending] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptUploadResult[] | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  async function uploadXls(dryRun: boolean): Promise<void> {
    const file = xlsInputRef.current?.files?.[0];

    if (!file) {
      setXlsError('Vyberte prosím soubor Sales.xls');
      return;
    }

    setXlsPending(true);
    setXlsError(null);

    try {
      const formData = new FormData();
      formData.set('file', file);
      formData.set('dryRun', String(dryRun));

      const response = await fetch('/api/import/fuel', { method: 'POST', body: formData });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Import se nezdařil.';

        setXlsError(message);
        setXlsPreview(null);
        return;
      }

      const summary = payload as FuelImportSummary;

      if (dryRun) {
        setXlsPreview(summary);
      } else {
        setXlsPreview(null);
        if (xlsInputRef.current) xlsInputRef.current.value = '';
        setXlsFileName(null);
        router.refresh();
      }
    } catch {
      setXlsError('Import se teď nezdařil. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      setXlsPending(false);
    }
  }

  async function uploadReceipts(dryRun: boolean): Promise<void> {
    const files = receiptInputRef.current?.files;

    if (!files || files.length === 0) {
      setReceiptError('Vyberte prosím alespoň jednu účtenku (PDF)');
      return;
    }

    setReceiptPending(true);
    setReceiptError(null);

    try {
      const formData = new FormData();
      for (const file of files) formData.append('file', file);
      formData.set('dryRun', String(dryRun));

      const response = await fetch('/api/import/fuel-receipt', { method: 'POST', body: formData });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
            ? payload.error
            : 'Nahrání účtenky se nezdařilo.';

        setReceiptError(message);
        setReceiptPreview(null);
        return;
      }

      const { results } = payload as { results: ReceiptUploadResult[] };

      if (dryRun) {
        setReceiptPreview(results);
      } else {
        setReceiptPreview(null);
        if (receiptInputRef.current) receiptInputRef.current.value = '';
        router.refresh();
      }
    } catch {
      setReceiptError('Nahrání se teď nezdařilo. Zkontrolujte připojení a zkuste to znovu.');
    } finally {
      setReceiptPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Odhadovaný zůstatek na kartě" value={CZK.format(Number(walletBalanceCzk))} detail={`${topUpCount} dobití · ${purchaseCount} nákupů`} sensitive />
        <Metric
          label="Poslední měsíc"
          value={monthly.length > 0 ? CZK.format(Number(monthly[monthly.length - 1]?.totalCzk ?? '0')) : '—'}
          detail={monthly.length > 0 ? formatMonth(monthly[monthly.length - 1]?.month ?? '') : 'Zatím žádná data'}
          sensitive
        />
        <Metric
          label="Sleva díky Tankartě"
          value={CZK.format(Number(totalDiscountCzk))}
          detail={`${receiptCount} ${receiptCount === 1 ? 'nahraná účtenka' : 'nahraných účtenek'}`}
          tone="positive"
          sensitive
        />
        <Metric
          label="Nespárované účtenky"
          value={String(unmatchedCount)}
          detail={unmatchedCount > 0 ? 'Vyžadují kontrolu' : 'Vše spárováno'}
          tone={unmatchedCount > 0 ? 'critical' : 'default'}
        />
      </section>

      {latestMonth && latestMonthGapCzk > 1 ? (
        <StatusNotice
          title="Chybí účtenky"
          tone="warning"
          actions={
            <button type="button" onClick={() => receiptInputRef.current?.click()} className="ui-button ui-button-secondary">
              Nahrát chybějící účtenky
            </button>
          }
        >
          Za {formatMonth(latestMonth.month)} je z tankarta.cz útrata <MoneyValue>{CZK.format(Number(latestMonth.totalCzk))}</MoneyValue>, ale nahrané
          účtenky pokrývají jen <MoneyValue>{CZK.format(latestMonthReceiptsTotal)}</MoneyValue>. Chybí tedy přibližně <MoneyValue>{CZK.format(latestMonthGapCzk)}</MoneyValue> v
          nenahraných účtenkách.
        </StatusNotice>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Skutečná spotřeba podle měsíce</h2>
        {monthly.length === 0 ? (
          <StatusNotice tone="info">Zatím nejsou nahrány žádné nákupy paliva.</StatusNotice>
        ) : (
          <div className="surface overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="border-b border-line bg-surface-subtle text-xs text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Měsíc</th>
                  <th className="px-4 py-3 text-right font-medium">Litry</th>
                  <th className="px-4 py-3 text-right font-medium">Útrata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...monthly].reverse().map((row) => (
                  <tr key={row.month}>
                    <td className="px-4 py-3">{formatMonth(row.month)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{LITERS.format(Number(row.liters))} l</td>
                    <td className="money-value px-4 py-3 text-right font-semibold tabular-nums"><MoneyValue>{CZK.format(Number(row.totalCzk))}</MoneyValue></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <GasPump size={19} aria-hidden="true" />
          <h2 className="font-semibold">Import z tankarta.cz (.xls)</h2>
        </div>
        <p className="text-sm text-ink-muted">Export historie nákupů z uživatelského účtu na tankarta.cz. Import je bezpečné opakovat — duplicity se přeskočí. Sledujeme jen srpen 2026 a novější, starší řádky se neukládají.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => xlsInputRef.current?.click()}
            disabled={xlsPending}
            className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
          >
            Vybrat soubor
          </button>
          <input
            ref={xlsInputRef}
            type="file"
            accept=".xls"
            disabled={xlsPending}
            className="sr-only"
            onChange={(event) => setXlsFileName(event.target.files?.[0]?.name ?? null)}
          />
          {xlsFileName ? <p title={xlsFileName} className="max-w-full break-words text-xs font-medium text-ink-muted [overflow-wrap:anywhere]">{xlsFileName}</p> : null}
          <button
            type="button"
            onClick={() => void uploadXls(true)}
            disabled={xlsPending}
            className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
          >
            {xlsPending ? 'Načítám…' : 'Náhled'}
          </button>
        </div>
        {xlsError ? <StatusNotice tone="danger">{xlsError}</StatusNotice> : null}
        {xlsPreview ? (
          <div className="rounded-xl border border-line bg-surface-subtle p-4">
            <p className="text-sm">
              {xlsPreview.rowCount} řádků · {xlsPreview.inserted} nových · {xlsPreview.skipped} duplicitních · {xlsPreview.excludedBeforeCutoff} mimo sledované období · {xlsPreview.failed} chybných
            </p>
            {xlsPreview.preview.length > 0 ? (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line">
                <table className="w-full min-w-[28rem] text-left text-xs">
                  <thead className="border-b border-line bg-surface text-ink-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Datum</th>
                      <th className="px-3 py-2 font-medium">Stanice</th>
                      <th className="px-3 py-2 text-right font-medium">Množství</th>
                      <th className="px-3 py-2 text-right font-medium">Částka</th>
                      <th className="px-3 py-2 font-medium">Stav</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {xlsPreview.preview.map((row) => (
                      <tr key={`${row.purchasedAt}-${row.amountCzk}`}>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{new Date(row.purchasedAt).toLocaleString('cs-CZ', { timeZone: 'UTC' })}</td>
                        <td className="px-3 py-2">{row.stationName}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{LITERS.format(Number(row.quantityLiters))} l</td>
                        <td className="money-value whitespace-nowrap px-3 py-2 text-right tabular-nums"><MoneyValue>{CZK.format(Number(row.amountCzk))}</MoneyValue></td>
                        <td className="px-3 py-2">{row.duplicate ? <span className="text-ink-muted">duplicita</span> : <span className="text-positive">nové</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {xlsPreview.inserted > 0 ? (
              <button
                type="button"
                onClick={() => void uploadXls(false)}
                disabled={xlsPending}
                className="ui-button ui-button-primary mt-3 min-h-9 px-3 py-2 text-xs"
              >
                {xlsPending ? 'Ukládám…' : `Uložit ${xlsPreview.inserted} nových nákupů`}
              </button>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">Nic nového k uložení.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="surface flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Receipt size={19} aria-hidden="true" />
          <h2 className="font-semibold">Nahrát účtenky (PDF)</h2>
        </div>
        <p className="text-sm text-ink-muted">Účtenka obsahuje slevu Tankarty, kterou export historie neuvádí. Po nahrání se automaticky spáruje s odpovídajícím nákupem. Lze nahrát víc účtenek najednou.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => receiptInputRef.current?.click()}
            disabled={receiptPending}
            className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
          >
            <UploadSimple size={16} aria-hidden="true" />
            Vybrat účtenky
          </button>
          <input
            ref={receiptInputRef}
            type="file"
            accept=".pdf"
            multiple
            disabled={receiptPending}
            className="sr-only"
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) void uploadReceipts(true);
              else setReceiptPreview(null);
            }}
          />
          {receiptPending ? <span className="text-xs text-ink-muted">Načítám…</span> : null}
        </div>
        {receiptError ? <StatusNotice tone="danger">{receiptError}</StatusNotice> : null}
        {receiptPreview ? (
          <div className="rounded-xl border border-line bg-surface-subtle p-4">
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              <table className="w-full min-w-[32rem] text-left text-xs">
                <thead className="border-b border-line bg-surface text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Soubor</th>
                    <th className="px-3 py-2 font-medium">Stanice</th>
                    <th className="px-3 py-2 text-right font-medium">Částka</th>
                    <th className="px-3 py-2 text-right font-medium">Sleva</th>
                    <th className="px-3 py-2 font-medium">Stav</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {receiptPreview.map((result) => (
                    <tr key={result.filename}>
                      <td className="max-w-40 truncate px-3 py-2" title={result.filename}>{result.filename}</td>
                      {result.ok ? (
                        <>
                          <td className="px-3 py-2">{result.stationName}</td>
                          <td className="money-value whitespace-nowrap px-3 py-2 text-right tabular-nums"><MoneyValue>{CZK.format(Number(result.totalAfterDiscount))}</MoneyValue></td>
                          <td className="money-value whitespace-nowrap px-3 py-2 text-right tabular-nums text-positive"><MoneyValue>{CZK.format(Number(result.discountAmount))}</MoneyValue></td>
                          <td className="px-3 py-2">
                            {result.matchedPurchaseId ? <span className="text-positive">spárováno</span> : <span className="text-warning">nespárováno</span>}
                          </td>
                        </>
                      ) : (
                        <td className="px-3 py-2 text-critical" colSpan={4}>{result.error}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {receiptPreview.some((result) => result.ok) ? (
              <button
                type="button"
                onClick={() => void uploadReceipts(false)}
                disabled={receiptPending}
                className="ui-button ui-button-primary mt-3 min-h-9 px-3 py-2 text-xs"
              >
                {receiptPending ? 'Ukládám…' : `Uložit ${receiptPreview.filter((result) => result.ok).length} účtenek`}
              </button>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">Nic k uložení.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Nahrané účtenky</h2>
        {receipts.length === 0 ? (
          <StatusNotice tone="info">Zatím nejsou nahrané žádné účtenky.</StatusNotice>
        ) : (
          <ul className="surface divide-y divide-line overflow-hidden">
            {receipts.map((receipt) => (
              <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{receipt.stationName}</p>
                    {receipt.matched ? <Badge tone="success">Spárováno</Badge> : <Badge tone="warning">Čeká na spárování</Badge>}
                  </div>
                  <p className="text-xs text-ink-muted">{new Date(receipt.purchasedAt).toLocaleString('cs-CZ', { timeZone: 'UTC' })}</p>
                </div>
                <div className="text-right">
                  <p className="money-value font-semibold"><MoneyValue>{CZK.format(Number(receipt.totalAfterDiscount))}</MoneyValue></p>
                  <p className="text-xs text-positive">sleva <MoneyValue>{CZK.format(Number(receipt.discountAmount))}</MoneyValue></p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
