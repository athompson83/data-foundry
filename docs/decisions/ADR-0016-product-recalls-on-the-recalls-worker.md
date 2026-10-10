# ADR-0016 — North American consumer-product recalls on the recalls Worker

**Status:** Accepted, 2026-09-27. Product Owner direction the same day: "Continue to add data types and ship to production". Earlier standing direction: datasets are composites of several sources, and any dataset with no identified restrictions is approved.

**Relates to:** ADR-0012 (capability hostnames), ADR-0013 (evidence-based rights), ADR-0015 (FDA recalls on D1), [`docs/sources/cpsc-recalls-rights-record-20260927.md`](../sources/cpsc-recalls-rights-record-20260927.md), [`docs/sources/health-canada-consumer-product-recalls-rights-record-20260927.md`](../sources/health-canada-consumer-product-recalls-rights-record-20260927.md).

## Context

Research round 3 ranked `home-product-recalls-global` first among the composites. Of its members, two government sources are ready now:
- **CPSC:** a US Government work, served by a documented API.
- **Health Canada:** an Open Government Licence index.

Together they already form a composite. CPSC notices are free text, from which model numbers, GTINs, units, hazards and remedies are extracted. Health Canada's index is a typed feed, normalised into the same taxonomy. The two are linked by a declared identifier: CPSC's `Inconjunctions` cites the Health Canada notice URL (342 of 371 citing recalls resolve).

The remaining members (EU Safety Gate, UK OPSS, ACCC, MBIE, SaferProducts incidents, ENERGY STAR) still need rights records or re-measurement. Waiting for them would hold back a useful, sellable slice (AGENTS.md: launch a narrow dataset when its gates are met).

## Decision

1. **Dataset:** `consumer-product-recalls-north-america`, with members `cpsc-recalls` and `health-canada-consumer-product-recalls`. The parser is `packages/product-recall-structuring`: deterministic, no model inference, provenance per derived field.
   - A GTIN needs a valid check digit.
   - A model number is taken only after an explicit "model" label.
   - Notices link only through declared citations. The Health Canada joint marker stays candidate evidence.
2. **Storage:** the existing D1 database `data-foundry-recalls` (migration `0003`), in separate tables:
   - `product_recall`, `product_recall_key`, `product_recall_citation` and `product_recall_fts`, so the FDA tables are untouched;
   - verbatim records as NDJSON in the existing R2 bucket under `product-recalls/`, with `raw_ref` byte ranges and `raw_sha256`, as in ADR-0015.
   - every fetched source response, archived whole before parsing under `product-recalls/source/<agency>/sha256-<hash>.json` (content-addressed, so an unchanged file is stored once) and listed in the run's `artifact_keys`, so any run can be replayed exactly, including records that were unchanged or out of scope. The initial bulk load's complete inputs are archived the same way: `product-recalls/source/cpsc/sha256-864f678cc1e34dcb60b41daaf9c4ca3614fdde6908d08dc5106a59066a69f9cf.json` (27,695,909 bytes, 10,027 notices) and `product-recalls/source/hc/sha256-9879b64121511ea77bcf434de625b68c4e2a0d5c2545bce3c7cb34536573cb68.json` (15,719,914 bytes, all 34,131 index records), uploaded 2026-09-27 and verified by read-back hash.

   Citations are resolved at read time against the target's canonical URL, so a link appears whichever notice arrives first.
3. **Serving:** the same Worker and hostnames (ADR-0012 paths, not new hostnames).
   - API: `api.data.aroqon.com/v1/product-recalls[/lookup|/stats|/<id>]`.
   - Pages: `data.aroqon.com/product-recalls[/browse|/<id>]`, plus sitemap shards, llms.txt and the catalog.

   Notice pages are indexable only for CPSC notices with a substantive description and hazard statement. Health Canada index-only pages are served `noindex` (rule 8).

   **IndexNow.** Changed, indexable notice pages (the rows the product sitemap lists) are pinged to IndexNow after every scheduled sync, on the same settle and retry rules as ADR-0015, under their own R2 watermark `state/indexnow-product-recalls-watermark.json`, so one dataset's throttled batch never holds back or skips the other's. The pings run only while the dataset is served (`PRODUCT_RECALLS_OPEN="1"` and its kill switch off), independently of FDA's `SOURCE_KILL_SWITCH`. The pages that existed before this feed (8,868 indexable notices) were submitted once by hand on 2026-09-28 (HTTP 200).

   **Channels.** Web and the direct-customer API are open, as for FDA Recall Intelligence (ADR-0015 creates no `mcp.data.aroqon.com`). MCP/agent access and bulk export are rights-permitted but not enabled (both rights records). RapidAPI completed the owner-approved free-first public release on October 9 (see **RapidAPI channel** below). Each is a separate, independently gated channel decision (AGENTS.md: "one truth does not mean one permission"). When the MCP channel is opened for the recall datasets, its tools must read this dataset's query layer and meet the API/MCP parity tests before it is enabled; until then there is no MCP surface to be out of parity with.
