import { Prisma } from '@/lib/generated/prisma/client';

/**
 * Pairs up the two legs of a transfer between our own accounts. Pure:
 * candidates in, a verdict out. No Prisma, no id generation.
 *
 * `kind: INTERNAL_TRANSFER` alone (set at import time by matching the
 * counterparty account number, see `lib/import/internal-transfers.ts`) is only
 * a one-sided guess — it never confirms the other leg exists or that the
 * amounts actually cancel. A false positive there would silently vanish from
 * settlement as "just a transfer". Matching is the proof.
 *
 * Only an **exact** amount match within a short date window counts. When more
 * than one candidate on the other side has the same amount in the window, none
 * of that group is matched — guessing wrong is worse than asking a human,
 * the same rule the CSV parser and the balance checkpoint already follow.
 */

export interface TransferCandidate {
  id: string;
  accountId: string;
  date: Date;
  amountCzk: Prisma.Decimal;
}

export interface MatchResult {
  /** [outgoingId, incomingId] pairs, ready to be written as a Transfer. */
  pairs: [string, string][];
  /** Candidate ids that could not be safely matched, one way or the other. */
  ambiguous: string[];
}

const DEFAULT_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function matchTransfers(
  candidates: readonly TransferCandidate[],
  windowDays = DEFAULT_WINDOW_DAYS,
): MatchResult {
  const pairs: [string, string][] = [];
  const ambiguousSet = new Set<string>();
  const consumed = new Set<string>();

  // Deterministic order: date, then id. Nothing here should depend on the
  // order candidates were passed in.
  const sorted = [...candidates].sort((a, b) => {
    const byDate = a.date.getTime() - b.date.getTime();

    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });

  for (const outgoing of sorted) {
    if (consumed.has(outgoing.id) || ambiguousSet.has(outgoing.id)) {
      continue;
    }

    if (!outgoing.amountCzk.isNegative()) {
      continue;
    }

    const target = outgoing.amountCzk.negated();
    const windowMs = windowDays * DAY_MS;

    const matches = sorted.filter(
      (candidate) =>
        candidate.id !== outgoing.id &&
        !consumed.has(candidate.id) &&
        candidate.accountId !== outgoing.accountId &&
        candidate.amountCzk.equals(target) &&
        Math.abs(candidate.date.getTime() - outgoing.date.getTime()) <= windowMs,
    );

    if (matches.length === 0) {
      continue;
    }

    if (matches.length > 1) {
      ambiguousSet.add(outgoing.id);
      for (const match of matches) {
        ambiguousSet.add(match.id);
      }
      continue;
    }

    const incoming = matches[0];

    if (!incoming) {
      continue;
    }

    // The other side might itself have more than one candidate pointing back
    // at it (e.g. two -X legs both within the window of one +X leg). Check
    // symmetrically before committing — from incoming's perspective, a
    // matching leg is negative, not positive like `target`.
    const reverseTarget = incoming.amountCzk.negated();
    const reverseMatches = sorted.filter(
      (candidate) =>
        candidate.id !== incoming.id &&
        !consumed.has(candidate.id) &&
        candidate.accountId !== incoming.accountId &&
        candidate.amountCzk.equals(reverseTarget) &&
        Math.abs(candidate.date.getTime() - incoming.date.getTime()) <= windowMs,
    );

    if (reverseMatches.length > 1) {
      ambiguousSet.add(outgoing.id);
      ambiguousSet.add(incoming.id);
      for (const match of reverseMatches) {
        ambiguousSet.add(match.id);
      }
      continue;
    }

    pairs.push([outgoing.id, incoming.id]);
    consumed.add(outgoing.id);
    consumed.add(incoming.id);
  }

  return {
    pairs,
    ambiguous: [...ambiguousSet].filter((id) => !consumed.has(id)),
  };
}
