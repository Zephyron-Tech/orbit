import { FileTextIcon as FileText, UserIcon as User } from '@phosphor-icons/react/dist/ssr';

import { InsuranceManager } from '@/components/insurance/insurance-manager';
import { MoneyValue } from '@/components/ui/money-value';
import { PageHeader, PageShell, SectionHeader } from '@/components/ui/page-container';
import { Badge } from '@/components/ui/status';
import { prisma } from '@/lib/db/prisma';
import { formatLicensePlate } from '@/lib/finance/license-plate';
import { nextOccurrenceOnOrAfter } from '@/lib/finance/insurance';
import { loadInsuranceOverview } from '@/lib/finance/insurance-service';
import type { PaymentFrequency, PolicyStatus } from '@/lib/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const CZK = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });

const FREQUENCY_LABEL: Record<PaymentFrequency, string> = {
  ANNUAL: 'Ročně',
  SEMI_ANNUAL: 'Pololetně',
  MONTHLY: 'Měsíčně',
};

const STATUS_LABEL: Record<PolicyStatus, string> = {
  ACTIVE: 'Aktivní',
  PAID: 'Zaplaceno',
  PENDING_RENEWAL: 'Blíží se obnova',
  TERMINATED: 'Ukončeno',
};

const STATUS_TONE: Record<PolicyStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  PAID: 'neutral',
  PENDING_RENEWAL: 'warning',
  TERMINATED: 'neutral',
};

const RENEWAL_THRESHOLD_DAYS = 45;

