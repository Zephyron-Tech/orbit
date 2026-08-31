# Orbit — Personal & Couple Finance Hub

Automated personal finance tracking: net worth, free cash-flow, sinking funds (envelope buckets),
and fair monthly settlement of shared costs with a partner.

Data never comes from PSD2 / Open Banking. Two ingestion paths only:

1. **CSV statement imports** (Moneta Money Bank, Revolut) uploaded through the UI and deduplicated on the bank's own transaction reference.
2. **Trading 212 public REST API** for portfolio positions and cash — pulled as periodic snapshots.

Inbound e-mail parsing was evaluated and dropped: Moneta caps notification e-mails,
so micro-payments would be lost. CSV exports are complete by construction.

---

## 1. Hard rules

### Language
- **All code comments, identifiers, interface/type definitions, commit messages, and technical documentation MUST be in English.** No exceptions.
- Only user-facing UI copy may be Czech.

### TypeScript
- `strict: true`. **`any` is banned** — use `unknown` + a Zod schema to narrow.
- No `as` casts to force compilation. Casting is allowed only for branded types and `satisfies`-style narrowing.
- No non-null assertions (`!`) on values coming from the DB, `process.env`, or parsed e-mails.
- Every external input (webhook body, T212 response, env vars, form data) passes through a Zod schema **before** it is used.

### KISS
- No overengineering. No abstraction layer that has exactly one implementation, unless a second one is already scheduled.
- No event bus, no CQRS, no DDD ceremony, no generic "plugin system". Parsers are plain functions in a registry map.
- Prefer a server component reading Prisma directly over an internal HTTP hop.

---

## 2. Data integrity

### Idempotency (non-negotiable)
Every `Transaction` carries a unique `idempotencyKey`.

Two strategies, in this order:

1. **`EXTERNAL_ID` (required whenever the source has one).** SHA-256 of `provider` + `accountId` + the source's own reference. Moneta's `Bankovní reference` is unique per transaction.
2. **`ATTRIBUTES` (fallback only).** SHA-256 of `provider` + `accountId` + `date` (day precision) + amount (minor units, signed) + currency + normalized merchant.

**The attribute fallback is not safe on statement imports.** A single real July
export contained three pairs of genuinely distinct transactions that the
attribute hash collapses into one — two 50 CZK payments at the same club on the
same day. 7 % of the file would have been silently discarded. A parser that
cannot produce a reference must fail the row, not guess.

- `accountId` **must** be in the hash: without it, the same purchase booked on two accounts collides and the second one is silently swallowed.
- Normalization is deterministic: trim, collapse whitespace, uppercase, strip diacritics.
- Bulk imports insert with `prisma.transaction.createMany({ skipDuplicates: true })`. The unique index on `idempotencyKey` provides the guarantee; one statement is one query instead of a thousand upserts. Single-row writers still use `upsert` — **never** a bare `create`.
- Re-importing the same statement MUST result in zero new rows.
- The key builder lives in `lib/finance/idempotency.ts` and is unit-tested. Changing it is a breaking change and requires a backfill migration.

### Money
- Money is `Decimal` in Prisma (`@db.Decimal(18, 4)`) and `Prisma.Decimal` / minor-unit `bigint` in TypeScript.
- **`Float` / JS `number` is banned for amounts.** IEEE-754 cannot represent 0.1; summing a year of transactions drifts, and the couple settlement then disagrees with the bank by a few haléřů forever.
- Sign convention: expense negative, income positive. Direction is derived from the sign, never a second source of truth.
- Reporting currency is **CZK**. Every monetary row stores its own `currency` (ISO 4217); Revolut and T212 rows can be EUR/USD and carry `amountCzk` + `fxRate`. No implicit 1:1 conversion.

### Resilience
- Every imported transaction stores its source row in `rawData: Json`, so an export format change can be debugged without re-downloading the statement.
- A row that fails to parse MUST persist an `IngestionEvent` with status `FAILED`, the raw row and the line number — never drop data on the floor. It never aborts the rest of the import.
- Successful and skipped rows are counted on `ImportBatch`, not logged individually: a per-row audit of a full statement buries the rows that actually need attention.
- `ImportBatch.fileHash` (SHA-256 of the uploaded bytes) short-circuits a byte-identical re-upload before parsing.
- Every import is a dry run first. The user sees inserted / duplicate / failed counts and a preview before anything is written.

