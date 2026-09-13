# On-Demand Moneta Ingestion Pipeline — spec + work split

**CANCELLED (2026-09-13).** The on-demand live-scrape flow this document
describes (UI trigger → Redis Pub/Sub → Mac Mini Playwright login against
`ib.moneta.cz` → XHR capture) does not proceed. `ib.moneta.cz` runs behind
F5 Bot Defense; automating past a bank's own fraud/anti-automation defense
is a real account-risk (blocking, fraud review) — not a technical problem
worth solving around. Nothing described below this notice was ever built
beyond the write endpoint's transaction-ingest half, which has since been
repurposed for the passive e-mail fallback instead (§3 below) — see
`docs/moneta-sync-ingest-api.md` for what actually exists today.

Original spec (Jan Vandlíček, 2026-09-13), verbatim below the split. This
document exists to divide work between the **Orbit** repo and the
**mac-automation** repo before any implementation starts.

## Open architectural question — resolve before coding

`CLAUDE.md` §"Hard rules" states today: *"Data never comes from PSD2 / Open
Banking. Two ingestion paths only: CSV statement imports, Trading 212 REST
API."* This spec is a **third path** — browser automation against Moneta's
own internet banking, storing real login credentials on the Mac Mini, and
capturing the bank's internal (undocumented, unversioned) XHR/JSON
responses. That's a deliberate, consequential departure from a documented
hard rule, not an incremental addition — worth a conscious go/no-go before
either repo writes code, and a `CLAUDE.md` rewrite once decided. Not
blocking the work-split below, but the first thing to settle.

Two more design gaps worth resolving early, not during implementation:

- **Email-fallback-then-upgrade dedup.** The spec says a real sync
  "přepisuje a doplňuje" the provisional email-derived row with the bank's
  own `transaction_id`. Orbit's idempotency doctrine (`lib/finance/idempotency.ts`,
  documented in `CLAUDE.md`) already flags the ATTRIBUTES fallback (day +
  amount + merchant) as unsafe for exactly this kind of matching — a real
  July export had two genuinely distinct same-day same-amount transactions
  it would have collapsed into one. Matching a provisional email row to its
  later real counterpart needs an explicit strategy (e.g. keep the
  provisional row keyed by ATTRIBUTES as today, but instead of inserting a
  second row when the real sync arrives with an EXTERNAL_ID, look up and
  *upsert in place* — turning the provisional row into the confirmed one),
  not an ad hoc regex reconciliation.
