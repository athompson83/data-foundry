# RapidAPI listing package — US Vehicle Recalls & Fuel Economy API (`vehicles`)

**Status: prelaunch. Do not make the listing public yet.** This is the
copy-paste package for `UA-004` on the vehicles dataset, following the
2026-09-26 conversion-first decision
([`conversion-first-decision-20260926.md`](../commercial-validation/conversion-first-decision-20260926.md)):
RapidAPI is the lead channel, the free tier is RapidAPI's BASIC plan, and
overage is a hard stop.

Publish only after every gate in [Before you publish](#before-you-publish)
holds. Billing sells access; it never creates permission (ADR-0013, ADR-0014).

The plan table below is drift-checked against `verticals/vehicles/product.yaml`
by `tooling/test/rapidapi-vehicles-listing.test.ts`. Change prices or
allowances in `product.yaml` first, then here, in the same pull request.

## Before you publish

All must be true. None is true on 2026-09-26.

1. **Rights.** A written ADR-0013 determination for `nhtsa-recalls` and
   `epa-fueleconomy-vehicles` decides the `RAPIDAPI` surface cell, and both
   sources are activated (`verticals/vehicles/RIGHTS.md`, `UA-009`).
2. **Real data.** Captured artifacts have replaced the synthetic fixtures, the
   column assumptions in `verticals/vehicles/SOURCES.md` are verified (including
   the `RCLTYPECD` codes the vehicle-only row filter relies on), and the live
   database serves real vehicles records.
3. **Deployment.** The vehicles edge Worker (`data-foundry-edge-vehicles`) is
   deployed with its marketplace route and `RAPIDAPI_HOSTNAME`, and all three
   `RAPIDAPI_*` settings are installed
   (`docs/owner-actions/cloudflare-deployment.md` sections 10.1 and 10.2).
4. **Path prefix.** RapidAPI calls the public prefixed paths
   (`/v1/vehicles/...`). The generated OpenAPI file lists the internal
   `/v1/...` paths, so import the prefixed copy made in
   [Import the OpenAPI file](#import-the-openapi-file), never the raw file.

## Listing fields

**API name**

```text
US Vehicle Recalls & Fuel Economy API
```

**Short description** (RapidAPI's one-line field)

```text
Open NHTSA safety recalls by make, model and year, with EPA fuel economy. VIN-to-recalls lookup is planned, not yet available.
```

**Long description**

```markdown
Look up open US safety recalls for a vehicle, joined with its EPA fuel economy, from US federal data, through one read-only JSON API.

**Headline use case: VIN → open recalls.** This lookup is on the roadmap and is **not available yet**. It needs NHTSA vPIC VIN decoding, which has not been captured. Today, recalls are matched at make, model and model-year level.

**Current coverage: prelaunch.** Real-source coverage depends on the NHTSA and EPA rights determinations and live data capture. The API reports only data it is permitted to show. There is no commercial freshness guarantee during validation.

What you can query:
- Recall campaigns: NHTSA campaign number, component, defect summary, consequence, remedy, manufacturer, report date, and do-not-drive / park-outside advisories where published.
- Model years: which recall campaigns affect a make/model/year.
- Configurations: EPA-tested engine, drive, transmission, fuel, city/highway/combined MPG (MPGe for EVs), tailpipe CO2 and EV range.
- Exact-identifier search (campaign number, EPA vehicle id, make + model + year) ahead of text search, faceted filters, and side-by-side comparison.

Every value carries its source lineage. Recalls, configurations and model years are linked only by deterministic identifiers, never by guesswork.

Limitations:
- A campaign may cover only part of a model year's production. Only a VIN check with the manufacturer or at nhtsa.gov/recalls confirms whether a specific vehicle is included.
- Recall text is the manufacturer's report as published by NHTSA, not an NHTSA finding. Remedy availability can change.
- Fuel economy is EPA label data for a tested configuration. Real-world results vary.
- A model named differently by EPA and NHTSA is not joined automatically. An absent recall means none is matched, not that none exists.

Data: U.S. Department of Transportation, NHTSA (recalls) and U.S. EPA / U.S. DOE fueleconomy.gov (fuel economy). Not endorsed by NHTSA, EPA, DOE or the U.S. Department of Transportation.
```

**Category:** `Data` (fallback: `Transportation`).

**Tags** (RapidAPI allows a limited number; use them in this order):

```text
vehicle recalls, NHTSA, recall API, fuel economy, EPA, VIN, automotive, car data, MPG, vehicle data
```

**Website / terms:** `https://data.aroqon.com/vehicles` once the public page is
live; until then leave it blank rather than point at a placeholder.

## Plans

Create the four standard public plans plus one custom plan. Every plan has a
**hard limit** on its monthly request quota and **no overage fee**: RapidAPI
stops the subscriber at the quota instead of billing more. Upgrades are a plan
change in RapidAPI.

<!-- plan-table:start -->
| RapidAPI plan | Data Foundry plan | Price (USD / month) | Requests / month | Visibility |
| --- | --- | --- | --- | --- |
| BASIC | Evaluate | $0 | 100 | Public |
| PRO | Starter | $9 | 1,000 | Public |
| ULTRA | Developer | $49 | 5,000 | Public |
| MEGA | Growth | $149 | 25,000 | Public |
| Custom | Scale | $299 | 75,000 | Private, by invitation |
<!-- plan-table:end -->

Settings for **each** plan in RapidAPI Studio (Hub Listing > Plans & Pricing;
labels as seen at the time of writing, confirm in the Studio UI):

- Billing: monthly subscription at the price above. BASIC is free and
  requires no card.
- Quota object: `Requests`, period `Monthly`, limit as in the table.
- Limit type: **Hard limit**. Leave the overage price unset or `0`.
- Rate limit: none beyond the quota at launch. The edge's own protections still
  apply.
- All endpoints enabled on every plan.

## Base URL and proxy secret

- **Base URL:** `https://<rapidapi-hostname>`. `<rapidapi-hostname>` is the
  exact `RAPIDAPI_HOSTNAME` in `apps/edge/wrangler.vehicles.production.toml`.
  Its only route is `<rapidapi-hostname>/v1/vehicles/*` on the vehicles edge
  Worker. It must not be the DIRECT host `api.data.aroqon.com`.
- **Proxy secret:** RapidAPI Studio > Hub Listing > Gateway shows the
  `X-RapidAPI-Proxy-Secret` value. Install it on the vehicles Worker. Paste the
  value at the prompt; never put it on the command line or in a file:

  ```powershell
  pnpm exec wrangler secret put RAPIDAPI_PROXY_SECRET --config apps/edge/wrangler.vehicles.production.toml --env-file tooling/wrangler-empty.env
  ```

- **Origin credential:** mint the marketplace service key straight into the
  Worker's `RAPIDAPI_API_KEY`. The exact dry-run and live commands are in
  `docs/owner-actions/cloudflare-deployment.md` section 10.2. RapidAPI and its
  subscribers never see this key. Do not configure any `Authorization` header
  or origin credential in RapidAPI.
- Keep RapidAPI request/response logging at the minimum the Studio allows.

## Import the OpenAPI file

Source file: `openapi/data-foundry-vehicles-rapidapi-v1.openapi.json`. It is
generated and drift-checked (`pnpm openapi:check`) and omits the origin bearer.

Its paths are the internal `/v1/...` surface. The vehicles Worker serves them
under `/v1/vehicles/...`. Make a prefixed copy outside the repository and import
that copy:

```powershell
node -e "const fs=require('fs'),os=require('os'),path=require('path');const d=JSON.parse(fs.readFileSync('openapi/data-foundry-vehicles-rapidapi-v1.openapi.json','utf8'));d.paths=Object.fromEntries(Object.entries(d.paths).map(([p,v])=>[p.replace(/^\/v1\//,'/v1/vehicles/'),v]));const out=path.join(os.tmpdir(),'data-foundry-vehicles-rapidapi-import.json');fs.writeFileSync(out,JSON.stringify(d,null,2)+'\n');console.log(out)"
```

In RapidAPI Studio > Definitions, import the printed file. Then check that
there are exactly seven GET endpoints: `/v1/vehicles/health`,
`/v1/vehicles/entities/by-slug/{slug}`, `/v1/vehicles/entities/{id}`,
`/v1/vehicles/entities/{id}/facts`, `/v1/vehicles/entities/{id}/relationships`,
`/v1/vehicles/search` and `/v1/vehicles/compare`. Re-import after every change
to the generated file.

## Attribution and disclaimer

Put this text at the end of the long description, and also in the listing's
Terms/About section:

```text
Data: U.S. Department of Transportation, National Highway Traffic Safety Administration (NHTSA) recall data (manufacturer-reported), and U.S. Environmental Protection Agency / U.S. Department of Energy fueleconomy.gov vehicle data. This API is not endorsed by NHTSA, EPA, DOE or the U.S. Department of Transportation. Recall information is matched at make, model and model-year level; confirm whether a specific vehicle is affected with the manufacturer or at nhtsa.gov/recalls.
```

It matches each source's `attribution_requirement` in
`verticals/vehicles/sources/*.yaml` and the `limitations` in `product.yaml`.
Do not describe the data as official, certified or government-approved.

## Test-subscriber verification

Run this on the live listing, while it is still private, before making it
public. Record the evidence (times, status codes, non-secret ids; no keys)
under `docs/evidence/`.

1. **Subscribe.** With a separate RapidAPI test account, subscribe to BASIC.
2. **Health.** In the RapidAPI test console, call `GET /v1/vehicles/health`.
   Expect `200`.
3. **Real query.** Call `GET /v1/vehicles/search?q=<a known campaign number>`.
   Expect `200`, with the exact campaign first.
4. **Metering and billing source.** In the canonical database, the newest
   `api_usage_events` rows for the vehicles vertical have
   `access_tier = 'RAPIDAPI'` and `billing_source = 'RAPIDAPI'`. No Stripe
   invoice or customer is created for these calls.
5. **Bypass refused.** From outside RapidAPI:

   ```powershell
   curl.exe -sS -o NUL -w "%{http_code}`n" https://<rapidapi-hostname>/v1/vehicles/health
   curl.exe -sS -o NUL -w "%{http_code}`n" -H "X-RapidAPI-Proxy-Secret: wrong" https://<rapidapi-hostname>/v1/vehicles/health
   curl.exe -sS -o NUL -w "%{http_code}`n" -H "X-RapidAPI-User: spoofed" https://api.data.aroqon.com/v1/vehicles/health
   ```

   Each must be `401`. The third proves RapidAPI headers on the DIRECT host
   are refused.
6. **No self-service billing on the marketplace host.**
   `https://<rapidapi-hostname>/v1/vehicles/billing/plans` must be `404`.
7. **Hard stop.** Make 101 calls in the month on BASIC (or lower a private test
   plan's quota to 3). The call over the quota must be refused by RapidAPI
   (`429`), with no overage charge.
8. **Cancel.** Cancel the test subscription after recording the evidence.