### Transaction kinds
Not every row is income or spending. `Transaction.kind` keeps the books honest:

- `NORMAL` — real income or cost. The only kind that counts towards cash-flow.
- `PENDING_TRANSFER` — a one-sided guess, set at import time, that this row is money moved between two of our own accounts (counterparty account matches another `Account.externalId`, see `lib/import/internal-transfers.ts`; account numbers are normalized first, because a statement prints its own account as `204370628/0600` but the same account as a counterparty as `204370628`). Excluded from settlement/burn-rate the same as `INTERNAL_TRANSFER`, because an unconfirmed guess must never count as real income or spend either.
- `INTERNAL_TRANSFER` — a `PENDING_TRANSFER` promoted once transfer matching (see below) has proven both legs exist and cancel out. It appears twice (outgoing on one statement, incoming on the other) and would otherwise inflate both income and spending.
- `SETTLEMENT` — payment of a couple balance. It repays a debt rather than creating one, so it is excluded from income and reduces the balance instead of counting as a shared cost.
- `SPLIT_PARENT` — a transaction that has been broken into child rows (`lib/finance/split.ts`, `app/(dashboard)/transactions/split-actions.ts`). The children carry the money and the categorisation now; the parent is excluded from every aggregate (settlement, net worth) that reads `kind`, or the amount would be counted twice. The ledger query filters split parents out entirely (`kind: { not: 'SPLIT_PARENT' }`) — they are a bookkeeping placeholder, not a row a person edits.

Only `NORMAL` transactions can be shared; changing the kind clears `isShared` and `myShareRatio`.

### Splitting a transaction
- One purchase, several purposes (e.g. groceries partly shared, partly personal): `splitTransaction` turns the parent into `SPLIT_PARENT` and creates child rows, one per part, each with its own category/share/notes.
- The parts must sum to **exactly** the parent amount — `lib/finance/split.ts` blocks anything else, and the UI shows a live "Zbývá rozdělit" remainder that gates the submit button. No silent rounding remainder.
- Every part keeps the parent's sign: a -1000 expense cannot be split into a -1400 and a +400, because that would invent income.
- Child `idempotencyKey`/`externalId` are derived from the already-unique parent (`${parent.idempotencyKey}#split#${index}`), so they can never collide with an imported row.
- `mergeSplit` reverses it: children are deleted, the parent returns to `NORMAL`. Both directions refuse when any row involved already has a `settlementId` — undoing or redoing a split after settlement would silently change a figure both people already agreed on.

### Transfer matching
`kind: PENDING_TRANSFER` (set at import time, see above) is only a one-sided
guess from the counterparty account number — it never confirms the other leg
exists or that the amounts cancel. A false positive there would silently
vanish from settlement as "just a transfer" with nothing to catch it. Matching
is the proof, and only a matched pair is promoted to `INTERNAL_TRANSFER`:

- `Transaction.transferId` links exactly two legs through a `Transfer` row. The pure matcher (`lib/finance/transfer-matching.ts`) requires an **exact** `amountCzk` match (opposite sign, no FX tolerance — every account is CZK today), different accounts, and a date within a few days. This is deliberately stricter than "looks like a transfer": it is the check that the transfer actually happened as described.
- Ambiguous cases — more than one same-amount candidate on either side within the window — are **not** matched. Guessing wrong silently corrupts settlement; leaving it unmatched and visible does not. Same rule as the CSV parser refusing a row it cannot deduplicate safely.
- `matchPendingTransfers()` (`lib/import/transfer-sync.ts`) only ever looks at rows with `transferId: null` and `kind` in `PENDING_TRANSFER`/`INTERNAL_TRANSFER`, so calling it repeatedly — after every import, after a manual reclassification to `INTERNAL_TRANSFER` in the ledger, or from the "Spárovat převody" button — can only add pairs, never touch an existing one. A match flips both legs' `kind` from `PENDING_TRANSFER` to `INTERNAL_TRANSFER`.
- Reclassifying a transaction *away* from `INTERNAL_TRANSFER` clears its `transferId`: it is no longer part of that pair.
- Unmatched legs are named on `/net-worth`, the same way `findCoverageGaps` names a missing statement — a silent guess is worse than a visible question mark.

