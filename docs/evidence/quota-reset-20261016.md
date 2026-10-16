# Direct API quota reset and retry guidance — 2026-10-16

## Verdict

**SOURCE QUALIFIED; release and consumer verification pending.** Direct data responses now describe the existing UTC monthly allowance reset. Exhausted direct calls provide Retry-After, allowing the existing collector to wait instead of retrying hourly. No subscription, price, allowance, billing ledger, source permission or publication gate is expanded. Deployment, browser/gateway acceptance and the next ordinary collector quota response remain separate gates.

## Checklist Snapshot

REV-017 is added as IN_PROGRESS for the public quota/retry contract and hosted consumer verification. REV-011 stays IN_PROGRESS for CPSC full-history reconciliation and scheduled source-error verification; REV-012 still requires productive collection, current-runtime benchmark and separately authorized publication. REV-008/REV-013 independent paid consumption/buyers remain unverified. No unstable portfolio percentage is asserted.

## Progress Report

Canonical base `3f4cf2a1df65e239cca6c4aef857bbacb7f331d8`, existing isolated worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`, branch `codex/quota-reset-20261016`. Previous documentation-main CI 38855485997 is confirmed successful. The old dirty chat checkout and ignored receipts are preserved.

One Date snapshot now supplies both the existing atomic usage ledger and reset metadata. Successful direct data responses and exhausted 429 responses carry X-RateLimit-Reset (Unix seconds), limit and remaining headers. Exhausted 429 additionally carries Retry-After (positive whole seconds), a precise reset timestamp in its message and private/no-store caching. CORS exposes the quota headers. The error code and envelope remain compatible. Marketplace calls bypass direct metering/headers; account, catalog and stats remain unmetered.

The direct OpenAPI describes these headers on all seven metered operations; the marketplace definition omits them. Landing FAQ, human docs, machine docs, collector guidance and the RapidAPI operating guide distinguish direct quota resets from marketplace rules. The public Hub guide still needs its actual save/read-back after deployment; no new endpoint import or financial/provider configuration is needed.

## Problems Found and Fixed

The API omitted Retry-After on monthly exhaustion. The collector already honors that standard header, but without it `_wait_for_allowance` defaults to 3,600 seconds. An ordinary installed read-job event and its next due time confirm that behavior. The fix sends the actual monthly delay instead of changing the collector's limits, spending more allowance or creating another key.

Regression tests cover October, non-leap/leap February, subsecond year rollover, the UTC ledger rollover, all three API families, CORS, unmetered account reads, private exhausted responses and marketplace isolation even with an exhausted direct key. Nine tests failed before implementation; the existing marketplace-isolation case passed. All ten pass after repair.

Production acceptance now aggregates reset/CORS checks across its existing successful data requests, without making extra data calls. A regression demonstrated that the previous acceptance ignored a missing reset header; it now fails and still revokes the fixture key. Payload-only transport fixtures retain their actual headers so refresh/parity checks keep their intended meaning.

## Required User Actions

None. No plan upgrade, purchase, new agreement, credential replacement or prospect message is requested. The source reader is not forced to retry its exhausted key. Ordinary background activity is observed read-only.

## Recommended Next Steps

Finish protected review/CI, exact-main CI, guarded Cloudflare deployment and authenticated acceptance with revocation. Verify live desktop/mobile FAQ/docs and save/read back the existing RapidAPI guide; make a bounded BASIC gateway call and compare direct allowance accounting. Observe the collector's next ordinary quota response and due time, without dispatching an exhausted data request. Keep scheduled source-error qualification separate: an ordinary healthy Cron pass alone does not prove its negative path.

## Repository and Evidence Record

Baseline refreshed around 05:30Z: existing Worker `data-foundry-recalls`, source `38d9a87f91fc4a7afd39d82b48105ec9c375c6d7`, version `ba74649a-13ca-4fec-b2b1-82c9b617bdb8` at 100%, deployment `2504eb05-ed3d-49e6-896b-483e4d0d2f55`. D1 `84acdedd-4d3e-457e-9bdc-3b118590e172` has migrations 0001–0004 and 10,053 CPSC / 5,216 HC notices. Internal acceptance fixture is suspended with zero active keys. Both extracted-identifier publication flags remain 0; existing sales/product/marketplace/intake gates and source kills are preserved. Canonical R2 and Postgres/Supabase infrastructure are unchanged.

Read-only collector receipt `05:46:07.825Z`: 8 extracted / 8 skipped, 12 historical server accepted / 13 agency duplicates, zero queryable, six historical acknowledged submissions. Read job pending, attempts 0, due `05:50:42.634Z`; latest allowance wait 3,600 seconds. Verify job due `05:47:19.485Z`, attempts 0. Five API requests used in the current local daily counter. These are existing totals, not new productive output. Secret-free receipt: ignored `.data/quota-collector-before.json`.

Local verification: `corepack pnpm run typecheck` passed. `corepack pnpm exec vitest run apps/recalls-worker/test tooling/test/readme-inventory.test.ts tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts --maxWorkers=2` passed 12 files / 257 tests. Focused quota/acceptance tests passed 24 tests after repair. `git diff --check` passed. Fresh protected/source/runtime results must be recorded before promoting their respective gates; logs are ignored `.data/quota-*`.

Recovery: revert this additive header/documentation change; the existing ledger requires no migration or restoration. The baseline Worker version above is the rollback target for this release. No source data deletion is involved.
