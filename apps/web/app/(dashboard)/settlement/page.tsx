import { cookies, headers } from 'next/headers';

import { SettlementView } from '@/components/settlement/settlement-view';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { apiClient } from '@/lib/api-client';
import { isPeriod, PERIOD_COOKIE, periodParts } from '@/lib/ui/period';

export const dynamic = 'force-dynamic';

interface SettlementLineView {
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

interface SettlementSummary {
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

interface SettlementData {
  period: { year: number; month: number };
  isClosed: boolean;
  closedId: string | null;
  settledAt: string | null;
  closedNotes: string | null;
  summary: SettlementSummary;
  lines: SettlementLineView[];
  lockedCount: number;
  unconvertedCount: number;
  months: string[];
  history: { id: string; period: string; balance: string; settledAt: string | null }[];
}

function parsePeriod(value: string | undefined, fallback: { year: number; month: number }): { year: number; month: number } {
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  if (!match) return fallback;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : fallback;
}

export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ period?: string }> }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const cookie = (await headers()).get('cookie') ?? undefined;
  const preferredPeriod = (await cookies()).get(PERIOD_COOKIE)?.value;
  const client = apiClient(cookie);

  const newestResponse = await client.settlement['newest-transaction-date'].$get();
  const { date: newestDate } = (await newestResponse.json()) as { date: string | null };
  const now = new Date();
  const fallback = newestDate
    ? { year: new Date(newestDate).getUTCFullYear(), month: new Date(newestDate).getUTCMonth() + 1 }
    : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  const remembered = isPeriod(preferredPeriod) ? periodParts(preferredPeriod) : null;
  const period = parsePeriod(params.period, remembered ?? fallback);

  const response = await client.settlement.$get({ query: { year: String(period.year), month: String(period.month) } });
  const data = (await response.json()) as SettlementData;

  return (
    <PageShell>
      <PageHeader title="Vyrovnání" description="Sdílené výdaje za měsíc, jejich rozdělení a bezpečně uzamčená historie dohodnutých částek." />
      <SettlementView
        period={data.period}
        months={data.months}
        isClosed={data.isClosed}
        closedId={data.closedId}
        settledAt={data.settledAt}
        closedNotes={data.closedNotes}
        summary={data.summary}
        lines={data.lines}
        lockedCount={data.lockedCount}
        unconvertedCount={data.unconvertedCount}
        history={data.history}
      />
    </PageShell>
  );
}
