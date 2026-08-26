import { FuelManager } from '@/components/fuel/fuel-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { loadFuelOverview, loadUnmatchedReceipts } from '@/lib/finance/fuel-service';

export const dynamic = 'force-dynamic';

export default async function FuelPage(): Promise<React.JSX.Element> {
  const [overview, unmatchedReceipts] = await Promise.all([loadFuelOverview(), loadUnmatchedReceipts()]);

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
        unmatchedReceipts={unmatchedReceipts.map((receipt) => ({ ...receipt, purchasedAt: receipt.purchasedAt.toISOString() }))}
      />
    </PageShell>
  );
}
