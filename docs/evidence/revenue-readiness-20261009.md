# Stripe and recall-product revenue readiness — 2026-10-09

## Source and serving identity

- Release source on `main`: `a8e875eec327ccaad1261f7804e3a12430f90ac2`; [exact-main CI passed](https://github.com/athompson83/data-foundry/actions/runs/37935680210). This documentation closeout does not alter the deployed Worker or its packages.
- Cloudflare account: `c2832821a9ab36419cde6ee08112f6d3`.
- `data-foundry-recalls` serves both enabled Custom Domains, `data.aroqon.com` and `api.data.aroqon.com`.
- Serving source: `a8e875eec327ccaad1261f7804e3a12430f90ac2`; version `eafd2479-65b6-4f50-b8f6-6ab4d9ae2092`, tag `a8e875eec327`, [deploy 37937432766](https://github.com/athompson83/data-foundry/actions/runs/37937432766). Rollback: `b17218c7-3204-4022-9581-d60ce9bc7aa7`.
- D1 migrations `0001` through `0004` are applied. R2 raw-evidence binding is present. Cron is `17 */6 * * *`; `SALES_OPEN=1`, product recalls are open, and both dataset kill switches are off.

## Fresh live evidence

- [Fresh production acceptance](https://github.com/athompson83/data-foundry/actions/runs/37937570649) passed all 22 recorded checks on the exact new source/version: both datasets, credential denial, pagination, source provenance, redacted raw digests, exact lookup and 404 handling. Eleven metered requests counted once; the fixture closed, all temporary keys revoked and subsequent requests denied. The expected-source gate also passed.
- Public stats returned HTTP 200: 87,581 FDA records and 15,261 CPSC/Health Canada notices in the latest observed October 9 refresh at 12:17 UTC. The read-only D1 check found only successful sync runs since October 8.
- Stripe live prices are active: Evaluate $0/100, Developer $49/5,000, Growth $149/25,000 and Scale $299/75,000 monthly. The live Developer button opens a $49 monthly Checkout page. No purchase was executed.
- The subscription-state webhook is enabled at `https://data.aroqon.com/stripe/webhook`; D1 records the free subscription's checkout/subscription webhook events. Stripe has one active Evaluate subscription and no paid subscription. Internal fixtures or manually provisioned D1 customers are not paid revenue evidence.

## Stripe requirement — resolved

The owner had submitted the form. During the session it progressed from In review to Completed. Dashboard: no active tasks and payments/payouts active. Live account API: charges_enabled and payouts_enabled true; no due, eventually-due, past-due or pending-verification requirements and no errors. The October 11 payout warning is gone. No duplicate submission was made.

The account product description now matches Data Foundry. The verified support email, support URL, privacy URL and terms URL were saved. Legal identity, tax details, bank and credentials were unchanged. This source change makes the existing billing/refund/dispute support process explicit without changing the refund rule.

## RapidAPI — public free launch completed

Existing project `api_ba3c8244-55fa-4a3f-8226-c040dcf03bab` has accurate recall metadata, the canonical website/terms, eight imported recall GET endpoints and a usage guide. The equivalent OpenAPI 3.0.3 contract imported after the 3.1 import returned an internal error; nullable unions became nullable:true, with paths and parameters preserved. The origin health check is SUCCESS.

BASIC only: $0, 500 requests/month with a hard request limit. PRO, ULTRA and MEGA are hidden. The platform's separately displayed bandwidth fee remains. The existing payout link was not changed. The owner authorized transferring the existing listing proxy secret; it was installed securely as `RAPIDAPI_PROXY_SECRET`. No secret value is in source/evidence, and the protected temporary transfer file was removed.

The pinned release opened `RAPIDAPI_ENABLED=1`. Independent Cloudflare version readback confirmed that flag, the secret binding and both extracted-identifier publication flags at 0.

Real gateway proof via the existing subscribed BASIC application:

| Request | Result |
| --- | --- |
| FDA `/v1/recalls/H-1275-2026?include=raw` | 200; structured fields, attribution and raw provenance |
| CPSC `/v1/product-recalls/cpsc-27022?include=raw` | 200; source evidence |
| Marketplace-shaped request with wrong proxy secret | 401 `invalid_proxy_secret`; unverified rejection log |
| Direct allowance before/after these requests | Unchanged in every stored month; no double billing |

Each gateway request emitted the structured marketplace log with BASIC subscription and a username digest. No direct Data Foundry key was sent through RapidAPI. After these tests passed, the owner explicitly approved accepting the Hub ownership/Terms declaration and publishing free BASIC. The declaration was accepted, Public visibility enabled and Save completed. The saved Studio state is Public; the [published Hub](https://rapidapi.com/athompson83/api/data-foundry) shows the updated offer, eight endpoints and usage guide. Public pricing displays BASIC $0, 500/month, Hard Limit; paid plans are unavailable. The existing owner application retains its deprecated free 500,000/month plan, visible to that subscriber; it was used for gateway delivery tests. This does not prove exhaustion of the new 500-request quota, whose hard limit was verified in provider settings and public pricing. No new consumer subscription or payment was executed.

Direct paid access remains operational, Stripe is clear, and real marketplace delivery is verified. No paid customer or new financial transaction is claimed. Post-publication status is recorded in [release PR #93](https://github.com/athompson83/data-foundry/pull/93).

## Release validation

- `corepack pnpm --filter @data-foundry/recalls-worker typecheck`: passed.
- `corepack pnpm exec vitest run --root apps/recalls-worker test/site.test.ts --maxWorkers=1 --no-file-parallelism`: 16 passed.
- `corepack pnpm exec vitest run --root apps/recalls-worker test/worker.test.ts -t 'RapidAPI channel' --maxWorkers=1 --no-file-parallelism`: 6 passed; 53 unrelated tests skipped.
- Rendered the changed terms page and checked the billing-help heading and support link. `git diff --check`: passed.
- All 75 site/API tests and [hosted full CI](https://github.com/athompson83/data-foundry/actions/runs/37932155041) passed before this documentation-only reconciliation. The tested Worker source is unchanged. The pinned deployment, fresh direct acceptance and actual gateway proof subsequently passed.
