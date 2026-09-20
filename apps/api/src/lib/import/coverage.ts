/**
 * Which days of a statement history have actually been imported.
 *
 * Pure by design: it must be unit-testable without a database, and a gap is the
 * failure mode that silently breaks an account balance, so its detection cannot
 * depend on anything that might not be running.
 */

export interface CoverageGap {
  from: string;
  to: string;
}

/**
 * Days between statements that no statement covers.
 *
 * Only **declared** coverage counts. Transaction dates are not coverage: an
 * account with no movements for a fortnight would look exactly like a fortnight
 * that was never imported, and reporting that as a gap cries wolf. A movement
 * export declares nothing, so it never takes part.
 */
export function findCoverageGaps(
  batches: readonly { coverageFrom: Date | null; coverageTo: Date | null }[],
): CoverageGap[] {
  const periods = batches
    .filter((batch): batch is { coverageFrom: Date; coverageTo: Date } =>
      batch.coverageFrom !== null && batch.coverageTo !== null,
    )
    .map((batch) => ({ from: batch.coverageFrom, to: batch.coverageTo }))
    .sort((a, b) => a.from.getTime() - b.from.getTime());

  const gaps: CoverageGap[] = [];
  let coveredTo: Date | null = null;

  for (const period of periods) {
    if (coveredTo) {
      const nextDay = new Date(coveredTo);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      if (period.from.getTime() > nextDay.getTime()) {
        const gapEnd = new Date(period.from);
        gapEnd.setUTCDate(gapEnd.getUTCDate() - 1);

        gaps.push({ from: toDay(nextDay), to: toDay(gapEnd) });
      }
    }

    if (!coveredTo || period.to.getTime() > coveredTo.getTime()) {
      coveredTo = period.to;
    }
  }

  return gaps;
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Missing monthly statements, from their sequence numbers.
 *
 * Statements chain: each names the previous one's closing date, and their
 * numbers run consecutively within a year. A hole in that chain is proof a
 * statement was never imported — more precise than inferring it from covered
 * days, which cannot tell a gap from a month with no transactions.
 */
export function findMissingStatements(numbers: readonly string[]): string[] {
  const parsed = numbers
    .map((number) => ({ raw: number, value: Number(number) }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => a.value - b.value);

  const missing: string[] = [];

  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];

    if (!previous || !current) {
      continue;
    }

    for (let value = previous.value + 1; value < current.value; value += 1) {
      // Keep the source width, so "2026000006" does not come back as "2026006".
      missing.push(String(value).padStart(previous.raw.length, '0'));
    }
  }

  return missing;
}
