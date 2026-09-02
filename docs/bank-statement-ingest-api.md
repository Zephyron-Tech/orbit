# Bank statement ingest API (statement bot)

Machine-to-machine endpoints for pushing Moneta bank statement PDFs into
Orbit without a browser session — used by an external automation bot, not
the web UI. Both statement bot endpoints wrap the exact same import
pipeline the human-facing `/import` page uses (`lib/import/process-csv.ts`),
so they carry the same idempotency guarantees: re-uploading an
unchanged file is a safe no-op, and a statement's own account/card number
is checked against the account you post it to.

## Endpoints

| Purpose | Path |
| --- | --- |
| List accounts (to find the right `account_id`) | `GET /api/ingest/accounts` |
| Upload one statement PDF | `POST /api/ingest/bank-statement` |

Base URL: `https://orbit.zephyron.tech` (production only — there is no dev deployment).

## Auth

```
Authorization: Bearer <BANK_STATEMENT_INGESTION_SECRET>
```

A dedicated secret, separate from `INGESTION_SECRET` and `FUEL_INGESTION_SECRET`
— see `lib/validation/env.ts`, provisioned from the `ORBIT_BANK_STATEMENT_INGESTION_SECRET`
GitHub Actions secret. A missing or wrong token returns `401`.

Both Orbit (env var, validated at request time) and the bot (this header)
need to hold the **same** secret value — generate it once
(`openssl rand -hex 32`), put it in the GitHub Actions secret so deploys
write it into the server's `.env`, and give the bot the identical value.

## `GET /api/ingest/accounts`

No request body.

```bash
curl -H "Authorization: Bearer $BANK_STATEMENT_INGESTION_SECRET" \
     https://orbit.zephyron.tech/api/ingest/accounts
```

`200` with every non-archived account:

```json
{
  "accounts": [
    { "id": "…", "name": "Běžný účet", "type": "CHECKING", "provider": "MONETA", "accountNumber": "204370628/0600" },
    { "id": "…", "name": "Kreditní karta", "type": "CREDIT", "provider": "MONETA", "accountNumber": null },
    { "id": "…", "name": "Trading 212", "type": "INVESTMENT", "provider": "TRADING212", "accountNumber": "22539729" }
  ]
}
```

`accountNumber` is the account's own bank-visible number — match it against
the number printed on the mailed statement to pick the right `id` for the
upload below. It's `null` for the credit card (matched by card last-4
inside the PDF itself, not an account number) and for any non-Moneta
account.

## `POST /api/ingest/bank-statement`

`multipart/form-data`, one file per request:

| Field | Value |
| --- | --- |
| `file` | the statement `.pdf` bytes, max 5 MB |
| `account_id` | the `id` from `GET /api/ingest/accounts` (uuid) |
| `dryRun` | `"false"` to actually commit — **any other value, or omitting the field, defaults to `true`** (preview only, nothing written) |

```bash
curl -H "Authorization: Bearer $BANK_STATEMENT_INGESTION_SECRET" \
     -F "file=@statement.pdf" \
     -F "account_id=b3a893d4-a301-486a-8b62-218d1a132371" \
     -F "dryRun=false" \
     https://orbit.zephyron.tech/api/ingest/bank-statement
```

## `POST /api/ingest/bank-statement` response

`200` with a JSON summary (same shape the `/import` UI page shows):

```json
{
  "batchId": "…",
  "dryRun": false,
  "kind": "STATEMENT",
  "rowCount": 42,
  "inserted": 3,
  "skipped": 39,
  "failed": 0,
  "preview": [ /* first 25 rows */ ],
  "failures": [ /* { rowNumber, reason } for unparseable rows */ ],
  "checkpoint": { /* balance anchor written from the statement's own closing balance */ },
  "statement": { "openingBalance": "…", "closingBalance": "…", "warnings": [] }
}
```

Other statuses:

| Status | Meaning |
| --- | --- |
| `401` | missing/wrong bearer token |
| `400` | malformed request, missing/empty file, `code: "BAD_FORMAT"` for a corrupted or non-Moneta PDF, or `code: "ACCOUNT_MISMATCH"`/`"ACCOUNT_NOT_FOUND"` if the statement's own account/card number doesn't match `account_id` |
| `413` | file over 5 MB |
| `415` | file extension isn't `.pdf` |
| `409` | byte-identical file already imported (`code: "ALREADY_IMPORTED"`) — **treat as success, not an error**: it means there was nothing new to add |
| `500` | unexpected failure — check server logs |

`400`/`409` are permanent for that exact file — don't retry it. `500` is
the only status worth retrying.

## Notes

- No `period`/`statement_date` field: the parser reads the statement's own
  period, opening/closing balance and transaction count straight out of the
  PDF and cross-checks itself (`statement.warnings`) — a value the bot
  guessed would just be a second, possibly-wrong source of truth.
- Every statement type the bank mails is supported the same way: current
  account, savings account, EUR account, and the credit card — the endpoint
  sniffs which one it's looking at from the PDF's own text, no separate
  field needed to say which.
