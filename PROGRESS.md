# Progress

## Current session — 2026-10-01 (evening): revenue-readiness check; product-recall acceptance passed

- **Revenue path verified live.** `data.aroqon.com` pages, pricing, docs, terms, privacy, sitemap and `llms.txt` answer 200. `api.data.aroqon.com` answers 401 without a key. A live `POST /recalls/checkout` for Developer redirects to a `cs_live_` Stripe Checkout session (left unpaid). Stripe live mode has the four prices active and the webhook to `/stripe/webhook` enabled.
- **Revenue so far: none.** The only real customer is the owner's free Evaluate account (since 2026-09-30). The Stripe balance is $0.00.
- **Redeploy of `0f4949c`** (run 36914439661; no Worker code change since `12007d9`). The live version had lost its source tag: the `ADMIN_TOKEN` secret rotation on 2026-09-30 made an untagged version, so acceptance refused to run (run 36914180700). Live version is now `8ea7aba4`, tagged `0f4949c3ea7f`.
- **Authenticated acceptance passed for both datasets** (run 36914729481), 21/21 checks:
  - CPSC and Health Canada search, pagination, the hazard filter, model-code lookup, `include=raw` with matching digest, and 404;
  - FDA search, lot lookup and `include=raw`;
  - metering counts each of the 11 data requests once, against an allowance of 5,000;
  - the key was revoked afterwards and is rejected (401).
  The 2026-09-28 product-recall 401 does not reproduce through the operator reissue path.
- **Found: the collector has spent its free quota.** The owner's Evaluate key, which the Windows collector uses, reached 100/100 requests for October (also 100 in September), so the collector's reads are refused until 2026-11-01. It needs a key with a larger allowance. Minting an internal production key was refused by this session's permission check, so this is left to the owner.
- **Found: the recalls IndexNow feed is rate-limited.** Its 18:17 run got 429 and the watermark did not advance; the product feed is current. Not yet diagnosed.
- **RapidAPI:** the adapter and `?channel=rapidapi` OpenAPI (8 paths, no account paths) are live and closed (`RAPIDAPI_ENABLED = "0"`). With acceptance passed, the only remaining gate is `UA-004` (owner enrollment, agreement, payout).

## Current session — 2026-10-01: ENERGY STAR Model Index PROTOTYPED

- **Merged.** #84 (`0f4949c`): collector live, ADR-0018, the ENERGY STAR rights record, the snapshot archive workflow and
  the equipment-model parser.
- **Archived.** `Archive source snapshot` run 36878079058 wrote
  `research/pipeline/snapshots/equipment-energystar-model-index/2026-10-01/snapshot.tar.gz` (25,677,258 bytes, SHA-256
  `e3a5c579…1b17f7`) to `data-foundry-raw-artifacts` and verified it by read-back. The model-index CSV is byte-identical
  to the 2026-09-30 local run.
- **Evidence round** `research-2026-10-01` (`evidence/2026-10-01`, replayable from the archive). An independent Python
  assessment reproduces the parser's counts: 11,719 models with check-digit-valid GTINs, 886 rejected codes,
  1,576,700 pattern listings and 1,644,779 Canada listings.
- **Prototype.** 0 errors over 1,796,876 rows on the archived snapshot. `equipment-energystar-model-index` is now
  `PROTOTYPED`, the first member of `home-equipment-model-registry` past screening.
- **Next.** Build it (storage, daily sync, API/MCP), with GTIN as the only automatic recall link. Then archive and
  prototype the next free sources the same way (WaterSense, CEC solar lists, the international recall feeds).

## Current session — 2026-09-30 (afternoon): collector running against production

- **Deploy.** #83 merged as `12007d9`; `Deploy recalls Worker` run #10 green, live version
  `da997b35-bda5-4f4e-9c6d-c67705d94f1f` (rollback `76ed0234-ea9f-4493-9bae-a0a1c5749df6`). Unauthenticated intake
  probe: 401 (open, credential required). API root and product-recall stats: 200.
- **Credentials.** The owner rotated `ADMIN_TOKEN` (Worker secret and `RECALLS_ADMIN_TOKEN`), minted one ingestion
  credential (`owner-windows-collector`, sources `cpsc-recalls`) straight into the collector, and set an Evaluate read key.
- **Defect found and fixed.** The collector sat in `waiting for the local model` for over an hour: Ollama was not
  running. Starting it resumed collection with no restart. `install.ps1` now adds Ollama to the Startup folder.
- **Evidence (production D1, 13:58 UTC).** 6 `extraction_submission` rows, 12 `product_recall_extracted_key` rows, all
  `accepted`; the collector reports 8 notices extracted, 7 skipped, 13 candidates matching agency facts, 6 uploads
  acknowledged, 8.4 s mean extraction latency. Publication stays closed (`EXTRACTED_IDENTIFIERS_OPEN = "0"`).
- **Next.** The Evaluate plan allows 100 requests a month; the full backfill needs Developer or higher. Then review
  `EXTRACTED_IDENTIFIERS_OPEN = "1"` against the stored results.

## Current session — 2026-09-30 (daily dataset scout)

- **Live health.** FDA Recall Intelligence and North American Consumer Product Recalls both synced at 12:18 UTC today; newest records match openFDA (2026-09-23) and the CPSC API (2026-09-24). No regression.
- **Data types added (3, all SCREENED):** `sanctions-designations-global` (OFAC, UN, EU, UK; EU-to-UN cited reference 81/87), `drug-shortages-us-eu` (FDA, EMA; hand-checked candidate join 17/30; no true free-text member yet) and `research-grant-awards-us` (NIH, NSF; UEI 38/40). Fewer than the 5 to 10 target: the others lacked a measured cross-publisher link.
- **Screened, not added:** public tenders (UK Contracts Finder, CanadaBuys), accident reports (MSHA, UK AAIB; NTSB parked), case law (UK Find Case Law; CourtListener parked), airworthiness directives (FAA via Federal Register; EASA parked), food by GTIN (Open Food Facts and USDA FDC parked after 503/429).
- **Widening.** UK OPSS re-measured against CPSC: 0 shared GTINs (155 of 600 OPSS notices carry one), so it cannot join the BUILDING North American dataset yet. Capture check: the whole Health Canada index (34,137 rows) is archived in R2 before filtering; no gap. Gap found for later: the UK OFSI 2022-format ConList.xml is stale (Last-Modified 2026-06-03).
- **Validator.** `source-pipeline.test.ts` now accepts a declared join whose key names a cited reference number or UEI.
- Record: `docs/sources/pipeline/research-2026-09-30.md`; evidence in `evidence/2026-09-30/`. Nothing deployed; no production state changed.

## Current session — 2026-10-01: daily dataset scout (round 4)

- **Live health.** FDA Recall Intelligence: last sync 2026-10-01 12:18Z, newest report date 2026-09-23 on food, drug and
  device, equal to openFDA. North American Consumer Product Recalls: last sync 12:18Z for CPSC and Health Canada, newest
  CPSC notice 2026-09-24, equal to the CPSC Recall API. No regression. Capture check on the recalls Worker: full history
  (openFDA from 2012-06, CPSC from before 2000) and the verbatim record in R2 are already kept; no gap found.
- **Screened (SCREENED, nothing past it).** Six new data types, each with a registered dataset: `aviation-safety-occurrences`,
  `drug-shortage-notices`, `public-procurement-notices`, `workplace-injury-incident-narratives` (mining only; OSHA
  403), `regulatory-enforcement-actions` (hand-checked name candidates only) and `food-and-health-recalls-global`,
  which widens the LIVE `fda-recalls` with UK FSA, Canada non-consumer recalls and FSANZ. `hazard-disaster-events` is
  candidates only (FEMA terms unreadable; no independent join). Several members are PARKED (403, keys, RED terms).
- **Decision for the owner.** Exact-identifier joins (NDC/RxCUI, aircraft registration, Companies House number, MSHA mine
  ID) are recorded as hand-checked `candidate` joins because the test's declared-identifier list does not name them.
  Adding them is a policy change that was not made here.
- **Record.** [research-2026-10-01.md](docs/sources/pipeline/research-2026-10-01.md); evidence in
  `docs/sources/pipeline/evidence/2026-10-01/`.

## Current session — 2026-09-30 (later): ADR-0017 deployed; intake opening

- **Migration `0004` applied to production D1** at 2026-09-30 12:11 UTC. The owner asked for it to be done from this
  session; it went through the connected Cloudflare account, with the same statements as the migration file and a
  `d1_migrations` row, so wrangler sees it as applied. It only adds tables. After it, `d1_migrations` lists
  `0001`–`0004`, the four intake tables exist, and `product_recall` still holds 15,233 rows. Restore point: D1 Time
  Travel to 2026-09-30 12:11 UTC.
- **Deploy.**
  - The first `Deploy recalls Worker` run for `625b07e` stopped at the account check: the `production` secret
    `CLOUDFLARE_ACCOUNT_ID` did not match the recalls account.
  - The owner corrected it, and the re-run went green.
  - Live check: the API root names `registry` keys for both datasets, the intake answers 503 (closed, as committed),
    and the site and stats answer 200.
- **This change** sets `COLLECTOR_INTAKE_OPEN = "1"`. Publication stays closed (`EXTRACTED_IDENTIFIERS_OPEN = "0"`).
- **Next:**
  1. Deploy the merge commit.
  2. `enable-production.sh --finish`: the probe must answer 401, then it mints the credential.
  3. `set-secret.cmd` on the Windows computer: `ingest-token` first, then `read-api-key`.

## Current session — 2026-09-30: Maxun review; sitemap planning and record-selector suggestions

- **Owner direction.** Review `getmaxun/maxun` for anything we can use, then "add anything that would be valuable".
- **Decision** ([record](docs/reference/maxun-review-20260930.md)). Reference only.
  - It is AGPL-3.0 (we are MIT and sell hosted access).
  - It ships stealth, fingerprinting and proxy-rotation tooling, which conflicts with rules 1 and 6.
  - Its combined navigate-and-extract robots and separate platform would duplicate our infrastructure.
  - No Maxun code was copied.
- **Built (pure functions, tested, not yet wired to a runner):**
  - `packages/acquisition/src/policy/sitemap.ts`. The `SITEMAP` method had no parser. This adds a bounded parser
    and a planner that applies result-URL policy, robots and a lastmod cutoff.
  - `packages/extraction/src/record-selector-suggest.ts`. It drafts HTML record selectors for new sources; fixture
    tests are still required.
  - Robots crawl-delay already existed, so nothing was added there.
- **Deferred with a design note:** declarative pagination, and model-proposed field selectors validated against
  fixtures. Neither is needed by any approved source yet.
- **Verification (local, this container):**
  - Passed: `pnpm typecheck`; acquisition and extraction package tests (507/507); `acquisition:check`;
    `ingestion:check` (after regenerating `hvac.ingestion-runtime.json`, whose implementation digest covers the
    new files); `cloudflare:artifacts:check`; `mcp:compile:check`; `web:compile:check`; `migrate:check`;
    `schemas:check`; `openapi:check`; `cloudflare:topology:check`; `verticals:validate`;
    `verticals:compile:check`; `cloudflare:synthetic-ingestion:artifacts:check`.
  - Full suite: 5,193/5,194. The one failure was already on `main`: a `recalls-worker` site test matched
    `2026-09-2\d` against a sync seeded at the current time, so it broke on 2026-09-30. PR #80 fixed the same test
    on `main`, and its version was kept when `main` was merged in.
  - Codex review: three P2 findings, all fixed with tests. `lastmod` values that don't exist on the calendar are
    now rejected, sitemap plans resume from a cursor, and mixed-content text is counted. Hosted CI is green.
  - No production, database or Cloudflare state changed.

## Current session — 2026-09-30: Windows install done; production not yet deployed

- **UA-017 done by the owner.** `install.ps1` ran from `main` under PowerShell 7 with `-SkipSecrets`. The logon task
  is running, the dashboard answers on `127.0.0.1:8765`, and `doctor` passed with the pinned `qwen3.5:4b`. Windows
  PowerShell 5.1 could not find the Python that the installer had just installed. The installer now also looks in
  Python's standard install folders, and never counts the Microsoft Store stub. This was checked under PowerShell 7.4
  with Python only in the per-user folder, only the Store stub on `PATH`, and a normal `PATH`.
- **Production is unchanged**, checked read-only on 2026-09-30:
  - D1 has migrations `0001`–`0003` only;
  - there has been no `Deploy recalls Worker` run since the two token failures of 2026-09-28;
  - the live API root names no dataset `registry`, and `POST /v1/intake/product-recalls/identifiers` answers 405.
- **Consequence.** The installed collector stays idle by design (fail closed) until the deploy is live. The ingestion
  credential cannot be minted until then either.
- **Remaining owner steps, in order.** The gates are committed values in `apps/recalls-worker/wrangler.toml`, so
  each one is a reviewed change deployed by the workflow. `--finish` mints the credential only once the intake answers
  401, not 503.
  1. UA-015: re-save the production `CLOUDFLARE_API_TOKEN` as one line.
  2. `enable-production.sh --migrate`.
  3. A reviewed change sets `COLLECTOR_INTAKE_OPEN = "1"`.
  4. Dispatch `Deploy recalls Worker` for the `main` SHA that contains that change.
  5. `enable-production.sh --finish`: verifies the deploy, probes for 401, then mints the credential.
  6. On the Windows computer: `set-secret.cmd` for `read-api-key` and `ingest-token`.
  7. To publish: a reviewed change sets `EXTRACTED_IDENTIFIERS_OPEN = "1"`, deployed the same way.

## Current session — 2026-09-29: Local Collector review closeout and re-verification

- **PR #75.** It went through 12 more Codex review rounds. Every finding was fixed with a regression test that fails on
  the earlier code. Codex's final review of `0565658` found no issues, and required CI is green on it.
- **Main fixes.**
  - Withdrawals: notice-level holds are durable, and a withdrawn source gets a retryable 503 before anything is
    written.
  - Intake: a failure that wrote nothing releases its reservation.
  - Collector: an upload is acknowledged only by an intake answer that matches it, and an answer longer than 60
    identifiers is quarantined.
  - Long fields are read in overlapping windows and reported as their own unpublished build until they are
    benchmarked.
  - The benchmark report is bound to its gold file and re-scored in CI.
- **Re-verified end to end** on the final head against a full local replica: source → local model → intake →
  authenticated API result, with a 20-minute unattended run
  ([evidence](docs/evidence/local-collector-e2e-20260929.md)).
- **Not live yet.**
  - Production deploy is blocked by UA-015 (the deploy token contains a line break), then the ADR-0017 steps.
  - The Windows install is UA-017.

## Current session — 2026-09-28: Local Collector (local-model extraction through a governed intake)

- **Owner direction.** Set up the Data Foundry Local Collector (goal document of 2026-09-28). Use Ollama with a free
  local model (start with `qwen3.5:4b`), benchmark it, and disable cloud and paid fallbacks. Reuse the existing
  infrastructure, registry, rights controls, parsers and publication path. Mid-session: "This tool will need to be
  able to see what types of data we are hosting on Data Foundry (and refresh as needed) and then seek out and
  capture that data. We can also set it up with any OpenAI free models as needed."
- **Reconciled.**
  - The deployed path for the target dataset is the recalls Worker (D1/R2). The Postgres acquisition and ingestion
    Workers are not deployed, and no intake existed.
  - This session runs in a cloud Linux container (4 vCPU, 15.7 GB RAM, no GPU, Docker daemon unavailable), not on
    the owner's Windows computer, and has no Cloudflare credentials.
  - Production was healthy throughout (CPSC 10,027, Health Canada 5,206, syncs 12:17 UTC).
- **Gap chosen.** 6,698 of 10,027 CPSC notices have no indexed identifier, because the parser reads models only after
  a "model" label. 3,642 of them print labelled item, style, SKU, part or catalog codes.
- **Built** ([ADR-0017](docs/decisions/ADR-0017-local-collector-extraction-intake.md)):
  - `apps/local-collector` (Python stdlib): catalog-driven capture plan, SSRF-guarded fetches, SQLite
    leases/outbox, a local-only Ollama client with a pinned digest, a loopback dashboard, a Windows installer and
    Start/Stop/Status launchers, and a benchmark harness.
  - The recalls Worker intake `POST /v1/intake/product-recalls/identifiers` (migration `0004`, ingestion
    credentials, re-verification against R2 evidence, idempotency, withdrawal). It is served only behind
    `EXTRACTED_IDENTIFIERS_OPEN`, as `extracted_identifiers` and lookup kind `extracted_model`.
  - Shared acceptance rules in `product-recall-structuring` with TS/Python shared vectors.
  - Policy compiled from `candidates.yaml` (`pnpm collector:policy`, checked in CI).
  - The API root now names each dataset's registry key and stats path.
- **Benchmark** ([results](apps/local-collector/benchmark/RESULTS.md)). 130 notices, blind gold labels, 30
  held out. The bar was fixed before the held-out run.
  - Held-out, model plus server checks: precision 38/38 = 1.00 (95% CI 0.91–1.00), recall 0.84, 0/18 negatives with
    a false positive, 0 hallucinated values. **Passes the bar.**
  - Dev: precision 0.96, recall 0.63. The rules alone reached only 0.58 precision on dev.
  - Speed: median 12 s per notice (p95 about 50 s), 6.7 tokens/s on 4 CPU cores.
  - Memory: `llama-server` reached 8.3 GB RSS after 130 notices (prompt cache), so 16 GB of RAM is recommended.
  - `gpt-oss:20b` (OpenAI open-weight, Apache-2.0, 12.9 GB) is supported but not benchmarked: it would not fit
    beside the rest in 15.7 GB.
- **End-to-end on the real Worker locally** ([evidence](docs/evidence/local-collector-e2e-20260928.md)):
  - 16 identifiers accepted; with the gate closed, none were served.
  - With the gate opened, the authenticated lookup of `LDQMFJ8D-BK` returned `cpsc-26794` as `extracted_model`, and
    11 identifiers were read back as queryable.
  - Replay with the same and with new keys created no duplicates.
  - After `kill -9`, the restart resumed with 0 duplicate documents.
  - Source withdrawal, credential revocation and the dataset kill switch were each refused or idled correctly.
