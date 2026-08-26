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
        description="Skutečná měsíční spotřeba PHM podle nákupů z Orlen Tankkarty, ne podle toho, kdy jste si dobili kredit."
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
