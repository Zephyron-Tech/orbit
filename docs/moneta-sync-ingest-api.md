# Moneta live-sync ingest API (mac-automation bot)

Machine-to-machine endpoint for pushing transactions scraped live from
Moneta's internet banking into Orbit — used by the `mac-automation` Mac Mini
worker (Playwright + Face ID SCA + XHR interception), not the web UI. See
`docs/moneta-ondemand-sync-spec.md` for the full architecture; this document
covers only the write endpoint.

Unlike every other ingest endpoint, this one takes **JSON**, not a file:
there's no PDF/CSV/XML to parse, the bot already extracted structured data
straight from the bank's own XHR responses.

## Endpoint

| Purpose | Path |
| --- | --- |
| Upload one account's transactions from a sync run | `POST /api/ingest/moneta-sync/transactions` |

Base URL: `https://orbit.zephyron.tech` (production only — there is no dev deployment).

To find the right `accountId`, call `GET /api/ingest/accounts` first (see
`docs/bank-statement-ingest-api.md`) — same account-discovery endpoint, same
secret family, shared across every ingest bot.

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

`application/json`, **one account per call** — the bot calls this endpoint
once per account it navigated to in a sync run (checking, EUR, credit):

```json
{
  "accountId": "b3a893d4-a301-486a-8b62-218d1a132371",
  "balance": "69826.91",
  "transactions": [
    {
      "transactionId": "260913S00512345678",
      "date": "2026-09-13",
      "amount": "-450.00",
      "currency": "CZK",
      "merchant": "ALBERT",
      "description": null,
      "counterAccount": null,
      "sourceCategory": "Potraviny"
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `accountId` | uuid, from `GET /api/ingest/accounts` |
| `balance` | optional decimal string (dot separator). When present, writes a checkpoint (`AccountSnapshot`, `source: PROVIDER`) dated today — a live balance is the most trustworthy anchor Orbit ever gets, more current than any statement |
| `transactions[].transactionId` | **required** — Moneta's own real reference. This becomes the transaction's `externalId` and drives dedup; there is no reference-less fallback on this path, unlike the credit-card PDF parser |
| `transactions[].date` | `YYYY-MM-DD` |
| `transactions[].amount` | signed decimal string, dot separator, expense negative |
| `transactions[].currency` | ISO 4217, 3 letters |
| `transactions[].merchant` / `.description` | either may be `null` |
| `transactions[].counterAccount` | the counterparty's account number, or `null`. Used for internal-transfer detection between Orbit's own accounts — omit this and a genuine transfer between your own accounts won't be recognized as one |
| `transactions[].sourceCategory` | Moneta's own category label, or `null`. Mapped the same way a CSV import's bank category is |

No `dryRun` — a live sync is meant to commit; a Face-ID-gated one-shot run
doesn't fit a preview step. Max 500 transactions per call.

## Response

`200` on success:

```json
{
  "batchId": "…",
  "accountId": "…",
  "rowCount": 12,
  "inserted": 1,
  "skipped": 11,
  "failed": 0,
  "failures": [],
  "checkpoint": { "balance": "69826.91", "asOf": "2026-09-13", "expected": "69826.91", "difference": "0.00", "matches": true }
}
```

`inserted`/`skipped` behave exactly like every other ingest path: a
transaction whose `transactionId` already exists on this account is a
silent no-op, not an error — a sync naturally re-sends recent history every
run, only the new rows land.

Other statuses:

| Status | Meaning |
| --- | --- |
| `401` | missing/wrong bearer token |
| `400` | malformed request (bad JSON, failed Zod validation), or `code: "ACCOUNT_NOT_FOUND"`/`"UNSUPPORTED_PROVIDER"` if `accountId` doesn't resolve to a Moneta account |
| `409` | byte-identical payload already processed (`code: "ALREADY_IMPORTED"`) — **treat as success, not an error** |
| `500` | unexpected failure — check server logs |

`400`/`409` are permanent for that exact payload — don't retry it as-is.
`500` is the only status worth retrying.

## Notes

- Categorization and internal-transfer detection reuse the exact same
  functions the CSV/PDF import pipeline uses
  (`lib/import/process-csv.ts`'s `resolveTransactionCategory`, and
  `lib/import/internal-transfers.ts`) — a live-synced row is classified
  identically to one that arrived any other way.
- `source: 'API'` is stamped on every row this endpoint writes, distinct
  from `CSV_IMPORT` (statements/movement exports) and `MANUAL` (typed-in) —
  useful for telling where a given transaction actually came from later.
- The `/api/ingest/moneta-sync/status` callback (for reporting a Face-ID
  timeout or an in-flight error back to Orbit) and the Redis-driven "Sync
  Moneta" trigger button are not built yet — deferred until the scraping
  side of mac-automation is working. Trigger a sync manually for now.