- **Unattended run with no lasting local copy** (owner: "Make sure this stays on an autonomous run … without keeping
  it locally after the work is done").
  - Every stop condition now recovers by itself. Notice text exists locally only while queued, and acknowledged
    uploads and final candidates are deleted at once, keeping only counts.
  - `purge` refuses while work is owed, and `--everything` removes the data directory.
    `apps/local-collector/deploy/enable-production.sh` handles the operator steps around the `Deploy recalls Worker`
    workflow. `--migrate` applies `0004` under a bookmark before the deploy, which the workflow requires, and
    `--finish` verifies, mints and probes. It never deploys and does not change the gates, and setting them to `"1"` in `wrangler.toml` was refused by the session's permission
    check as a feature-flag write.
  - A 41-minute unattended run added 84 identifiers at about 125 notices an hour, with 0 outbox rows kept.
  - Purge left no local notice data, and this session's snapshots and local replica were deleted (303 MB to 108 KB).
- **Not done.**
  - Production: migration `0004`, the deploy, a minted credential, and the open gates. The session has no
    Cloudflare credentials. Deploys run only through the owner-dispatched `Deploy recalls Worker` workflow, which
    refuses a pending migration, so `enable-production.sh --migrate` must come first.
  - Installation on the owner's Windows computer (outside this environment).
  - Elapsed multi-day stability.
  - An adapter for the permitted Health Canada member.

## Current session — 2026-09-28 (night): merged, deploy blocked on a malformed secret

- **Merged.**
  - #74 as `9e487ff`: deploy and acceptance workflows, fixture open/close with a 20-minute server-side lease, RapidAPI adapter (closed), `/admin/*` operator endpoints.
  - #76 as `3a256c6`: the migration gate now shows wrangler's error.
  - Required CI was green on the exact heads. Codex found 11 issues on #74 across 7 rounds; all were fixed, and its final review was clean.
- **Deploy dispatched twice** (runs 36473322447 and 36478142394). Both passed the guard, environment release, secret presence, account match, tests and bundle. Both stopped at the first Cloudflare API call: `CLOUDFLARE_API_TOKEN` in the `production` environment contains a line break (`invalid header value`). **Production is unchanged.**
  - The workflows now refuse a whitespace-containing token up front (this PR).
  - Owner action `UA-015`: re-save the token as a single line.
- **Not verified, in order:** deploy, authenticated acceptance of both datasets (needs `UA-016`), then scheduled IndexNow evidence. Full state table: `docs/evidence/recalls-release-20260928.md` §10.

## Current session — 2026-09-28 (late): repeatable deploy and acceptance path, RapidAPI adapter

- **Diagnosis of the rejected key.** The Worker accepts only `rcl_live_` followed by exactly 32 characters (`account.ts:71`). The hand-made keys had 40 and 43, so they were refused before the D1 lookup. Authentication was never broken. Keys are now only issued by the Worker.
- **Built (PR #74, not yet merged or deployed at the time of writing):**
  - `deploy-recalls.yml`: manual, on `main`, pinned to the approved SHA, requires green CI, runs in the `production` environment, records a rollback target, verifies the tag, serialized.
  - `recalls-acceptance.yml` with `scripts/acceptance.ts`: operator reissue, bounded checks on CPSC, Health Canada and FDA, metering, always-revoke.
  - `/admin/revoke-keys` and `/admin/indexnow-status`.
  - A per-feed IndexNow last-run record.
  - The RapidAPI adapter, closed by default, with ADR-0016 and the listing updated.
- **Verified locally:** 100/100 Worker tests, 7/7 workflow tests, a dry-run bundle and OpenAPI lint. Live Stripe prices and webhook were reconciled read-only.
- **Not yet verified:** production deploy, authenticated acceptance, and a scheduled IndexNow run of the product feed. These follow the merge through the two workflows. See `PROJECT_CHECKLIST.md` `UA-015`/`UA-016` for the environment secrets they need.

## Current session — 2026-09-28 (evening): PR #73 release and product-recall acceptance

Full record: [`docs/evidence/recalls-release-20260928.md`](docs/evidence/recalls-release-20260928.md).

- **Source merged.** PR #73 (product-recall IndexNow feed) was squash-merged as `efc1121`, after required CI passed on its exact head `62451d1` and the Codex review came back clean with no open threads. CI was not rerun and no duplicate review was requested.
- **Production deploy: not done.** This cloud session has no Cloudflare token, and the Cloudflare connector cannot deploy. The live bundle (recorded version `40ea452b`) was read through the connector: it has the FDA IndexNow feed but **not** the product-recall feed. The new path is therefore merged but not deployed, and it has never run on schedule. Owner action `UA-015`.
- **Keyless live checks passed** on the current version:
  - public pages, sitemap, `llms.txt`, robots and the IndexNow key file answer 200;
  - data endpoints answer 401 without a key or with a bad key;
  - stats show CPSC 10,027 and Health Canada 5,206 notices with 343 links, and both synced at 12:17 UTC;
  - the live OpenAPI validates with 0 errors.
- **Authenticated product-recall acceptance: not passed.** Following the FDA procedure, an internal customer `acceptance-20260928` and a hashed key were written to production D1. Every authenticated call returned 401 `invalid_key`. The permission check denied reading the key-handling source, so the cause was not diagnosed and no further guesses were made. The key was revoked and the customer canceled (read back, 0 usage rows). The revoked key still returns 401, but because it never authenticated, that proves nothing about revocation. Both product-recall members stay `BUILDING`, and the site sample stays labelled as parser output.
- **Purchase flow.** Read-only Stripe on the live account: the webhook is enabled for 4 events, there are 0 subscriptions, and all 10 live Checkout sessions are unpaid. A live buyer journey has never completed. The only end-to-end proof is the 2026-09-26 sandbox run. There is no revenue.
- **Channels.**
  - RapidAPI: a listing package was prepared ([`rapidapi-recalls-listing.md`](docs/owner-actions/rapidapi-recalls-listing.md)). It is not publishable, because the recalls Worker has no RapidAPI proxy adapter and ADR-0016 leaves the channel not enabled.
  - Pay Per Crawl: unknown. There was no zone-level access this session, and the last check (2026-09-16) found it in closed beta (`UA-008`).
  - Outreach: drafts written, none sent ([`recalls-outreach-drafts.md`](docs/owner-actions/recalls-outreach-drafts.md)).

## Current session — 2026-09-28: daily scout round 4 (partial) — one new composite dataset, seven new source candidates, EU Safety Gate evidence, capture audit

- **Round completeness (honest accounting, per two Codex reviews on PR #72).** This round falls short of two `scout-routine.md` per-run requirements: only 1 new composite data type was added against a 5-10 target (most of the round's time went to fixing nine rounds of real Codex-found defects — three personal-data leaks, one image-rights violation, several measurement bugs — on the work already in progress, which AGENTS.md's evidence/rights rules prioritize over volume), and no new source was added to any LIVE/BUILDING dataset (the EU Safety Gate work below advances evidence for a still-`SCREENED` composite, not a LIVE one). See `research-2026-09-28.md` §6 for the full accounting. Both are legitimate carry-over for the next scheduled run.
- **Health check.** Re-verified both LIVE datasets before any new work: FDA and product-recalls `/stats` both report `last_successful_sync` under 24h old with no regression (food 29,413/drug 17,973/device 39,968; CPSC 10,027 + HC 5,206, 343 links), cross-checked against `api.fda.gov/food/enforcement.json`'s own total. No fix needed.
- **Eight new source candidates screened; two of them (`ntsb-aviation-accidents` + `faa-airworthiness-directives`) reach a conforming composite dataset** (real live HTTP with the declared scout User-Agent; see [`research-2026-09-28.md`](docs/sources/pipeline/research-2026-09-28.md)), into categories that were previously absent or nearly absent (`agriculture` and `labor` had zero entries; `environment` had zero; `transport`/`regulatory`/`finance` had 1-2). A Codex review on PR #72 correctly rejected the earlier framing of these eight as "six new data types": this pipeline defines a data type as a composite `datasets:` entry with at least two independently-published member sources (README.md), and only one composite resulted this round — the other six candidates are standalone single-source feeds (three screened, three parked), which is real breadth but not a new data type each:
  - **`aviation-safety-events`** (new composite, `transport`, the round's one new data type): entity is the aircraft model itself (make + model designation), not "one NTSB accident or FAA action" as an earlier draft defined it — a Codex review on PR #72 correctly rejected that framing, since an accident and a regulatory action are different entity types, not one entity from two sources. Members: `ntsb-aviation-accidents` (NTSB monthly eADMSPUB extract, real `.mdb` opened with mdbtools, 163 aircraft rows, 58 free-text narratives, events spanning 2008-01-30 to 2026-07-29 once `ev_date` is actually date-parsed rather than string-sorted — a Codex review caught the earlier string-sort bug; the table's real owner/operator names and street addresses are personal data and are not committed to git) contributes which models appeared in investigated accidents, `faa-airworthiness-directives` (Federal Register API, 10,000+ FAA-agency documents) contributes which models have been named in a published airworthiness or special-conditions filing (named in, not verified still in effect — a Codex review flagged "current action" as overclaiming this before it was reworded). Both members are `format: free-text`: a Codex review caught an earlier draft mislabeling `faa-airworthiness-directives` `structured`, when the model-applicability fact this composite actually uses is text-matched from its free-text title/abstract, not a typed field (the same reasoning that already makes JSON-API `cpsc-recalls` free-text); the composite therefore has no structured member yet and cannot reach `EVIDENCED` until one is added. No declared identifier links an accident to a directive (N-number vs. aircraft type), so joined on aircraft make/model as a hand-reviewed `candidate` link only: models confirmed (Textron 560XL, Robinson R44, Cessna 182, Airbus A319-114 — the same Codex review caught that an earlier draft only checked the first Federal Register result and missed the A319-114 match further down the page) — a 5-record reviewed sample, not a population-level rate. A further Codex review found that check itself was still incomplete: all five Federal Register queries were fetched at the API's default 3-results-per-page size while `next_page_url` remained set (890 total for the Boeing query alone), so the Boeing non-match was an artifact of pagination, not a searched negative. All five queries were re-fetched in full (`per_page=1000`, no page left unread), and the script now also runs a live site-wide confirmatory search whenever a query shows no match. A further review then found the Boeing verdict was wrong on its merits, not just its search coverage: "737-7CT" is a Boeing customer code (airline-specific), not a model series — FAA directives name the series (737-700) the customer code's leading digit denotes, never the customer code — so the join now also checks the base series and Boeing flips from a non-match to a match (document 2025-20951 names "737-700" exactly). `reviewed: { correct: 5, checked: 5 }`, was 4/5.
  - **`federal-contract-awards`** (`regulatory`, standalone): USASpending.gov `spending_by_award`, real contract data; a UEI is reachable via a second live call (`/api/v2/recipient/duns/<recipient_id>/`), not present on the award record itself — an earlier draft wrongly called `recipient_id` "UEI-derived", a Codex finding this session corrected.
  - **`epa-echo-facility-compliance`** (`environment`, standalone): EPA ECHO, real facility/enforcement counts.
  - **`fdic-bank-failures`** (`finance`, standalone): FDIC BankFind, 4,117 failures + 4,231 active institutions since 1934.
  - **Parked with concrete reasons** (still counted as screened): `sam-entity-exclusions` (api.sam.gov requires a registered key; `DEMO_KEY` → 404), `usda-nass-quickstats` (requires a registered key; `DEMO_KEY` → 401), `bls-local-area-unemployment` (shared unauthenticated quota already exhausted). FINRA BrokerCheck was checked live (200, real broker records) but not used: private SRO, terms unreadable from this egress, and no overlapping entity population with `fdic-bank-failures`.
- **Evidence toward widening `home-product-recalls-global`** (a `SCREENED`-stage composite, not yet LIVE/BUILDING — this does not satisfy the run's per-round LIVE/BUILDING-widening requirement; a Codex review on PR #72 correctly caught an earlier framing here that implied it did): re-screened `eu-safety-gate-alerts` with 223 fresh live notification samples (3 current weekly reports) and two fresh cross-source measurements against live CPSC data (10,027+ notices, most recent `RecallDate` 2026-09-24): declared GTIN join 0/151 (canonical GTIN-14 readings on both sides, ported from the production `gtinReadings`/`gtin14` helpers — three Codex rounds caught first an earlier version comparing raw digit strings and silently dropping the 8 EU records whose barcode field concatenates multiple codes, then that the tokenizer's fix still fused single-space-delimited codes because it was missing the production `digitCodes` regex's third split alternative, then that 12 more records concatenate valid codes with no separator at all — now recovered by a uniqueness-gated decomposition, only accepted when exactly one valid partition exists) — CPSC's real UPC field is `ProductUPCs[].UPC` (40 of 1,184 live recalls carry a GS1-valid one, 170 distinct codes), not `Products[].UPC` as an earlier draft of this script checked; a Codex review on PR #72 caught that field-name bug before merge, so the join result stands (this sample just shares no barcode with those 40) but the "CPSC exposes no UPC data" framing was wrong and is corrected. Hand-reviewed candidate brand-token join 15/223 measured (was 13/223: a Codex review found multi-brand fields like "Hua Sheng Toys, Torch" were searched as one phrase and never matched; brand fields are now split on comma/slash), `reviewed: {correct: 1, checked: 7}` (Husqvarna confirmed on overlapping model codes; a second Codex finding on the same PR correctly rejected the initial "Shein" match, since sharing a distributor between two unrelated recalled products — a cushion cover and a teething toy — isn't a product-level match for this dataset's entity; Seven/Allegro/Best/Torch and the newly-surfaced second Torch record are coincidental word matches). Stage kept at `SCREENED`, not bumped to `EVIDENCED`: this session's own `wrangler r2 object put` was refused by the permission classifier ("Modify Shared Resources"), but a later session on the same PR archived the round's raw inputs to R2 successfully (bucket `data-foundry-raw-artifacts`, key `research/pipeline/2026-09-28/archive/evidence-2026-09-28-raw.tar.gz`, sha256 `683b0b3e0d47f881007b2b9b84a4f3858b6832f5a15bc63606dfad265b916b30`, independently re-verified, see the archive-rebuild note below) — so the refusal was scoped to one session, not a standing block. The remaining gap is a conforming `inputs.json`/`samples.json` evidence package against that archive, which the next session can write without repeating the live fetches.
- **Second personal-data removal, and an archive rebuild.** A Codex review on PR #72 found `aviation/raw/narratives.csv` (committed as harmless free text) also identifies people even with the earlier `aircraft.csv` fix applied: its autopsy/toxicology/disease-history findings, combined with the same row's NTSB event ID, tail number, exact date and location, are enough to re-identify a specific person. Removed from git (`NOTE-narratives.md`, same pattern as `NOTE-aircraft.md`); `parse_ntsb_month.py` only reads its row count, so no fixture is needed. A second Codex finding on the same review found the R2 archive itself had gone stale: it still held the original 3-results-per-page Federal Register JSON snapshot, not the complete `per_page=1000` files the published 5/5 result now depends on, so replaying `model_candidate_join.py` from the archived copies would fail its own new pagination assertions. The tarball at the same key was rebuilt with `narratives.csv` and the current, complete Federal Register JSON, and re-verified round-trip (new sha256 above; full manifest in `../../archive/ARCHIVE.txt`).
- **A third personal-data removal, a code-correctness fix, and a scope-of-claim correction.** A Codex review found `aviation/raw/events.csv` also identifies people, without needing name/address fields: its exact date, time, ZIP code, coordinates, fatality count, NTSB event ID and internal `lchg_userid` together pinpoint a specific fatal accident. Removed from git (`NOTE-events.md`); its content was unchanged from the original R2 upload, so no archive rebuild was needed this time. A second finding on the same review caught a real bug in the Boeing customer-code fix: it had no manufacturer check, so the same digit-plus-two-character suffix shape would misfire on non-Boeing designations in the same 163-row sample (e.g. `SCHWEIZER SGS 2-33A`, `ENSTROM F-28F`, `Bell OH-58A`) that are not Boeing customer codes at all — `model_matches` now takes the record's `make` and only applies the series-normalization rule for Boeing (verdict unchanged at 5/5, since none of the other four checks trigger this rule). A third finding correctly pointed out that the `5/5` figure only shows a model was *named* in a Federal Register result, never that the specific action is still in effect (not later superseded, rescinded or corrected) — `candidates.yaml`'s `agent_questions` and `join_keys.measured` are reworded to stop implying "currently subject to."
- **A fourth personal-data leftover, a narrative-coverage bug, and a real image-rights violation.** A Codex review found the "currently subject to" wording above hadn't been fully swept: this document and `candidates.yaml`'s composite description still called the FAA filings "current"/"open" actions in a couple of spots, now reworded. A second finding caught `parse_ntsb_month.py` reporting the 58 NTSB narrative rows as covering "the same 163 events" — 163 is the aircraft-row count, not the event count (157, since one event can involve multiple aircraft); the script and `results/ntsb_extraction_rates.txt` are corrected. The most significant finding: the three EU Safety Gate `detail_*.xml` fixtures committed this round still carried every `<pictures>` image-URL block from the live fetch (40, 97 and 86 blocks respectively) — `eu-safety-gate-alerts`'s own recorded rights condition in `candidates.yaml` says not to republish those URLs (AGENTS.md rule 9, image rights). Every `<pictures>` block is now stripped from the three committed files (`NOTE-images.md`); the unredacted originals stay in R2 (already archived, no rebuild needed), and re-running `parse_weekly_reports.py` against the redacted files reproduces the exact same `eu_records_sample.json` and extraction rates, confirming no field the pipeline actually reads was affected.
- **Capture-completeness audit (CPSC + Health Canada, the two LIVE recall-Worker members).** Read `apps/recalls-worker/src/product-sync.ts` and `packages/product-recall-structuring/src/cpsc.ts`: CPSC is read in `RecallDate` windows from 1900 to the present (full history, not just recent), Health Canada's full open-data index is read whole, raw bytes are archived to R2 before parsing, and the only two omitted fields (`ConsumerContact`, `Images`) are deliberate rule-8/rule-9 exclusions, not a capture gap. No code change needed; no gap found.
- **Verification.** `npx vitest run tooling/test/source-pipeline.test.ts` — 1117/1117 passed (`pnpm install --frozen-lockfile` first; node_modules were not present at session start).
- **Not done.** No candidate's `stage` advanced past `SCREENED` this round (the R2-write block above applies to every EVIDENCED-or-later stage transition, not just EU Safety Gate); no rights record was written this round for the same reason (ADR-0013 rights records for NTSB/Federal Register content also await a readable terms citation, separately from the R2 block). Per the round-completeness bullet above: only 1 of the 5-10 target new data types was added, and no new source was added to a LIVE/BUILDING dataset — both explicit carry-over for the next scheduled run.

## Current session — 2026-09-28 (continued): production and revenue-readiness check

- **Owner direction.** "Make sure this is fully deployed to production and everything is done that is needed to start earning revenue."
- **Live state, verified read-only (13:30–13:50 UTC).**
  - Every public page answers 200 on `data.aroqon.com` (home, `/recalls`, `/product-recalls`, `/docs`, terms, privacy, `llms` files, sitemaps, a recall page); `/recalls/docs` answers 301. Data endpoints answer 401 without a key. The deployed Worker is still `40ea452b` (PR #69); `main` has only docs since.
  - Scheduled syncs: every run through 12:17 UTC today succeeded (FDA food/drug/device recent and history windows, CPSC recent, Health Canada full index).
  - Stripe live (`acct_1U3gItLlvU3ZaHdi`): the four plan prices are active and the webhook `we_1UK1TtLlvU3ZaHdiy7KqSNdW` (`https://data.aroqon.com/stripe/webhook`) is enabled; the route answers 405 to GET. Every live Checkout Session so far is an internal verification probe; none completed.
  - D1: no customers besides the canceled acceptance customer. **Revenue has not started: sales are open but no one has bought.**
- **Fixed: product-recall pages were never announced to IndexNow.** The pinger only covered `/recalls/…`. It now takes a per-dataset feed with its own watermark, and the product-recall feed runs while that dataset is served, independently of FDA's kill switch (ADR-0016). Two new tests fail against the previous source and pass now; recalls-worker 88/88, repo typecheck clean. The 8,868 indexable product pages were submitted to IndexNow by hand (HTTP 200). **The code change needs a `wrangler deploy` of `data-foundry-recalls` after merge**; this session has no Cloudflare token.
- **Still not done: authenticated acceptance of product recalls.** Creating a production acceptance key, and even posting to the live checkout, were refused again by this session's permission check. Any session permitted those writes can run them (procedure: the 2026-09-26 FDA acceptance below), then revoke the key.

## Current session — 2026-09-27/28 (continued): second dataset, website, daily scout — deployed

- **Owner direction.** "Continue to add data types and ship to production."
- **Dataset.** `consumer-product-recalls-north-america` (ADR-0016), the first shippable slice of the round-3 recall composite.
  - Members: CPSC (US Government work, free text) and Health Canada's consumer-product index (OGL-Canada, structured).
  - Linking: a CPSC notice is linked to a Health Canada notice only where it cites the notice's URL (declared; 342 recalls). Health Canada's joint marker stays a candidate.
  - Rights records and prototypes (0 errors over 10,027 + 5,206 notices) are committed. Evidence round `2026-09-27` gains `hc_assess.py`, with its input in `inputs-r2.tar.gz` in R2.
- **Build.** On the recalls Worker, with the existing keys and plans (no repricing):
  - `packages/product-recall-structuring`, migration `0003`, a six-hourly sync with a daily full CPSC read;
  - `/v1/product-recalls` API (lookup by model or UPC, filters, verified raw evidence with contact text removed);
  - `/product-recalls` pages, sitemap shards, llms.txt/OpenAPI entries;
  - `PRODUCT_RECALLS_OPEN` and `PRODUCT_RECALLS_KILL_SWITCH` gates;
  - `tooling/scripts/product-recalls-bulk-load.ts`.
- **Also shipped in #69.**
  - **Website** (owner task "Build the Data Foundry landing page and dataset catalog"). A server-rendered homepage with a list catalog of the published datasets: tags, live record counts, sources and last successful refresh. One product-page template serves `/recalls` and `/product-recalls`. `/docs` is canonical, with endpoint anchors, and `/recalls/docs` now answers 301. Checkout renders only while `SALES_OPEN=1`, and there is no marketplace button.
  - **Gates.** A withdrawn dataset disappears from the catalog, JSON-LD, sitemap, `llms` files, docs, OpenAPI and the API root, all sent `no-cache`.
  - **Daily scout.** The routine `trig_01W3FJssxnuYT3h3RVWsHZyu` now runs daily with a target of 5 to 10 new data types, adds member sources to live datasets and checks full-history capture. `AGENTS.md` records the owner's source-breadth and capture direction.
  - **Review.** Nine Codex rounds, all findings fixed. Among them:
    - whole source responses archived in R2 before parsing;
    - bounded memory for the full CPSC read;
    - freshness published only after a complete pass;
    - parser @2 (UPC-E/EAN-8, structured model fields);
    - bounded lookups;
    - gate-consistent discovery;
    - honest `include=raw` digests.
- **Merged and deployed 2026-09-28.**
  - #69 was squash-merged as `6520d5a`, with CI green on `7f02951` and Codex clean.
  - It was deployed as Worker version `40ea452b-1b4a-41c9-931b-82719b1dc7cd`; the previous version was `00d362e1`.
  - No migrations were pending, and `PRODUCT_RECALLS_OPEN="1"`, `SALES_OPEN="1"`.
  - The bulk load's complete inputs were archived in R2 (CPSC `sha256-864f678c…`, Health Canada `sha256-9879b641…`) and verified by read-back.
- **Live verification.**
  - Every public page, sitemap and `llms` file answers 200, `/recalls/docs` answers 301, and gated responses are sent `no-cache`.
  - The catalog shows FDA 87,354 and product recalls 15,233 records, with no RapidAPI button and JSON-LD listing both datasets.
  - The API root and OpenAPI list both datasets. Data endpoints answer 401 without a valid key.
  - Checkout for `evaluate` and `developer` answers 303 to `cs_live` sessions. The webhook answers 405 to GET and 400 to an unsigned POST.
- **First scheduled sync (00:17 UTC).**
  - CPSC: a full pass in 29 windows plus one `product:CPSC` run, 10,027 notices rewritten under `product-recall-structuring@2`.
  - Health Canada: 5,206 notices rewritten.
  - 0 failures, 343 declared links. FDA synced normally.
  - The public freshness now reads CPSC 00:19 UTC and Health Canada 00:20 UTC.
- **Not done: authenticated acceptance.** Creating an internal acceptance customer and key in production was refused by this session's permission check (an environment boundary on production writes, not a product decision; any session permitted that write can run the checks and revoke the key). The authenticated checks (lookup, filters, `include=raw` digests) and a completed $0 Evaluate checkout have therefore not been run. The registry keeps the dataset at `BUILDING` until they pass. The product-recalls sample on the site is labelled as parser output until a live response replaces it.

## Current session — 2026-09-27 (continued): composite datasets, and discoverability live

- **Owner direction.** "We need to make sure our datasets are aggregates of several different sources of data. Find all related data (including unstructured) and structure it for our purposes. Classify and organize accordingly."
- **Composite model.** `candidates.yaml` now has a `datasets:` section: one entity type per dataset, member sources, join keys with measured match rates, taxonomy and agent questions. `tooling/test/source-pipeline.test.ts` requires ≥2 members from different hosts, no RED member, ≥1 measured cross-source join, and dataset membership for any source past PROTOTYPED. The direction is recorded in AGENTS.md.
- **Round 3** ([`research-2026-09-27-composites.md`](docs/sources/pipeline/research-2026-09-27-composites.md)): four composites — recalls (31/35; Health Canada ↔ CPSC joint marker proposes 341/352 review candidates, 25/25 correct; SaferProducts bulk export found), equipment models (29; US/Canada overlap, AU/EU are separate partitions), building-envelope approvals (27; 6/19 cited Miami-Dade NOAs past expiry), licensed contractor businesses (26; business entities only). 40 new sources; EPREL re-read and kept parked (its terms forbid aggregating). One redirect reached a prohibited host during research (one GET, discarded unread); the CEE directory and the UK MCS site are now prohibited (see docs/sources/prohibited-sources.md).
- **Discoverability live.** PR #67 merged (`35118fe`) and deployed (version `00d362e1`); live checks passed and all 84,908 indexable recall URLs were submitted to IndexNow.

## Current session — 2026-09-27 (continued): service trades, and search/LLM discoverability

- **Owner direction.** "The next 5 data sets should be something nongovernmental … service based. HVAC, Plumbing, Electric, Roofing, and Appliance. We build those out. Also need a way to SEO and make data show up for LLMs."
- **Redirect.** Prototypes for the round-1 government candidates (CPSC, ClinicalTrials.gov, Federal Register, drug labels, SEC 8-K) were stopped mid-work and not committed; their empty parser scaffolds were removed. Round-1 candidates keep their stages.
- **Service-trade research** ([`research-2026-09-27-service-trades.md`](docs/sources/pipeline/research-2026-09-27-service-trades.md)): 61 candidates across the five trades, verbatim terms, measured samples. Finding: every nongovernmental trade source with rich data (IAPMO, ASSE, NSF, UL, DLC, CRRC, ICC-ES, FM RoofNav, iFixit, manufacturer manuals/warranties, parts sites) is RED for a commercial data product. What passes is manufacturer-filed data on public hosts. First dataset per trade: appliance recall model index (GREEN, 32), HVAC ENERGY STAR matched systems (AMBER, 29), plumbing WaterSense products (AMBER, 28), electrical CEC solar equipment lists (AMBER, 28), roofing Miami-Dade NOAs (AMBER, 26). Active build order: `cpsc-recalls` with trade facets, then HVAC, plumbing, roofing, electrical. Goodman Manufacturing's site (Daikin-owned) added to the prohibited-source list. The weekly scout routine's prompt was updated to the new build order (claude.ai and `scout-routine.md`).
- **Discoverability** (recall Worker; ADR-0015 "Discoverability"): a public page per recall (`/recalls/<recall_number>`) with JSON-LD, `noindex, follow` year hubs, a sitemap index over 20,000-URL files, `DataCatalog`/`Dataset` JSON-LD, `/llms.txt` and `/llms-full.txt`, `robots.txt` with Content-Signal, and IndexNow pings after each sync. Thin records (no product or reason text of 20+ characters) are noindex and out of the sitemaps. Cloudflare's AI-crawler blocking on the zone was checked: disabled. Deployment and live verification: see the PR.

## Current session — 2026-09-27 (continued): dataset expansion pipeline, research round 1

- **Owner direction.** Keep expanding data types and databases, categorise them,
  automate it, and prioritise unstructured data that is most useful to AI agents.
- **Pipeline.** `docs/sources/pipeline/`:
  - `README.md` sets out the stages, the rights gate, the scoring and the weekly run.
  - `candidates.yaml` is the registry, validated by `tooling/test/source-pipeline.test.ts`.
  - `research-2026-09-27.md` is the round-1 evidence.
- **Round 1 result.** Evidenced against live sources:
  - ClinicalTrials.gov eligibility: 27/35, AMBER with satisfiable conditions. Next
    new data type.
  - CPSC recalls: GREEN; the model/UPC/lot codes are only in prose. Quick
    expansion of the live recall API.
  - Federal Register + eCFR: GREEN; compliance-date and stay chains exist only in
    prose.
  - Drug label facts: AMBER; sponsor copyright blocks verbatim text.
  - SEC 8-K: GREEN, but there is an incumbent.
  - NVD/KEV: parked, because CNA data already fills 92% of the backlog.
- **Environment.** NHTSA is now reachable. The NHTSA flat file moved to
  `FLAT_RCL_POST_2010.zip`. FSIS is still blocked by Akamai from this egress.

## Current session — 2026-09-26/27: FDA Recall Intelligence merged, loaded, deployed, accepted; sales opened

**2026-09-27 launch.** The Product Owner confirmed the legal seller and the support
inbox (`data@mail.proviciency.com`) and instructed go-live. Commit `de305d5`
(PR #64, CI green) with `SALES_OPEN="1"` is deployed to `data-foundry-recalls` as
version `de43507f-c4f8-4d11-bee6-f8fa3c252d8c` (both Custom Domains and the
`17 */6 * * *` schedule unchanged). Live verification: `POST /recalls/checkout`
returns 303 to a live `checkout.stripe.com` session for both the Developer and
Evaluate plans (sessions left unpaid to expire), and the landing page renders the
checkout forms without the "opening shortly" notice. `UA-014` (update the Worker
secret after the owner rotates the Stripe key) remains open. No paid request yet.

**Verdict at the 2026-09-26 closeout (superseded by the launch above): technically ready for launch; public sales remained closed (`SALES_OPEN="0"`)
until the Product Owner's separate launch instruction. PR #59 merged as `449b3f6`
(CI green on the PR head `0900c6d` and on `main`); Worker version
`b51ac2ee-941b-41df-bac3-6045780c5897` is live with the six-hourly cron restored;
the dataset is reconciled to the openFDA source; hosted acceptance and the
sandbox customer flows pass. Remaining items are owner confirmations (legal
seller, support inbox, key rotation) and the launch instruction. No revenue yet.
The HVAC track and the hosted Postgres baseline are unchanged.**

- **Owner direction.**
  - First message: approve any dataset whose restrictions can be ruled out, with
    the value in structuring unstructured data. Accept the pricing sheet.
    Approve launch. Support contact `data@mail.proviciency.com`.
  - Second message: approve D1/R2 as the interim architecture and monthly
    Stripe self-service billing on the four-tier catalog. Scoped authorization
    of D1 migration `0002` and the initial import, with pre-checks. Keep sales
    closed. Stripe verification, legal seller and support inbox stay with the
    owner.
- **Dataset.** openFDA enforcement reports, CC0 ([rights record](docs/sources/openfda-enforcement-rights-record-20260926.md),
  which lists every redistributed field). Reports run from 2012-06-20 to
  2026-09-16. See [ADR-0015](docs/decisions/ADR-0015-first-paid-dataset-fda-recalls-on-d1.md).
- **D1 load, `UA-012` (completed under the scoped authorization).**
  - Pre-checks: correct account and DB `84acdedd…`; only `0001` applied; every
    table at 0 rows, so dropping `raw` destroyed nothing.
  - Time Travel bookmark `00000005-00000000-000050f2-13d6c05b98708cefcb053cdd157124ba`.
  - Cron paused; the 13 R2 bundle ETags equal the local MD5s.
  - `0002` applied. One part failed atomically on the placeholder recall number
    `N/A`, which collides across categories. It was root-caused and fixed in
    code, and the single `N/A` row removed.
  - Reconciled exactly: 87,354 recalls, 87,354 FTS rows, 10,748,197 keys;
    0 FTS/rowid mismatches and 0 orphan keys.
- **Reviews.** An independent reviewer (two rounds) and Codex (four rounds)
  found real defects. All are fixed with regression tests, and every thread is
  answered and resolved. The most material ones:
  - code lists truncated at 600 characters;
  - non-atomic sync writes;
  - "not nationwide" read as nationwide;
  - a stricter state rule that briefly dropped about 8,200 real state codes;
  - compact lot codes (`MAY1613`) stripped as dates;
  - placeholder and duplicate records missing from evidence;
  - a free-key race;
  - non-atomic key rotation.
- **Parser v2 re-import (after the merge, owner-approved).** Bookmark
  `00000009-00000000-000050f2-77dfa2fcc344adad0a2eb4bbaf18986b`; cron still
  paused; 0 customers. The load, regenerated with the merged parser, touches
  only `recall`, `recall_fts` and `recall_key` (in-place upserts). Its 13
  evidence bundles are byte-identical to the objects under
  `recalls/openfda/bulk/2026-09-26-r2/` (ETags verified). Reconciled: 87,354
  recalls, all `recall-structuring@2`; 87,354 FTS rows, 0 missing; 10,763,121
  keys, 0 orphans; every `raw_ref` under the `-r2` prefix.
- **Source reconciliation.** openFDA totals on 2026-09-26: food 29,415, drug
  17,975, device 39,969 (87,359), latest report 2026-09-16 in each, matching
  the snapshot. D1 holds 29,413 / 17,973 / 39,968: the 5 records with placeholder
  or duplicate recall numbers are kept as evidence, not published. Catch-up sync
  (2026-08-27..2026-09-26, per category) fetched 47 / 58 / 134, inserted 0,
  changed 0.
- **Deploy.** `449b3f6` deployed to `data-foundry-recalls` (version
  `b51ac2ee-941b-41df-bac3-6045780c5897`), custom domains `data.aroqon.com`
  and `api.data.aroqon.com`, schedule `17 */6 * * *` restored, `SALES_OPEN="0"`
  (superseded on 2026-09-27 by version `de43507f-c4f8-4d11-bee6-f8fa3c252d8c` with
  `SALES_OPEN="1"`).
- **Hosted acceptance (production, internal key revoked afterwards).** 401 for
  a missing or bad key; representative food (listeria + TX, peanut allergen),
  drug (class I), device (software) and full-text queries 200; known codes
  NDC `0409-6729-41` → D-1390-2012, UDI `00885403167839` → Z-1927-2012 and lot
  `MAY1613` → F-1632-2012 all found; raw evidence for all three served from its
  R2 range with a matching SHA-256; hard stop 200 at request 5,000 and 429
  `allowance_exhausted` at 5,001; operator lost-key reissue revoked the old key
  (401) and issued a working one (200); checkout 503 while closed; public pages
  200. The acceptance customer `acceptance-20260926` is `canceled` and its keys
  are revoked. Public coverage ("from June 2012", ~87,000 recalls) and
  freshness ("we check openFDA every six hours") match the data.
- **Customer flows.** Re-run on the final code (`0900c6d`) and passing. Tested in the isolated Stripe sandbox (test key, separate
  account) against the real Worker code, with no production secrets involved:
  - real Checkout for the $49 and $0 plans, with the key shown once;
  - 401 without a key or with a bad key;
  - quota hard stop at request 101 (429);
  - real test events relayed and signed, checkout and subscription created;
  - plan change Developer → Growth, taking the allowance to 25,000;
  - key rotation and operator lost-key reissue;
  - cancellation (403), with duplicate events handled idempotently;
  - billing portal session created.
- **Owner actions.**
  - `UA-013`: resolved — live account `acct_1U3gItLlvU3ZaHdi` now reports
    `charges_enabled` and `payouts_enabled` true with nothing currently due.
  - `UA-014`: after rotating the Stripe key, update the Worker secret.
  - The Stripe account is an individual account with statement descriptor
    "ADAM THOMPSON" and no support email set; the owner confirms the legal
    seller and support inbox.
  - Legal seller and support inbox: confirmed by the owner 2026-09-27.
  - Launch instruction: given 2026-09-27; `SALES_OPEN="1"`.

## Earlier session — 2026-09-26 (PR #57, merged to `main`): rights rule changed, self-service billing built, paid path blocked on environment access

**Verdict: the paid-API machinery is now complete in code, but the platform is NOT earning revenue yet.** No
real dataset is loaded, nothing new is deployed, and Stripe is test-mode only.

- **Owner decisions (2026-09-26).**
  - First paid dataset: US vehicle data (NHTSA vPIC + Recalls + EPA fuel economy).
  - Rights: a named human reviewer is no longer required; a logical, evidence-based determination suffices
    ([ADR-0013](docs/decisions/ADR-0013-evidence-based-rights-determination.md)).
  - Payment: Stripe self-service and RapidAPI.
  - Public cutover: authorized once checks pass.
- **Done (PR #57, branch `claude/data-foundry-api-monetization-8dleew`).**
  1. ADR-0013 and migration `0034`: a `DETERMINATION` reviewer type is accepted by the resolver and the
     database guards. `AUTOMATED` still cannot activate permission; deny exceptions stay human/counsel only.
  2. ADR-0014 and migration `0035`: self-service Stripe billing on the edge (`/v1/billing/...`); the
     one-time key claim; signed, idempotent webhooks; the monthly allowance hard stop (`429`). df_edge and
     df_usage gain narrow grants (313 grants, 60 functions).
  3. Stripe sandbox product `prod_VKbcy7DLL3iNSH` with Developer/Growth/Scale prices
     (`docs/owner-actions/stripe-billing-setup.md`).
- **Also done (same PR, later in the session).**
  - `pnpm rights:record` (`tooling/scripts/record-rights-determination.ts`) is the first production writer
    of rights decisions. It records a committed ADR-0013 determination file into the rights matrix as
    `DETERMINATION`; it is idempotent, supersedes correctly and has 14 tests.
  - Entity-resolution blocking is now declared per vertical in `vertical.yaml` instead of hard-coded to
    HVAC. HVAC output is unchanged. A vehicles-shaped integration test and a validator test are included.
  - Hosted CI was green on `14a0fd6`. The local full suite on `45b3e7d` passed 3,652/3,652.
- **Later the same day: vehicles, checkout, routing and deploy tooling.**
  - `verticals/vehicles` (DRAFT) was added: make, model year, EPA configuration and NHTSA recall campaign,
    with composite CSV keys and a configurable publisher entity type.
    - Its sources are fail-closed (UNDER_REVIEW, UNREVIEWED, no acquisition targets).
    - Its fixtures are SYNTHETIC SHAPE FIXTURES. Every unverified column and format assumption is listed in
      `verticals/vehicles/SOURCES.md`.
  - The web pricing page gets a direct Stripe "Subscribe" form via `product.yaml` `direct_checkout`. It
    stays off while prelaunch.
  - Canonical `api.data.aroqon.com/v1/<slug>` routing is in place: an edge `API_PATH_PREFIX`, per-vertical
    edge topology checks, the `apps/edge/wrangler.vehicles.toml` template, a manifest renderer and a
    manual-only, main-only `.github/workflows/deploy-production.yml`.
  - Conversion-first choices, delegated by the owner: RapidAPI lead channel, free + $9 Starter entry tiers,
    VIN-recall headline (`docs/commercial-validation/conversion-first-decision-20260926.md`).
  - The local full suite on the merged head passed 3,785/3,785. The artifacts check builds 13 core
    artifacts plus the vehicles edge.
- **Final additions (same PR).**
  - ZIP member extraction with strict limits, plus the operator bulk-load path
    (`pnpm ingest --artifact … --evidence-dir …`).
  - A generic `where` row filter; vehicles keeps only `RCLTYPECD = V` rows, and that code set is
    unverified.
  - `credentials:provision` works for per-vertical edges, with a copy-ready RapidAPI listing
    (`docs/owner-actions/rapidapi-vehicles-listing.md`).
  - The OpenAPI generator publishes per-vertical edge contracts under `/v1/<slug>`.
  - The ordered path to the first paid request is `docs/owner-actions/launch-runbook.md`.
  - Head `608c1bb`: hosted CI green; local full suite 3,883/3,883 and all 12 check scripts pass.
- **Verification.**
  - `pnpm test` passed 3,620/3,620.
  - `typecheck` and every CI compile/topology/artifact check passed.
  - A local native-PostgreSQL-16 port of the CI `migrations-postgres` job passed: 35/35 ledger, twice
    idempotent; 0 missing/unexpected grants; 0 function/search-path drift; 0 `SECURITY DEFINER`. The
    runtime-role, ingestion, source-record, credential and acquisition Postgres checks all passed.
- **Correction.** The ingestion runtime digest covers `db/migrations` and the rights-engine sources, so the
  first pushed commit (`acb542e`) carried a stale `hvac.ingestion-runtime.json`. The billing commit
  regenerates it.
- **Blocked (environment).** The network policy denies every vehicle source host, and WebFetch is blocked
  too. No Cloudflare deploy token is present. Real fixtures, the rights determination text, the data load
  and all deploys wait on `UA-009`. Live payments wait on `UA-010`.
- **Next session (with UA-009 done), in order.**
  1. Capture NHTSA/EPA terms and sample artifacts, then write
     `docs/sources/vehicles-federal-rights-determination-*.md`.
  2. Build `verticals/vehicles`.
     - Candidate entities: model-year vehicle (make/model/year), EPA vehicle configuration (`epa_vehicle_id`)
       and NHTSA recall campaign (`nhtsa_campaign_number`).
     - Sources: the EPA `vehicles.csv` bulk file and the NHTSA recall flat file.
     - The scheduled ingestion limits (1,000 records, 1 MiB per artifact, one target per source) cannot take
       those files whole. Load the initial snapshot through the offline `pnpm ingest` path
       (`maxRecords` 100k), and design partitioned refresh separately.
     - The query/blocking code still hard-codes HVAC's resolution blocking
       (`services/ingest-worker/src/resolution.ts`).
  3. Record rights cells via a determination recorder (no production writer exists yet).
  4. Apply `0034`/`0035` to hosted Supabase through the controlled path, deploy, then route
     `api.data.aroqon.com`.
  5. Run the test-mode purchase, then go live once `UA-010` is done.
- **Production changed by this session:** no hosted database, Cloudflare or DNS change. Stripe sandbox
  objects were created (test mode only).

## Current session — 2026-09-18 (second session): UA-002 hosted execution independently reconciled and closed

**Verdict: UA-002 COMPLETE. BETA-002 DONE. Private-canary success only — not
production, not public cutover, not source activation, not commercial launch.**

- **Current state.** Protected `main` `55804842f5c5131640dd0435c7d203a66e95b63c` (hosted CI run
  35291689381 green). Lifecycle stage: MVP integrated / private canary passed /
  pre-production. Control-graph node: `State changed → refresh baseline →
  invalidate only affected evidence → rerun affected gates → continue`; this
  session was the refresh. Current milestone: still "integrate and deploy the
  first lawful, revenue-capable dataset".
- **Session objective.** Take over from the earlier 2026-09-18 hosted
  execution, verify its material claims from the provider and the database
  rather than from its prose, preserve sanitized evidence, and reconcile the
  status documents. Full record:
  [`docs/evidence/ua002-hosted-execution-reconciliation-20260918.md`](docs/evidence/ua002-hosted-execution-reconciliation-20260918.md).
- **What was read back, and matched.** Hosted ledger 33 / 33 / 0 with every
  effective checksum equal to release `2063ea8d72247a9b2643e1c690e37ab55ab14252` (the exporter run against a
  snapshot of the live ledger reports zero pending and the release's own
  ledger-drift query returns empty). The release's
  `postMigrationGrants.postCredentialVerificationSql` executed read-only:
  both `DO` blocks pass, 286/286 runtime grants, 0 missing, 0 unexpected, 55
  relations and 59 functions owned by `df_migration` with the canonical
  `search_path`, 0 `SECURITY DEFINER`, 0 unsafe default ACLs, 0 unsafe
  durable settings, 0 `PUBLIC` private ACLs, runtime roles LOGIN and
  non-privileged with no memberships, external ACLs exactly `CONNECT` +
  `extensions USAGE`, 0 reachable external capability. Six Hyperdrives with
  the expected names, IDs and role users, all `caching.disabled`,
  `verify-full`, CA `4856c681-5728-4008-8b1c-41323ce203bc`
  (`data-foundry-supabase-root-2021`, expires 2031-04-26). Five private-canary
  queues with the expected IDs and the runbook's exact producer/consumer/DLQ
  topology; the ordinary usage pair untouched with no producer or consumer.
  Both R2 buckets; the receipt retrieved by its exact key (sha256
  `81435077ca99d64868f031d733bb849b3dc3193fa7cc3f3b255925c9c91269e4`): six
  `READY` probes, edge and MCP metering `QUEUED`. Fixture residue: none.
  Seven route-less Workers with the expected version IDs; bindings read back
  and matching the tracked manifests; **deployed bundles byte-identical to
  in-place builds of the tracked manifests at `5580484`** (and at
  `2063ea8`, whose app sources are identical).
- **What could not be read back with read-only tooling** (carried as Part 2
  gaps, not asserted): queue retention and depth, Worker route / workers.dev /
  preview flags. The six direct runtime-role credential probes were not re-run
  (no credential is or should be in this session); they are corroborated by
  Hyperdrive creation and by each target asserting its own role before
  `READY`.
- **Checklist changes.** `UA-002` → COMPLETED; `BETA-002` → DONE;
  `FOUNDATION-006`, `MVP-005`, `PROD-001`, `PROD-002`, `REV-006` evidence
  advanced, status unchanged; `FOUNDATION-008` records the Windows-only test
  debt below. `README.md`, `SECURITY.md`, the Cloudflare runbook and the
  UA-002 handover carry dated banners; history was kept, not rewritten.
- **Tests and verification.** `pnpm install --frozen-lockfile`; `pnpm
  typecheck` pass; `pnpm cloudflare:artifacts:check` pass (thirteen
  artifacts); full `pnpm test` on Windows 3,556 / 3,583 with the 27 failures
  confined to three POSIX-only tooling tests from PR #47 plus two vitest
  worker-timeout errors, while Linux CI on the same SHA is green. The doc and
  tooling suites relevant to this change were re-run after editing (see the
  PR).
- **Problems found and corrected.** (1) The main checkout was parked on the
  stale branch `claude/foundation-hardening-20260818` with a stray untracked
  draft test that broke `tsc`; the checkout was moved to `main` and the draft
  was moved, not deleted, to `C:\Users\Adam\data-foundry-worktrees\stray-untracked-20260918\`.
  (2) `node_modules` predated the lockfile (no `wrangler`); reinstalled from
  the frozen lockfile. (3) Status documents still described the hosted state
  as 26/33 with no Workers/Hyperdrives/R2; reconciled.
- **Branch / PR.** `claude/ua002-hosted-reconciliation-20260918`, a
  documentation-only PR (the CI scope gate runs the documentation-only path).
- **Deployment environment / database target.** Cloudflare account
  `c2832821a9ab36419cde6ee08112f6d3`: seven temporary route-less Workers, no
  ordinary Worker, no route. Supabase `fgxinxaqkwoqyywdgobs`, private schema
  `data_foundry` at `0033`. **Production changed by this session: no.**
- **Blockers.** None for Part 2's technical work. Owner-only gates unchanged:
  `UA-001` (first real source rights), `UA-005` (public cutover), `UA-004`,
  `UA-007`, `UA-008`.
- **Risks / debt.** `pgpass` deprecation warning for a future `pg@9` (record
  only). Three POSIX-only tooling tests fail on Windows. `df_migration`
  remains `LOGIN`; parking it is a Part 2 decision. The temporary canary
  Workers, queues, CA, bucket and receipt are intentionally retained until Part
  2 decides their disposition; do not delete the receipt.
- **Required user actions.** None new.
- **Recommended next steps (Part 2).** Decide the disposition of the seven
  temporary Workers and five canary queues; establish the ordinary production
  topology from the six tracked manifests (ignored deployment manifests with
  the six Hyperdrive IDs, no routes); add a read-back for queue retention and
  Worker routes/subdomain flags; recovery/rollback exercise on the hosted
  target (`BETA-003`, `REV-006`); then the public-cutover decision packet
  for `UA-005`.

## Earlier — 2026-09-18 (first session): UA-002 provider staging executed and verified on the hosted database

**First hosted mutation of UA-002. The three provider-path prerequisites are
cleared. No migration was applied and none should be read into this.**

- **The reviewed `ua-002-provider-staging.sql` ran unchanged against project
  `fgxinxaqkwoqyywdgobs`** and its own verification query returns **0 / 0 / 7**:
  zero all-databases role settings remaining, zero privileged-or-inheriting
  `df_*` roles, seven `df_*` roles present. `df_ingestion` now exists
  `NOLOGIN NOINHERIT` with CONNECT and `extensions` USAGE and — correctly —
  *without* `data_foundry` USAGE, which the grant upgrade in the pending set
  delivers. All seven roles carry exactly one current-database `search_path` row.
  `df_migration` is `LOGIN`. Provider ledger row `20260918001016`.
- **A correction to my own earlier record.** The 2026-09-16 entry concluded "the
  connector is still read-only". That was measured against `execute_sql`, and
  `execute_sql` is still read-only — probing it with the authorized
  `ALTER ROLE df_migration LOGIN` returns `ERROR 25006: cannot execute ALTER ROLE
  in a read-only transaction`, mutating nothing. But the conclusion was drawn
  about *the connector* from one of its tools. `apply_migration` runs on a
  privileged connection and had never been tested. It is the same provider path
  the `20260901001729 data_foundry_private_schema_role_skeleton` came through,
  and the handover already assigns role creation and role-settings repair to
  "the secure provider path" rather than to the migration runner. Option 2's
  whole-project write mode was **not** enabled and remains un-taken.
- **The pending migrations were deliberately not applied through that tool**,
  although it could physically run them. `migrate.ts` asserts that the
  connection's `session_user` *and* `current_user` are both `df_migration`;
  `session_user` is fixed at connection time, so no in-session manoeuvre
  satisfies it, and the handover says a broader credential "is rejected by the
  runner, not merely discouraged". Applying by hand would also bypass the
  fifteen-probe preflight and the exact-baseline ACL-drift refusal, and leave
  `data_foundry.schema_migrations` unwritten — writing those rows by hand is the
  improvised SQL the standard forbids.
- **Pending set re-verified against the real hosted ledger**, exported from a
  clean worktree at the pinned release: **33 / 26 / 7**, pending `0027`–`0033`,
  `repositoryDigest 8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`.
  Undrifted.
- **The remaining blocker is reachability, not credential custody, and it was
  re-measured rather than assumed.** The same pooler hostname is OPEN on 443 and
  TIMES OUT on both 5432 and 6543, so the block is port-based; the origin is
  IPv6-only and this container has zero `inet6` addresses, no default IPv6 route,
  and no DNS answer for it at all. A probe of whether the HTTPS proxy would
  tunnel `CONNECT` to 5432 was **denied by the sandbox policy classifier as a
  containment escape** — recorded, not worked around.
- **No credential was created, on purpose.** A password this session generated
  would have to exist here to be useful, which the security boundary forbids; one
  generated server-side so it never enters this context would be known to nobody.
  Either way it would be unusable from here, because the port is unreachable.
- **Advisors unchanged by this work.** The 57 `function_search_path_mutable`
  warnings in `data_foundry` are what pending `0027` exists to repair and are not
  treated as blockers; `public.automation_runs` was left exactly as it is.
- Records: [the 2026-09-18 execution
  record](docs/evidence/ua002-provider-staging-executed-20260918.md) (new), a
  dated update banner on [the
  handover](docs/owner-actions/ua-002-hosted-migration-handover.md) marking the
  prerequisites section and execution step 4 as no longer applicable, and the
  `UA-002` rows of `PROJECT_CHECKLIST.md`.

**Exactly one owner action remains before the run:** set a password for
`df_migration` through the provider's secure credential path, then run the merged
sequence from a machine with ordinary PostgreSQL egress. Nothing about that value
belongs in chat, a repository file, a shell history or a log, and this session
neither needs nor wants it.

## Earlier — 2026-09-17 closeout: two PRs merged, hosted catch-up ready, commercial validation not started

**Merged implementation, hosted verification and commercial validation are three
separate tracks. Only the first advanced.**

### Merged implementation

- **PR #46 merged as `41dd2ec`.** The multi-dataset machine-data direction is
  standing repository authority, with ADR-0012 recording capability-based
  canonical hostnames while **preserving ADR-0011's implemented per-vertical
  edge isolation**. The two Codex P2 findings were answered and resolved: the
  delivered plan tasks are ticked, and Task 3 states why executive-state
  reconciliation was deferred to this closeout rather than raced from a branch
  that could not see both PRs.
- **PR #47 merged as `8a9542d`.** Both recorded parent-directory residuals in
  the UA-002 credential helper are closed, and both were reproduced against
  `44cec28` first. Ownership: a root run staged a credential into a 0755
  directory owned by another user at exit 0, and that user then unlinked it and
  substituted a symlink. Ancestors: a swapped symlink component put the password
  line **in the attacker's directory at exit 0** — the residual had recorded this
  as "not demonstrated", and it is demonstrated now. A defect the fix itself
  introduced (`--file .../` has no basename, producing a `mv` into a directory
  that BSD `mv` would accept) was found by re-reading the diff and rejected
  outright. Eight tests, 45 → 53; six fail against `44cec28`, two are controls.
  Local parity 15/15 with identical before/after tree fingerprints; exact-head
  CI green on `a3eb1bc`.

### Hosted verification — READY_FOR_SCOPED_EXECUTION, not done

Read-only reconciliation of `fgxinxaqkwoqyywdgobs` on 2026-09-17, plus a local
PostgreSQL 15 compatibility proof. Full packet:
[`docs/evidence/ua002-hosted-catchup-decision-20260917.md`](docs/evidence/ua002-hosted-catchup-decision-20260917.md).

- **PostgreSQL 15 needs no upgrade.** CI only ever proved 16. Against a real
  PostgreSQL 15.19 cluster with certificate-verified TLS, run from a clean
  detached checkout at release `2063ea8`, all 33 migrations applied, re-apply was
  a clean no-op, and the result was 51 tables / 3 views / 59 functions,
  `security_definer=0`, `functions_with_proconfig=59`.
- **The ledger agrees exactly: 33 / 26 / 7, 0 differing.** A raw-file SHA-256
  comparison reports all 26 rows differing and is **wrong** — this install uses
  the private schema, so the ledger stores the effective transformed checksum.
  Anyone re-checking must use the release's own `effectiveMigrationChecksum`.
- **Release pin not moved.** `PROGRESS` previously said UA-002 was "rebound to
  `1a37241`"; that described re-verification, not a change of pin. Migrations,
  runner, exporter and canonical store are byte-identical at `2063ea8` and
  current `main`, so `2063ea8` stands and its published checksums stay valid.
- **The 57 mutable search paths are what migration `0027` repairs**, not a
  blocker. A preflight comparing them before the catch-up would raise 57 false
  blockers and make the catch-up impossible to start.
- **Disabled RLS on private `data_foundry` tables is not public exposure.** The
  schema grants USAGE to the six `df_*` roles only; `anon`, `authenticated` and
  `service_role` have none. Supabase's own linter agrees — one ERROR finding,
  and it is not a Data Foundry table.
- **`public.automation_runs` is another workload's table** (ESO/ZOLL EMS
  automation): 5 rows, all from 2025-02-16, zero triggers, FKs, views or
  referencing functions, `anon` holding full CRUD with RLS off. Smallest
  containment proposed, deliberately not executed — the shared `public` schema
  is out of scope and the table belongs to its own owner.
- **Cloudflare state is UNKNOWN.** No connector, no credential, `wrangler
  whoami` unauthenticated. Historical inventories are not restated as current.
- **The one blocker is a `df_migration` LOGIN credential plus a PostgreSQL route
  to the origin.** All six `df_*` roles are NOLOGIN today. That is an owner
  action, not engineering.

### Commercial validation — CONTINUE_TARGETED_VALIDATION

Full decision:
[`docs/commercial-validation/first-paid-slice-decision-20260917.md`](docs/commercial-validation/first-paid-slice-decision-20260917.md).

- **Zero independent buyer interviews.** Every threshold on PR #49's scorecard
  reads 0. Interview #0 was the owner's own organisation and is correctly
  excluded; the two figures it produced — "a few hours a month" of burden, and
  single-state operation — both cut against the hypothesis.
- **Zero real sources.** All four HVAC sources are declared
  `SYNTHETIC — fictional publisher`. UA-001's blocker is a counsel question, not
  an engineering one.
- **One slice proposed, held weakly:** US Vehicle Intelligence (VIN → open
  recalls). Its differentiation was re-measured today — `HONDA`/`CR-V` (vPIC,
  JSON), `HONDA`/`ACCORD` (recalls, JSON), `Acura`/`Aston Martin` (EPA, **XML**)
  — three naming conventions and two formats across two agencies. It has no
  buyer and no rights determination, and the portfolio's own rule stands: every
  candidate is a research note.
- **Next action is not engineering**: run PR #49's existing instrument for 5–8
  independent conversations, and obtain one commercial-redistribution rights
  determination for the NHTSA endpoints in parallel.

### What is not true

No hosted migration was applied. No credential was created, requested, used or
rotated. No role was activated, no provider state changed, no deployment, no DNS
change, no public route, and no payment of any kind. The PostgreSQL 15 result is
a **local compatibility proof**, not hosted certification.

## Earlier — 2026-09-16 disposable-Postgres verification evidence, levels 2+ unproven

**Highest level proven: Level 1 (externally inspectable disposable-Postgres E2E integration proof). Next unproven: Level 2, hosted database reconciliation — blocked on PostgreSQL egress plus the `df_migration` credential.**

- **Level 1 work landed as PR #47.** The existing real-Postgres CI job now carries a `workflow_dispatch` trigger with a non-secret correlation id and publishes sanitized per-stage evidence to the run summary. It reuses the proven job rather than adding a second test implementation. The emitter is a tested script, not inline YAML, with 8 tests: the correlation id cannot carry a path or URL, the output cannot contain a value it was not given (asserted against a planted connection string, Cloudflare token and `PGPASSWORD`), a missing stage reports `not-run`, every stage can fail the run alone, and **a skipped stage is treated as unproven rather than a pass**.
- The evidence carries `kind: disposable-postgres-e2e-integration-proof` and a `notAProofOf` list as **data**, so the disclaimer travels with the document: not hosted-production, not Cloudflare deployed-runtime, no real Queue delivery, no real R2, no REST/MCP readback.
- **The repository's own CI policy test caught my first attempt.** I widened the Postgres job's `if:` for `workflow_dispatch`; `tooling/test/ci-workflow.test.ts` pins that expression and failed. It was right — the scope step already sets `run_postgres=true` for any non-`pull_request` event, so dispatch was already covered and the change only loosened a fail-closed guard. Restored verbatim.
- **Local verification, per instruction, with a partial result reported as partial.** Built a PostgreSQL 16.13 cluster with certificate-verified TLS and **applied all 33 migrations of the release to a fresh real database over it**. Stopped short of the full grant payload: it hit the release's genuine `df_migration` default-object-ACL precondition, which CI satisfies in a dedicated step, and re-deriving CI's ~400-line bootstrap locally stopped being economical. Two release behaviours confirmed along the way — the runner refuses non-TLS connections outright, and rejects any URL carrying `sslmode` or other TLS/endpoint query overrides.
- **UA-002 rebound to `1a37241`** against a freshly read hosted ledger (26 rows, `df_ingestion` absent, 0 `SECURITY DEFINER`, no drift): 33 / 26 / 7 and all ten checksums reproduce.
- **UA-002 environment determination:** this container has neither egress nor credential — the origin resolves IPv6-only and the container has zero IPv6 addresses. The handover now carries two credential-free commands the owner can run on their own machine to determine which blocker they have, plus a `.pgpass` placement that keeps the password out of arguments and history, escapes the `:` and `\` that are `.pgpass` metacharacters, and takes the login name from the route the owner actually has — bare `df_migration` direct, project-qualified through Supavisor.
- **PR #47 credential-guidance repair, with coverage that fails on the pre-fix revisions.** Two review findings on the UA-002 `.pgpass` guidance were real: a bare `df_migration` login that cannot authenticate through the Supavisor pooler the same section recommends, and a password written into `.pgpass` without escaping the `:` and `\` that are metacharacters there. Both fixed, and both now covered by tests that **execute** the documented block rather than assert its prose — 9 of 11 fail against the pre-fix document. A third finding followed on the same block — it appended to `.pgpass` where libpq uses the FIRST matching line, so a stale entry from an earlier password would win. Reproduced against a live PostgreSQL 16 cluster with `scram-sha-256` (stale-first fails to authenticate, correct-alone and correct-first connect), fixed, then two more found on the fix itself: a stale `*` wildcard still won, because libpq honours `*` in any of the first four fields; and a cancelled prompt replaced a working credential with an empty password while exiting 0. All measured against a live cluster, not reasoned from documentation. The block now writes the new entry FIRST (which is what beats a wildcard) while deliberately keeping wildcards that may serve the operator's other hosts, and refuses to write at all unless the read succeeded and returned something. A sixth followed: with a writable-but-unreadable `.pgpass` the rewrite failed, `mv` installed a file containing only the new entry, every unrelated credential was destroyed, and the block reported success — now `chmod`/`mv` are chained onto the rewrite succeeding. **Six findings across four rounds on one shell snippet, with CI green through all of them.** The gating checks do not reach a procedure written in prose, which is why these tests execute the block. Done rather than left open: the block is replaced by `tooling/scripts/ua002-migration-pgpassfile.sh`, which writes a dedicated password file and never touches `~/.pgpass`, so the whole class is gone by construction. Alternate-file support was confirmed **through the real runner** before adopting the design — `createPostgresDriver` against a live TLS PostgreSQL 16 connects with `PGPASSFILE` set, still connects when `~/.pgpass` holds a wrong password, and fails with no password file at all. 14 tests pin the acceptance conditions. **Correction:** I said the sanitized evidence was waiting on the merge; that conflated the trigger with the artifact. The evidence step runs on every PR run, and [run 35165734258](https://github.com/athompson83/data-foundry/actions/runs/35165734258) already emitted `overall: "pass"` with all ten stages and both fixtures verified for `29f142c`. Only `workflow_dispatch` needs `main`. A seventh finding then landed — the first the redesign did **not** make impossible: the helper cannot unset the caller's environment, so a `PGPASSFILE` or `DATA_FOUNDRY_MIGRATION_DATABASE_URL` left over from an earlier attempt would silently be used by the next migration command. The helper now names both on every failure and the handover says to clear them first. An eighth finding, **P1 and introduced by the redesign itself**, followed: the signal handler cleaned up and *returned*, so an interrupt after `mktemp` let the script resume, recreate the deleted file under the ambient umask and install it — reproduced as a **world-readable file containing the password, with the script exiting 0**. Signal handlers now exit (130/143) while `EXIT` keeps ordinary cleanup, and `umask 077` removes the dependency on the caller's umask. A ninth round found four more, including a **P1 that no test of the helper could have caught**: the execution sequence checked out release `2063ea8`, which does not contain the helper (`git cat-file -e` confirms), so the documented command would fail exactly when the credential was needed — the credential step now comes first. Two later blocks also re-exported a secret-bearing URL over the helper's password-free one, bypassing `PGPASSFILE` further down the same document. Plus `printf %q` for paths containing quotes, and rejection of directory targets (`mv` into a directory had reported success with the password in a random file inside). A tenth round then pinned the **whole operator path**: the helper is copied out of the reviewed checkout with a recorded SHA-256 and re-verified after the release checkout, so the migration release stays at `2063ea8` rather than moving and invalidating every release-dependent packet and checksum. A new `--check` mode stops the procedure when `PGPASSFILE`/the URL are missing, the file is not owner-only, or the URL carries a password. **The complete documented sequence was then run end to end** in an isolated checkout against disposable TLS PostgreSQL through `createPostgresDriver` itself — helper preserved, tree stripped of it, digest re-checked, `--check` passed, driver CONNECTED, decoy `~/.pgpass` byte-identical. An eleventh round caught two more: the section still *opened* by telling a fresh operator to start from the `2063ea8` checkout, where even the `cp` preserving the helper would fail — now split so the migration steps use that checkout and the credential step precedes it; and a `SIGINT` arriving after `mv` committed reported *"nothing was installed"* over an already-rotated credential, which is the more damaging wrong answer. The helper now tracks how far it got and says the outcome is uncertain rather than guessing. A twelfth round then caught that the procedure verified the helper against a digest it generated itself — proving the copy unchanged but nothing about provenance, so a tampered helper in a dirty checkout would capture the password and pass every check. The handover now **publishes the reviewed SHA-256**, checked before the helper is ever run, with a test binding the published value to the file. Also: `chmod 700` ran unconditionally, so a `--file` target in a shared directory had other users' access revoked even on a cancelled run; only a helper-created directory is restricted now. A thirteenth round moved to the verification workflow itself: a `workflow_dispatch` on `main` shared a concurrency group with ordinary pushes under `cancel-in-progress`, so a manual verification could be cancelled by a push or by a second request — now keyed on the event with each dispatch in its own group; and the evidence emitter needs a successful install, so a checkout/install failure produced **no evidence at all** despite `always()` — now backed by a shell-only fallback that sanitizes its correlation id and can only ever report `fail`. That fallback then regressed the ordinary path — the emitter exits 1 on a `fail` verdict *by design*, so a real stage failure got its accurate evidence plus a second block falsely blaming checkout/install. Fixed by measuring whether the emitter wrote anything rather than trusting its exit status. My regression, not a new class of defect. A fifteenth round then found the published-digest gate was **advisory**: with no `set -e` in a pasteable block, a failed `shasum -c` printed and the next line ran the unverified helper anyway. Each guard is now chained with `&&` to what it guards — verified with a wrong digest, the helper never runs and never sees a password. A sixteenth round found the same gap one step further down — `pnpm ua002:operator` ran unchained after a failed `--check`. Rather than chain that one site, the assertion was written against the class (**every** invocation must be gated), and it immediately failed on my own fix: 4 invocations, 3 gated. It found a fourth call site neither I nor the review had noticed. A seventeenth round showed the limit of that approach: a `set -e`-free pasted block cannot gate “the remainder” at all, because manual steps sit between the checks. Every helper invocation is now digest-gated **at the point of use** (six invocations, six gates), which also covers a copy modified after an earlier check. The class assertion I had written was itself hard-coded to a count — assert-the-case in test form — and is now genuinely class-based. The TCP readiness repair got the same treatment: the loop is driven against a stubbed probe replaying the observed init-server race, and 4 of 5 fail against the socket-probe version. An eighteenth round found the first defect here that is about the shell rather than the procedure, and it is the same shape as all the others: `printf '%s' "$(escape_field "$x")"` reports the status of `printf`, never of the substitution, so `set -e` could not see a failing `sed` and `pipefail`'s verdict died with the subshell. Reproduced against `b9ec9b9` — a `sed` failing for every field installed `::::` at **exit 0**, and a `sed` failing for the password alone installed a line matching the real host and login with an **empty password**, which is precisely what this helper exists to make impossible. `--check` accepted both, because it validates the file's type and permissions rather than its contents. Every field is now escaped into a checked variable **before anything is created**, by assignment, whose status *is* the substitution's; an empty result on a zero status is also rejected. Three of four new tests fail against `b9ec9b9`; the fourth is the control. A nineteenth round found a credential source the procedure never mentioned: `PGPASSWORD` does not compete with `PGPASSFILE`, it **overrides** it. Confirmed in `pg@8.23.0`'s source (`val('password', …)` falls back to the environment, and `pgpass` is consulted only when the resolved password is still `null`), then behaviourally through `createPostgresDriver` against a disposable TLS PostgreSQL 16 with `scram-sha-256`: a **correct** password file plus a stale `PGPASSWORD` **fails to authenticate**, and one that happened to be valid would authenticate with a credential this procedure never placed. The handover now clears it and `--check` refuses while it is set — checked first, because every other check would otherwise be reporting on a file the driver will not read. Also recorded rather than acted on: `pg@8.23.0` warns that pgpass support is removed in `pg@9`, which the whole `PGPASSFILE` design rests on. A twentieth round closed the last finding, on the same recurring shape: `cleanup()` ran `rm -f` and then `return 0` unconditionally, so a removal that **failed** could not affect the outcome — the helper printed "nothing was installed" and exited 1 while a mode-0600 file holding the complete password line stayed on disk at a path it never named. Reproduced against `e9f2735` as an unprivileged user (root bypasses the directory permission check, and my first attempt as root wrongly showed nothing). Cleanup is now a reported outcome: it checks whether the file is still present after the attempt, names it and says it holds the password in clear text, and no summary line reads as an all-clear unless removal was established — on ordinary failure, `INT`, `TERM` and `EXIT` alike. Four new assertions fail against `e9f2735`; two are controls. Exact commands and results, including two failures, in [the local verification record](docs/evidence/pr47-local-verification-20260916.md). A twenty-first round closed the two findings I had verified and declined to fix under the earlier stop. The first was a credential-integrity defect in the same shape as the rest: `mktemp` creates the staged file safely, but `printf ... > "$temporary"` resolves that name a **second** time, so in a directory another local user can write to, that user can unlink the entry and leave a symlink in its place. Reproduced against `bd0666e` two ways -- deterministically, with the complete password line landing in a file the attacker chose while the helper printed "Wrote" and exited 0; and in a live race between two real unprivileged users, where the attacker's symlink was installed as the target and the run still reported success. The helper cannot make a shell redirection race-safe, and it must not tighten a directory it did not create (the twelfth round fixed exactly that), so it now refuses a group- or world-writable parent before reading the password -- and refuses just as firmly when it could not read the parent's mode at all, because a mode that could not be read is unknown rather than acceptable. The default `~/.data-foundry` path is unaffected. The second was an evidence-integrity defect: the shell fallback fired whenever the emitter wrote nothing and concluded from that alone that "checkout or install did not complete", publishing `"stages": []`. An import-time error inside the emitter produces the identical condition **after** all ten PostgreSQL stages have run and recorded their outcomes, so the evidence stated a cause nothing had established and discarded outcomes sitting in its own environment. The fallback now carries every recorded outcome through -- sanitized to the four GitHub outcome values, `not-run`, or `unrecognized`, so a value that is not a step outcome can never be echoed -- stays `fail`-only, and names no cause. Seven new tests fail against `bd0666e`; one is a control.
- **CI on PR #47 runs now that it is no longer a draft.** Every job is gated on `github.event.pull_request.draft == false`, which is why the run for `e177e2d` skipped all three. Since the PR was marked ready, all three jobs are green on every head CI has reached, and the real-Postgres job emits the sanitized evidence document on each one — ten stages `success`, both pinned fixtures matching, `overall: "pass"` ([run 35176901239](https://github.com/athompson83/data-foundry/actions/runs/35176901239)). Full local `verify`-job parity (14 commands, 224 test files, 3510 tests) is recorded alongside it rather than in place of it.
- **Cloudflare activation (Level 3) cannot proceed from here:** the Cloudflare connector is unauthenticated and its tools are not loadable at all. No Worker, Hyperdrive, Queue or R2 state can be read or changed.

## Earlier — 2026-09-16 no first-source candidate is selectable

- **An external verification canary was requested and deliberately not built.** [The record](docs/owner-actions/external-verification-canary-20260916.md) states why: a public HTTPS canary would be a facade over a pipeline that is not deployed. Four measured reasons — the Cloudflare connector is unauthenticated here; the private canary is **route-less by design** (`workers_dev = false`, and its own header says "deliberately no public route, workers.dev endpoint, preview URL, Hyperdrive, database credential"); no runtime role has a credential; and the hosted schema is seven migrations behind with `df_ingestion` absent. The second reason would still apply even if the other three were solved, and the request's own security rules forbid weakening the auth model to work around it.
- **The fallback already exists, is green, and is publicly readable.** CI's real-Postgres job performs the synthetic transaction against real PostgreSQL with certificate-verified TLS, the real acquisition and ingestion runners, and the real `df_ingestion` role with its exact grants, asserting `facts > 0` and `fact_evidence > 0` — every stage an independent step. Reference run on `2063ea8`: `actions/runs/35137492353/job/104933454084`. All passwords are generated per-run with `openssl rand` and die with the container, so there is nothing to leak.
- **What it does not prove is recorded as prominently as what it does:** no real Cloudflare Queue delivery, no real R2 (the check uses `InMemoryObjectClient`), no deployed Workers, and no read from the hosted database. It is a code-path proof against ephemeral infrastructure, not a deployed-system proof.

- **Owner direction received: proceed with counsel review of ENERGY STAR as the preferred US first-source candidate.** A [counsel packet](docs/owner-actions/energy-star-counsel-packet.md) is prepared carrying only what is needed to answer one narrow question — the per-dataset licence attachment, the verbatim EPA text, the field-origin evidence, the exact fields and transformations proposed, the intended commercial use, and the explicit commitment not to use the ENERGY STAR mark or imply EPA endorsement. Trademark is kept as a separate issue from data-use rights, as directed.
- **Counsel's answer is necessary but not sufficient.** ENERGY STAR needs a second, separate approval: the acquisition method, which review packet §2 records as *proposed, not authorised*. The packet says so explicitly so a favourable legal answer cannot be mistaken for clearance to activate.
- **AU Energy Rating is qualified as the fallback and deliberately not built** — [the minimum viable AU/NZ slice](docs/owner-actions/au-energy-rating-fallback-slice.md) records one equipment class, the exact fields (natively AS/NZS, no cross-standard conversion), the claim the product could honestly make, and the five things that must happen first. Licensing being easier does not make it closer to revenue: it carries a robots blocker and a schema blocker that ENERGY STAR does not.
- **The DOE inquiry reduces to one send authorization.** Neither of the owner's two conditions is met: the CCMS contact page returns 403 to an honest agent so the contact route cannot be confirmed from here, and the only reachable DOE addresses are press/executive/clearinghouse routes rather than the CCMS program. Sender identity remains blank because asserting one on the project's behalf is not mine to do. [The authorization](docs/owner-actions/doe-send-authorization.md) names the three candidate routes in preference order.
- **A parallel dataset-discovery workstream is open** — [thirty candidates across six unrelated domains, reduced to ten finalists](docs/sources/dataset-portfolio-20260916.md), with every **factual** claim labelled `[MEASURED]`, `[INFERRED]` or `[UNVERIFIED]` because this session produced three errors from treating availability as authorisation. Judgement calls — demand, competitive intensity, monetization and the finalist ranking itself — are reasoned opinion, not measurements, and the document says so rather than implying the ranking is evidence-derived. Measured today: reachability for seventeen endpoints, `robots.txt` **bodies** for eleven hosts, and licence text for two. Two measured blockers are already recorded — ClinicalTrials.gov's `robots.txt` **disallows `/api/`**, and Open Food Facts is **ODbL share-alike**, which may be incompatible with a closed commercial derivative.
- The best-evidenced candidate is **US vehicle intelligence**, because the reconciliation problem is measurable rather than asserted: the same 2003 Accord is `HONDA`/`Accord` in NHTSA vPIC, `HONDA`/`ACCORD` in NHTSA recalls, and EPA fuel economy uses title case in XML — three identifier conventions, two formats, two agencies, no shared key, and two of those are the same agency.

- **Conclusion, after four correct review findings: no candidate is selectable today.** An earlier draft of this session's work recommended ENERGY STAR conditional on counsel with AU Energy Rating as a rights-clear fallback. Both halves were overstated and are withdrawn. The record is [the first-source decision sheet](docs/owner-actions/ua-001-first-source-decision-20260916.md).
- **The same error three times, which is the thing worth carrying forward.** I repeatedly let *reachability* stand in for *permission*: (1) I fetched `data.gov.au/robots.txt`, recorded `http=200`, never read the body — it is `User-agent: * / Disallow: /` for the entire host, and this platform sets `respect_robots: true`, so AU has **no approved automated acquisition path** despite a genuine CC-BY 3.0 AU licence; (2) I called ENERGY STAR's acquisition side "clean" on the strength of robots permitting `/api/` and `/resource/`, when the review packet §2 already says the SODA method is *proposed, not authorised* and states the rule outright — **"Robots not disallowing a route is not a grant"** — with terms, rate limits and redistribution constraints **[UNVERIFIED]**; (3) I presented the EPA licence attachment as new evidence narrowing the blocker when the packet already recorded the pointer **[VERIFIED]**, reproduced its text and analysed the same scope problem.
- **ENERGY STAR therefore needs two approvals, not one:** the rights question (does the EPA licence reach partner- and certification-body-submitted values?) **and** an acquisition-method authorisation. Counsel answering the first does not make it selectable.
- **The internal cell count was undercounted.** `docs/source-onboarding.md` Stage 2 requires effective `ACQUIRE`, `STORE` **and `CACHE`** before transport, and the ingest pipeline separately requires `NORMALIZE` and `DERIVE`. That is five internal cells, so a paid direct API needs **at least eight** cells, not seven. Omitting `CACHE` fails the first fetch closed.
- **AU Energy Rating** also has a field-coverage blocker beyond robots: AS/NZS star ratings and kW versus the dictionary's US DOE `seer2`/`eer2`/`hspf2` — different test procedures, not different units, so conversion would invent facts. Route to yes is written DCCEEW permission plus a schema decision.
- **DOE CCMS** is not selectable on access rather than rights: the edge returns **403 to an honest agent for `robots.txt` itself**, so crawl permission cannot be established without impersonating a browser, and no CCMS dataset appears in data.gov's advertised sitemap (all 112 shards, 559,455 URLs) — absence from the sitemap, not proof no catalogue record exists, since the catalogue API and search are broken and it appears mid-rebuild.
- Refresh cadence is **unknown** for both AU and ENERGY STAR; dated observations establish no frequency. Nothing was activated, no publisher was contacted, and the DOE inquiry remains unsent.

## Earlier — 2026-09-16 UA-002 execution environment identified

- **UA-001 gained a documented alternative to CCMS, and a clean negative on the open data.gov question.** Enumerating all 112 data.gov sitemap shards — 559,455 URLs — establishes that **CCMS has no catalogue entry**; the only `ccms` match is an unrelated workers-compensation system. The catalogue's own API is unusable (`/api/3/action/*`, `/api/action/*`, `/api/1/*` and `/api/` all return a non-CKAN `{"detail":{},"message":"Not Found"}`, and its `robots.txt` still carries literal `# TODO` placeholder text), so the sitemap was the only route left and it worked.
- The same enumeration surfaced [ENERGY STAR certified products](docs/sources/energy-star-certified-products-qualification-20260916.md), published by the EPA on Socrata with `provenance: official`. It resolves the exact objection that stopped CCMS: measured today with a plain descriptive user agent, `robots.txt` (200) disallows only `/browse?*` query-parameter variants — not `/api/` or `/resource/` — and both the metadata and row endpoints return 200. No impersonation, no undocumented endpoint, documented CSV/JSON/XML distributions, and `rowsUpdatedAt` on the day of measurement. 31 HVAC-relevant datasets carry stable identifiers.
- The coverage figure is deliberately **not** quoted as a total. The naive sum across the 21 core certified datasets is 875,613, and it is wrong twice: *Central Air Conditioners* and *Mini-Split Air Conditioners* both return **0 rows** while reporting `publicationStage: published`, and *Air-Source Heat Pumps* and *Heat Pumps* report identical row counts and update timestamps but different column counts (48 vs 50), so they may overlap and must not be added. The distinct count is unestablished and is recorded as something to measure, not to assume.
- Two things are explicitly **not** resolved by this find. ENERGY STAR is a *voluntary* label and therefore a higher-efficiency **subset**, whereas CCMS is the *mandatory* database for regulated equipment — different populations, not substitutes. And its rights position is open: no `licenseId`, an empty `license` object, and "ENERGY STAR" is a registered certification mark with its own usage rules, so it needs its own rights determination rather than inheriting CCMS's. Nothing was activated.

- The database half is blocked on exactly one capability, now established by measurement rather than assumption: **a host with PostgreSQL egress to the project origin, running release `2063ea8`, with the `df_migration` password available to libpq without appearing in a command line.** Any ordinary developer machine with internet access and the password satisfies it. [Measurements](docs/evidence/ua002-execution-environment-20260916.md).
- Every alternative was checked, not assumed. `list_environments` returns exactly one environment and `get_session` confirms it is the one this session already runs in, so a sibling session is the same container by another name. The origin resolves IPv6-only (`2600:1f1c:825:9500:de6d:a3aa:4fb1:e23b`, no A record) against a container with zero IPv6 addresses. Raw TCP to the IPv4 Supavisor addresses was refused at the sandbox policy layer, so the restriction is policy rather than routing. A Vercel function was rejected on judgement — it would put the migration credential into a hosting provider nobody approved for that purpose.
- The hosted baseline was re-measured read-only and has not drifted: ledger `0001`-`0026`, 46 tables, 3 views, 57 functions, 0 `SECURITY DEFINER`, 0 functions carrying `proconfig`, `public` untouched at 7, six `df_*` roles all `NOLOGIN`, `df_ingestion` absent. That `proconfig` count is the measurement that keeps a search-path preflight out of the operator: `0027` is what sets it, so checking it today would raise 57 false blockers.
- The 26 applied ledger rows were read from the hosted database and compared against the release's own recomputation: **0 differing**. The hosted database and `2063ea8` agree exactly on everything already applied.
- The corrected documented sequence was then run end to end with that **real** hosted ledger — clean detached checkout at `2063ea8`, `--applied-ledger`, manifest written to `mktemp -d` outside the repository: **33 / 26 / 7** and all ten documented checksums reproduce. The operator run against it cleared packet parsing, the release-SHA guard and the clean-checkout guard, and stopped at exactly one line: the credential.
- The twelve durable-setting violations are unchanged (each of the six roles carries the forbidden all-databases `search_path` row and none carries the required per-database row). `postgres` is a member of `df_migration` with no admin option, which is the session `ua-002-provider-staging.sql` is written for — it is not an execution path, because the operator requires `session_user` and `current_user` to both equal `df_migration` and rejects `SET ROLE` by design.
- One operational detail that would have cost a cycle: the IPv4 Supavisor pooler must be used in **session mode (port 5432)**. Transaction mode on 6543 does not preserve the session state the runner asserts (`session_replication_role = origin`, `lo_compat_privileges = off`).
- No mutation was attempted. The management connector was re-measured as `supabase_read_only_user` with `transaction_read_only = on` and no `df_migration` membership; only reads were issued and its read-only posture is preserved.

## Earlier — 2026-09-16 UA-002 operator merged and bound to the release

- PR #42 merged as `2063ea8d72247a9b2643e1c690e37ab55ab14252` after six review rounds (`a75e75f` 3 findings, `7945930` 2, `f34697a` 3, `20ea79a` 2, `1754f33` 1, `d9b0e13` 1). Every finding was verified against the code, the migration SQL or the live hosted inventory before being accepted; all eleven threads are answered and resolved.
- The operator's preflight is fifteen read-only probes derived from the exporter's own SQL rather than a paraphrase, because a preflight that checks something subtly different from what the grant install raises on buys false confidence. It reports every blocker in one pass, and `--apply` executes a grant payload **rebuilt from the release** rather than the manifest's — the manifest's checksum hashes the SQL beside it and so proves nothing against an edit, and its verifier had no integrity binding at all.
- The dominant lesson of the review rounds was a failure mode worse than a missing check: **blocking on drift the pending migrations themselves repair**, which would make the catch-up impossible to start, since the runner refuses to apply while any finding exists. Three instances were found and excluded on measured grounds: function search paths (`0027` sets all 57, which would have produced 57 false blockers), the `SECURITY DEFINER` functions `0029` and `0033` replace with `INVOKER` definitions, and the acquisition ACL reshape.
- That third one arrived as a review finding proposing a check, and was declined with evidence rather than implemented. The hosted runtime-role private ACL is 200 entries (schema 5, relation 100, column 38, function 57); `LEGACY_RUNTIME_GRANTS_0028` is 199 (schema 5, relation 98, column 39, function 57). The difference is `0027` lines 56-58 revoking two relation grants and adding one column grant, so comparing the existing-object subset against that baseline before mutation would fire on three entries `0027` exists to repair.
- Artifacts regenerated from the merged release and re-verified: 33 repository migrations, 26 applied, 7 pending, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, six grant roles, 59 function signatures, 286 expected grants. All seven pending checksums match the Git objects at `2063ea8d72247a9b2643e1c690e37ab55ab14252`, and the rebuilt grant payload reproduces the exported manifest byte for byte across all three executable fields.
- The handover is now bound to that SHA and carries the exact direct-TLS command sequence with the values filled in. Nothing was executed against the hosted database; the management connector remains read-only.
- PR #43 merged as `5e263fc9326962de4e009b9047e5af1a04053df5`, closing three review findings on the handover. Two were P1s caused by the same mistake — documenting a command without executing it — and both were reproduced before being fixed: the export omitted `--applied-ledger`, so it produced `33 0 33` instead of `33 26 7` and would have flagged all 26 applied migrations as replays; and redirecting the manifest into the checkout created an untracked file that tripped the exporter's own clean-worktree guard (`?? ua002-packet.json`). Both now use `$(mktemp -d)` outside the repository.
- The third finding was a P2 on a claim, and measurement confirmed it: the table's checksums do **not** all follow from an identical `db/migrations/` tree. `upgradeFrom0028Sql` is 269,595 characters and embeds all 59 entries of `PRIVATE_FUNCTION_SIGNATURES` plus the 199-entry `LEGACY_RUNTIME_GRANTS_0028` baseline, neither of which lives under `db/migrations/`. The seven migration checksums and `repositoryDigest` do follow (`effectiveMigrations` hashes the migration SQL and the schema constant; `repositoryDigest` hashes only version, filename and checksum over those), so the document now splits the two cases and requires exact-SHA regeneration for the grant values.
- Artifacts regenerated from `5e263fc` after the merge, as the owner instruction requires before any live database work: 33 / 26 / 7, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, six roles, 59 signatures, 286 expected grants, `postMigrationGrants` checksum `b6c7e197aac427b21e232a988567b8d180ef6cc767a3e7cd691eb61febc8413c`, `upgradeFrom0028Checksum` `d73fe6718648ff459cb416d2b665496f841c4a430bc06647c6c55013dd04dd65`, and all seven pending migration checksums. All ten documented rows reproduce unchanged, which is the expected result for a documentation-only merge and is now recorded in the handover so either SHA can be used.
- One diagnosability trap is now documented rather than left to be rediscovered: once `DATA_FOUNDRY_MIGRATION_DATABASE_URL` is set, `migrationFailureMessage` redacts any error outside its safe-category allowlist to the bare sentence `Direct PostgreSQL migration failed.`, because a raw driver error can carry the connection string. Measured both ways on the merged release — the same failing run prints the full message and stack with the variable unset. Packet parsing, the release-SHA guard and the clean-checkout guard all run before the driver is created, so they can be diagnosed with no database at all.
- `UA-001`: an attempt to find a documented CCMS distribution on data.gov could not reach the catalogue API — `catalog.data.gov` serves its root but every `/api/3/action/*` call returns `{"detail":{},"message":"Not Found"}`, which is not CKAN's error envelope. That neither confirms nor rules out a documented distribution, and is recorded in the unsent inquiry draft as a reason to ask DOE rather than as a finding.

## Earlier today — 2026-09-16 direct-TLS operator, merged PR #41, and the remaining commercial decision

- PR #41 was marked ready, reviewed, corrected and merged as `0026b14b7ef0156519305fec756fae8fa083b169`. Codex raised three P1 findings and all three were correct: the paid-API rights bundle needs seven cells rather than six (`SURFACE_REQUIREMENTS.API_PAID` ANDs `SERVE_API_ACCESS`, `SELL_API_ACCESS` and an unconditional `REDISTRIBUTE_NORMALIZED`); the handover described `SET ROLE` where the runner requires connecting **as** `df_migration` and that role is `NOCREATEROLE`; and the topology needs six Hyperdrives, not five. Each was verified against the code before being accepted, fixed in `e996c25`, answered on its thread and resolved.
- The seven pending migration checksums were re-verified against the Git objects at the merged `main` SHA: 7 matched, 0 mismatched, and `db/migrations/` is unchanged between `eb7e998` and `0026b14`, so the prepared artefacts carry over intact.
- `tooling/scripts/ua002-direct-tls-operator.ts` is the new executable half of the handover, exposed as `pnpm ua002:operator`. Preflight is the default and mutation is opt-in behind `--apply`. It reads the credential only from `DATA_FOUNDRY_MIGRATION_DATABASE_URL`, never as an argument, and never prints it.
- The operator exists because of a specific failure mode rather than for tidiness. The migration runner's per-transaction guards check the session `search_path`, the role binding and the default ACL, but not durable role settings — and the grant packet raises on exactly those. Against the measured hosted state a naive run would have applied `0027`-`0033`, written seven ledger rows, and only then failed at the grant upgrade. Preflight therefore checks identity, session writability, durable settings for all seven roles, role existence and shape, the ledger marker and range, replay, and every checksum both pending and already applied — reporting all blockers in one pass, because the repairs need a privileged provider session anyway.
- Grant-upgrade failure rolls back and then *proves* the session recovered before reporting, rather than assuming PostgreSQL did it. 19 unit tests cover the blocked-run-mutates-nothing path, the apply ordering, and both rollback outcomes; the composed durable-setting probe was parsed against real PostgreSQL via PGlite before shipping. Full tooling suite: 37 files, 715 tests, passing.
- `UA-001` now separates **rights** from **acquisition method** as two approvals, recording the owner's decision that the undocumented, browser-user-agent-dependent endpoint is not to be used in production pending review or a supported path. The decision sheet gained exact-field, transformation, retention, refresh and downstream-channel sections, and a concise DOE access inquiry is drafted and deliberately unsent pending authorization.
- The remaining commercial decision is reduced to four questions with proposed values and rationale: keep the existing $0/$49/$149/$299 ladder, keep the hard stop rather than building metered overage, invoice manually monthly-in-arrears at Net 30 rather than building billing before there is demand, and offer the 100-request Evaluate tier only if `UA-001` returns `API_FREE` permission.

## Earlier today — 2026-09-16 UA-002 connector exception and first-source decision sheet

- Objective: execute the owner-approved `UA-002` database exception (management connector over HTTPS for the migration and grant-verification portion only), and advance the unblocked revenue tracks alongside it.
- Preconditions were verified before any mutation, in the order the exception required. The hosted baseline at `2026-09-16T16:16:23Z` matched the reviewed expected state **exactly, with no drift**: ledger `0001`-`0026` under marker `data-foundry:schema_migrations:v1`, 46 tables, 3 views, 57 functions, zero `SECURITY DEFINER`, zero non-owner objects, six `df_*` roles all `NOLOGIN` and non-privileged, `df_ingestion` absent, `public` untouched at 7 tables, and non-zero rows only in `api_route_keys` (14) and the ledger (26).
- The packet was regenerated against the merged release `eb7e998`: 33 repository migrations, 26 applied, 7 pending, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, `relevantInputsClean: true`, grants covering six roles, 59 function signatures and 286 expected grants. All seven pending checksums were then recomputed **independently of the exporter**, directly from the Git blobs at that SHA: 7 matched, 0 mismatched.
- The exception could not be executed. The management connector now authenticates as `supabase_read_only_user`, not `postgres` as in September. `SET LOCAL ROLE df_migration` failed with `ERROR: 42501: permission denied to set role "df_migration"`, and read-only probes confirmed two independent blocking layers: no `df_migration` membership (only `postgres` is a member) and `default_transaction_read_only = on` while `pg_is_in_recovery()` is `false` — deliberate configuration of a primary, not a standby artefact. Supabase's `read_only=true` MCP parameter produces exactly this identity and posture.
- The control was **not worked around**, because approval to use a connector is not approval to bypass a security control. No migration was applied, no grant changed, no role created; the only write attempted was the authorization probe, which failed closed. This is a capability limit, not a refusal, and the prepared work was handed over rather than abandoned — see [the write-path evidence](docs/evidence/ua002-connector-write-path-20260916.md) and [the handover](docs/owner-actions/ua-002-hosted-migration-handover.md), which sets out the direct-TLS run (the runbook's own canonical path, and the contained one) against re-enabling connector write mode (which would widen write authority across the whole project, including the unrelated application's `public` schema).
- `UA-001` advanced on the unblocked side. A fillable [rights decision sheet](docs/owner-actions/ua-001-doe-ccms-rights-decision.md) now states the minimum that earns revenue: **seven** operation/channel cells — `ACQUIRE`/`STORE`/`CACHE`/`NORMALIZE` on `INTERNAL_PROCESSING` plus `SERVE_API_ACCESS`, `SELL_API_ACCESS` and `REDISTRIBUTE_NORMALIZED` on `DIRECT_CUSTOMER_API` — with every other surface left `UNKNOWN` so it refuses by default. Seven and not six because `API_PAID` in `packages/rights-engine/src/surfaces.ts` is an AND-bundle whose redistribution requirement is unconditional; a six-cell decision would fail closed on every normalized API request.
- A second measurement found **real drift the first baseline did not cover**. Running the release's own durable-setting policy SQL read-only returned twelve violations: all six `df_*` roles carry a forbidden role-global (`setdatabase = 0`) `search_path` row and none carries the required current-database row. That SQL is embedded in the grant packet under `RAISE EXCEPTION`, while the migration runner's per-transaction guards check only the session search path, role binding and default ACL — so a direct-TLS run against the current state would apply `0027`-`0033`, write seven ledger rows, and only then fail at the grant upgrade. The operator sequence therefore checks durable settings before the first mutation. Repair belongs to the provider path: `df_migration` is `NOCREATEROLE` and can alter only its own settings.
- Codex raised three P1 findings on PR #41 and all three were correct: the paid-API bundle needs seven cells rather than six; the handover described `SET ROLE` when the runner requires connecting **as** `df_migration` and that role cannot create `df_ingestion`; and the topology needs six Hyperdrives, not five. All three are fixed.
- A material correction to the same-day source qualification: the DOE edge serves **only browser user agents**. `curl/8.5.0`, a bare `Mozilla/5.0` and a descriptive `data-foundry-research` token all returned 403; only a full Chrome UA string returned 200. The earlier "reachable with a plain descriptive user agent" cell was not reproducible and has been corrected in place.
- The query surface was confirmed from the shipped bundle: `POST` to `<solrUrl>select` with `wt=json` and `q`/`fq`/`fl`/`start`/`rows`/`sort`, the equipment-class facet is `Product_Group_s`, and CSV export is assembled client-side via `papaparse`. `solrUrl` itself is still not resolvable from published assets — the bundle carries only AjaxSolr's `http://localhost:8983/solr/` default — so the review packet's exact-endpoint cell still cannot be filled from public evidence.
- Those three facts together (browser-only edge, undocumented internal endpoint, bundle re-versioned the day before reading) are recorded as a reviewer decision rather than an engineering detail. Engineering's recommendation is to ask DOE for a supported bulk path before building a revenue-bearing pipeline on an endpoint the publisher never agreed to serve.

## Earlier the same day — 2026-09-16 machine-access channel reconciliation

- Objective: reconcile the owner's corrected business direction — Data Foundry as a supplier of machine-readable data, with agent and crawler monetization as core channels rather than deferred features — against live primary evidence, and select the minimal supported paid-machine release path.
- Live hosted database, read directly through the authenticated management connector at `2026-09-16T13:42Z`: ledger `0001`-`0026`, 46 tables, 3 views, 57 functions, zero `SECURITY DEFINER`, `df_ingestion` absent, all `df_*` roles `NOLOGIN` with no password, relation grants 25 each for `df_edge`/`df_web`/`df_mcp`/`df_acquisition` plus column grants (11/11/16), shared `public` schema unchanged at 7 tables, and no rows beyond the migration-seeded `api_route_keys` (14) and the ledger. The release at `af9fc68` carries `0033`, six roles and 286 expected grants, so the hosted target is seven migrations, one role and the grant upgrade behind.
- The pending export was built and validated against that live ledger: 7 packets (`0027`-`0033`), 286 expected grants, 59 function signatures, six roles including `df_ingestion`.
- The hosted catch-up did not proceed. Direct TLS was unreachable on three independently measured grounds: no migration credential in the environment, an IPv6-only direct origin against a container with no IPv6 stack, and IPv4 pooler endpoints timing out behind an HTTPS-only proxy. The runbook states the manifest's `liveUseAuthorized: false` does not authorize connector execution and directs stopping rather than substituting a connector. The September connector application of `0001`-`0026` was covered by a recorded owner preauthorization; nothing covers `0027`-`0033`. The work stopped rather than being worked around.
- Channel capability was established from official provider documentation and the implemented model, not from previous assistant claims: `API_ACCESS_TIERS` is `API_FREE`, `API_PAID`, `RAPIDAPI`, `MCP` and `API_BILLING_SOURCES` is `DIRECT`, `RAPIDAPI`, `NONE`. There is no paid-crawler access tier, rights surface or billing source in the application model.
- Cloudflare Pay Per Crawl verified 2026-09-16 as **closed beta** with no self-serve enablement. Identity is Web Bot Auth request signatures plus verified-bots registration, never a `User-Agent`. The flow is `HTTP 402` with `crawler-price`, a retry carrying `crawler-exact-price` or `crawler-max-price`, and a charged 2xx carrying `crawler-charged`; Cloudflare is Merchant of Record and distributes earnings. WAF and Bot Management block rules take precedence over charging, so a crawler refused before the charging flow earns nothing. Since 2026-06-16 price may be set dynamically from the origin, which corrects the earlier internal assumption that pay per crawl involves no Worker code.
- Selected minimal path: the **direct `API_PAID` API billed `DIRECT`** is the shortest supported route to a paid machine request. It needs no third-party enrollment, marketplace agreement or beta admission — only deployment, an approved source and a published price. RapidAPI and pay per crawl remain live channels behind their own external enrollments; neither blocks the first release.
- Records updated: `docs/evidence/machine-access-channel-capability-20260916.md` (new), `docs/sources/hvac-first-source-qualification-20260916.md` (new), the pay-per-crawl and channel-table sections of `docs/owner-actions/revenue-readiness.md`, the deployment runbook's pay-per-crawl item, an amendment to ADR-0006, and `PROJECT_CHECKLIST.md` (`UA-002` re-measured, release target realigned, `UA-008` added for beta admission).
- `UA-002` credential paths exhausted, not merely asserted: only TCP 443 leaves this container (`1.1.1.1:443` open, `:53` blocked; the Supavisor host answers on 443 but times out on 5432 and 6543). The blocker is therefore network reachability, not credential custody — no secret store or credential bridge can make the PostgreSQL wire protocol reachable from here. The only database path over 443 is the management API, which the runbook forbids for application migrations. This reduces to a two-option owner decision: record an exception for the connector path as was done in September, or run the direct-TLS procedure from an environment that has both the credential and 5432 egress.
- `UA-001` advanced in parallel. DOE CCMS is reachable (200) and structurally acquirable — a Solr-backed JSON API with `fq` filtering, `start`/`rows` pagination and exact `numFound`, which permits a slice that is complete in its own terms rather than a truncated class. Upstream refresh is approximately two weeks; scope is current basic models submitted within the past year; provenance is manufacturer self-certification with accuracy disclaimed and no legal significance, so absence is not discontinuation and this is never independent certification. `energyrating.gov.au` refused the same automated client (403) and could not be qualified. Recommendation: advance DOE CCMS, let the Australian register lapse to unqualified. Rights remain entirely the reviewer's.
- Direct paid path verified against the release: 61 tests pass across `api-keys` and `usage-events`, including the closed `API_PAID`/`DIRECT` invoice predicate that keeps marketplace events structurally out of the invoice projection. What remains is a price, an invoicing mechanism, terms and a deployment.
- Production impact: none. No provider, credential, DNS, schema, rights, listing or billing mutation occurred. The Cloudflare and Stripe interfaces were not authorized in this session, so this account's zone settings, bot rules, plan level, beta admission and product state remain unverified.
- Next dependency order is unchanged in substance: owner credential activation (`UA-002`) unblocks deployment and the private canary; the source rights decision (`UA-001`) unblocks real data; a price and invoicing decision plus `UA-007` unblock the first direct sale. `UA-004` and `UA-008` open the additional channels afterwards.

## Current session — 2026-09-08 revenue platform implementation

- Objective: implement the accepted HVAC-first RapidAPI launch plan, reusable across industries with regular refresh and a $300/month operating ceiling.
- Baseline: live main 0ae6c7aeb2dee70ce380663cb438d5e1d047b634, README-only PR29 and zero open issues. Work is isolated on codex/revenue-platform-20260908. Four pre-existing original-checkout changes were preserved and integrated in this worktree; no original checkout was reset.
- Current release shape: six ordinary Workers and database roles, six reduced capability targets plus credential-free harness (thirteen core bundles), and one separately built synthetic ingestion phase using isolated Queue/DLQ/artifact storage. Migrations extend through0033; 59 private functions,51 tables and286 exact runtime grants. The historical hosted inventory remains26 migrations/five staged roles/200 grants; it was not re-certified or changed.
- Pipeline: acquisition completion inserts an immutable processing identity transactionally; opaque UUID messages, independent five-minute outbox recovery, database-clock leases/fences, bounded verified JSON/CSV artifacts, atomic canonical promotion, retained revisions and 304 verification. A NOT_MODIFIED run may reuse only a matching FETCHED run whose completion and freshness both precede its own claim, preventing overlapping work from borrowing a future artifact. Source permissions are checked during processing and delivery. The production path imports no fixture filesystem or PDF graph.
- Operations: 1–8760-hour optional source interval (12 hours only where reviewed terms permit); separate acquisition/verification/publication observations; closed production telemetry; immutable operator action history, replay/backfill/pause/resume/retraction/revocation/account closure; durable incident and failure/recovery email states. Alerts default off; unknown sends never automatically repeat.
- Foundation/customer work: one compiled identifier contract for ingestion and exact lookup, synthetic second-industry proof, /hvac canonical pages and old-path redirects, useful filters/pagination, honest coverage/pricing, fail-closed listing/approved-policy/contact configuration, TypeScript/Python examples and rights-filtered selected-fact evidence. Unreviewed query-bearing evidence URLs are omitted while artifact identities/hashes remain.
- Source/commercial work: fresh source documentation assessment, bounded initial data dictionary, pricing/cost envelopes, three-partner trial criteria, unsent outreach copy and reviewable customer policy drafts. No source was approved/acquired, no agreement accepted, no marketplace billing/listing configured and no customer contacted.
- Prior native local evidence (before migration0032): all31 migrations apply; exact legacy199-to286 grant upgrade and complete postcondition verifier pass, including same-count ACL drift refusal and unchanged ledger. Restricted df_ingestion publishes61 synthetic facts with61 evidence rows, ignores duplicates and rejects ten mutation/capability probes, including function execution after PUBLIC access is revoked. These are disposable local controls, not hosted/TLS/Hyperdrive/backup evidence.
- Verification records: docs/evidence/revenue-platform-implementation-20260908.md, docs/evidence/identifier-and-buyer-verification-20260908.md and docs/evidence/ingestion-postgres-control-20260908.md. Candidate-wide checks and exact-head hosted CI/reviews belong to the implementation PR evidence; a later SHA requires fresh applicable verification before release designation.
- Material repairs found in review: missing real-role sequence/lock privileges, absent legacy ACL upgrade, operator UUID-case idempotency and audit TRUNCATE bypass, query-bearing evidence URL leakage, malformed UTF-8 acceptance and unqualified multi-target source ordering.
- Production impact: none. No provider, credential, DNS, real-source, billing or outreach mutation occurred. Existing containment/credential/source/marketplace/public-cutover gates remain; approved retention and verified alert/support contact are now explicitly UA-007.
- Next dependency order: owner containment (UA-006) and source/policy decisions (UA-001/007); agent-run recovery/provider staging after secure activation (UA-002); private capability and synthetic ingestion proof; owner marketplace agreements/payouts (UA-004), live subscription/limits/cancellation; action-time public cutover (UA-005). First actual external payment plus useful access, scheduled real refresh/recovery and budget evidence remain the revenue milestone.
- Source qualification limits:16 artifacts,1 MiB each,4 MiB total,1,000 records,10,000 affected entity/property pairs per delivery (including retirements and dependent facts) and one acquisition target per source. Larger complete snapshots, target partitions, HTML/PDF runtime qualification, approved-policy erasure, independent provider outage/spend alerts and later paid channels are not claimed complete.

- Follow-up integration: PR #30 merged as `eed284599ab9a2bf1892039705eb294a0e99fbd1` after hosted run34254514199 passed both required jobs for `2ba6ad8b4833253f1ba782071b7b2cdaf63d70ac`. PR #29 then reconciled the README presentation onto that operational baseline and merged as `1fb406c8f91540bde1beb5b678e6953365de4768`. Migration0032 exposes all current alias source memberships through the existing view without granting raw-history access. Production promotion scopes its work to affected entity/property pairs; a small update beside10,001 unrelated entries passes. Search pages are always noindex and remain outside sitemaps.
- Follow-up checks: the final sequential suite passed3,450/3,450 in220 files (397.90 seconds); all14 type/schema/runtime/topology checks and all14 build profiles passed. Hosted run34254514199 passed its full job in13m50s and its real-PostgreSQL job in1m14s. The README reconciliation's documentation-scoped protected run34256317967 passed; its real-PostgreSQL job was correctly skipped.
- Delayed304 repair: PR30 comment3959304808 is covered at both completion boundaries. The test first claims the304, then completes a matching FETCHED run; the304 is refused because that artifact became available after the claim boundary. A separate raw terminal-update regression proves the database guard also refuses the same bypass. Migration0033 reasserts that fence in the terminal guard and pins its function search path. Focused acquisition, migration, packet and runtime-grant controls passed; the final sequential suite passed3,450/3,450 in220 files (397.90 seconds), followed by all14 configuration checks and all14 build profiles. The exact candidate's protected checks passed before merge. No deployment or revenue claim is made.
- UA-006 disposition: the Product Owner affirmatively cleared provider containment on 2026-09-08. This record is sanitized: it stores no item, credential, identifier, browser state, or security detail. Frozen `origin/main` was `bc6d8f060153853d8c8d79087775fec99c1805a1`; its local sequential suite passed3,450/3,450 in220 files (1,402.43 seconds), private-canary/synthetic-ingestion topology gates passed, and thirteen core plus the separate synthetic-ingestion artifact builds passed. Its credential-free migration packet reports33 migrations and six runtime roles. The worktree contains no direct-TLS migration/runtime credential. On 2026-09-09 Wrangler authenticated and a read-only Cloudflare inventory confirmed only the preserved ordinary usage Queue/DLQ pair and raw-artifact bucket, with no Hyperdrives; direct-TLS inspection, migrations, grant upgrade, credential activation, new queues/buckets, and the route-less canary remain precisely blocked at UA-002's owner-controlled secure-entry interface. No provider mutation occurred.
## Prior-session record

Everything below is preserved historical context. Its five-Worker topology and
earlier SHA/provider observations do not override the current six-role plan,
current checklist or fresh primary evidence.

## Historical state through the prior session

- Product: Data Foundry
- Lifecycle stage: Alpha Lab schema staged / protected main / pre-deployment
- Control-graph node: `PROTECTED_MAIN -> EXTERNAL_DEPLOY`
- Current milestone: bind the staged Alpha Lab schema to the five Workers
  through owner-provisioned credentials and Hyperdrives, prove the first lawful
  Cloudflare canary, and open the first rights-admitted source and revenue
  channel without implying that a real HVAC dataset is cleared
- Release authority: the live 40-character `origin/main`. Integration PR
  [#19](https://github.com/athompson83/data-foundry/pull/19) is merged; PRs
  #13–#17 are closed as superseded after path, patch, ancestry, and behavioral
  reconciliation. Dependency follow-up PR #21 removes the remaining `esbuild`
  advisory from the post-integration lockfile. PR #22 merged the closeout tree
  as `9c917c0f708352dfb79861110023145eb23806e3`, including migrations
  `0025`–`0026`, exact alias evidence, bounded surface-catalog authorization,
  one request-wide query snapshot, and database-free request pre-routing.
  Its exact head `501b33d08fafe5cdf1c9c0c9877f0b38b4b265c0` passed hosted run
  `33352124668`, both automated reviews, and sealed security scan
  `24b34cd2-2f8d-40ae-bfd2-f4460daa419f`. Every later commit, including
  documentation-only, creates a new repository SHA and requires fresh exact-SHA
  local, hosted-CI, review, and ruleset evidence before it can be designated for
  provider action. The Alpha Lab isolation branch merged as
  `290df1342094433e92978ec97eb37cc02fc4eb50`; PR #24 (`/docs` page names the
  API contract) merged as `5dde773a4b64a8e004ca429706100399a678cf74`.
  PR #26 then merged normally as
  `02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493` from reviewed head
  `8a43b7f7600fef10c1b26f0281a4c087f8610373` after both required
  checks, both automated reviews, and all review threads were clean. That merge
  does not authorize a hosted migration or deployment; those retain separate
  containment, credential, exact-SHA, and provider gates.
- Repository state alone designates no Worker release candidate.
- The required source gate
  is six route-less private-canary Worker artifacts: five reduced targets and
  one harness. The canary path also requires the five dedicated 14-day queues
  `data-foundry-private-canary-usage-events`,
  `data-foundry-private-canary-usage-events-dlq`,
  `data-foundry-private-canary-events`, `data-foundry-private-canary-dlq`, and
  `data-foundry-private-canary-quarantine`; none may repurpose the ordinary
  usage Queue/DLQ pair.
- Preview: none verified
- Production: no Data Foundry Cloudflare deployment exists. The Aroqon zone is
  active/full, but `data.aroqon.com` currently returns Vercel `404: NOT_FOUND`.
- Database target: shared Alpha Lab Supabase project `fgxinxaqkwoqyywdgobs`.
  The private `data_foundry` schema now carries all 26 ledgered migrations,
  migration-owner ownership, the `PUBLIC` revoke, and the historically verified
  200-grant runtime matrix for five staged `NOLOGIN` roles. The same hosted
  snapshot records `df_migration` as `NOLOGIN`; it is not yet the controlled
  direct login required by the current migration runner. Repository migration
  `0027` pins all 57 function search paths and narrows acquisition access to the
  199-grant matrix; repository migration `0028` adds the four justified rights-
  path indexes. Both remain pending hosted authorization and application at a
  newly reviewed exact SHA. It holds no source, entity, fact, tenant, or
  credential rows.
  See the [2026-09-02 hosted migration evidence](docs/evidence/alpha-lab-hosted-migration-20260902.md).

## Latest Session — Local Clone, Windows Test Repair, and E2E

- Populated the previously empty local checkout from `origin/main` at merge
  commit `0ae6c7a` on branch `local-test`; installed the pinned pnpm lockfile
  dependencies with `pnpm install --frozen-lockfile`.
- Fixed the Windows-only architecture-boundary test failure caused by using a
  URL pathname without decoding `%20` in a workspace path. Both boundary
  suites now use Node `fileURLToPath`.
- Focused verification passed: 2 files / 10 tests. The local factory E2E proof
  passed: 1 file / 34 tests. The repeated full local suite passed: 202 files /
  3,246 tests. `pnpm build` passed schema generation and TypeScript typecheck.
- No hosted CI, provider, database, deployment, rights, billing, DNS, or
  source state changed. This local branch is not a release candidate.
- Repeat validation on 2026-09-03 reproduced no failures: focused boundary
  tests 10/10, factory E2E 34/34, full suite 3,246/3,246, and build/typecheck
  passed again.

## Latest Session — Protected-Main PR #26 Release-Boundary Merge

- Reconciled every PR #26 review thread and extended the
  same shared PostgreSQL 16 policy across the direct migration runner,
  connector packets, runtime-grant installer/verifiers, five direct role
  probes, and every route-less private-canary target. The merged implementation
  rejects unsafe role posture, memberships, role/database settings, effective
  parameter and large-object privileges, FDW/server access, ownership, all-
  database `CREATE`, and `CONNECT` to any other live non-template database.
- Direct migrations now require `df_migration` to be a controlled direct
  `LOGIN NOINHERIT` session/current user with exactly one current-database
  durable `search_path=data_foundry, pg_catalog, extensions` row and no global
  role settings. The configured and resolved live path is checked before the
  first broader policy query and before/after every pending migration.
- Generated provider packets recheck migration-role durable/default/external
  state before and after each migration, prove `current_user=df_migration`
  around migration SQL, and refuse quoted as well as unquoted shared-`public`
  qualification. Drift rolls back before both the ledger insert and any later
  migration. Exact reviewed Git migration bytes remain the trusted computing
  base; these controls do not claim to sandbox a malicious provider admin.
- Negative controls cover neighboring default permissions independently,
  effective privileges inherited through `PUBLIC`, PostgreSQL 16 parameter and
  large-object catalogs, exact extension membership, unmanaged and shared
  object ownership, foreign tables, search-path poisoning, role escape, and
  cross-database reachability. Tests directly assert the non-generic extension
  and numeric shared-ownership branches so a broader rejection cannot mask
  them. The disposable PostgreSQL CI job applies and cleans each mutation and
  preserves only allowlisted error signatures in mode-`0600` captures.
- Repository-only verification is green. Exact PR head
  `8a43b7f7600fef10c1b26f0281a4c087f8610373` passed
  protected run `33697035331`, including disposable TLS PostgreSQL 16, and
  both automated reviews found no remaining issue. A clean checkout of merge
  commit `02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493` passed TypeScript, 202
  files / 3,244 tests, 28 ordered idempotent migrations, generated
  schema/OpenAPI/runtime checks, topology, and eleven PGlite-free Worker
  artifacts. Protected-main push run `33698213600` also passed both required
  jobs. None of this is live provider evidence.
- No provider, source, rights, billing, DNS, or deployment state changed. The
  hosted target still needs `UA-006`, a secure `df_migration` credential with
  the exact current-database `data_foundry, pg_catalog, extensions` search path,
  a read-only cross-database topology result, pending
  migrations `0027`–`0028`, `postMigrationGrants.verificationSql`, five distinct
  runtime-role credentials with that same exact current-database search path,
  `postMigrationGrants.postCredentialVerificationSql`, a successful five-path
  `pnpm runtime-roles:postgres:check`, five cache-disabled Hyperdrives, five
  separate 14-day private-canary queues, both required R2 buckets, and the
  private canary before any public deployment.

## Previous Session — Hosted Private-Schema Migration and Grant Activation

- Applied the exact `db/migrations/` set (tree shared by PR #26 head `93a668b`
  and `main` `5dde773`) to the Alpha Lab target through the exporter's attested
  connector packets, each submitted as one multi-statement query that
  PostgreSQL runs as a single implicit transaction; demonstrated by a rollback
  probe and by every object being owned by the migration owner through
  `SET LOCAL ROLE`, not assumed from client documentation. Direct TLS Postgres
  is unreachable from the automation container, so the connector path was used
  under the owner's explicit production-provisioning preauthorization and is
  recorded as a documented deviation from the runbook's direct-TLS preference.
- Verified: ledger `0001`–`0026` with exporter-matching checksums, 46 tables,
  3 views, 57 functions, every object owned by the migration owner, zero
  `SECURITY DEFINER` functions, the `PUBLIC` pseudo-role removed from the
  private schema and its objects, and the exporter's 200-grant runtime
  verification block passing. The shared `public` schema ACL and table count
  are unchanged.
- Staged, not activated: the five runtime roles have database `CONNECT`,
  schema `USAGE`, and object grants but no password and no `LOGIN`. Assigning
  credentials and creating the five cache-disabled Hyperdrives is owner-only
  (`UA-002`). Zero Hyperdrive configurations and no Data Foundry Worker exist.
- Provider advisories after migration: the pre-existing `public.automation_runs`
  RLS error belongs to the unrelated Alpha Lab application and was left for the
  owner; 57 `function_search_path_mutable` warnings on `data_foundry` functions
  were observed. Repository migration `0027` implements the forward fix, but it
  has not been applied or reverified on the hosted target; no warning closure is
  claimed.
- Latest redacted Cloudflare evidence at 2026-09-02T14:46Z records the standard
  usage model and the ordinary usage Queue/DLQ pair at 14-day retention, with
  zero Data Foundry Workers, Hyperdrives, R2 buckets, hostname record, or route.
  The earlier same-day raw-bucket observation is historical and superseded.
- The FK-advisor review justifies exactly four rights-path indexes in repository
  migration `0028`. The other 31 INFO notices are non-blocking and deferred to
  post-traffic `EXPLAIN`/advisor monitoring rather than speculative indexes.
- Merged PR #24 (`/docs` page names the API contract) as `5dde773`. The hosted
  `0001`–`0026` application predates repository migrations `0027`–`0028`; any
  pre-continuation SHA-specific canary or exporter evidence remains historical
  only and cannot authorize the pending hosted work.
- Data and revenue remain gated exactly as before: `hvac` is `DRAFT` with four
  synthetic fixture sources, ENERGY STAR is deferred and unreviewed, RapidAPI
  enrollment is owner-only (`UA-004`), and no Stripe product or listing exists.
  No source acquisition, publisher contact, listing, or billing change was made.

## Session 2026-08-31 — Alpha Lab Isolation and Provider Reconciliation (historical, superseded where noted)

- Corrected the data boundary: Data Foundry is a private `data_foundry` schema
  inside Alpha Lab, not part of Valor. Real-Postgres operational commands now
  default to that private schema; legacy `public` use is explicit only.
- Hardened migrations to preflight the private schema and `extensions` access,
  refuse legacy Data Foundry public installations, and retain an independent
  schema-scoped migration ledger.
- Made the disposable real-Postgres CI service create the same `extensions`
  namespace before private-schema migration, preserving the production guard
  instead of weakening it for a generic PostgreSQL container.
- Hardened Cloudflare Hyperdrive usage: each Worker invocation owns and closes a
  fresh client; every private-schema operation uses and verifies a transaction-
  local search path; snapshot setup is constrained and serialized so a pooled
  transaction cannot inherit another Alpha Lab consumer's path.
- Added regression coverage across the canonical store, migration runner,
  ingest CLI, and all five Worker lifecycle roots.
- Historical observation: `aroqon.com` was active/full with no Data Foundry
  Workers, Hyperdrives, Queues, or R2 buckets, and the account appeared Workers
  Free. The Queue/R2/plan assertions are superseded by the 2026-09-01/09-02
  redacted evidence: the account uses the standard usage model and the ordinary
  14-day Queue/DLQ pair exists. The 2026-09-02T14:46Z refresh found zero Data
  Foundry Workers, Hyperdrives, or R2 buckets and supersedes an earlier same-day
  raw-bucket observation. No Worker, route, Hyperdrive, or live binding proof
  exists. The configured Vercel project has
  disconnected Git and no viable deployment, so it is not a rollback target.
  The [redacted 2026-08-31 provider reconciliation](docs/evidence/alpha-lab-provider-reconciliation-20260831.md)
  records the read-only observations and excludes provider identifiers and
  credentials.
- Fresh local evidence: `typecheck`; focused schema/Worker tests (78); the full
  Vitest suite (189 files, 2,969 tests); migration, generated-schema/OpenAPI,
  topology, vertical/runtime, and all-five-Worker artifact checks all pass.
  Source readiness at `2026-08-31T20:22:08.032Z` is correctly `NOT_READY`:
  HVAC has zero real sources and no effective surface grants.
- No Cloudflare, Vercel, Supabase, DNS, billing, source-rights, or production
  data mutation was made.

## Protected-Main Implementation State

PR #19, the PR #21 dependency repair, and the PR #22 closeout are on protected
`main`. The bullets below describe that merged tree; repository-ready still does
not mean deployed or commercially publishable.

- Corrected Option B is accepted and implemented. Exact effective rights-matrix
  decisions authorize each operation/channel surface independently. Missing,
  stale, automated-only, or otherwise ineffective permission refuses.
- Legacy `GREEN`/`AMBER` classifications and permission booleans are inventory
  metadata and additional hard stops only. Migrations created no `ALLOW`.
- Historical queries select one exact immutable fact and recursive contribution
  graph at `policy.at`, while source status, terms, and surface grants are
  evaluated at the response/export `asOf`. A current successor is never
  substituted for the selected historical fact.
- REST and MCP await Cloudflare Queue acceptance before returning a metered
  success. Missing/rejected enqueue returns an opaque retryable 503. Only the
  later Postgres persistence remains asynchronous and idempotent.
- Scheduled acquisition uses migrations 0017, 0019, and 0020 with immutable
  versioned receipts and fenced recoverable execution leases. Pre-migration
  terminal rows remain contract v1; every new or reclaimed claim is contract v2
  and requires ordered `INITIAL`, `PRE_PROVIDER`, `PRE_TRANSPORT`, and
  `PRE_PERSISTENCE` authorization within the current attempt before R2
  persistence or `NOT_MODIFIED` freshness. Unexpected orchestration failures
  that escape expected terminal handling release still-owned claims; expired
  attempts rotate tokens on the same slot row. Only a winning claimant receives
  the current fencing token; active/terminal duplicate observations and
  diagnostic/freshness reads physically omit it. Direct and provider
  transports enforce finite response, record, pagination, cursor, diagnostic,
  and cumulative-artifact bounds without partial persistence.
- Offline entity resolution uses one driver-managed transaction executor for
  manufacturer, entity, alias, judgment, and evidence writes. A transactional
  failure rolls the batch back. No usable strong identifier is instead a
  fail-closed zero-claim result whose provenance revision can still finalize,
  so a refresh does not leave the superseded record falsely current.
- Re-ingestion now supersedes a logical source record's current immutable
  revision rather than mutating or deleting provenance. Migrations `0021`–
  `0023` preserve historic evidence, record a one-way supersession link, make
  source-record lifecycle explicit (`PROVISIONAL` versus `FINALIZED`), and make
  each entity/fact/relationship lineage cite its exact artifact. The persisted
  `source-record-evidence@3` fingerprint covers the exact resolved entity and
  manufacturer targets, accepted alias claims and locators, fact projections,
  resolution audit, and relationship dispositions/endpoints/writer. An exact
  replay does not churn `updated_at`; any evidence, target or mapping-semantic
  change appends a successor instead of retaining stale evidence.
- Migration `0023` adds append-only alias claims and authority epochs. It
  deliberately creates no authority claim for a legacy alias. Resolution and
  search read only claim-backed current aliases; entity and relationship
  surfaces require current `FINALIZED` supporting evidence. A refresh without
  a usable strong identifier still finalizes a zero-claim successor, withdraws
  the prior source-only identity from customer surfaces, and creates no phantom
  manufacturer while preserving immutable history.
- Migration `0025` binds every source-record alias claim to its exact immutable
  `ALIAS` entity-evidence row. A claim without that link—and every legacy row
  for which the repository cannot prove the link—stays outside resolution and
  search. The ingest pipeline records the claim and evidence in one pinned
  transaction, so the alias's source is included in the surface-rights AND.
- Every customer-facing query operation uses a fresh read-only repeatable
  snapshot and request-local authorizer. Compound REST, MCP, public-web, search,
  facet, relationship, and comparison flows cannot reuse authorization from an
  older contribution set or observe a mid-operation alias commit. REST parses
  all matched-route inputs before acquiring that snapshot; the web Worker
  rejects methods, malformed targets, `robots.txt`, and unmatched paths before
  loading the database-backed deployment.
- Migration `0024` requires explicit source-stream membership and
  `full_snapshot` versus `incremental` refresh semantics. Complete snapshots
  retire omitted current records atomically with append-only artifact evidence;
  incremental streams do not. Unknown legacy membership is revoked rather than
  inferred, then restored only by a rights-admitted reingest.
- Rights-backed readiness exists and requires canonical `--as-of` plus either a
  named-environment live database or a schema/digest-validated qualified
  snapshot. YAML/fixture metadata alone never proves a current grant.
- RapidAPI is a thin authenticated proxy into the canonical edge Worker, with a
  generated OpenAPI contract and disjoint `RAPIDAPI/RAPIDAPI` usage. Those rows
  are excluded from direct invoices.
- The fail-closed credential provisioner admits exactly `API_PAID/DIRECT`,
  `RAPIDAPI/RAPIDAPI`, and `MCP/NONE` for one tenant and one vertical. File
  delivery is POSIX-only, owner-only and outside the worktree; marketplace
  delivery goes to the repository-pinned Wrangler entry point through the
  validated edge manifest, a sanitized child environment, and an explicit empty
  env file. Reserved and `workers.dev` marketplace hosts are refused. It creates
  no rights grant, plan, invoice or source approval.
- MCP is a deployable, one-vertical, custom-bearer MCP 2026-07-28 surface with
  exact `MCP/NONE` analytics. It is not OAuth or anonymous; no live deployment
  is verified.
- The final Cloudflare topology is five Workers: edge, web, usage-consumer,
  acquisition-worker, and mcp-worker. Deployment validation requires every
  exact manifest to name the same canonical 32-hex `account_id`.

## Source and Product Truth

- HVAC remains `DRAFT`. All four registered sources are synthetic fixtures.
- No real HVAC source has an effective reviewed publication/commercial bundle.
- The proposed ENERGY STAR source is `DEFERRED`, `UNDER_REVIEW`, `UNREVIEWED`,
  unapproved, outside the runtime registry, and has no grant. Do not sign,
  promote, acquire, publish, contact, or initiate publisher outreach.
- The only approved general product wording for regulatory-filing values is:
  “Manufacturer-reported, as filed with US regulators”. Do not broadly call
  filings certified, verified, approved, or regulator-determined unless exact
  provenance genuinely supports that narrower statement.

## Deployment and Revenue State

- The PR #19 integration, PR #21 dependency repair, and PR #22 closeout are on
  protected `main`. Repository-ready does not mean deployed or commercially
  publishable; the live deployment and real-source gates remain independent.
- RapidAPI enrollment, proxy-secret configuration, plans, payout setup, live
  route, and real subscriber proof remain external.
- The Aroqon Cloudflare zone is active/full. Latest redacted evidence shows the
  standard usage model and exactly the ordinary 14-day Queue/DLQ pair, with no
  Data Foundry Worker, route, Hyperdrive, or R2 bucket. The next deployment
  proof is the
  route-less, service-bound private canary; any public canary or
  `data.aroqon.com` cutover requires separate later authorization.
- The configured Vercel project has disconnected Git. Its production domain
  returns `404: NOT_FOUND` and historic deployments fail for a missing `public`
  output directory; it is not a viable rollback path.
- GitHub `main` is protected by active ruleset `21855694`; its two strict
  required checks are bound to GitHub Actions. Private vulnerability reporting,
  Dependabot vulnerability/security-update controls, secret scanning, and push
  protection are enabled, and repository hooks are empty. Only the Vercel App's
  sudo-gated repository selection remains an owner-only governance check; it
  does not block protected merge or Cloudflare deployment.
- Protected `main` upgrades the production PDF parser to `unpdf@1.8.1`, removing
  the legacy `canvas` / `node-pre-gyp` / vulnerable `node-tar` install chain
  behind all twelve Dependabot advisories discovered on the prior
  default-branch lockfile. The dependency follow-up also updates `esbuild`,
  removing the remaining development-tool advisory. Parsed-lockfile regression
  coverage and `pnpm audit --audit-level moderate` keep those dependency
  repairs executable rather than documentary.
- Public production requires `PUBLIC_CACHE_MODE=no-store`; the runtime rejects
  `cache` in production because request-time rights checks cannot revoke an
  object already retained by a browser or intermediary. Shared caching is a
  later engineering capability only after cache keys and invalidation follow
  exact rights lifetimes. Provider purge and stale-object probes remain live
  incident checks because the repository does not control every provider rule.
- Public sitemap work is keyset-paged and subject to one validated raw-page
  budget per request, shared across all verticals and segments for the global
  index. Capacity exhaustion returns an opaque, non-cacheable retryable 503
  without partial XML; malformed and configuration-impossible shard aliases do
  no query work. A provider-level rate limit still requires live configuration
  and verification.

## Verification

- Focused test-first repair cycles cover post-transport rights revocation,
  exact historical selection, recursive contributors, bulk refusal, pinned
  reconciliation transactions and advisory locks, source-record currentness,
  alias epochs/claims, identifier-less successors, bounded provider input,
  Queue privacy/idempotency, bounded sitemap work, and credential-delivery
  refusal/compensation paths, plus removal of the vulnerable transitive
  `node-tar` chain.
- PR #22 exact head `501b33d08fafe5cdf1c9c0c9877f0b38b4b265c0`
  passed the complete 183-file/2,926-test Vitest suite, typecheck/build, all 26
  ordered and idempotent migrations, generated schema/OpenAPI/runtime drift
  checks, vertical/acquisition checks, repository Cloudflare topology, all five
  Worker artifact checks, disposable PostgreSQL 16
  replay/reconciliation/concurrency gates, and the moderate-level dependency
  audit. Hosted run `33352124668` passed the protected ruleset checks. Sealed
  security scan `24b34cd2-2f8d-40ae-bfd2-f4460daa419f` closed 32/32
  worklist rows across all 65 changed files and 10/10 surfaces with zero
  findings, candidates, deferred items, or suppressions. PR #22 merged normally
  as `9c917c0f708352dfb79861110023145eb23806e3`.
- Repository topology centralizes production endpoint classification, rejects
  loopback/unspecified endpoints and plaintext protected values, and keeps
  deployment-only fields out of tracked templates. Deployment-mode validation
  additionally requires five ignored exact manifests with one canonical
  `account_id`. It is expected to refuse safely until those external manifests
  and resources exist.

## Blockers

- A provider-side containment result (`UA-006`) is required before any provider
  deployment or new credential-bearing migration/recovery action. Use only the
  affected provider's normal security/audit controls; do not reopen the prior
  browser state, reveal the item, or rotate unrelated credentials.
- Hosted Alpha Lab private-schema and grant proof is recorded; no Data Foundry
  Worker deployment, Hyperdrive, or live Queue/DLQ/R2 integration proof is.
- `df_migration` and the five runtime roles are staged `NOLOGIN` without
  passwords. Pending direct migrations wait on the controlled migration-login
  credential and canonical database-scoped path; every Worker database binding
  waits on its own secure credential and Hyperdrive (`UA-002`).
- The current PostgreSQL policy refuses effective `CONNECT` to any other live
  non-template database and `CREATE` on every database. No current hosted
  inventory proves that cluster boundary yet; a non-empty result is an explicit
  owner/provider topology blocker rather than a condition automation may
  normalize on the shared project.
- The current public data hostname is a Vercel 404, not a Data Foundry runtime.
- Secure `df_migration` credential entry with the exact current-database
  `data_foundry, pg_catalog, extensions` search path, the pending exact-SHA
  migrations, `postMigrationGrants.verificationSql`, then secure activation of
  all five runtime-role credentials, each distinct and using that same exact
  current-database search path,
  `postMigrationGrants.postCredentialVerificationSql`, a successful five-path
  `pnpm runtime-roles:postgres:check`, five cache-disabled Hyperdrives, five
  separate private-canary queues with 14-day retention, and the absent
  raw-artifact and canary receipt buckets are needed in that order before the
  route-less canary can run. Preserve and reverify the standard usage model and
  ordinary 14-day Queue/DLQ pair; never reuse that ordinary pair for any
  private-canary path.
- Public sitemap rate limiting and its ordinary-crawler bypass policy have not
  been configured or verified on the canonical Cloudflare account.
- No real HVAC source has the required exact grants and human rights review.
- RapidAPI and MCP have no live external-channel proof.

## Required User Actions

See `PROJECT_CHECKLIST.md` `UA-001` through `UA-006`. The immediate external
gates are provider-side containment (`UA-006`), rights review (`UA-001`), secure
role/Hyperdrive entry (`UA-002`), RapidAPI enrollment (`UA-004`), and separately
authorized public hostname confirmation (`UA-005`). Filling the schema with
real data depends entirely on `UA-001`: ENERGY STAR remains deferred and
unreviewed, and its review packet's open `[REVIEWER]` questions are the owner's
to answer; automation must not sign, acquire, publish, or contact the publisher.

## Production Impact

The merged Alpha Lab isolation change (`290df13`) governs runtime schema
selection and Hyperdrive transaction isolation/lifecycle. Merged PR #26
tightens migration/runtime-role safeguards, regression coverage, and deployment
documentation only; it made no hosted mutation. The preceding
session performed the hosted private-schema migration and grant activation
described above and merged PR #24. Neither session performed a Worker
deployment, credential creation, source acquisition, publisher contact,
listing, or billing change, and neither touched the shared `public` schema.

## Previous Session Summary

Protected `main` combines usage accounting/auth, corrected Option B rights,
public web, RapidAPI, scheduled acquisition/readiness, MCP, the private-canary
topology, and final runtime least-privilege/export hardening in dependency order
through migration `0028`. Hosted migrations `0027`–`0028` remain pending
separate exact-SHA authorization and application. Earlier
review repairs add a last
practical pre-persistence rights checkpoint, exact historical authorization,
one-client resolution transactions, `source-record-evidence@3`, claim-backed
alias epochs/currentness, identifier-less successor handling, a fail-closed
credential provisioner, bounded provider-controlled input and surface
authorization, recoverable server-clock acquisition leases with
non-owner capability redaction, request-bounded keyset sitemap enumeration,
same-account deployment validation, and non-actionable HVAC source research
consistent with the owner decisions.
