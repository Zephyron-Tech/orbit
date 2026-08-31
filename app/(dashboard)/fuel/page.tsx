import { ArrowSquareOut, GasPump } from '@phosphor-icons/react/dist/ssr';

import { FuelManager } from '@/components/fuel/fuel-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { loadFuelOverview, loadRecentReceipts } from '@/lib/finance/fuel-service';

export const dynamic = 'force-dynamic';

export default async function FuelPage(): Promise<React.JSX.Element> {
  const [overview, receipts] = await Promise.all([loadFuelOverview(), loadRecentReceipts()]);

  return (
    <PageShell>
      <PageHeader
        title="Palivo"
        description="Skutečná měsíční spotřeba PHM podle nákupů z Orlen Tankarty, ne podle toho, kdy jste si dobili kredit."
        actions={
          <a
            href="https://www.tankarta.cz/CustomerPortal"
            target="_blank"
            rel="noopener noreferrer"
            className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs"
          >
            <GasPump size={16} aria-hidden="true" />
            tankarta.cz
            <ArrowSquareOut size={14} aria-hidden="true" />
          </a>
        }
      />
      <FuelManager
        monthly={overview.monthly.map((row) => ({ month: row.month, totalCzk: row.totalCzk.toFixed(2), liters: row.liters.toFixed(3) }))}
        walletBalanceCzk={overview.walletBalanceCzk}
        topUpCount={overview.topUpCount}
        purchaseCount={overview.purchaseCount}
        totalDiscountCzk={overview.totalDiscountCzk}
        receiptCount={overview.receiptCount}
        receipts={receipts.map((receipt) => ({ ...receipt, purchasedAt: receipt.purchasedAt.toISOString() }))}
      />
    </PageShell>
  );
}
