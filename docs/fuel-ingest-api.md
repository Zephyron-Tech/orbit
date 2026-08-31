# Fuel ingest API (Tankarta bot)

Machine-to-machine endpoints for pushing Orlen Tankarta data into Orbit
without a browser session — used by an external automation bot, not the web
UI. Every endpoint wraps the exact same import pipeline the human-facing
`/settings/fuel` page uses (`lib/import/process-fuel-xls.ts`,
`lib/import/process-fuel-topups.ts`, `lib/import/process-fuel-receipt.ts`),
so they carry the same idempotency guarantees: re-uploading an unchanged
file is a safe no-op, and a file with new rows only inserts the new ones.

## Endpoints

| Purpose | Path |
| --- | --- |
| Sales.xls (purchase history) | `POST /api/ingest/fuel` |
| ChargingPrepaids.xls (top-up history) | `POST /api/ingest/fuel-topups` |
| Receipt PDFs (batch) | `POST /api/ingest/fuel-receipt` |

Base URL: `https://orbit.zephyron.tech` (production only — there is no dev deployment).

## Auth

```
Authorization: Bearer <FUEL_INGESTION_SECRET>
```

A dedicated secret, separate from the cron/provider `INGESTION_SECRET` —
see `lib/validation/env.ts`, provisioned from the `ORBIT_FUEL_INGESTION_SECRET`
GitHub Actions secret. A missing or wrong token returns `401`.

## `fuel` / `fuel-topups` request

`multipart/form-data` with two fields:

| Field | Value |
| --- | --- |
| `file` | the `.xls` file bytes, max 5 MB |
| `dryRun` | `"false"` to actually commit — **any other value, or omitting the field, defaults to `true`** (preview only, nothing written) |

```bash
curl -H "Authorization: Bearer $FUEL_INGESTION_SECRET" \
     -F "file=@Sales.xls" \
     -F "dryRun=false" \
     https://orbit.zephyron.tech/api/ingest/fuel
```

## `fuel` / `fuel-topups` response

`200` with a JSON summary:

```json
{
  "batchId": "…",
  "dryRun": false,
  "rowCount": 347,
  "inserted": 3,
  "skipped": 344,
  "failed": 0,
  "preview": [ /* first 25 rows */ ],
  "failures": [ /* { rowNumber, reason } for unparseable rows */ ]
}
```

Other statuses:

| Status | Meaning |
| --- | --- |
| `401` | missing/wrong bearer token |
| `400` | malformed request, missing/empty file, or unreadable `.xls` structure |
| `413` | file over 5 MB |
| `415` | file extension isn't `.xls` |
| `409` | byte-identical file already imported (`code: "ALREADY_IMPORTED"`) — **treat as success, not an error**: it means there was nothing new to add |
| `500` | unexpected failure — check server logs |

## `fuel-receipt` request

`multipart/form-data`, batch upload — different shape from `fuel`/`fuel-topups`:

| Field | Value |
| --- | --- |
| `file` | one or more `.pdf` files (repeat the field), max 5 MB each, max 30 files per request |
| `dryRun` | same as above — `"false"` to commit, defaults to `true` |

```bash
curl -H "Authorization: Bearer $FUEL_INGESTION_SECRET" \
     -F "file=@receipt1.pdf" \
     -F "file=@receipt2.pdf" \
     -F "dryRun=false" \
     https://orbit.zephyron.tech/api/ingest/fuel-receipt
```

## `fuel-receipt` response

Always `200` — unlike `fuel`/`fuel-topups`, errors are per-file, not per-request:

```json
{
  "results": [
    { "ok": true, "filename": "receipt1.pdf", "dryRun": false, "receiptId": "…", "docNumber": "…", "purchasedAt": "…", "stationName": "…", "matchedPurchaseId": "…", "totalAfterDiscount": "…", "discountAmount": "…" },
    { "ok": false, "filename": "receipt2.pdf", "error": "Tato účtenka už byla nahrána", "code": "ALREADY_IMPORTED" }
  ]
}
```

`code` is `"ALREADY_IMPORTED"` (byte-identical or same `docNumber` already stored — treat as a no-op success, same as the `409` case above) or `"BAD_FORMAT"` (unreadable PDF, wrong extension, empty/oversized file). A `401` for a missing/wrong bearer token and a `400` for a malformed request (no files, or over 30 files) are the only request-level failures — everything else is reported per file inside `results`.

## Notes

- Full history should be uploaded, not just the current period — the wallet
  balance calculation needs every top-up and purchase that ever happened
  (see `lib/finance/fuel-service.ts`); only the monthly report display is
  scoped to `FUEL_DATA_CUTOFF`.
- A row the parser can't make sense of is reported in `failures`, not
  silently dropped — a non-empty `failures` array is worth alerting on even
  though the request itself still returns `200`.
