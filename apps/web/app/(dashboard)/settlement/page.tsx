import { loadPeriodTransactions } from './actions';
import { cookies } from 'next/headers';

import { SettlementView } from '@/components/settlement/settlement-view';
import { PageHeader, PageShell } from '@/components/ui/page-container';
import { prisma } from '@/lib/db/prisma';
import { calculateSettlement, describeBalance, monthPeriod } from '@/lib/finance/settlement';
import { computeMyShare } from '@/lib/finance/share';
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

function parsePeriod(value: string | undefined, fallback: { year: number; month: number }): {
  year: number;
  month: number;
} {
  const match = value ? /^(\d{4})-(\d{2})$/.exec(value) : null;

  if (!match) {
    return fallback;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  return month >= 1 && month <= 12 ? { year, month } : fallback;
}

export default async function SettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const preferredPeriod = (await cookies()).get(PERIOD_COOKIE)?.value;
  const newest = await prisma.transaction.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
  const fallback = newest
    ? { year: newest.date.getUTCFullYear(), month: newest.date.getUTCMonth() + 1 }
    : { year: new Date().getUTCFullYear(), month: new Date().getUTCMonth() + 1 };

  const remembered = isPeriod(preferredPeriod) ? periodParts(preferredPeriod) : null;
  const period = parsePeriod(params.period, remembered ?? fallback);
  const { from, to } = monthPeriod(period.year, period.month);
  const closed = await prisma.settlement.findFirst({
    where: { periodFrom: from, periodTo: to },
    select: {
      id: true,
      paidByMe: true,
      paidByPartner: true,
      balance: true,
      settledAt: true,
      notes: true,
      transactions: {
        select: {
          id: true,
          date: true,
          merchant: true,
          amount: true,
          amountCzk: true,
          currency: true,
          isShared: true,
          paidBy: true,
          myShareRatio: true,
          kind: true,
        },
        orderBy: { date: 'asc' },
      },
    },
  });

  const [transactions, history, months, unconvertedCount] = await Promise.all([
    closed ? Promise.resolve(null) : loadPeriodTransactions(period.year, period.month),
    prisma.settlement.findMany({ orderBy: { periodFrom: 'desc' }, take: 12 }),
    prisma.$queryRaw<{ month: string }[]>`
      SELECT DISTINCT to_char("date", 'YYYY-MM') AS month
      FROM "Transaction"
      ORDER BY month DESC
    `,
    prisma.transaction.count({
      where: closed
        ? { settlementId: closed.id, currency: { not: 'CZK' }, amountCzk: null }
        : {
            date: { gte: from, lt: to },
            currency: { not: 'CZK' },
            amountCzk: null,
            settlementId: null,
            OR: [
              { kind: 'NORMAL', isShared: true, amount: { lt: 0 } },
              { kind: 'SETTLEMENT' },
            ],
          },
    }),
  ]);

  let summary;
  let lines: SettlementLineView[];
  let lockedCount: number;

  if (closed) {
    // Settlement totals are immutable snapshots. Only line shares are derived
    // from their locked transaction values for display.
    lines = closed.transactions.flatMap<SettlementLineView>((transaction) => {
      const amount = transaction.currency === 'CZK' ? transaction.amount : transaction.amountCzk;

      if (!amount) {
        return [{
          id: transaction.id,
          date: transaction.date.toISOString().slice(0, 10),
          merchant: transaction.merchant ?? '—',
          total: transaction.amount.abs().toFixed(2),
          paidBy: transaction.paidBy,
          myShare: null,
          partnerShare: null,
          currency: transaction.currency,
          kind: 'UNCONVERTED' as const,
        }];
      }

      if (transaction.kind === 'SETTLEMENT') {
        return [
          {
            id: transaction.id,
            date: transaction.date.toISOString().slice(0, 10),
            merchant: transaction.merchant ?? 'Platba vyrovnání',
            total: amount.abs().toFixed(2),
            paidBy: amount.greaterThan(0) ? ('PARTNER' as const) : ('ME' as const),
            myShare: null,
            partnerShare: null,
            currency: 'CZK',
            kind: 'SETTLEMENT' as const,
          },
        ];
      }

      if (transaction.kind !== 'NORMAL' || !transaction.isShared || amount.greaterThanOrEqualTo(0)) {
        return [];
      }

      const total = amount.abs();
      const myShare = computeMyShare(total, transaction.myShareRatio, `Transaction ${transaction.id}`);

      return [
        {
          id: transaction.id,
          date: transaction.date.toISOString().slice(0, 10),
          merchant: transaction.merchant ?? '—',
          total: total.toFixed(2),
          paidBy: transaction.paidBy,
          myShare: myShare.toFixed(2),
          partnerShare: total.minus(myShare).toFixed(2),
          currency: 'CZK',
          kind: 'EXPENSE' as const,
        },
      ];
    });
    summary = {
      paidByMe: closed.paidByMe.toFixed(2),
      paidByPartner: closed.paidByPartner.toFixed(2),
      dueFromMe: null,
      dueFromPartner: null,
      settlementReceived: null,
      settlementSent: null,
      balance: closed.balance.toFixed(0),
      exactBalance: null,
      direction: describeBalance(closed.balance),
      sharedCount: lines.filter((line) => line.kind === 'EXPENSE').length,
    };
    lockedCount = closed.transactions.length;
  } else {
    const result = calculateSettlement(transactions ?? []);
    const lineDetails = await prisma.transaction.findMany({
      where: { id: { in: result.lines.map((line) => line.id) } },
      select: { id: true, date: true, merchant: true },
      orderBy: { date: 'asc' },
    });
    const detailById = new Map(lineDetails.map((detail) => [detail.id, detail]));

    summary = {
      paidByMe: result.paidByMe.toFixed(2),
      paidByPartner: result.paidByPartner.toFixed(2),
      dueFromMe: result.dueFromMe.toFixed(2),
      dueFromPartner: result.dueFromPartner.toFixed(2),
      settlementReceived: result.settlementReceived.toFixed(2),
      settlementSent: result.settlementSent.toFixed(2),
      balance: result.balance.toFixed(0),
      exactBalance: result.exactBalance.toFixed(2),
      direction: describeBalance(result.balance),
      sharedCount: result.lines.length,
    };
    lines = result.lines.map((line) => {
      const detail = detailById.get(line.id);

      return {
        id: line.id,
        date: detail?.date.toISOString().slice(0, 10) ?? '',
        merchant: detail?.merchant ?? '—',
        total: line.total.toFixed(2),
        paidBy: line.paidBy,
        myShare: line.myShare.toFixed(2),
        partnerShare: line.partnerShare.toFixed(2),
        currency: 'CZK',
        kind: 'EXPENSE' as const,
      };
    });
    lockedCount = result.transactionIds.length;
  }

  return (
    <PageShell>
      <PageHeader
        title="Vyrovnání"
        description="Sdílené výdaje za měsíc, jejich rozdělení a bezpečně uzamčená historie dohodnutých částek."
      />
      <SettlementView
        period={period}
        months={months.map((row) => row.month)}
        isClosed={closed !== null}
        closedId={closed?.id ?? null}
        settledAt={closed?.settledAt?.toISOString() ?? null}
        closedNotes={closed?.notes ?? null}
        summary={summary}
        lines={lines}
        lockedCount={lockedCount}
        unconvertedCount={unconvertedCount}
        history={history.map((settlement) => ({
          id: settlement.id,
          period: settlement.periodFrom.toISOString().slice(0, 7),
          balance: settlement.balance.toFixed(0),
          settledAt: settlement.settledAt?.toISOString().slice(0, 10) ?? null,
        }))}
      />
    </PageShell>
  );
}
