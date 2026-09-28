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

   **Channels.** Web and the direct-customer API only, as for FDA Recall Intelligence (ADR-0015 creates no `mcp.data.aroqon.com`). MCP/agent access, RapidAPI and bulk export are rights-permitted but not enabled (both rights records), and each is a separate, independently gated channel decision (AGENTS.md: "one truth does not mean one permission"). When the MCP channel is opened for the recall datasets, its tools must read this dataset's query layer and meet the API/MCP parity tests before it is enabled; until then there is no MCP surface to be out of parity with.
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
