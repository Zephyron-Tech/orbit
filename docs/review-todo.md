# Review TODO

All items done — see commit history. Kept for record.

## Bugs (logic/calc)

- [x] `lib/providers/trading212/sync.ts:122-124` — cash sum uses JS float (`+`) before `Decimal` conversion. Fix: convert each field to `Decimal` first, then `.plus()`.
- [x] `app/(dashboard)/settings/accounts/actions.ts:380` — `credit.amountCzk!.abs()`, non-null assertion on DB value. Fix: type-narrowing filter instead of `!`.
- [x] `lib/finance/idempotency.ts` `toMinorUnits` — truncates past 2 decimals instead of rounding/rejecting (schema allows 4). Now throws if precision would actually be lost.
- [x] Redeclared `TransactionKind` union (should import from `@/lib/generated/prisma/enums`) in:
  - `lib/finance/settlement.ts`
  - `lib/finance/burn-rate.ts`
  - `lib/finance/net-worth.ts`
  - `components/transactions/transaction-table.tsx`
- [x] CLAUDE.md doc drift: describes `INTERNAL_TRANSFER` set at import; code actually uses `PENDING_TRANSFER` → promoted after match confirmation. Doc updated to match code.

## UI/UX

- [x] Portfolio charts (`components/charts/portfolio-history-chart.tsx:199`) — Y-axis tick formatter (`Intl.NumberFormat compact, maximumFractionDigits:1`) collapses to identical labels on narrow value ranges. Fixed with adaptive-precision formatter.
- [x] Sidebar icon for "Plánování" uses Phosphor `Prohibit` (no-entry glyph) — wrong meaning. Swapped to `Target`.
- [x] `/net-worth` — "Kreditní karta" row renders like an asset (same black text), should visually read as a liability (red/minus). Now red with minus sign.
- [x] Dashboard "Akční centrum" — empty-state items ("Bez aktuálního problému") still show clickable arrow → dead-end click. Now rendered as non-interactive rows.
