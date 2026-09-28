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
2. Every authenticated request returned **401 `invalid_key`**, including after the key was regenerated as a 32-byte base64url body.
   **Root cause (diagnosed later the same day, section 7):** `findCustomerByKey` (`apps/recalls-worker/src/account.ts:71`) accepts only `rcl_live_` followed by exactly 32 characters. Both hand-made keys had longer bodies (40 and 43 characters), so they were refused before any D1 lookup. Customer authentication was not broken, and the hand-inserted rows were never reachable.
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

## 7. Evening follow-up: the release path is repaired in code (PR #74)

- **Diagnosis.** See section 4, step 2. Manually written credentials are no longer part of any procedure. Keys come only from the Worker (`mintApiKey` through `/admin/reissue-key`).
- **Deployment path.** `.github/workflows/deploy-recalls.yml`:
  - manual dispatch on `main` only, with a confirmation phrase and the exact approved SHA;
  - requires green push-to-`main` CI on that SHA;
  - runs in the `production` environment, with its secrets checked for presence and for the recalls account id;
  - runs the recalls typecheck and tests, and refuses a pending D1 migration;
  - records the rollback version, deploys with the tag `<sha:12>`, verifies that tag on the live version, and smoke-tests both origins;
  - shares the `deploy-production` lock with no cancellation.
- **Acceptance path.** `.github/workflows/recalls-acceptance.yml` and `apps/recalls-worker/scripts/acceptance.ts`:
  - issues a key through the operator reissue path for `cus_acceptance_internal_20260928` only;
  - runs about fifteen customer-equivalent requests covering CPSC, Health Canada and FDA;
  - checks metering against the account delta;
  - always revokes through the new `/admin/revoke-keys` and proves the key is rejected.
  - Tested against the Worker on local D1, including thrown errors, tampered data and non-internal customer ids.
- **IndexNow runtime evidence.** Each scheduled run records `state/indexnow{,-product-recalls}-last-run.json`, readable through `/admin/indexnow-status` with `trigger: "scheduled"`.
- **RapidAPI adapter.** Built and tested, and closed by default (ADR-0016 "RapidAPI channel").
- **Stripe reconciliation (read-only, live).** The four prices in `wrangler.toml` exist, are active, are monthly, and are $0/$49/$149/$299. The webhook's four events are all handled. The only purchase-path change since the 2026-09-26 sandbox run is the checkout `cancel_url` and portal `return_url`.
- **Local verification.**
  - `apps/recalls-worker`: 100/100 tests, typecheck clean.
  - Workflow contract tests: 7/7.
  - The dry-run bundle contains the product IndexNow feed, the admin endpoints and the adapter.
  - Both OpenAPI variants validate. The direct contract is identical to the live one.
- **Fixture reactivated (2026-09-28 17:45 UTC).** `acceptance-20260928` was set back to `active`, touching one row and only while it had 0 active keys, so the acceptance workflow can authenticate. It still has no key until a run issues and revokes one.

