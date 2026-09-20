import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { loadNetWorth } from './net-worth-service';
import { getMonthlyAccrualCost, getSinkingFundRequirement, getUpcomingRenewals, isAccruing, perPeriodAmount, type InsurancePolicyInput } from './insurance';

export interface PolicyProgress {
  policyId: string;
  /** Time-projected accrual target for this policy alone (ignores real money). */
  accrualTarget: string;
  /** Amount due at the next payment. */
  dueAmount: string;
  /** This policy's share of the real savings surplus, allocated proportionally to `accrualTarget`. */
  backedAmount: string;
  /** `backedAmount / dueAmount`, 0–100, for a progress bar. */
  backedPercent: number;
}

export interface InsuranceOverview {
  monthlyAccrualCost: string;
  /** Sum of `annualCost` across accruing policies — "how much this costs per year in total." */
  annualCostTotal: string;
  sinkingFundRequirement: string;
  upcomingRenewals: { policyId: string; vehicleName: string; licensePlate: string; nextDueDate: string }[];
  /** Real savings-account balance minus the emergency-reserve requirement. */
  savingsSurplus: string;
  /** Whether `savingsSurplus` covers `sinkingFundRequirement`. */
  sinkingFundCovered: boolean;
  /** `sinkingFundRequirement - savingsSurplus`, floored at 0. */
  sinkingFundShortfall: string;
  /** `savingsSurplus / sinkingFundRequirement`, 0–100, for a progress bar. */
  coveragePercent: number;
  /** Per-policy breakdown of how much of each one's accrual target the real surplus actually backs. */
  policyProgress: PolicyProgress[];
}

/**
 * Database-facing wrapper around the pure aggregation in `insurance.ts`.
 * Everything that touches Prisma lives here so the arithmetic stays testable.
 */
export async function loadInsuranceOverview(now: Date = new Date(), daysThreshold = 30): Promise<InsuranceOverview> {
  const rows = await prisma.insurancePolicy.findMany({
    select: {
      id: true,
      annualCost: true,
      paymentFrequency: true,
      startDate: true,
      status: true,
      vehicleName: true,
      licensePlate: true,
    },
  });

  const policies: InsurancePolicyInput[] = rows.map((row) => ({
    id: row.id,
    annualCost: row.annualCost,
    paymentFrequency: row.paymentFrequency,
    startDate: row.startDate,
    status: row.status,
  }));

  const renewals = getUpcomingRenewals(policies, now, daysThreshold);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const sinkingFundRequirement = getSinkingFundRequirement(policies, now);
  const savingsSurplus = await loadSavingsSurplus(now);
  const sinkingFundShortfall = Prisma.Decimal.max(0, sinkingFundRequirement.minus(savingsSurplus));

  // The real surplus is one pot of money, not earmarked per policy. Allocate
  // it across policies proportionally to each one's own accrual target, so
  // the per-policy bars sum back to exactly `min(savingsSurplus, sinkingFundRequirement)`.
  const coverageRatio = sinkingFundRequirement.isZero()
    ? new Prisma.Decimal(1)
    : Prisma.Decimal.min(1, savingsSurplus.dividedBy(sinkingFundRequirement));

  const policyProgress: PolicyProgress[] = policies.map((policy) => {
    const accrualTarget = getSinkingFundRequirement([policy], now);
    const dueAmount = perPeriodAmount(policy.annualCost, policy.paymentFrequency);
    const backedAmount = accrualTarget.times(coverageRatio);
    const backedPercent = dueAmount.isZero() ? 0 : Math.min(100, backedAmount.dividedBy(dueAmount).times(100).toNumber());

    return {
      policyId: policy.id,
      accrualTarget: accrualTarget.toFixed(2),
      dueAmount: dueAmount.toFixed(2),
      backedAmount: backedAmount.toFixed(2),
      backedPercent,
    };
  });

  const annualCostTotal = policies.filter(isAccruing).reduce((sum, policy) => sum.plus(policy.annualCost), new Prisma.Decimal(0));

  return {
    monthlyAccrualCost: getMonthlyAccrualCost(policies).toFixed(2),
    annualCostTotal: annualCostTotal.toFixed(2),
    sinkingFundRequirement: sinkingFundRequirement.toFixed(2),
    upcomingRenewals: renewals.map(({ policy, nextDueDate }) => {
      const row = rowsById.get(policy.id);
      return {
        policyId: policy.id,
        vehicleName: row?.vehicleName ?? '',
        licensePlate: row?.licensePlate ?? '',
        nextDueDate: nextDueDate.toISOString().slice(0, 10),
      };
    }),
    savingsSurplus: savingsSurplus.toFixed(2),
    sinkingFundCovered: savingsSurplus.greaterThanOrEqualTo(sinkingFundRequirement),
    sinkingFundShortfall: sinkingFundShortfall.toFixed(2),
    coveragePercent: coverageRatio.times(100).toNumber(),
    policyProgress,
  };
}

/**
 * Real money available beyond the emergency reserve, summed across every
 * active SAVINGS account: actual balance (via `loadNetWorth`, the same
 * checkpoint+transactions figure `/net-worth` shows) minus that account's
 * reserve requirement (`emergencyReserveMonths` × total active monthly fixed
 * costs — the same baseline `/net-worth`'s account cards use for "Železná
 * rezerva"). An account with no reserve configured contributes its full
 * balance as surplus, matching the account card's own "Nastavte měsíce"
 * treatment of an unset target.
 */
async function loadSavingsSurplus(now: Date): Promise<Prisma.Decimal> {
  const [savingsAccounts, recurringExpenses, netWorth] = await Promise.all([
    prisma.account.findMany({
      where: { type: 'SAVINGS', isArchived: false },
      select: { id: true, emergencyReserveMonths: true },
    }),
    prisma.recurringExpense.findMany({ where: { isActive: true, currency: 'CZK' }, select: { expectedAmount: true } }),
    loadNetWorth(now),
  ]);

  const fixedBaseline = recurringExpenses.reduce((total, expense) => total.plus(expense.expectedAmount), new Prisma.Decimal(0));
  const balanceByAccount = new Map(netWorth.accounts.map((account) => [account.accountId, account.balance]));

  return savingsAccounts.reduce((sum, account) => {
    const balance = balanceByAccount.get(account.id) ?? new Prisma.Decimal(0);
    const reserveRequirement = account.emergencyReserveMonths ? fixedBaseline.times(account.emergencyReserveMonths) : new Prisma.Decimal(0);

    return sum.plus(balance.minus(reserveRequirement));
  }, new Prisma.Decimal(0));
}