4. **Commerce:** the existing keys and plan ladder cover the dataset. There is no repricing and no new Stripe objects.
5. **Gates:**
   - `PRODUCT_RECALLS_KILL_SWITCH="1"` stops acquisition and serving, the rights kill switch for both sources.
   - `PRODUCT_RECALLS_OPEN` must be `"1"` to serve. With it unset, acquisition still runs, so the dataset can load before it opens.

   The FDA `SOURCE_KILL_SWITCH` no longer withdraws this dataset, and this dataset's gates do not touch FDA's.
6. **Freshness:** every six hours, the Cron reads CPSC notices published or updated in the last 30 days and the whole Health Canada index. The first run of each UTC day re-reads the full CPSC list. A full list below a floor (9,000 CPSC; 4,500 Health Canada consumer records) is treated as a failed fetch, never as deletions. Unchanged records are only touched.

## Consequences

- One Worker now serves two datasets. The Worker is dataset-agnostic in routing but not yet in code: a third dataset should extract the shared storage/sync/page pattern rather than copy it a third time.
- The initial load uses `tooling/scripts/product-recalls-bulk-load.ts`, which uses the Worker's own statement builders and renders statements under D1's 100 KB limit.
- Health Canada notices without a CPSC citation stay unlinked. Reviewing joint-marker candidates, and adding EU/UK/AU/NZ members, extend the same tables.

## RapidAPI channel (2026-09-28)

Both rights records permit RapidAPI redistribution. The recalls Worker now carries a marketplace adapter (`apps/recalls-worker/src/marketplace.ts`), following the edge Worker's pattern (`apps/edge/src/index.ts`).

- **Trust.** Any request carrying an `x-rapidapi-*` header is marketplace-shaped. It is decided by the adapter and is never passed to direct-key authentication. It is served only when `RAPIDAPI_ENABLED = "1"` and the `RAPIDAPI_PROXY_SECRET` Worker secret (the listing's `X-RapidAPI-Proxy-Secret`) matches, compared in constant time over SHA-256 digests. A missing or wrong secret returns 401 `invalid_proxy_secret`, and a closed channel returns 403 `marketplace_disabled`, even when the request also carries a valid `rcl_live_` key. So spoofed headers cannot borrow a direct customer's key, and a direct key sent through RapidAPI is never looked up.
- **Subscriber context.** `X-RapidAPI-User` is required (1–128 characters). `X-RapidAPI-Subscription` (BASIC, PRO, ULTRA, MEGA, CUSTOM) is recorded when present.
- **Metering and billing.** RapidAPI is the meter and biller of record for its subscribers. Marketplace requests touch no Stripe customer, key or `usage_month` row, so nothing is billed twice. Every marketplace-shaped response writes exactly one `rapidapi_request` log line: stats cache hits, refusals and errors included, and requests refused before a subscriber is verified, which are marked `verified: false` and logged with their refusal code (status, path, subscription, and a 16-hex digest of the username, never the username), for reconciliation against RapidAPI's invoices. The account endpoints (`/v1/account*`) return 403 on this channel.
- **Contract.** `GET /openapi.json?channel=rapidapi` is the import contract: the same data paths, with no account endpoints and no bearer scheme.
- **Pricing (amended 2026-10-09).** The owner directed a free-first launch to measure calls before upgrading. BASIC is $0 with a hard limit of 500 requests/month; PRO, ULTRA and MEGA are hidden. This supersedes the unapproved proposal to mirror direct Stripe pricing. RapidAPI enforces request quotas and separately displays its bandwidth platform fee. The direct Stripe ladder is unchanged.
- **Activation (amended 2026-10-09).** The existing provider account and payout link are verified; eight recall endpoints and a usage guide are saved. The owner authorized installing the existing proxy secret without rotation. Reviewed source `a8e875e` deployed with `RAPIDAPI_ENABLED="1"`, then actual FDA/CPSC gateway requests returned 200, wrong-secret traffic returned 401 and direct usage stayed unchanged. The owner subsequently approved the Hub ownership/Terms declaration at action time. The declaration was accepted and Public visibility saved; the published Hub and free 500/month hard-limit pricing were verified. No paid plan was enabled. Do not repeat completed import, secret installation or publication, expose direct customer account routes, or open either extracted-identifier publication flag. The pinned deploy workflow, source/version identity and independent channel kill switch remain required. Tests: `apps/recalls-worker/test/worker.test.ts`, "RapidAPI channel"; [release record](../evidence/revenue-readiness-20261009.md) and [PR #93](https://github.com/athompson83/data-foundry/pull/93).