export default async function InsurancePage(): Promise<React.JSX.Element> {
  const now = new Date();
  const [policies, overview] = await Promise.all([
    prisma.insurancePolicy.findMany({
      orderBy: [{ sortOrder: 'asc' }, { annualCost: 'desc' }],
      include: {
        documents: {
          orderBy: { uploadedAt: 'desc' },
          select: { id: true, kind: true, filename: true, uploadedAt: true },
        },
      },
    }),
    loadInsuranceOverview(now, RENEWAL_THRESHOLD_DAYS),
  ]);
  const latestDocuments = new Map(
    policies.map((policy) => {
      const toInfo = (document: { id: string; filename: string; uploadedAt: Date } | undefined) =>
        document ? { id: document.id, filename: document.filename, uploadedAt: document.uploadedAt.toISOString() } : null;
      const contract = toInfo(policy.documents.find((document) => document.kind === 'CONTRACT'));
      const greenCard = toInfo(policy.documents.find((document) => document.kind === 'GREEN_CARD'));

      return [policy.id, { contract, greenCard }];
    }),
  );
  const progressByPolicy = new Map(overview.policyProgress.map((progress) => [progress.policyId, progress]));

  return (
    <PageShell>
      <PageHeader
        title="Pojistky vozidel"
        description="Přehled pojistných smluv, měsíčního nákladu a nadcházejících obnov."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="surface p-5">
          <p className="text-sm font-medium text-ink-muted">Měsíční náklad</p>
          <p className="money-value mt-3 text-2xl font-semibold tracking-[-0.04em]"><MoneyValue>{CZK.format(Number(overview.monthlyAccrualCost))}</MoneyValue></p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">Součet ročního pojistného / 12, jen aktivní smlouvy.</p>
        </div>
        <div className="surface p-5">
          <p className="text-sm font-medium text-ink-muted">Cíl k dnešku</p>
          <p className="money-value mt-3 text-2xl font-semibold tracking-[-0.04em]"><MoneyValue>{CZK.format(Number(overview.sinkingFundRequirement))}</MoneyValue></p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            Časová projekce, ne skutečný zůstatek — kolik dní od posledního výročí uplynulo, tomu odpovídající podíl příští platby. Rozpis u smluv níže.
          </p>
        </div>
        <div className="surface p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-ink-muted">Kryto přebytkem na spořáku?</p>
            <Badge tone={overview.sinkingFundCovered ? 'success' : 'warning'}>{overview.sinkingFundCovered ? 'Ano' : 'Chybí'}</Badge>
          </div>
          <p className="money-value mt-3 text-2xl font-semibold tracking-[-0.04em]">
            <MoneyValue>{overview.sinkingFundCovered ? CZK.format(Number(overview.savingsSurplus)) : CZK.format(Number(overview.sinkingFundShortfall))}</MoneyValue>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            {overview.sinkingFundCovered ? (
              <>Přebytek na spořicím účtu nad rámec železné rezervy (celkem <MoneyValue>{CZK.format(Number(overview.savingsSurplus))}</MoneyValue>).</>
            ) : (
              <>Přebytek nad železnou rezervou je jen <MoneyValue>{CZK.format(Number(overview.savingsSurplus))}</MoneyValue> — o tolik méně, než je cíl k dnešku.</>
            )}
          </p>
        </div>
        <div className="surface p-5">
          <p className="text-sm font-medium text-ink-muted">Blíží se obnova</p>
          <p className="money-value mt-3 text-2xl font-semibold tracking-[-0.04em]">{overview.upcomingRenewals.length}</p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">V následujících {RENEWAL_THRESHOLD_DAYS} dnech.</p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Smlouvy" description={`${policies.length} evidovaných smluv.`} />
        <div className="grid gap-3">
          {policies.map((policy) => {
            const nextDue = nextOccurrenceOnOrAfter(policy.startDate, policy.paymentFrequency, now);
            const progress = progressByPolicy.get(policy.id);
            const dueAmount = progress ? Number(progress.dueAmount) : 0;
            const backedAmount = progress ? Number(progress.backedAmount) : 0;
            const backedPercent = progress?.backedPercent ?? 0;

            return (
              <div key={policy.id} className="surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{policy.vehicleName}</span>
                      <Badge tone={STATUS_TONE[policy.status]}>{STATUS_LABEL[policy.status]}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className="rounded-md border border-line bg-surface-subtle px-2 py-0.5 font-mono text-xs font-semibold tracking-wider text-ink">
                        {formatLicensePlate(policy.licensePlate, policy.vehicleType)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                        <FileText size={13} className="text-ink-faint" aria-hidden="true" />
                        {policy.policyNumber}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                        <User size={13} className="text-ink-faint" aria-hidden="true" />
                        {policy.policyHolder}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="money-value text-xl font-semibold"><MoneyValue>{CZK.format(Number(policy.annualCost))}</MoneyValue></p>
                    <p className="text-xs text-ink-muted">{FREQUENCY_LABEL[policy.paymentFrequency]}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-muted">
                      Kryto přebytkem na příští platbu (<MoneyValue>{CZK.format(dueAmount)}</MoneyValue> do {nextDue.toLocaleDateString('cs-CZ', { timeZone: 'UTC' })})
                    </span>
                    <span className="font-semibold text-ink">
                      <MoneyValue>{CZK.format(backedAmount)}</MoneyValue> <span className="font-normal text-ink-muted">({backedPercent.toFixed(0)} %)</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <span
                      className={`block h-full rounded-full ${backedPercent >= 100 ? 'bg-positive' : 'bg-warning'}`}
                      style={{ width: `${backedPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <InsuranceManager
        policies={policies.map((policy, index) => ({
          id: policy.id,
          vehicleName: policy.vehicleName,
          licensePlate: policy.licensePlate,
          policyNumber: policy.policyNumber,
          policyHolder: policy.policyHolder,
          vehicleType: policy.vehicleType,
          annualCost: policy.annualCost.toFixed(2),
          paymentFrequency: policy.paymentFrequency,
          startDate: policy.startDate.toISOString().slice(0, 10),
          status: policy.status,
          isFirst: index === 0,
          isLast: index === policies.length - 1,
          documents: latestDocuments.get(policy.id) ?? { contract: null, greenCard: null },
        }))}
      />
    </PageShell>
  );
}
