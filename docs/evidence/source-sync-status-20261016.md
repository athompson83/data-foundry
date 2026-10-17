# Public source sync status — 2026-10-16

## Verdict

**IN_PROGRESS: locally qualified; review, protected/main CI, deployment and fresh acceptance pending.** Add source-attempt visibility to the two existing stats endpoints, beside successful clocks. No new source, dataset, endpoint, publication permission or commercial demand is claimed.

## Checklist Snapshot

REV-018 is IN_PROGRESS for the contract and channel alignment; REV-017 remains DONE. REV-011 history reconciliation/ordinary hosted error observation, REV-012 current-runtime benchmark/productive collector and REV-008/REV-013 independent paid consumption remain separate. Both extraction-publication gates stay closed.

## Progress Report

Canonical repo `C:/Users/Adam/data-foundry`; reused isolated worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`, branch `codex/source-sync-stats-20261016`. Base main `21779de28b04ba5f9c313566c12f86afee0868db` closes reviewed TOML evidence PR #106; exact-main CI 38874184460 succeeds. The accepted public Worker still serves `1fb2cb8…` / `cb45d589…` at 100%. PR #88's broader portfolio, older dirty checkout and ignored receipts remain preserved.

Keyless live stats at `07:47:44Z` expose successful clocks without attempts; both OpenAPI stats responses have only descriptions. Independent D1 read-back at `08:34:17Z` confirms five successful 06:17Z runs: FDA historical windows `2023-04-05..2023-08-02`, CPSC recent `2026-09-16..2026-10-16`, HC full. That healthy pass is not hosted negative-path or complete CPSC history proof.

The shared read model uses the existing `sync_run` ledger with fixed source categories; highest id selects the most recently created run. FDA keys: food/drug/device; product keys: CPSC/HC. Each `source_sync` entry has nullable `last_successful_sync` and nullable `latest_attempt` {status, started_at, finished_at, window_from, window_to}. No run yields two nulls; running has no finish. CPSC subwindows cannot become agency-pass status. Existing counts, top-level clocks and attribution keep their meaning. No migration or second ledger; errors, artifact locations and ids are not returned.

## Problems Found and Fixed

Successful clocks could hide newer failed/running attempts. The added state exposes them without advancing success. Existing stats cache keys lacked a release namespace; they now include Worker version, preserving the ten-minute cache and pre-cache rights gates. Typed direct/marketplace OpenAPI covers counts, attribution and sync states. Landing FAQ/dataset pages, human docs, catalog and agent references explain windows/nulls/cache limits. Public RapidAPI guide/definition alignment remains pending.

## Required User Actions

None. No purchase, price/plan/payout, credential, legal agreement or publication flag change. No exhausted owner request, upgrade or sent prospect outreach.

## Recommended Next Steps

Finish final-head review/CI, exact-main CI, existing guarded deployment and authenticated acceptance with revocation. Verify live desktop/mobile navigation and actual RapidAPI stats with separate direct accounting. Save/reload the existing public guide and update its two stats definitions; preserve ten endpoints and all marketplace settings. Keep history, scheduled failure handling and paid buyers separate.

## Repository and Evidence Record

- TDD: initial source packet found six absent-contract failures plus one corrected test expectation (existing invalid proxy secret returns 401). Two acceptance tampering cases first failed to reject missing/private metadata, then pass with independent public-contract checks.
- `corepack pnpm exec vitest run apps/recalls-worker/test tooling/test/readme-inventory.test.ts tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts --maxWorkers=2`: 13 files / 268 passed, including 219 Worker tests and all 16 acceptance cases. Covers failure/old success, running/null, never-run, subwindow exclusion, durable ordering, release cache isolation, allowance/channel behavior, withdrawal and privacy rejection with revocation.
- `corepack pnpm run typecheck`: passed after correcting strict index-signature/optional-property syntax in new tests. No hosted debugger push.
- `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .data/source-sync-bundle`: passed without upload. Bundle SHA-256 `cdb618609b830063ef3581fab44938e360a205b1229051bb8cf54104ce0ae964`.
- Real local Chrome 1366×900 and 375×812: landing FAQ → source-sync reference, one h1, no page overflow or console warnings/errors. Preview proof only; no key/billing submission.
- `git diff --check`: passed. Secret-free logs/receipts: ignored `.data/source-sync-*`.

Recovery: roll back to accepted source `1fb2cb8…`, version `cb45d589-0006-4501-bef1-a3731c719116`; no database rollback. Correct the additive guide in its existing editor. Never delete records or change plans to recover metadata/presentation.
