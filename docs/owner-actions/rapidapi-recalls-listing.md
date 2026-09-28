# RapidAPI listing package: Recall Intelligence API (FDA + North American consumer products)

**Status (2026-09-28): not publishable.** Do not create the listing yet. Two gates are open (see [Before you publish](#before-you-publish)). This file holds the copy-paste fields so the listing can go up as soon as both gates close.

Billing sells access. It never creates permission (ADR-0013, ADR-0014). Both product-recall rights records permit RapidAPI; ADR-0016 leaves the channel **not enabled** until it is decided separately.

## Before you publish

1. **Proxy adapter (engineering, not built).** `apps/recalls-worker` accepts only its own Stripe-issued `rcl_live_` keys. It has no `X-RapidAPI-Proxy-Secret` check, no marketplace principal, and no per-subscriber metering. The Postgres edge Worker's adapter (`apps/edge/src/index.ts`, `apps/edge/test/rapidapi.test.ts`) is the pattern. Without an adapter, RapidAPI subscribers could not call the API. Building it is a separate, reviewed change: an ADR-0016 channel decision, a `RAPIDAPI_PROXY_SECRET` Worker secret, tests, and no double billing with Stripe.
2. **Authenticated acceptance of both datasets.** As of 2026-09-28, product recalls have not passed authenticated acceptance ([record](../evidence/recalls-release-20260928.md)).
3. **Owner account actions (`UA-004`).** Provider enrollment, the marketplace agreement, payout settings and plan configuration in the RapidAPI dashboard.

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

**OpenAPI definition.** Import `https://api.data.aroqon.com/openapi.json` (OpenAPI 3.1.0). It validated on 2026-09-28 with Redocly CLI with 0 errors and 3 warnings: two operations lack a 4xx response, and there is no `info.license`. Before import, remove `/v1/account/*` (account management belongs to the direct channel) and the bearer scheme. RapidAPI supplies `X-RapidAPI-Key`.

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
2. Approve the RapidAPI plan prices (mirror the ladder or change it).
3. After the adapter ships: copy the listing's proxy secret into `wrangler secret put RAPIDAPI_PROXY_SECRET` on `data-foundry-recalls`, then run one test-subscriber request.