### Passive income (dividends & interest)
- Moneta never puts a bank category on savings-account interest — verified against a real export: merchant `KREDITNÍ ÚROKY`, empty `Název kategorie`. `lib/parsers/csv/moneta-categories.ts`'s `classifyByMerchant` catches it by text when `mapMonetaCategory` has nothing to map; the parser itself stays dumb, all classification lives in `moneta-categories.ts` + `process-csv.ts`'s `resolveTransactionCategory`.
- T212 dividends and interest come from two endpoints the price sync never called: `GET /history/dividends` and `GET /history/transactions` (only `INTEREST_ON_FREE_CASH` items are kept from the latter — the rest are cash movements into/out of the account itself, out of scope here). `lib/providers/trading212/income-sync.ts` writes them as **real `Transaction` rows**, tagged `Dividends`/`Interest`, deduplicated via the existing `buildIdempotencyKey({ externalId: item.reference, ... })` — the same mechanism a bank reference uses, because the API's own `reference` is just as unique.
- These rows do **not** change the T212 account's net-worth figure: `type: INVESTMENT` accounts are valued purely from `AccountSnapshot` (see below), and the account's `totalValue` already reflects reinvested cash. The point is visibility in the ledger and settlement, not a second valuation.
- **`nextPagePath` does not reliably match the documented shape.** A real `history/transactions` response returned the bare query string (`limit=50&cursor=...`) with no leading path or `?` — not the full-path shape the docs' quickstart example shows. `Trading212Client.resolveNextPath` reconstructs against the endpoint's own canonical path regardless of which shape (full path, absolute URL, bare query string) comes back. Verified against a live account: 259 transaction-history items paginated correctly across 6 pages.
- `history/dividends` and `history/transactions` allow 6 requests/minute — a different, stricter limit than `account/summary` (1/5s) and `positions` (1/1s). Pagination is paced at 10s between calls.
- Wired into the same hourly cron as the price sync (`/api/cron/sync-trading212`) and the manual "Obnovit" button, both best-effort: a dividend-history hiccup is reported but never fails the primary portfolio-value sync.

### Couple logic
- Every `Transaction` has `isShared: boolean` and `paidBy: ME | PARTNER`.
- `myShareRatio` is **my** share of the transaction, not the payer's: `0.5` = even split, `0.6` = I owe 60%, `1.0` = fully mine, `null` = not shared.
- Settlement over a period: for each shared transaction, my due share is `|amountCzk| * myShareRatio`. Sum what each side actually paid, subtract what they owed, and the difference is the balance. Closing a period stamps `settlementId` on the transactions so they can never be settled twice.
- Only **expenses** are split. Shared income is not a cost and is ignored by the settlement.
- `balance = paidByMe - dueFromMe - settlementReceived + settlementSent`. Positive means the partner owes me.
- Rounding happens **once**, on the final balance, to whole crowns — the closing payment is a bank transfer. Rounding per line drifts by halers. `exactBalance` keeps the unrounded figure for reconciliation.
- Closing a period stamps `settlementId` on every transaction it covers, inside the same database transaction, and the `updateMany` filters on `settlementId: null` so a concurrent close cannot claim a row twice. A settled transaction is read-only in the ledger.
- Settlement math lives **only** in `lib/finance/settlement.ts` — pure functions, no Prisma calls, fully unit-tested.
- The "my share of a ratio" arithmetic (`computeMyShare`, `assertValidRatio`, `DEFAULT_SHARE_RATIO`) lives in `lib/finance/share.ts`, shared verbatim between settlement and burn rate — one ratio calculation, not two that could drift apart. `settlement.ts` re-exports `ShareInputError` as `SettlementInputError` for backward compatibility.

