import { prisma } from '@orbit-api/lib/db/prisma';

/**
 * The user's own "Počáteční měsíc reportování" (Settings), reused here so a
 * check that scans unbounded history (no natural month window, unlike
 * dca-overdue/recurring-expense-overdue which are already scoped to the
 * current month) never resurfaces pre-reporting-window data as "new."
 *
 * Without this, the first cron run against real data fired one notification
 * per historical row ever — e.g. every unmatched fuel receipt back to 2024 —
 * because those checks' dedupe key is "once ever per row," and every old row
 * looked new the first time the check ran. Null when no start month is
 * configured, in which case the caller applies no floor (matches how the
 * dashboard route treats an unset reportingStartMonth today).
 */
export async function getReportingFloor(): Promise<Date | null> {
  const settings = await prisma.planningSettings.findUnique({ where: { id: 'household' }, select: { reportingStartMonth: true } });
  return settings?.reportingStartMonth ?? null;
}
