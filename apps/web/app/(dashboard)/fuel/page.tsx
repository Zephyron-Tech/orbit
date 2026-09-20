import { ArrowSquareOut, GasPump } from '@phosphor-icons/react/dist/ssr';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { FuelManager } from '@/components/fuel/fuel-manager';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { apiClient } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

interface FuelResponse {
  overview: {
    monthly: { month: string; totalCzk: string; liters: string }[];
    walletBalanceCzk: string;
    topUpCount: number;
    purchaseCount: number;
    totalDiscountCzk: string;
    receiptCount: number;
  };
  receipts: { id: string; stationName: string; totalAfterDiscount: string; discountAmount: string; purchasedAt: string; matched: boolean }[];
}

export default async function FuelPage(): Promise<React.JSX.Element> {
  const cookieHeader = (await headers()).get('cookie') ?? undefined;
  const response = await apiClient(cookieHeader).fuel.$get();
  if (!response.ok) redirect('/signin');
  const { overview, receipts } = (await response.json()) as FuelResponse;

  return (
    <PageShell>
      <PageHeader
        title="Palivo"
        description="Skutečná měsíční spotřeba PHM podle nákupů z Orlen Tankarty, ne podle toho, kdy jste si dobili kredit."
        actions={
          <a href="https://www.tankarta.cz/CustomerPortal" target="_blank" rel="noopener noreferrer" className="ui-button ui-button-secondary min-h-9 px-3 py-2 text-xs">
            <GasPump size={16} aria-hidden="true" />
            tankarta.cz
            <ArrowSquareOut size={14} aria-hidden="true" />
          </a>
        }
      />
      <FuelManager
        monthly={overview.monthly}
        walletBalanceCzk={overview.walletBalanceCzk}
        topUpCount={overview.topUpCount}
        purchaseCount={overview.purchaseCount}
        totalDiscountCzk={overview.totalDiscountCzk}
        receiptCount={overview.receiptCount}
        receipts={receipts}
      />
    </PageShell>
  );
}
