# Recalls release record — 2026-09-28 (PR #73)

Scope: PR #73 (product-recall IndexNow feed) on the `data-foundry-recalls` Worker, and authenticated acceptance of North American Consumer Product Recalls (ADR-0016). No credential value appears here.

## 1. Source merged — done

- PR #73 head `62451d19e54bb99f98ff3dbce30ebd5b9dbaa396`. Required CI job `typecheck • test • migrations • vertical config` succeeded on that exact head (run 36432486040). The real-Postgres job was skipped by scope selection. Codex review completed on `62451d1` with no findings, there were no review threads, and GitHub reported `mergeable_state: clean`.
- Squash-merged 2026-09-28 as **`efc1121899d5fde038d41373bd5e3bfdfe841136`** on `main`, pinned to the expected head SHA.

## 2. Production deploy — NOT done (access block)

- Cloudflare account `c2832821a9ab36419cde6ee08112f6d3`. Worker `data-foundry-recalls` (script id `812b92b510444f4e909671942acff4bd`). D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`. R2 `data-foundry-raw-artifacts`. Custom domains `data.aroqon.com` and `api.data.aroqon.com`. Cron `17 */6 * * *`. All match `apps/recalls-worker/wrangler.toml`.
- Rollback target: the version currently live. PROGRESS records it as `40ea452b-1b4a-41c9-931b-82719b1dc7cd` (the #69 deploy). The Cloudflare connector used here does not list deployments, so this session did not independently confirm the version id.
- The live bundle, read through the Cloudflare connector at 15:5x UTC, contains `state/indexnow-watermark.json` (FDA feed) but **not** `state/indexnow-product-recalls-watermark.json` or `indexnow_product_recalls`. **The product-recall IndexNow path is merged, not deployed.** No scheduled execution of it has occurred.
- Block: this cloud session has no `CLOUDFLARE_API_TOKEN`, and the connector has no deploy operation. `.github/workflows/deploy-production.yml` does not deploy the recalls Worker. Deploying requires `cd apps/recalls-worker && CLOUDFLARE_ACCOUNT_ID=c2832821a9ab36419cde6ee08112f6d3 pnpm exec wrangler deploy` from `efc1121`, with a token scoped to Workers Scripts:Edit on that account. There are no migrations and no var changes.
- Verifying the deploy: `wrangler deployments list` shows a new version with source `efc1121`. The bundle contains `indexnow-product-recalls-watermark`. After the next `:17` cron, Workers logs show an `indexnow_product_recalls` line.

## 3. Live keyless checks against the current (pre-#73) version — passed

At 2026-09-28 ~16:05 UTC:

- **200:** `/`, `/product-recalls`, `/recalls`, `/docs`, `/product-recalls/cpsc-25203`, `/product-recalls/hc-77184`, `robots.txt`, `sitemap.xml`, `llms.txt`, the IndexNow key file, `api.data.aroqon.com/`, and `/v1/product-recalls/stats`.
- **401:** `/v1/product-recalls` and `/v1/recalls` without a key (`missing_key`), and with an unknown key (`invalid_key`).
- **Stats:** CPSC 10,027 notices and Health Canada 5,206, both latest 2026-09-24. 343 declared links. Last successful sync CPSC 12:17:45 UTC and Health Canada 12:17:52 UTC.
- **OpenAPI:** the live `api.data.aroqon.com/openapi.json` (3.1.0, server `https://api.data.aroqon.com`, bearer auth) validates with Redocly CLI 1.x with 0 errors and 3 warnings (2 × operation-4xx-response, 1 × info-license).

## 4. Authenticated product-recall acceptance — NOT passed

Procedure: the 2026-09-26 FDA acceptance, which used an internal customer provisioned in D1 and a hashed `rcl_live_` key.

1. At 15:53:35 UTC, created customer `acceptance-20260928` (email `acceptance-internal@aroqon.invalid`, `developer`, `active`, no Stripe subscription) and key id `9a7429f8-48ea-4cb3-8660-70881d9a5318`. The key was generated locally into a mode-600 file and only its SHA-256 was written.
2. Every authenticated request returned **401 `invalid_key`**, including after the key was regenerated as a 32-byte base64url body. The session's permission check denied reading the local key-handling source, so the cause was not diagnosed. Guessing further stopped there.
3. At 16:02:00 UTC, revoked the key (`revoked_at` set) and set the customer to `canceled`. Read-back showed `status=canceled`, `revoked_at=2026-09-28T16:02:00.000Z`, and `usage_month` rows = 0. The key then returned 401 on `/v1/account` and `/v1/product-recalls`. The local key files were shredded.
4. That post-revocation 401 does **not** prove revocation, because the key never authenticated. What is established is that the D1 row is revoked and no usage was metered.

Requests to production: 2 keyless, 2 with a bad key, 1 public stats, 1 account (401), 1 search (401), then 1 retry and 2 post-revocation checks. No source data or real customer was touched.

**Not verified:** any authenticated CPSC or Health Canada response, search/filter/pagination, code lookup, `include=raw` digests, entitlement or metering. Both datasets stay `BUILDING` / not customer-accepted.

## 5. Purchase flow — live journey never completed

Read-only Stripe, live account `acct_1U3gItLlvU3ZaHdi` (Aroqon Data), 2026-09-28:

- Webhook `we_1UK1TtLlvU3ZaHdiy7KqSNdW` is `enabled` → `https://data.aroqon.com/stripe/webhook`, with events `checkout.session.completed` and `customer.subscription.created/updated/deleted`.
- **0 subscriptions (any status). 10 live Checkout sessions, all `unpaid`** (open or expired internal probes, recalls plans evaluate/developer/growth/scale).
- Sandbox evidence (2026-09-26, `0900c6d`, PROGRESS) covers checkout → signed webhook → key issuance → quota → plan change → cancel → portal. It remains the only end-to-end proof. It was not re-run here.

## 6. Channels

| Channel | Status |
| --- | --- |
| Direct API (Stripe) | Live checkout sessions are created. No purchase yet. |
| RapidAPI | Not listed. The recalls Worker has no RapidAPI proxy adapter, and ADR-0016 leaves it not enabled. Package: `docs/owner-actions/rapidapi-recalls-listing.md` |
| Cloudflare Pay Per Crawl | **Unknown.** It was closed beta at the last check (2026-09-16). No zone-level read access this session. `UA-008` is open. |
| Search discovery | IndexNow submissions: FDA 84,908 (2026-09-27) and product 8,868 by hand (2026-09-28), both HTTP 200. Observed indexing: not measured. |
