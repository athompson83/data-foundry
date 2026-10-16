# Direct API quota reset and retry guidance — 2026-10-16

## Verdict

**COMPLETE for REV-017.** The direct quota contract is serving on Cloudflare with exact-main CI, authenticated acceptance, live browser/docs and public RapidAPI guide/gateway verification. The installed collector's ordinary `06:50Z` response supplies a 1,357,751-second wait and reschedules until November 1 UTC, with attempts and direct usage unchanged. Direct data responses describe the existing UTC monthly reset; exhausted calls provide Retry-After. No subscription, price, allowance, billing ledger, source permission or publication gate is expanded.

## Checklist Snapshot

REV-017 is DONE with the ordinary hosted consumer quota wait observed. REV-011 stays IN_PROGRESS for CPSC full-history reconciliation and scheduled source-error verification; the healthy 06:17Z source pass does not close either. REV-012 still requires productive collection, current-runtime benchmark and separately authorized publication. REV-008/REV-013 independent paid consumption/buyers remain unverified. No unstable portfolio percentage is asserted.

## Progress Report

Canonical base `3f4cf2a1df65e239cca6c4aef857bbacb7f331d8`, existing isolated worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`, branch `codex/quota-reset-20261016`. Previous documentation-main CI 38855485997 is confirmed successful. The old dirty chat checkout and ignored receipts are preserved.

PR #104 merged as `1fb2cb8d0846ab69e5b2e46ff0f525c4b9739106`, serving at 100% as version `cb45d589-0006-4501-bef1-a3731c719116`. Canonical main was safely fast-forwarded. The merged source branch was proved to contain no unique work and removed with a remote-head lease; documentation closeout uses `codex/quota-closeout-20261016`. No unrelated branch, source record or ignored receipt was removed.

One Date snapshot now supplies both the existing atomic usage ledger and reset metadata. Successful direct data responses and exhausted 429 responses carry X-RateLimit-Reset (Unix seconds), limit and remaining headers. Exhausted 429 additionally carries Retry-After (positive whole seconds), a precise reset timestamp in its message and private/no-store caching. CORS exposes the quota headers. The error code and envelope remain compatible. Marketplace calls bypass direct metering/headers; account, catalog and stats remain unmetered.

The direct OpenAPI describes these headers on all seven metered operations; the marketplace definition omits them. Both deployed definitions were independently fetched at `06:31:33.464Z` and match that split. Landing FAQ, human docs, machine docs and collector guidance are aligned. The existing RapidAPI guide's quota/reset section was saved and publicly read back after deployment. Ten marketplace endpoints, existing plans, proxy secret and financial/provider settings are preserved.

## Problems Found and Fixed

The API omitted Retry-After on monthly exhaustion. The collector already honors that standard header, but without it `_wait_for_allowance` defaults to 3,600 seconds. An ordinary installed read-job event and its next due time confirm that behavior. The fix sends the actual monthly delay instead of changing the collector's limits, spending more allowance or creating another key.

Regression tests cover October, non-leap/leap February, subsecond year rollover, the UTC ledger rollover, all three API families, CORS, unmetered account reads, private exhausted responses and marketplace isolation even with an exhausted direct key. Nine tests failed before implementation; the existing marketplace-isolation case passed. All ten pass after repair.

Production acceptance now aggregates reset/CORS checks across its existing successful data requests, without making extra data calls. A regression demonstrated that the previous acceptance ignored a missing reset header; it now fails and still revokes the fixture key. Payload-only transport fixtures retain their actual headers so refresh/parity checks keep their intended meaning.

## Required User Actions

None. No plan upgrade, purchase, new agreement, credential replacement or prospect message is requested. The source reader is not forced to retry its exhausted key. Ordinary background activity is observed read-only.

## Recommended Next Steps

Qualify the cached local-model fixtures on Ollama 0.40.4 without paid API calls when memory headroom permits, while keeping publication closed. Preflight measures 6.5 GiB free RAM versus the historical benchmark's 8.5 GB peak, so no heavy model run is started during concurrent work. Keep scheduled source-error qualification separate: an ordinary healthy Cron pass does not prove its negative path, and recent CPSC success does not reconcile full history. Next bounded repair: finish existing PR #91's smol-toml security update, whose complete failing logs show null-prototype TOML tables rejected by strict profile comparison. Sixteen open Dependabot alerts were read, all marked development scope, including two tinypool critical advisories; public Worker exploitability was not established by this inventory. Do not treat that scope label as full security qualification.

## Repository and Evidence Record

Baseline refreshed around 05:30Z: existing Worker `data-foundry-recalls`, source `38d9a87f91fc4a7afd39d82b48105ec9c375c6d7`, version `ba74649a-13ca-4fec-b2b1-82c9b617bdb8` at 100%, deployment `2504eb05-ed3d-49e6-896b-483e4d0d2f55`. D1 `84acdedd-4d3e-457e-9bdc-3b118590e172` has migrations 0001–0004 and 10,053 CPSC / 5,216 HC notices. Internal acceptance fixture is suspended with zero active keys. Both extracted-identifier publication flags remain 0; existing sales/product/marketplace/intake gates and source kills are preserved. Canonical R2 and Postgres/Supabase infrastructure are unchanged.

Read-only collector receipt `05:46:07.825Z`: 8 extracted / 8 skipped, 12 historical server accepted / 13 agency duplicates, zero queryable, six historical acknowledged submissions. Read job pending, attempts 0, due `05:50:42.634Z`; latest allowance wait 3,600 seconds. Verify job due `05:47:19.485Z`, attempts 0. Five API requests used in the current local daily counter. These are existing totals, not new productive output. Secret-free receipt: ignored `.data/quota-collector-before.json`.

Read-only predeployment receipt `06:10:43.576Z`: the normal read had retried at `05:50:47Z`, received another 3,600-second wait and remained pending / attempts 0, due `06:50:47.191Z`. Local daily API counter 6; historical output unchanged. This is the baseline for the next ordinary postdeployment response, not proof of the longer wait. Receipt: ignored `.data/quota-collector-predeploy.json`.

Read-only postdeployment receipt `06:51:37.163Z`: the ordinary read records an allowance wait at `06:50:50.056Z` of 1,357,751 seconds; pending / attempts 0, next due `2026-11-01T00:00:00.963Z`. The subsecond offset follows integer Retry-After and network/processing time. Local daily API count is 7 (one normal request); output remains 8 extracted / 8 skipped, 12 server accepted / 13 agency duplicates, 0 queryable and 6 acknowledged uploads. At `06:51:37.921Z`, independent D1 read-back stays four usage rows / 5,296 requests and owner Evaluate 100/100. No key, plan, scheduler setting or due time was changed by the observer; no exhausted request was forced. Receipt: ignored `.data/quota-collector-after-0651.json`.

Local verification: `corepack pnpm run typecheck` passed. `corepack pnpm exec vitest run apps/recalls-worker/test tooling/test/readme-inventory.test.ts tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts --maxWorkers=2` passed 12 files / 257 tests. Focused quota/acceptance tests passed 24 tests after repair; final documentation checks passed 49. `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .data/quota-bundle` and `git diff --check` passed. Logs are ignored `.data/quota-*`.

### Protected checks, deployment and authenticated API acceptance

- Final head `15adaee0e8d0c35faf24ea0a3205eb838d223c70`: Codex code review completed with zero findings. [Candidate CI 38858104865](https://github.com/athompson83/data-foundry/actions/runs/38858104865) and [exact-main CI 38859476948](https://github.com/athompson83/data-foundry/actions/runs/38859476948) passed 264 files / 5,282 tests. Main's real TLS Postgres migration, grants and concurrency regressions passed; the PR correctly skipped that path-unselected job.
- [Guarded deployment 38860860175](https://github.com/athompson83/data-foundry/actions/runs/38860860175) passed typecheck, 25/67 parser-package tests and 208 Worker tests, tracked configuration and no-pending-migration checks. Actual uploaded bundle SHA-256 `b2ef98f204a1a43adabebbab498d3ba971e7431f5449f7660b11dcebe5e168fb` exactly matches the local dry-run bundle.
- Provider deployment `0f5c4fcd-4df4-4190-b5ac-67ad4c95630f`, created `06:23:25.001078Z`, version `cb45d589-0006-4501-bef1-a3731c719116` at 100%; tag `1fb2cb8d0846`, annotation full source/run. Rollback version `ba74649a-13ca-4fec-b2b1-82c9b617bdb8` preserves the preceding CPSC guard.
- [Fresh acceptance 38861021039](https://github.com/athompson83/data-foundry/actions/runs/38861021039), `06:24:43.692Z`–`06:24:50.616Z`: 28/28 checks, 13 metered requests and exact delta 13. All 12 successful data responses expose reset `1793491200` (`2026-11-01T00:00:00Z`) and CORS metadata, with no early Retry-After. Raw integrity/redactions, filters and lookup parity pass. The serving version stays unchanged. Closure is 200/suspended/zero active keys; revoked key returns 401/401/401. Independent D1 confirms fixture suspended/zero active keys, updated `06:24:50.276Z`.
- Provider flags read back after deployment: sales/product/marketplace/intake = 1, source kills = 0, both extracted-identifier publication flags = 0. D1 migrations 0001–0004, canonical R2 and existing Postgres/Supabase are preserved. No price, subscription, payout, rights grant or legal agreement changed.

### Browser and marketplace verification

- Local source fixture in real Chrome made cross-origin 200 then 429 requests. Both exposed reset `1793491200`; 429 exposed Retry-After `1360680`, with remaining 0. This is local browser/CORS proof only. Its in-memory D1/fake key never accessed a provider; the two temporary listeners were stopped after testing.
- Live desktop `1366x900`: landing FAQ states the UTC monthly boundary; following its allowance link reaches `/docs#allowance`. Document width equals scroll width 1,351 px, with one landing h1. Live mobile `375x812`: document/scroll width 360 px, four-row header table within x=20..340 (width 320). FAQ → `/account` navigation works, password input and Check usage button visible, no horizontal overflow or captured console errors. No owner key was entered in these browser checks. Temporary viewport overrides were reset.
- Existing public [RapidAPI guide](https://rapidapi.com/athompson83/api/data-foundry) saved and read back with the new quota/reset section. The pre-edit 4,342-character text matched the baseline and had no draft changes; unrelated guide text was preserved. Screenshot: ignored `.data/quota-public-guide.png`. No endpoint import, plan, price, visibility, proxy-secret or payout change.
- One ordinary signed-in operator BASIC playground call to `/v1/lookup?code=DXH70CFAVX&datasets=recalls,product-recalls` returned 200 OK, 6,240 bytes, including the expected `cpsc-25203` source record. Direct `usage_month` remained four rows / 5,296 requests before (`06:25:42Z`) and after (`06:28:05Z`). The gateway omitted exact origin `x-ratelimit-reset` and `retry-after`; it supplied separate `x-ratelimit-requests-*` counters. That operator response reports limit 500,000 / remaining 499,990, which is not evidence of the publicly advertised BASIC 500-request enforcement. Public price terms and independent paid consumption are not qualified by this test.
- Ordinary source Cron, before this quota deployment, succeeded for 51 recent CPSC and 5,216 HC notices at `06:17:28.260Z`, zero inserts/changes; stored totals remain 10,053/5,216. Healthy execution advances those success clocks but does not exercise the error guard or reconcile CPSC history. See [source follow-up](consumer-lifecycle-reconciliation-20261016.md).

Recovery: revert this additive header/documentation change; the existing ledger requires no migration or restoration. The baseline Worker version above is the rollback target for this release. No source data deletion is involved.
