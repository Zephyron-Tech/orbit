import { Prisma } from '@orbit-api/lib/generated/prisma/client';

/**
 * Credit-card utilization math, extracted from apps/api/src/routes/dashboard.ts
 * (which aggregates across every CZK credit account for one summary figure)
 * so the `credit-utilization-high` notification check can reuse the same
 * math per account instead of only the household-wide aggregate. Pure.
 */

const ZERO = new Prisma.Decimal(0);

export interface CreditAccountInput {
  accountId: string;
  name: string;
  creditLimit: Prisma.Decimal;
  /** Current balance — negative means money owed. */
  balance: Prisma.Decimal;
}

export interface CreditUtilization {
  accountId: string;
  name: string;
  used: Prisma.Decimal;
  limit: Prisma.Decimal;
  utilization: Prisma.Decimal;
}

export function perAccountUtilization(accounts: readonly CreditAccountInput[]): CreditUtilization[] {
  return accounts
    .filter((account) => account.creditLimit.isPositive())
    .map((account) => {
      const used = account.balance.isNegative() ? account.balance.abs() : ZERO;
      return { accountId: account.accountId, name: account.name, used, limit: account.creditLimit, utilization: used.dividedBy(account.creditLimit).times(100) };
    });
}