- **Run correlation.** Unlike cron ingestion, this flow has a human
  approving Face ID mid-flight. The trigger, the Redis message, the Mac
  Mini run, and the status callback all need one correlation id carried
  through, so a slow/hung run's late status callback can't reset a UI
  that already moved on to a newer run (or a stale timeout from run N
  doesn't get applied to run N+1).

## Work split

### Orbit repo (this repo)

1. **Trigger UI** — "Sync Moneta" button (likely `/net-worth` or `/dashboard`),
   client component with loading/timeout state, same shape as existing
   "Spárovat převody"/"Obnovit" (T212) action buttons already in the
   codebase.
2. **Redis publisher** — thin, publish-only client (new `lib/realtime/redis.ts`
   or similar); no Redis client dependency exists in `package.json` yet.
   New `REDIS_URL` env var, validated in `lib/validation/env.ts`.
3. **New ingest endpoints**, following the existing `/api/ingest/*`
   convention (`isIngestionAuthorized`, dedicated bearer secret — see
   `docs/bank-statement-ingest-api.md` and `docs/fuel-ingest-api.md` for
   the pattern to mirror):
   - `POST /api/ingest/moneta-sync/transactions` — receives the Mac Mini's
     normalized JSON. This is its **own** parser
     (`lib/parsers/moneta-api/*`, not the PDF/CSV/XML ones), producing
     `ParsedTransaction`s keyed by the bank's real `transaction_id` as
     `EXTERNAL_ID` — better than every existing Moneta path, since this one
     always has a real reference, no ATTRIBUTES fallback needed.
   - `POST /api/ingest/moneta-sync/status` — receives `{ runId, status: 'timeout'|'error'|'done', ... }`
     from the Mac Mini so the UI can resolve the correct run (see "Run
     correlation" above).
   - New dedicated secret `MONETA_SYNC_INGESTION_SECRET`. **Checklist this
     session's bank-statement work proved necessary** — a secret only
     works end-to-end once it's in *all* of these, or requests 500 in
     production despite a correct token:
     - [ ] `lib/validation/env.ts` (Zod schema)
     - [ ] `.env.example`
     - [ ] `docker-compose.yml` **and** `docker-compose.prod.yml` — both
       need the var listed under the `app` service's `environment:` block.
       Compose does not forward an `.env` value into the container just
       because it's in `.env`; it must be named here too. (This exact gap
       caused a production 500 on the bank-statement endpoint this
       session.)
     - [ ] `.github/workflows/deploy.yml` — `env:`, `envs:`, and the `.env`
       heredoc, three separate places in that one file
     - [ ] `ORBIT_MONETA_SYNC_INGESTION_SECRET` GitHub Actions secret,
       same value the Mac Mini worker is configured with
4. **Email-fallback ingestion** — same transactions endpoint (or a
   `provisional: true` flag on the payload), landing rows via the
   ATTRIBUTES path today; see the dedup design gap above for how a later
   real sync must reconcile with these rather than duplicate them.
5. **Live refresh** — net worth / ledger re-render once a sync completes;
   SSE, polling, or a `router.refresh()` on a Redis-relayed status event
   are all plausible, not yet decided.

### mac-automation repo (Mac Mini)

1. Redis subscriber daemon, 24/7, persistent outbound connection.
2. Playwright automation against Moneta internet banking: login, wait for
   Face ID SCA, navigate the three accounts, intercept XHR/fetch JSON
   (not scraping rendered HTML).
3. Credential storage — macOS Keychain or local `.env`; **never** leaves
   this machine, never touches Redis or Orbit.
4. Transforms captured JSON to Orbit's expected shape, POSTs to
   `/api/ingest/moneta-sync/transactions` with the bearer secret.
5. 60s Face-ID timeout handling: tear down the browser context, POST
   `{ runId, status: 'timeout' }` to `/api/ingest/moneta-sync/status`.
6. IMAP listener (or inbound-mail webhook) for the Info Servis fallback;
   regex-extracts amount/date/merchant above the configured floor (e.g.
   100 Kč), POSTs the same transactions endpoint with `provisional: true`.
7. Full context teardown after every run (Playwright + any listeners),
   guarding against the memory-leak failure mode the spec calls out.

---

## Original specification (verbatim)

### 1. Architektura a topologie sítě

Systém je rozdělen do čtyř nezávislých uzlů, které komunikují asynchronně:

* **Orbit Frontend & API (Hetzner VPS):** Next.js aplikace obsluhující uživatelské rozhraní a přijímající finální data. Obsahuje spouštěcí mechanismus (tlačítko) a API endpoint pro bezpečný zápis do databáze přes Prisma ORM.
* **Message Broker (Redis na Hetzneru):** Existující instance Redisu nasazená za Traefik reverse proxy. Slouží jako rychlá komunikační sběrnice. Využívá architekturu Publish/Subscribe (Pub/Sub) pro bezpečné předání spouštěcího signálu za NAT domácí sítě, aniž by bylo nutné otevírat lokální porty.
* **Worker Node (Mac Mini M4):** Lokální démon běžící 24/7. Udržuje trvalé odchozí spojení na Redis. Obsahuje Playwright (Node.js/Python) pro provedení bezhlavé (nebo minimalizované) navigace v Internet Bance a síťový odposlech (Network Interception). Uchovává přihlašovací údaje.
* **Autorizační uzel (iPhone 15 Pro):** Hardwarový klíč přijímající Smart Klíč notifikace z banky. Zajišťuje biometrické potvrzení (Face ID) pro provedení relace.

### 2. Exekuční Flow (Krok za krokem)

1. **Trigger (Orbit UI):** Uživatel klikne na tlačítko "Sync Moneta". UI se přepne do stavu načítání. Next.js API publikuje zprávu `{"action": "sync_moneta", "timestamp": 1694600000}` do Redis kanálu `orbit_commands`.
2. **Command Interception (Mac Mini):** Worker Node okamžitě přijímá zprávu. Spouští instanci prohlížeče přes Playwright, zadává přihlašovací jméno a heslo (čtené z lokálního `.env` nebo macOS Keychain).
3. **SCA Autorizace (Moneta ↔ iPhone):** Bankovní systém odesílá push notifikaci. Worker Node čeká na vyřešení elementu na stránce. Uživatel biometricky potvrzuje přístup na telefonu.
4. **Network Extraction (Mac Mini):** Po úspěšném přihlášení Playwright naviguje přes Běžný, EUR a Kreditní účet. Pomocí event listeneru zachytává přímo XHR/Fetch odpovědi z backendu banky na haléř přesně v čistém JSON formátu. Křehké UI banky je ignorováno.
5. **Data Ingestion (Hetzner VPS):** Mac Mini transformuje JSON do struktury Orbitu a odesílá POST požadavek s Bearer tokenem na zabezpečený endpoint `https://orbit.tvoje-domena.cz/api/ingest`.
6. **Databázový Upsert:** API Orbitu provádí deduplikaci. Využívá unikátní identifikátor každé transakce (`transaction_id` z banky) pro databázový upsert, čímž se zamezí dvojímu zápisu. Frontend skrze SWR/Server-Sent Events detekuje změnu a překresluje Net Worth.

### 3. Pasivní Fallback Vrstva (E-mail Info Servis)

Slouží jako asynchronní výplň mezi manuálními synchronizacemi, zajišťující základní průběžný přehled o cash-flow bez nutnosti aktivního spouštění bota.

* **Záchytná mechanika:** Na Mac Mini běží sekundární IMAP listener (nebo je nakonfigurován webhook pro příchozí poštu).
* **Parsování:** Z každého e-mailu od Info Servisu nad minimální bankovní limit (např. 100 Kč) je pomocí regulárních výrazů (Regex) vytažena částka, datum a název obchodníka.
* **Zápis:** Údaje jsou okamžitě odeslány na stejný Ingest API endpoint.
* **Deduplikační logika:** Při následném spuštění "On-Demand" bota jsou tyto hrubé e-mailové záznamy přepsány a doplněny o přesná bankovní metadata a unikátní ID ze surového JSONu (předejití duplicit).

### 4. Zabezpečení a chybové stavy

* **Izolace Credentials:** Přihlašovací jméno a heslo k bance neopouští hardware Mac Mini. Redis přenáší pouze neadresný spouštěcí signál, nikdy citlivá data.
* **Smart Timeout:** Pokud uživatel nestihne potvrdit Face ID do 60 vteřin (např. spuštění omylem, nemožnost najít telefon), Worker Node relaci bezpečně ukončí, zavře prohlížeč a přes API odešle do Orbitu stav `timeout`. UI následně resetuje načítací tlačítko do výchozí polohy.
* **Self-Healing Flow:** Playwright skript se po každém běhu zcela dekonstruuje (vyčištění kontextu), čímž brání zaplnění operační paměti a případným memory leaks při dlouhodobém běhu workeru.
