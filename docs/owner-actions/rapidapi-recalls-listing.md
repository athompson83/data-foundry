# RapidAPI listing package: Recall Intelligence API (FDA + North American consumer products)

**Status (2026-09-28): adapter built and tested, channel closed, not publishable.** Do not create the listing until every gate in [Before you publish](#before-you-publish) holds.

Billing sells access. It never creates permission (ADR-0013, ADR-0014). Both product-recall rights records permit RapidAPI. The channel decision and the adapter's behaviour are in ADR-0016, section "RapidAPI channel".

## Before you publish

1. **Proxy adapter. Done in code.** `apps/recalls-worker/src/marketplace.ts` does the following:
   - verifies `X-RapidAPI-Proxy-Secret` in constant time;
   - requires `X-RapidAPI-User`;
   - serves without touching any Stripe key or allowance, so there is no double billing;
   - never falls back to a direct `rcl_live_` key;
   - keeps `/v1/account*` off the channel.

   Tests: `apps/recalls-worker/test/worker.test.ts`, "RapidAPI channel". It stays closed (`RAPIDAPI_ENABLED = "0"`).
2. **Authenticated acceptance of the direct API for both datasets.** See `docs/owner-actions/recalls-operations.md`, "Production acceptance".
3. **Owner account actions (`UA-004`).** Provider enrollment, the marketplace agreement, payout settings, and approving the plan prices below.
4. **Activation (after 3):**
   - put the listing's proxy secret on the Worker with `wrangler secret put RAPIDAPI_PROXY_SECRET`;
   - set `RAPIDAPI_ENABLED = "1"` in `apps/recalls-worker/wrangler.toml` through a reviewed PR and the `Deploy recalls Worker` workflow;
   - send one test-subscriber request through RapidAPI and check it is served;
   - confirm that no `usage_month` row moved and that a `rapidapi_request` log line was written.

   Only then is the listing publishable.

## Listing fields

**API name**

```text
Recall Intelligence API — FDA and North American consumer-product recalls
```

**Short description**

```text
FDA food, drug and device recalls plus CPSC and Health Canada consumer-product recalls, structured, with lookup by NDC, UDI, lot, model or UPC, and per-record source provenance.
```

**Long description**

```markdown
One read-only JSON API over US and Canadian recall notices, refreshed every six hours from the agencies.

- FDA Recall Intelligence: about 87,000 FDA food, drug and device recalls from June 2012 (openFDA). Look up by NDC, UDI or lot code, filter by category, class, state and date, and search full text.
- North American Consumer Product Recalls: 10,027 CPSC and 5,206 Health Canada consumer-product notices. Look up by model number or UPC/GTIN, filter by agency, hazard, remedy, trade facet (appliance, HVAC, plumbing and water heating, electrical, building products), firm and date. Cross-agency links appear only where a CPSC notice cites the Health Canada notice (343 links).
- Every record carries provenance: source URL, parser version, SHA-256 of the stored source record, and first-seen, last-seen and changed timestamps. `include=raw` returns the source record (contact text and images removed) with a digest of what was returned.
- Incremental sync through `changed_since`, and cursor pagination.

Sources are US federal government works and Health Canada open data (Open Government Licence – Canada). Not affiliated with FDA, CPSC or Health Canada.
```

**Server URL** (verified 2026-09-28: `/` answers 200 and data paths answer 401 without a key)

```text
https://api.data.aroqon.com
```

**OpenAPI definition.** Import `https://api.data.aroqon.com/openapi.json?channel=rapidapi` (OpenAPI 3.1.0) once the release that serves it is deployed. It has the same data paths as the direct contract, with no `/v1/account*` endpoints and no bearer scheme, because RapidAPI authenticates subscribers. Both variants validate with Redocly CLI 1.x: 0 errors and 3 warnings (two operations lack a 4xx response, and there is no `info.license`). The direct variant was checked live on 2026-09-28, and the marketplace variant was generated from the release code. The direct contract is unchanged by this release.

**Authentication instructions (for subscribers).** Send your RapidAPI key as `X-RapidAPI-Key` and `X-RapidAPI-Host` on each request, as RapidAPI's generated snippets do. Do not send a `rcl_live_` key through RapidAPI; those keys belong to the direct plans at data.aroqon.com.

**Example requests**

```text
GET /v1/recalls/lookup?code=0409-6729-41
GET /v1/recalls?category=food&q=listeria&limit=10
GET /v1/product-recalls/lookup?code=<model number or UPC>
GET /v1/product-recalls?agency=CPSC&hazard=fire&facet=hvac&limit=25
GET /v1/product-recalls?linked=true&limit=25
GET /v1/product-recalls/cpsc-25203?include=raw
GET /v1/product-recalls/hc-77184
GET /v1/product-recalls/stats
```

Example **responses** must come from a live authenticated capture after acceptance passes. Do not paste parser-output samples as live responses.

## Pricing

Approved ladder (owner "Accept pricing", 2026-09-26; `docs/owner-actions/direct-api-pricing-and-invoicing-decision.md`; `apps/recalls-worker/src/account.ts`). Monthly requests are a hard stop with no overage, and both datasets are included.

| Plan | Price / month | Requests / month |
| --- | --- | --- |
| Evaluate | $0 | 100 |
| Developer | $49 | 5,000 |
| Growth | $149 | 25,000 |
| Scale | $299 | 75,000 |

There is no approved RapidAPI-specific pricing. Mirroring the ladder above (Evaluate as RapidAPI's BASIC, as in the 2026-09-26 conversion-first decision) is the proposal. Whether RapidAPI's fee is absorbed or passed on is the owner's call before publishing.

## Owner-only actions

1. Enroll or confirm the RapidAPI provider account, accept the marketplace agreement, and set up payouts (`UA-004`).
2. Approve the RapidAPI plan prices: mirror the ladder above onto BASIC/PRO/ULTRA/MEGA, or change it.
3. Copy the listing's proxy secret from the RapidAPI provider dashboard into `wrangler secret put RAPIDAPI_PROXY_SECRET` on `data-foundry-recalls`, then approve the reviewed change that sets `RAPIDAPI_ENABLED = "1"`. The end-to-end test request follows.
