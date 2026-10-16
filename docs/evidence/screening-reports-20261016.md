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

Implementation PR #108 merged as `cd7ed4db5fe6ee5e222193ca6fff3cdde4b7bb26`. Final-candidate CI `38920228401` passed 5,331 tests / 266 files, typecheck, generated artifacts and deployment builds. Exact-main CI `38922400711` passed those gates and the real-Postgres migration/privilege checks. Automated Codex review completed clean on final head `741987fbe28959e917cf6f2701c099dab1d47d97`; all prior findings were resolved. The superseded feature branch was removed only after its tree matched merged main.

Before migration, D1 had only 0001–0004 and no report table. Recovery bookmark: `00000ea3-00000000-00005106-1a10e74fcd9ef87808c98bcc268ed4e9`. At 2026-10-16 15:30:18 UTC, additive 0005 was applied through the authenticated canonical Cloudflare connector, followed by the migration-ledger entry. Read-back verified the exact table, uniqueness constraints, both indexes, ledger row and zero initial reports. Migration SHA-256: `4dab94301637426b66fe340659145a18fa737c372e7abb377375c7ace5d71a0e`. Local Wrangler could not authenticate this account (7403), so the connector executed the reviewed SQL; no credentials were copied and no existing data was changed.

Guarded deployment `38924498971` succeeded for the implementation SHA with `SCREENING_SALES_OPEN=0`: deployment `bdead394-7e42-48f6-ac22-3f94caf940d0`, version `578d0abe-8a92-479f-8de2-bbf679641b89`, 100% at 2026-10-16 15:43:37 UTC. Authenticated production acceptance `38926323130` passed 35 checks / 14 metered requests, including report creation, durable reopen/history, unpaid download denial, deletion/404 and revoked-key denial. The fixture closed with no active keys. The version remained unchanged throughout.

Live Chrome at 1366×900 and 375×812 confirmed the sales-closed message, working form, required branded name without an accidental request, invalid-key 401 with actionable text, key clearing after reload, no horizontal overflow and no console warnings/errors after clean reload. This is hosted browser UI/negative-path proof; authenticated persistence is the separate protected acceptance above.

The separate activation candidate now sets only `SCREENING_SALES_OPEN=1` plus these release records/runbook clarification. Candidate/main checks, guarded deployment and fresh authenticated acceptance must pass before calling sales live. The live webhook was re-read immediately before activation and remains enabled for `checkout.session.completed`. Automated review required staging and repeatable acceptance: closing the admin-only, .invalid fixture clears its non-financial report rows; six consecutive local acceptance runs pass without bypassing the ordinary customer preview cap.

## Deferred

Automated paid monitoring/alerts, widgets, affiliates, ads and evaluation packs remain deferred pending source/delivery/traffic/licensing evidence appropriate to each. Rechecking inventory is manual. Nothing here certifies safety or remedy entitlement, expands source rights, enables extracted identifiers, or proves independent paid demand.
