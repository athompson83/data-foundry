# Stripe and recall-product revenue readiness — 2026-10-09

## Source and serving identity

- Protected `main`: `57e85e4fd9b71dee054e41d9b748ec7d40886b66`; [CI passed](https://github.com/athompson83/data-foundry/actions/runs/37487780673).
- Cloudflare account: `c2832821a9ab36419cde6ee08112f6d3`.
- `data-foundry-recalls` serves both enabled Custom Domains, `data.aroqon.com` and `api.data.aroqon.com`.
- Serving source: `0f4949c3ea7f5b9dadd37034692e9d3eb91309a2`; version `8ea7aba4-45a6-4ddc-9f76-31ff91b90661`, tag `0f4949c3ea7f`. Subsequent main changes do not change the recall Worker or its two structuring packages.
- D1 migrations `0001` through `0004` are applied. R2 raw-evidence binding is present. Cron is `17 */6 * * *`; `SALES_OPEN=1`, product recalls are open, and both dataset kill switches are off.

## Fresh live evidence

- [Production acceptance](https://github.com/athompson83/data-foundry/actions/runs/37929038201) passed 23 checks on the serving source/version: both datasets, credential denial, pagination, provenance and redacted raw-record digests, exact-code lookup, 404 handling, and exactly 11 metered requests. The internal fixture was suspended, every temporary key revoked, and subsequent requests rejected.
- Public stats returned HTTP 200: 87,581 FDA records and 15,258 consumer-product notices (10,047 CPSC; 5,211 Health Canada). Both datasets refreshed at about 06:17 UTC on October 9. The read-only D1 check found only successful sync runs since October 8.
- Stripe live prices are active: Evaluate $0/100, Developer $49/5,000, Growth $149/25,000 and Scale $299/75,000 monthly. The live Developer button opens a $49 monthly Checkout page. No purchase was executed.
- The subscription-state webhook is enabled at `https://data.aroqon.com/stripe/webhook`; D1 records the free subscription's checkout/subscription webhook events. Stripe has one active Evaluate subscription and no paid subscription. Internal fixtures or manually provisioned D1 customers are not paid revenue evidence.

## Stripe requirement — pending formal submission

Charges and payouts are currently enabled. The Dashboard says payouts will pause on October 11 unless the business-model form is supplied. The API also returns `invalid_url_website_incomplete` for the existing website. The account's old description describes broad SaaS for first responders, healthcare, education and government, while the current site sells recall-data API access.

The owner submitted the form. On October 9 the Dashboard shows "In review"; no duplicate submission was made. This is receipt of the submission, not Stripe clearance, and the Dashboard still displays the October 11 payout deadline. The site's existing terms already show the operator, support email, refund rule and cancellation policy. This change makes the support process for billing questions, refund requests and disputes explicit; it preserves the existing refund rule. Website acceptance remains Stripe's decision.

## RapidAPI — configuration repaired, launch incomplete

Existing project `api_ba3c8244-55fa-4a3f-8226-c040dcf03bab` is private. Its product description and website were corrected to the live recall offering. Its nonexistent/authenticated `/v1/health` check was replaced with `/`, which returned 200 and RapidAPI marked SUCCESS on October 9. This proves origin reachability, not marketplace delivery.

The provider has a payout account linked and no transactions. On the owner's October 9 direction, start with the free BASIC offer (500 requests/month); PRO, ULTRA and MEGA were hidden. MEGA required recovery from a provider `ECONNRESET`; the subsequent readback showed it disabled. The BASIC request configuration explicitly selects a monthly hard limit of 500. The bandwidth platform fee remains RapidAPI's separately displayed fee.

Remaining launch steps:

1. Import the current public marketplace OpenAPI contract (eight recall-data GET paths, no direct account endpoints), replacing the outdated generic definitions. Completed: the eight endpoints imported successfully after converting the equivalent public contract to OpenAPI 3.0.3 (3.1 import returned an internal error). Base URL remains `https://api.data.aroqon.com`, with canonical website terms.
2. Free-only plan configuration and the request hard limit are set; monitor actual calls after launch before deciding paid offers.
3. Obtain action-time approval for the Hub ownership/terms declaration before public visibility. The owner authorized connecting the existing proxy secret; it was installed through pinned Wrangler without exposing it in source or logs.
4. This candidate opens `RAPIDAPI_ENABLED=1` through reviewed source and the pinned deploy workflow. `RAPIDAPI_PROXY_SECRET` is installed; activation is pending deployment. Both extracted-identifier publication flags remain closed.
5. Prove a request through the RapidAPI gateway, failure with an incorrect proxy secret, and no change to direct Stripe usage before publication.

Direct paid access is operational within the evidence above; the Stripe review and unfinished marketplace launch prevent a claim that every commercial setup task is complete.

## Candidate validation

- `corepack pnpm --filter @data-foundry/recalls-worker typecheck`: passed.
- `corepack pnpm exec vitest run --root apps/recalls-worker test/site.test.ts --maxWorkers=1 --no-file-parallelism`: 16 passed.
- `corepack pnpm exec vitest run --root apps/recalls-worker test/worker.test.ts -t 'RapidAPI channel' --maxWorkers=1 --no-file-parallelism`: 6 passed; 53 unrelated tests skipped.
- Rendered the changed terms page and checked the billing-help heading and support link. `git diff --check`: passed.
- The marketplace tests prove isolation and no double billing in the local harness; they do not certify the closed live channel.
