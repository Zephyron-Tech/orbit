# Moneta sync ingest API (mac-automation `moneta-sync` bot)

Machine-to-machine endpoint for the Moneta email-fallback bot. **The
original on-demand live-scrape design was cancelled** —
`ib.moneta.cz` runs behind F5 Bot Defense, and automating past a bank's own
fraud/anti-bot defense is a real account-risk (blocking, fraud review), not
a technical problem to solve around. See `docs/moneta-ondemand-sync-spec.md`
for that history.

What remains: `mac-automation`'s `moneta-sync` bot runs as a one-shot job
every ~30 minutes, parses Moneta "Info Servis" notification e-mails, and
POSTs each transaction it finds here — a passive, approximate fallback, not
a replacement for the real statement import (`docs/bank-statement-ingest-api.md`).

## Endpoint

| Purpose | Path |
| --- | --- |
| Upload one transaction parsed from an Info Servis e-mail | `POST /ingest/moneta-sync/transactions` |

Base URL: `https://api.orbit.zephyron.tech` (production only — there is no dev deployment).
**Not** `orbit.zephyron.tech` (that's apps/web, the Next.js frontend) and **no** `/api`
prefix — apps/api is its own Hono service, mounted at the domain root.

## Auth

```
Authorization: Bearer <MONETA_SYNC_INGESTION_SECRET>
```

A dedicated secret, separate from `INGESTION_SECRET`, `FUEL_INGESTION_SECRET`,
and `BANK_STATEMENT_INGESTION_SECRET` — see `lib/validation/env.ts`,
provisioned from the `ORBIT_MONETA_SYNC_INGESTION_SECRET` GitHub Actions
secret. Both Orbit and the bot need the same value. A missing or wrong token
returns `401`.

## Request

`application/json`, **one transaction per call**:

```json
{
  "transaction_id": null,
  "account_id": "b3a893d4-a301-486a-8b62-218d1a132371",
  "amount": "250.00",
  "currency": "CZK",
  "booked_date": "2026-09-12",
  "counterparty": "Obchodník s.r.o.",
  "source": "moneta-sync-email-fallback",
  "dryRun": true
}
```

| Field | Notes |
| --- | --- |
| `transaction_id` | **always `null` on this source** — an Info Servis e-mail carries no bank reference. Send `null`, not an omitted field or an empty string. |
| `account_id` | uuid, from `GET /ingest/accounts` (see `docs/bank-statement-ingest-api.md`). **Do not send a placeholder like `"TODO"`** — see "Account resolution" below, this is rejected with `400` on purpose. |
| `amount` | **decimal string, dot separator, expense negative — not a JSON number.** Orbit's money handling bans JS floats end to end (`CLAUDE.md`); a JSON number here would already have lost precision by the time it reaches the server, and there's no way to recover the original figure afterward. Send `"250.00"`, never `250.0`. |
| `currency` | ISO 4217, 3 letters |
| `booked_date` | `YYYY-MM-DD` |
| `counterparty` | string or `null` — the only merchant-identifying text an Info Servis e-mail gives |
| `source` | free-text tag identifying the upstream channel (e.g. `"moneta-sync-email-fallback"`); stored for traceability, not matched against anything |
| `dryRun` | optional, **defaults to `true`** — pass `false` explicitly to actually commit. Keep this `true` until request/response shapes are mutually verified. |

No `counterAccount` (an e-mail never gives a counterparty account number, so
internal-transfer detection can't run on this source) and no `sourceCategory`
(Moneta doesn't categorize in the notification e-mail either).

## Response

`200`:

```json
{
  "batchId": "…",
  "accountId": "…",
  "dryRun": true,
  "rowCount": 1,
  "inserted": 1,
  "skipped": 0,
  "failed": 0,
  "failures": [],
  "checkpoint": null
}
```

`batchId` is `null` when `dryRun: true` (nothing was written). `checkpoint`
is always `null` on this path — this endpoint never receives a balance to
anchor from.

Other statuses:

| Status | Meaning |
| --- | --- |
| `401` | missing/wrong bearer token |
| `400` | malformed request (bad JSON, failed validation — including `account_id` not being a real uuid, e.g. `"TODO"`), or `code: "ACCOUNT_NOT_FOUND"`/`"UNSUPPORTED_PROVIDER"` |
| `409` | this exact payload already processed (`code: "ALREADY_IMPORTED"`) — **treat as success, not an error** |
| `5xx` | unexpected failure — retry (the bot's own 3× retry policy is the right response here, nothing else to do) |

Any other `4xx` carries a human-readable message in `error` — not retryable
as-is.

## Account resolution

`account_id` is required and validated as a real uuid — a placeholder value
is rejected with `400`, on purpose. Once the bot can reliably tell which
account an Info Servis e-mail belongs to, resolve it the same way the
`moneta-statements` bot does: `GET /ingest/accounts`, matched against
whatever account-identifying text the e-mail actually contains. There's no
"unassigned, sort out later" path here — an unresolvable row should not be
silently invented into the ledger under the wrong account, or the account
appears wrong in Orbit until someone finds and fixes it.

## Dedup — read this before assuming duplicates are handled

`transaction_id: null` means every row from this source dedups via
`buildIdempotencyKey`'s **ATTRIBUTES** fallback: same account, same
calendar day, same signed amount, same normalized merchant text. This is
the same fallback `CLAUDE.md` documents as **not safe** for a real statement
import — a real July export once had two genuinely distinct 50 CZK payments
at the same club on the same day that this hash would collapse into one.
For a single email-triggered row (not a batch of many), the collision risk
is much smaller, but not zero, and it is accepted here as a known trade-off
of an approximate fallback source, not treated as solved.

**Reconciliation on statement import**: when the real statement later imports
the same transaction with its real bank reference, `processCsvImport`
(`lib/import/process-csv.ts`) checks the incoming row's attribute signature
against every reference-less row already on the account. Exactly one
unclaimed match → the existing row is **updated in place** (`externalId` +
`idempotencyKey` only; category, split, notes are left untouched), not
duplicated. `ImportBatch.reconciledCount` reports how many rows were merged
this way on a given import.

This only fires when the two sides agree on the same normalized merchant
text. An Info Servis e-mail's `counterparty` is sometimes generic (e.g.
`"Platba kartou"`) where the statement carries the real merchant name — in
that case the attribute signatures differ and reconciliation does not match,
so the transaction can still end up duplicated. Ambiguous matches (more than
one reference-less candidate sharing a signature) are also deliberately left
unmerged, same "don't guess" rule as `lib/finance/transfer-matching.ts` —
check for a duplicate manually in that case.
