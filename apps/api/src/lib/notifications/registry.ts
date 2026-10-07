import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { checkCashBufferLow } from './checks/cash-buffer';
import { checkStatementCoverageGap } from './checks/coverage-gap';
import { checkCreditUtilizationHigh } from './checks/credit-utilization';
import { checkDcaOverdue } from './checks/dca-overdue';
import { checkFailedImportRow } from './checks/failed-import';
import { checkFuelReceiptMissing } from './checks/fuel-receipt-missing';
import { checkInsuranceRenewal } from './checks/insurance-renewal';
import { checkPortfolioDigest } from './checks/portfolio-digest';
import { checkPortfolioMove } from './checks/portfolio-move';
import { checkRecurringExpenseOverdue } from './checks/recurring-expense-overdue';
import { checkSavingsGoalReached } from './checks/savings-goal-reached';
import { checkSavingsGrowth, checkSavingsStagnant } from './checks/savings-growth';
import { checkSettlementNotClosed } from './checks/settlement-not-closed';
import { checkUncategorizedPileup } from './checks/uncategorized-pileup';
import { checkUnmatchedTransferStuck } from './checks/unmatched-transfer';

/**
 * Every polled notification check, run in order by `POST /cron/notifications`.
 * `DIVIDEND_RECEIVED` is deliberately absent — it's wired directly into
 * `/cron/sync-trading212`'s handler instead, since only that call site knows
 * which income transactions are genuinely new this run. Adding a 15th
 * trigger later is one new file in checks/ plus one entry here.
 */
export const NOTIFICATION_REGISTRY: { type: NotificationType; run: (now: Date) => Promise<number> }[] = [
  { type: NotificationType.INSURANCE_RENEWAL, run: checkInsuranceRenewal },
  { type: NotificationType.PORTFOLIO_DIGEST, run: checkPortfolioDigest },
  { type: NotificationType.DCA_OVERDUE, run: checkDcaOverdue },
  { type: NotificationType.RECURRING_EXPENSE_OVERDUE, run: checkRecurringExpenseOverdue },
  { type: NotificationType.UNMATCHED_TRANSFER_STUCK, run: checkUnmatchedTransferStuck },
  { type: NotificationType.STATEMENT_COVERAGE_GAP, run: () => checkStatementCoverageGap() },
  { type: NotificationType.FAILED_IMPORT_ROW, run: () => checkFailedImportRow() },
  { type: NotificationType.SETTLEMENT_NOT_CLOSED, run: checkSettlementNotClosed },
  { type: NotificationType.UNCATEGORIZED_PILEUP, run: checkUncategorizedPileup },
  { type: NotificationType.BIG_PORTFOLIO_MOVE, run: checkPortfolioMove },
  { type: NotificationType.CASH_BUFFER_LOW, run: checkCashBufferLow },
  { type: NotificationType.CREDIT_UTILIZATION_HIGH, run: checkCreditUtilizationHigh },
  { type: NotificationType.FUEL_RECEIPT_MISSING, run: checkFuelReceiptMissing },
  { type: NotificationType.SAVINGS_GROWTH, run: checkSavingsGrowth },
  { type: NotificationType.SAVINGS_STAGNANT, run: checkSavingsStagnant },
  { type: NotificationType.SAVINGS_GOAL_REACHED, run: checkSavingsGoalReached },
];
