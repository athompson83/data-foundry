# TOML parser security and build qualification — 2026-10-16

## Verdict

**COMPLETE for the bounded TOML security/build repair.** Existing PR #91 is merged with final-head review and protected/exact-main CI green. Its unchanged synthetic deployment template was rejected because nested TOML tables now have null prototypes. The fixed validator compares against the same TOML representation while retaining strict capability, type and value equality. GitHub marks the advisory's two graph alerts fixed. This is development/build maintenance; the public recalls Worker bundle is byte-identical to the accepted release.

## Checklist Snapshot

No new product milestone or paid-consumption claim. REV-017 is DONE through PR #105 and the ordinary installed collector check. REV-011/REV-012 and independent paid buyers remain separate. Issue #48 stays open for its remaining security and CI work. This patch fixes one TOML advisory, represented by graph alerts #30/#34; both were automatically marked fixed at `07:58:16Z`, without dismissal. At `08:09Z`, fourteen development dependency alerts remain, including two critical and four high. Public Worker exploitability is not established by that inventory.

## Progress Report

Canonical repo `C:/Users/Adam/data-foundry`, reused clean isolated worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`. Base main `711c123a7392b6fdfe6b30a52f724288491247fa` closes the quota release; its exact-main CI 38865114438 passes 5,282 tests / 264 files and real-Postgres checks. Preserve the old dirty chat checkout, unrelated worktrees and ignored receipts.

Reused branch `dependabot/npm_and_yarn/smol-toml-1.9.0`, original head `2c1e061a210450aa190b034eaf79f898b2e972ff`. Current main was merged locally and the PR kept draft during repair; final reviewed head is `ba9dfe4730eff8c876c0dd493f09ebfe9d34daeb`. PR #91 merged at `07:58:10Z` as `a20a2e890a6eb77fd13f0c4f5a8d2276de73d3eb`. The manifest/lockfile retain the existing update to 1.9.0. The hardcoded closed contract is round-tripped through TOML once; input remains subject to `isDeepStrictEqual`, including extra fields and wrong types. Four regression cases cover string/boolean and string/number confusion, an unquoted TOML date where a string is required, and an extra nested route capability.

Canonical checkout was safely fast-forwarded. The merged branch was proved to contain no unique work; its remote was already absent, and its local branch was removed. Documentation closeout uses `codex/smol-toml-closeout-20261016`; ignored receipts and unrelated work remain preserved.

The unchanged ingestion compiler regenerates only `implementation_digest` and `runtime_digest` in the governed HVAC artifact. All other payload fields and implementation-input coverage remain identical. No fingerprint inputs are removed to make the dependency update pass.

## Problems Found and Fixed

The [upstream advisory](https://github.com/squirrelchat/smol-toml/security/advisories/GHSA-r4xh-jqrq-34v2) identifies a quadratic key-parsing path in versions through 1.8.0 and fixes it in 1.9.0. [Release notes](https://github.com/squirrelchat/smol-toml/releases/tag/v1.9.0) describe the new null-prototype tables. Existing PR #91 had failed full CI on October 6: four synthetic-ingestion assertions rejected an otherwise unchanged configuration. Complete failing job logs were downloaded/read before repair, with no rerun. The same four failures reproduce locally on the updated graph; 23 synthetic-profile tests pass after repair.

An attempted broad Windows tooling run stalled in Bash-based fixtures: the host's `bash` resolves to the WindowsApps WSL launcher. Process ancestry identified the two blocked fixture children. Only the owned test process tree and its client processes were stopped; shared WSL host processes were left alone. This interrupted run is not a passing full-suite result. The affected TOML consumers and ingestion Worker were then checked directly, without changing or skipping any protected CI checks. The full Linux suite remains required.

## Required User Actions

None. No provider credential, purchase, subscription, price, legal agreement or publication gate is changed. The cached local-model benchmark remains unstarted while only 6.5 GiB of memory headroom was available versus its historical 8.5 GB peak; this maintenance lane does not consume API allowance or run inference.

## Recommended Next Steps

Issue #48 remains open for the remaining graph advisories and maintenance criteria. Its historical #47 TCP-readiness item was reconciled and marked complete: merged September 17 as `8a9542dd9969fce4b64b7b59bd10cbd5fd6d2ab8`, ancestor of current main, with current full/real-Postgres CI proof. The issue also records this bounded TOML repair and its remaining limits. A useful API follow-up is explicit latest source-attempt status: live stats at `07:47:44Z` expose only successful refresh clocks, and their OpenAPI responses lack detailed coverage schemas. Snapshot: ignored `.data/source-status-api-20261016.json`. No new public feature is implemented or qualified by that assessment. Productive collector output, current-runtime benchmark, CPSC history and scheduled source-error verification retain their own gates. No public interface changes require a landing, OpenAPI or RapidAPI edit in this patch.

## Repository and Evidence Record

- Local Node `24.19.0`, pinned pnpm `9.15.4`; protected CI uses Node 22. Initial offline install correctly reports one uncached smol-toml tarball. Frozen online install retrieves it from the existing npm registry with the committed integrity; subsequent `corepack pnpm install --frozen-lockfile --offline` succeeds.
- `corepack pnpm exec vitest run tooling/test/synthetic-ingestion.test.ts --maxWorkers=2`: before repair, 4 failed / 15 passed; after repair, 23 passed.
- `corepack pnpm run typecheck`: passed.
- `corepack pnpm run ingestion:check`: fails before regeneration; `corepack pnpm run ingestion:compile` and subsequent check pass. Only two artifact digest fields differ: implementation `5c4668de…` → `467a8df8…`, runtime `fe3a5c74…` → `bda1ae59…`.
- `corepack pnpm exec vitest run tooling/test/cloudflare-topology.test.ts tooling/test/cloudflare-artifacts.test.ts tooling/test/cloudflare-vertical-edge-topology.test.ts tooling/test/synthetic-ingestion.test.ts tooling/test/provision-api-credential.test.ts apps/ingestion-worker/test --maxWorkers=2`: 11 files / 299 tests passed.
- `corepack pnpm exec vitest run tooling/test/ingestion-implementation.test.ts --maxWorkers=2`: 4 passed, including dependency/input coverage and identity invalidation.
- Old/new parser comparison over all 16 tracked Wrangler manifests: zero semantic value differences. Receipt `.data/smol-parser-parity.json`, captured `07:17:51.335Z`, records per-manifest canonical hashes; ignored observer only, no manifest mutation.
- `corepack pnpm run cloudflare:artifacts:check`: thirteen ordinary/private-canary artifacts and one additional vertical edge build with no PGlite runtime. The synthetic fourteenth profile build passes in its focused test.
- `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .data/smol-recalls-bundle`: passed. SHA-256 `b2ef98f204a1a43adabebbab498d3ba971e7431f5449f7660b11dcebe5e168fb` exactly matches the accepted recalls deployment bundle. This command uploads nothing.
- `git diff --check`: passed. Secret-free logs/receipts are ignored `.data/smol-*`; the interrupted broad-run log is retained separately from the passing focused logs.

### Protected qualification and fresh read-back

- Codex review on final head `ba9dfe4730eff8c876c0dd493f09ebfe9d34daeb` completed at `07:46:08Z` with zero findings.
- [Candidate CI 38868759631](https://github.com/athompson83/data-foundry/actions/runs/38868759631) and [exact-main CI 38870579003](https://github.com/athompson83/data-foundry/actions/runs/38870579003) pass all 264 files / 5,286 tests, typecheck, generated artifacts, migrations and real TLS Postgres/grant/concurrency controls. Draft runs are recorded as skipped, not executed proof. No failed Action was manually rerun.
- GitHub alerts #30 and #34 report `state=fixed`, `fixed_at=2026-10-16T07:58:16Z`. Remaining fourteen-alert inventory is a dated read-back, not a clean security bill.
- Provider read-back `08:09:30.693Z`: deployment `0f5c4fcd-4df4-4190-b5ac-67ad4c95630f`, source `1fb2cb8…`, version `cb45d589…` at 100%; both extraction gates remain 0, existing sales/product/marketplace/intake flags 1 and source kills 0. D1 notice totals 10,053 CPSC / 5,216 HC; direct usage remains four counters / 5,296 requests; acceptance fixture remains suspended with zero active keys. No new authenticated test key or exhausted owner request was needed for this build-only change.

Serving source remains `1fb2cb8d0846ab69e5b2e46ff0f525c4b9739106`, existing Worker `data-foundry-recalls`, version `cb45d589-0006-4501-bef1-a3731c719116` at 100%. Read-back in this session confirms D1 migrations 0001–0004, CPSC 10,053 / HC 5,216, fixture suspended/zero active keys, both extraction-publication flags 0 and existing channel/kill settings preserved. No public Worker or private-canary deployment is performed or certified by this source maintenance. Public API/browser/gateway acceptance remains bound to [the quota release](quota-reset-20261016.md).

Recovery: revert the bounded dependency/validator change and regenerate the governed artifact through the existing compiler. Restoring 1.8.0 would reintroduce its advisory and requires a fresh security decision. No database migration, source deletion or cloud cleanup is involved.