### Recurring expenses & burn rate
- `RecurringExpense` is deliberately **not** `Bucket`: a bucket is a savings envelope accumulating toward a goal; a recurring expense is a tag on spending that already happened, used to answer "what does the household cost to run this month, independent of what we spent on top of that." Overloading `Bucket` with a second meaning would violate KISS more than a small second model does.
- Tagging is **manual only** in this phase — the same dropdown pattern as Category/Bucket on a transaction row (`Fixní výdaj` select). No auto-detection by merchant name; that risk (a wrong guess silently misclassifying spend) is the same one the CSV parser and transfer matcher already refuse to take.
- `Transaction.recurringExpenseId` links a transaction to its tag; a `RecurringExpense` can be deactivated (`isActive: false`) without deleting it, so its history stays but it stops appearing in new burn-rate calculations. Deleting is refused while any transaction still references it — archive instead, same guard as `deleteAccount`.
- `lib/finance/burn-rate.ts`'s `calculateBurnRate(transactions, recurringExpenses)` is pure: sums actual spend per active recurring expense for the given transactions, using `computeMyShare` for shared ones and the full amount for unshared ones. Excludes anything that isn't `NORMAL` income-bearing spend — `SPLIT_PARENT`, `INTERNAL_TRANSFER`, `SETTLEMENT`, and income — mirroring `settlement.ts`'s exclusions exactly, because a fixed cost is still just an expense.
- `missing` names every active recurring expense with **no** transaction tagged to it in the period — the same "name the gap, don't stay silent" philosophy as `findCoverageGaps` and the unmatched-transfer panel on `/net-worth`.
- `/dashboard` (the app's home route, replacing the empty placeholder) renders this: total burn rate, my share, an expected-vs-actual table per recurring expense, and the missing-this-month panel, for a picked month.

---

## 3. Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), Node.js runtime |
| Language | TypeScript 5, strict |
| DB / ORM | PostgreSQL 17 + Prisma 7 |
| Styling | Tailwind CSS 4 + Radix UI via shadcn/ui |
| Validation | Zod 4 (single source of truth for runtime shapes) |
| Charts | Recharts |
| Tests | Vitest |

### CSV import pipeline
- `lib/parsers/csv/*` is pure: text in, `CsvParseResult` out. No database, no clock, no network.
- Structural problems (renamed column, unreadable header) throw `CsvStructureError`; a single bad row becomes a `ParseFailure`.
- Encoding is detected: UTF-8 with BOM (current Moneta export) or Windows-1250. **The BOM must be stripped** or the first column name becomes `\uFEFFČíslo účtu` and the header no longer matches.
- Czech amounts (`-1 234,50`, including non-breaking spaces) are parsed as strings into `Decimal`. `parseFloat` is banned.
- Dates are `DD.MM.YYYY` with no time. They are stored as midnight **UTC** of that calendar day; a local-timezone parse shifts month boundaries into the wrong settlement period.
- Moneta writes a single space (not an empty string) into `Popis platby` on direct debits. `" "` is truthy, so cells are trimmed **before** any `a || b` fallback.
- The export names its own account; an import into a mismatched `Account.externalId` is refused.
- `Název kategorie` from the export is mapped to Orbit categories in `lib/parsers/csv/moneta-categories.ts`. An unmapped label imports uncategorized rather than being guessed at.

### Trading 212
- Read-only REST client in `lib/providers/trading212/`. Every response passes a Zod schema; fields the sync uses are required, everything else optional, so an added field cannot break a nightly job.
- **Authentication is HTTP Basic**: `TRADING212_API_KEY_ID` is the username, `TRADING212_API_SECRET` the password. The raw-token header is `legacyApiKeyHeader` in the spec and returns 401 on current keys — a wrong guess here costs an hour, so check `api.json` rather than remembering.
- The OpenAPI document lives in the repository root (`api.json`, `api.yaml`). **Read it before touching the client.** The endpoints are `GET /api/v0/equity/account/summary` and `GET /api/v0/equity/positions`; older paths such as `account/cash` and `portfolio` are not in the current spec.
- The API rate limits per endpoint; the client spaces calls and retries 429 using the server's `retry-after`. Never log the key or an error body: both can carry credentials.
- JSON numbers become strings via `toDecimalString` **before** they meet `Decimal`, so no value is ever a JS float in the database.
- A brokerage account's value cannot be derived from transactions — it moves with the market — so it is sampled into `AccountSnapshot`. Snapshots are truncated to the hour, which makes a re-run idempotent.
- Verify credentials with `npm run t212:check`; it writes nothing and never prints either value.

### Environment variables
`lib/validation/env.ts` exposes `getEnv()`, not a top-level constant. Validation is
**lazy on purpose**: `next build` imports every route module without a runtime
environment, so validating at import time fails the production build even though
the app would run fine. Call `getEnv()` inside the handler.

### Net worth
- `lib/finance/net-worth.ts` is pure; `net-worth-service.ts` holds everything that touches Prisma.
- Two kinds of account, knowable two different ways: **cash** is the newest checkpoint plus every transaction booked strictly after it; **investment** comes from the newest `AccountSnapshot`, because its value moves with the market and cannot be derived from transactions.
- A Moneta CSV export has **no running balance column** — verified against real exports from both a current and a savings account. A cash balance therefore cannot be derived, only anchored.

### Statements vs movement exports
Moneta offers two downloads and they are **not** interchangeable:

| | monthly statement (XML) | movement export (CSV) |
|---|---|---|
| balances | opening **and** closing | none |
| self-verification | turnovers + `trn-cnt` + balance chain | none |
| bank category | no | yes (`Název kategorie`) |
| role | the anchor | fills in mid-month |

- The statement is Moneta's own XML schema (a 2007 DTD), **not ISO 20022**. Parser: `lib/parsers/xml/moneta-statement.ts`.
- **Statement periods are not calendar months**: the current account closes at month end, the savings account around the 24th. Never assume a month boundary; read the period from the document.
- A statement **verifies itself**: parsed count against `trn-cnt`, summed amounts against `debit-tov`/`credit-tov`, and opening + movements against `stm-bal-end`. A statement that fails any of these is **not** used as a balance anchor — a wrong anchor is worse than none, because everything after it inherits the error silently.
- Statement sequence numbers chain (`@number`, `@date-previous`), so `findMissingStatements` detects a never-imported statement exactly, unlike day coverage which cannot tell a gap from a quiet month.

### Transaction references — the two formats must agree
```
CSV "Bankovní reference": 0204370628:20260701:00001:260701S00434438910
XML statement id:                                  260701S00434438910
```
Only the final segment is the bank's own identifier. `normalizeSourceReference`
(`lib/parsers/reference.ts`) reduces both to it, and **every parser must call
it** — otherwise importing the statement for a month already imported from CSV
creates a second copy of every transaction. Verified against a real July export
and statement: 84 of 84 agree on reference, amount and date.

Account numbers have the same problem (`204370628/0600` vs `204370628`); one
`normalizeAccountNumber` in `lib/import/internal-transfers.ts` serves both the
account check and internal-transfer detection. Do not write a second one.

### Which bank balance to reconcile against
Moneta shows two figures and they differ by pending card authorisations:

- **účetní zůstatek** (book balance) — everything posted. This is what Orbit computes, because statements and exports contain only posted transactions.
- **disponibilní zůstatek** (available balance) — the book balance less amounts blocked by card authorisations that have not settled yet.

Reconcile against the **book** balance. A blocked authorisation has no bank
reference yet, so it cannot appear in any export; matching the available balance
would mean inventing rows.

### Balance checkpoints
- `AccountSnapshot.source` is `PROVIDER` (Trading 212) or `MANUAL` (typed in from a banking app). One mechanism for both kinds of account; there is deliberately no second "opening balance" field, because two routes to the same number is how they drift apart.
- A checkpoint is stored at **the end of its calendar day** (`endOfDayUtc`), so that day's transactions are already inside the figure the bank showed. Balance counts transactions **strictly after** it.
- Every checkpoint is **reconciled**: `expectedBalance` records what the ledger predicted from the previous anchor plus the movements between. A zero difference is evidence that every statement has been imported and the parser reads it correctly; a mismatch names the exact unaccounted amount. This is the reason to ask for the number at all.
- A **statement supplies the balance itself**, so nothing is typed in.
- **A mid-month CSV import does not ask either.** Once an anchor exists, the balance is anchor + movements since, which the ledger already knows. Asking for a number it can derive would let a typo override a fact. `deriveBalance` computes and displays it instead.
- The manual field appears in exactly one case: a movement export landing on an account with **no anchor at all** (`needsAnchor`). Even then the better answer is to import a statement, and the UI says so.
- A checkpoint is recorded **after** the rows are inserted, so it reconciles against a ledger that already contains them.
- Re-entering a balance for the same day corrects it (upsert), never stacks.
- `findCoverageGaps` (`lib/import/coverage.ts`, pure) names missing statement periods from `ImportBatch.coverageFrom/coverageTo`. **Only a statement declares its coverage**; a movement export does not, and it never takes part. Inferring coverage from transaction dates is wrong and shipped a false alarm once: a savings statement covering 24 June to 24 July whose only movements fell on 14–15 July was reported as a two-week gap. `periodFrom`/`periodTo` remain the transaction date range, for display only.
- `AccountBalance.incompleteHistory` marks a cash account with no checkpoint at all; the UI says the total is a lower bound rather than presenting it as fact.
- An investment account with no snapshot reports `source: 'UNKNOWN'`, never a confident zero.
- `INTERNAL_TRANSFER` is **not** skipped here, unlike in settlement and cash-flow: it nets to zero across the household but genuinely moves each account's own balance.
- The nightly rollup truncates to the day and updates in place, so re-running it never creates a second history point.

### Charts
- Recharts. Palette lives in `components/charts/chart-theme.ts`, validated with the data-viz validator against this app's own surfaces (`#ffffff` / `#0a0a0a`) in both modes — re-run it before changing a colour.
- Recharts renders colours as SVG attributes, so a CSS custom property cannot do the light/dark swap; `useChartPalette()` resolves it in JavaScript.
- One series means no legend (the heading names it). One measure across categories means one colour — bars carry magnitude, labels carry identity.
- Money stays `Decimal` right up to the chart, becoming a number only for pixel positions.

### Auth
- Auth.js v5, Credentials provider, JWT sessions. No database adapter.
- Passwords are scrypt (`node:crypto`) via `lib/auth/password.ts`. No password hashing dependency.
- Invitations are single-use links; only `sha256(token)` is stored, so a database dump hands out nothing usable.
- The first account is created at `/setup`, which is reachable only while the user table is empty. Everyone after that arrives by invitation.
- All users see all financial data. Orbit is a two-person household hub, not a multi-tenant app; `Transaction.paidBy` stays the ME / PARTNER axis and is deliberately not tied to a user row.
- Route protection lives in `proxy.ts` (Next.js 16 renamed the `middleware` convention). Cron and provider routes stay on `INGESTION_SECRET`; they have no session.

### Prisma 7 — differs from older docs and from model training data
- `datasource db` in `schema.prisma` has **no `url`**. The connection URL lives in `prisma.config.ts`.
- The client is generated by the `prisma-client` generator (not `prisma-client-js`) into `lib/generated/prisma`, which is git-ignored. Import from `@/lib/generated/prisma/client`, **never** from `@prisma/client`.
- `PrismaClient` requires an explicit driver adapter (`PrismaPg`). The singleton lives in `lib/db/prisma.ts`; always import `prisma` from there.
- Run migrations with `npm run db:migrate`, regenerate with `npm run db:generate`.

### Next.js 16
- Read `node_modules/next/dist/docs/` before writing App Router code — this version has breaking changes versus older Next.js knowledge.
- `middleware.ts` is deprecated: the file is `proxy.ts` and the handler is its default export.
- Do **not** use `runtime = 'edge'`. Prisma and the parsers need the Node.js runtime.
- Scheduled work (T212 sync, nightly net-worth snapshot) runs as Vercel Cron hitting `app/api/cron/*`.
- Cron and webhook routes are secured by a shared secret header, checked before any parsing.

---

## 4. Project structure

```
prisma.config.ts           # Prisma 7 config: schema path, migrations, DATABASE_URL
Dockerfile                 # multi-stage: deps -> builder -> migrator / runner
docker-compose.yml         # local dev: postgres + one-shot migrate + app + cron
docker-compose.prod.yml    # VPS deploy: prebuilt GHCR images + Traefik labels
prisma/
  schema.prisma            # single schema file (no datasource url — see prisma.config.ts)
  migrations/
  seed.ts                  # baseline categories
proxy.ts                   # route protection (Next.js 16 name for middleware)
app/
  api/
    import/csv/route.ts               # CSV upload: dry run + commit
    auth/[...nextauth]/route.ts       # Auth.js handlers
    setup/route.ts                    # first owner account
    invites/route.ts                  # create / list invitations
    invites/accept/route.ts           # redeem an invitation
    session/status/route.ts           # current session probe
    cron/sync-trading212/route.ts     # pull positions + cash snapshot
    cron/net-worth-snapshot/route.ts  # nightly net worth rollup
    health/route.ts                   # liveness + DB probe (Docker healthcheck)
  signin/ setup/ invite/[token]/      # unauthenticated pages
  (dashboard)/
    import/                # CSV dropzone + import history
    settings/               # my account: email, password, reporting-start-month
    users/                  # who has access, invitations
    accounts/               # account CRUD
    planning/               # planning inputs + recurring-expense CRUD (tags for burn rate)
    insurance/              # insurance policy CRUD
    fuel/                   # Orlen Tankarta purchase/top-up/receipt tracking
    dashboard/             # home route: burn rate, expected vs. actual, missing-this-month
    transactions/          # ledger, categorization, isShared toggle, split/merge, transfer matching
    portfolio/             # T212 portfolio view
    buckets/               # sinking funds (planned, not yet built)
    net-worth/             # history chart, unmatched-transfer panel
    settlement/            # monthly couple settlement
lib/
  generated/prisma/        # generated Prisma client — git-ignored, never edited
  db/prisma.ts             # singleton PrismaClient (pg driver adapter)
  auth/                    # Auth.js config, scrypt passwords, invitations, user CRUD
  ui/period.ts             # shared month/period helpers for dashboard-style views
  parsers/
    reference.ts            # normalizeSourceReference — shared CSV/XML reference reduction
    csv/
      registry.ts            # provider -> parser map
      types.ts               # ParsedTransaction contract
      decode.ts               # bytes -> text (BOM, Windows-1250)
      numbers.ts dates.ts    # Czech amount and date parsing
      moneta.ts               # Moneta column map + row mapper
      moneta-categories.ts   # bank category -> Orbit category, merchant-text fallback
    xml/moneta-statement.ts  # Moneta monthly statement (XML), self-verifying
  import/
    process-csv.ts           # decode -> parse -> dedup -> persist
    internal-transfers.ts    # counterparty-account heuristic, sets kind
    transfer-sync.ts         # Prisma wrapper: finds candidates, writes Transfer rows
    checkpoints.ts           # AccountSnapshot balance checkpoints
    coverage.ts              # findCoverageGaps — missing statement periods (pure)
    recurring-matching.ts    # recurring-expense merchant matching (pure)
    recurring-alias-worker.ts # Prisma wrapper around recurring-matching
  providers/trading212/
    client.ts               # REST client: summary, positions, dividends, transaction history
    schemas.ts              # Zod response shapes
    sync.ts                  # portfolio value -> AccountSnapshot
    income-sync.ts           # dividends + interest -> real Transaction rows
  finance/
    idempotency.ts                  # idempotency key builder
    settlement.ts                   # couple settlement math (pure)
    share.ts                        # "my share of a ratio" math, shared by settlement + burn rate (pure)
    split.ts                        # transaction split validation (pure)
    transfer-matching.ts            # transfer pairing algorithm (pure)
    burn-rate.ts                    # recurring-expense expected vs. actual (pure)
    net-worth.ts                    # net worth aggregation (pure)
    net-worth-service.ts            # net-worth Prisma queries (impure half of net-worth.ts)
    monthly-net-worth-service.ts    # nightly net-worth rollup persistence
    account-analytics-service.ts    # per-account analytics Prisma queries
    insurance.ts                    # insurance math (pure)
    insurance-service.ts            # insurance Prisma queries (impure half of insurance.ts)
    merchant-category-recommendations.ts  # category suggestion heuristics (pure)
  validation/              # shared Zod schemas
components/{ui,charts}/
components/recurring/       # RecurringExpense CRUD manager
components/dashboard/       # month picker for the burn-rate view
components/accounts/ auth/ import/ layout/ net-worth/ planning/ settlement/ transactions/
types/
scripts/                   # anonymizers, backfills, account/password admin, replay-ingestion
docs/
```

Rules:
- `lib/finance/*` is **pure** — inputs in, numbers out, no Prisma, no `fetch`, no `Date.now()` (time is injected). Where a Prisma-touching counterpart exists, it lives alongside as `*-service.ts` (e.g. `net-worth.ts` / `net-worth-service.ts`), never inline in the pure file.
- `lib/parsers/*` never touches the DB. A parser returns `ParsedTransaction | ParseFailure`; `lib/import/*` deduplicates and persists.
- Route handlers stay thin: verify secret, Zod-parse, delegate, respond. A single inline Prisma call for a trivial lookup (health check, session probe) is fine — don't wrap a one-liner in a service file just for the sake of the rule.

---

## 5. Conventions

- Files `kebab-case.ts` — including React components (`transaction-table.tsx`, not `TransactionTable.tsx`). Types/interfaces `PascalCase`, no `I` prefix.
- Enums live in Prisma and are imported from `@/lib/generated/prisma/enums` — do not redeclare them as TS unions.
- Commits: Conventional Commits, English, imperative (`feat(parsers): add Revolut card payment template`).
- **Never add AI-attribution trailers to commits** (no `Co-Authored-By: Claude`, no session links).
- Secrets only via env vars, validated once in `lib/validation/env.ts` at startup.
- Never log a full e-mail body or a T212 API key. Raw payloads live in the DB, not in stdout.

---

## 6. Running the project

```bash
cp .env.example .env      # then fill INGESTION_SECRET (openssl rand -hex 32)
```

### Full stack in Docker

```bash
docker compose up --build -d      # postgres + migrate + app
curl localhost:3000/api/health    # {"status":"ok","database":"up"}
docker compose down               # add -v to also drop the data volume
```

Compose has three services:
- `postgres` — Postgres 17, data in the `orbit-pgdata` volume.
- `migrate` — one-shot: runs `prisma migrate deploy` then `prisma db seed`, then exits. The seed is idempotent (upsert on `Category.name`), so re-running compose is safe.
- `app` — the standalone Next.js build. Waits for `migrate` to complete successfully.

The image is built from a multi-stage `Dockerfile` (`deps` → `builder` → `migrator` / `runner`).
`npm ci` runs with `--ignore-scripts`; `prisma generate` is invoked explicitly in `builder`
with a placeholder `DATABASE_URL`, since generation never connects to a database.

There is no dev deployment — `dev` is a git branch only (a PR gate before `main`),
nothing deploys from a push to it. Every fix happens once, on production.

### Reaching production data from a local machine

Two ways in, both requiring SSH access to the VPS — no separate credentials to manage:

- **Quick SQL, no setup**: `ssh <user>@<host> "docker exec -it orbit-postgres psql -U orbit -d orbit"`.
  Works through `docker exec`, so it needs nothing published on the host.
- **Running a repo script** (`scripts/*.ts`) against production: `DEPLOY_HOST=<vps> ./scripts/prod-db-tunnel.sh`
  in one terminal (tunnels `orbit-postgres`, which is bound loopback-only on the VPS —
  see `docker-compose.prod.yml` — never reachable from the public internet), then in
  another terminal `DATABASE_URL="postgresql://orbit:<prod-password>@localhost:5432/orbit?schema=public" npx tsx scripts/whatever.ts`.

**Never run `docker compose up` against a tunneled production `DATABASE_URL`.** The
`migrate` service unconditionally runs `prisma migrate deploy` before `app` starts —
against production, with no confirmation step. Migrations only ever happen through
the real deploy pipeline. A one-off script or `npm run dev` is safe (neither migrates);
`docker compose up` is not.

For the rare case where you need the actual containerized `app` (not `npm run dev`)
pointed at production — see `docs/prod-db-access.md` for the full walkthrough
(`docker-compose.prod-local.yml` overrides `DATABASE_URL` and drops the local
`postgres`/`migrate` dependency, so a plain `docker compose up` still can't reach it).

### Local dev against the containerised database

```bash
npm run db:up             # postgres only
npm run db:migrate
npm run db:seed
npm run dev
```

Checks: `npm run typecheck`, `npm test`, `npm run lint`.
`npm run test:integration` exercises the import pipeline end to end.

**Integration tests never run against the development database.** They target a
separate `<database>_test` (override with `ORBIT_TEST_DATABASE_URL`), created and
migrated by `scripts/test/global-setup.ts`. Fixtures additionally scope every
delete to the accounts they created. Both guards exist because an unscoped
`deleteMany({})` once destroyed real imported statements.

### Test fixtures and privacy
- Real bank exports live in `private/` and are git-ignored. Never commit one.
- Fixtures in `docs/samples/` are produced by `scripts/anonymize-moneta-csv.ts`, which replaces account numbers, IBANs, card numbers, payment symbols and natural persons' names while preserving amounts, dates, merchants and the uniqueness of every bank reference — the properties the parser tests depend on.

### Creating an account
There is no account management UI yet; a CSV import needs an account to file under:

```bash
npx tsx scripts/create-account.ts --name "Moneta" --provider MONETA \
  --type CHECKING --external-id "204370628/0600"
```

### Changing a password
There is no password change screen yet:

```bash
npx tsx scripts/set-password.ts --email hello@example.com --password "new secret"
```

---

## 7. Definition of done

- [ ] `tsc --noEmit` clean, no `any`
- [ ] Every new external input has a Zod schema
- [ ] New parser has: happy-path test against a real anonymized fixture, malformed-input test, duplicate-import test
- [ ] Money handled as `Decimal`, currency stored
- [ ] Prisma migration committed alongside the schema change
