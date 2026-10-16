# Batch screening revenue offer — 2026-10-16

## Scope and repository

The owner requested implementation of the supplied finished-result revenue proposal. Adds a $29 standard batch report and $49 branded report (text business name), free complete findings preview, saved snapshots, CSV, printable HTML/PDF workflow and remedy worksheet. These are experimental prices. No independent purchase or revenue is claimed.

Canonical base: `athompson83/data-foundry` main `2f7b45cdaf96dad02f701fe32a031a9dd501021a`. Isolated branch `codex/batch-screening-revenue-20261016`. The attached `Documents/ChatGPT/Data Foundry` checkout is an older dirty checkout and was preserved. No other open PR or collector configuration was changed.

Canonical target: Cloudflare account `c2832821a9ab36419cde6ee08112f6d3`, Worker `data-foundry-recalls`, D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`. Baseline Worker `485c4ef7-2bb2-476d-b530-5db7309f5308` served source `2f7b45c`; migrations 0001–0004; 10,053 CPSC and 5,216 HC notices. Postgres private-canary infrastructure is outside this slice.

## Local verification

- `corepack pnpm install --frozen-lockfile` — passed (Node 24.19.0, pnpm 9.15.4).
- `corepack pnpm run typecheck` — passed.
- `corepack pnpm exec vitest run apps/recalls-worker/test tooling/test/readme-inventory.test.ts tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts --maxWorkers=2 --reporter=json --outputFile=.data/final-tests.json` — 302 passed, 14 files.
- `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .data/screening-bundle` — passed; 401.46 KiB / gzip 113.12 KiB.
- `git diff --check` — passed.

Uses SQLite running the actual D1 schema and additive 0005. Coverage includes four outcomes, source freshness, deterministic identifier gates, malformed uploads, same-account durable reload, other-account denial, five-preview concurrency cap, current rights withdrawal on stored contents, escaped/formula-safe output and source attribution, deletion/retention, signed webhook replay, forged webhook denial, server-owned prices, duplicate Checkout idempotency, wrong customer/report/amount/mode denial, refunds/disputes, missed-webhook recovery, billing failure and revoked keys. Provider-failure tests use mocks; they are not provider event-delivery proof.

Chrome at 1366×900 and 375×812: actual local Worker preview created all four outcomes, history reopened the original snapshot, no horizontal overflow, no console warnings/errors. Keys clear across navigation and must be re-entered after Checkout. UI screenshots were inspected inline; no customer records were published.

Automated review identified expired failed reservations retaining metadata and an abandoned Checkout blocking deletion. Both were repaired with regression coverage: expired non-financial reservations are removed; deletion after the fixed 23-hour Checkout expiry reconciles customer sessions, preserves a recovered payment reference, and then erases inventory. An incomplete scan or provider failure grants no deletion. The local test server was stopped after acceptance.

Further review requires a nonblank business name before reserving a branded preview. Safe local checkout errors preserve actionable status/message (for example, an expiring preview returns 400 and asks for a new check); provider error text remains opaque. Both cases have regression coverage. The canonical checklist/progress records track REV-019 and the staged release gates.

Review also identified kind filtering after the canonical lookup cap. The shared query now accepts an optional known identifier kind and filters before limiting; existing API callers retain their combined interpretation. A real-parser fixture with 101 newer numeric-model-only notices proves the barcode's older matched notice remains visible and that per-kind memoization stays separate. Inventory model length now matches the canonical query's 64-character bound.

Scheduled cleanup now reconciles expired abandoned Checkout attempts before erasing content: a confirmed absent session removes the row, a recovered paid session preserves and extends the snapshot, and provider failure retains it for retry. Two regressions exercise absence/outage and recovered payment. This also prevents private metadata surviving forever after an unbound attempt becomes inaccessible.

## Real Stripe sandbox evidence

Account `acct_1U3gItLlvU3ZaHdi`, test mode only; synthetic customer and card, no real money. Standard $29 Checkout `cs_test_a1L8zRZvz0tXcarqnYqGzs2D7F0Fpi3byltR8ti3fw3kW6ajiekovqAkgC`: completed/paid with succeeded intent, paid non-refunded non-disputed charge. This first session was an isolated price probe, not an app-bound report.

Branded $49 app-generated report `3639d210-bb64-48f4-b1a9-c4fcb21c54fb` bound to Checkout `cs_test_a17SyE0cfZGQruyhIqtRGiRu6fAGmgmp4UOF0iVm6M0CjqnMMkLrigcBuu`: completed/paid, succeeded intent, charge paid, refunded=false, disputed=false, amount_refunded=0. Browser returned, re-entered the local fixture key, reopened the saved report and downloaded printable output through the actual Worker handler's verification.

After that successful download, test refund `re_3URBVcLlvU3ZaHdi0XY9zzPK` succeeded for all 4,900 cents. A fresh connector read showed refunded=true/amount_refunded=4900. Replaying the minimal real refund receipt through the local Worker download route returned 402 `payment_required` (`corepack pnpm exec tsx .data/refund-check.ts`). This is real sandbox refund state plus local access-denial proof, not a production refund or provider webhook-delivery test.

Transport boundary: a private ignored local adapter relayed the Worker's generated requests to the authenticated Stripe connector. The connector uses API `2026-09-30.preview` and required `allowed_payment_method_types`; only that field was translated from the Worker's `payment_method_types` for this test. Production retains the existing pinned `2024-06-20` transport and card-only parameter ([Stripe Checkout API](https://docs.stripe.com/api/checkout/sessions/create)). This proves real sandbox payment objects and app fulfillment, not a deployed test-mode Worker or production charge.

Read-only live webhook verification: `we_1UK1TtLlvU3ZaHdiy7KqSNdW`, enabled at `https://data.aroqon.com/stripe/webhook`, includes `checkout.session.completed` plus existing subscription events. No live Stripe configuration was changed. Production signed delivery for a new one-time report remains to be observed on a real purchase; authenticated downloads can independently recover it.

## Release record

Pending protected PR/main checks, additive migration, guarded deploy and authenticated production acceptance. The initial candidate keeps `SCREENING_SALES_OPEN=0`. After that exact implementation passes production acceptance, a separate reviewed activation change can set it to 1 and pass the guarded release path again. Automated review also required this staging and repeatable acceptance: closing the admin-only, .invalid fixture now clears its non-financial report rows; six consecutive acceptance runs pass without bypassing the ordinary customer preview cap.

## Deferred

Automated paid monitoring/alerts, widgets, affiliates, ads and evaluation packs remain deferred pending source/delivery/traffic/licensing evidence appropriate to each. Rechecking inventory is manual. Nothing here certifies safety or remedy entitlement, expands source rights, enables extracted identifiers, or proves independent paid demand.
