# Fuel ingest API (Tankarta bot)

Machine-to-machine endpoints for pushing Orlen Tankarta `.xls` exports into
Orbit without a browser session — used by an external automation bot, not
the web UI. Both endpoints wrap the exact same import pipeline the
human-facing `/settings/fuel` page uses (`lib/import/process-fuel-xls.ts`,
`lib/import/process-fuel-topups.ts`), so they carry the same idempotency
guarantees: re-uploading an unchanged file is a safe no-op, and a file with
new rows only inserts the new ones.

## Endpoints

| Purpose | Path |
| --- | --- |
| Sales.xls (purchase history) | `POST /api/ingest/fuel` |
| ChargingPrepaids.xls (top-up history) | `POST /api/ingest/fuel-topups` |

| Environment | Base URL |
| --- | --- |
| Production | `https://orbit.zephyron.tech` |
| Dev | `https://dev.orbit.zephyron.tech` |

## Auth

```
Authorization: Bearer <FUEL_INGESTION_SECRET>
```

A dedicated secret, separate from the cron/provider `INGESTION_SECRET` —
see `lib/validation/env.ts`. Each environment has its own value
(`FUEL_INGESTION_SECRET` in prod, same var name but a different value in
dev — provisioned from the `ORBIT_FUEL_INGESTION_SECRET` /
`DEV_FUEL_INGESTION_SECRET` GitHub Actions secrets respectively). A missing
or wrong token returns `401`.

## Request

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

## Response

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

## Notes

- Full history should be uploaded, not just the current period — the wallet
  balance calculation needs every top-up and purchase that ever happened
  (see `lib/finance/fuel-service.ts`); only the monthly report display is
  scoped to `FUEL_DATA_CUTOFF`.
- A row the parser can't make sense of is reported in `failures`, not
  silently dropped — a non-empty `failures` array is worth alerting on even
  though the request itself still returns `200`.
