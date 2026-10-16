# TOML parser security and build qualification — 2026-10-16

## Verdict

**NOT_READY: locally qualified; protected review and exact-main CI pending.** Finish existing PR #91's smol-toml 1.9.0 update. Its unchanged synthetic deployment template was rejected because nested TOML tables now have null prototypes. The fixed validator compares against the same TOML representation while retaining strict capability, type and value equality. This is development/build maintenance; the public recalls Worker bundle is byte-identical to the accepted release.

## Checklist Snapshot

No new product milestone or paid-consumption claim. REV-017 is DONE through PR #105 and the ordinary installed collector check. REV-011/REV-012 and independent paid buyers remain separate. Issue #48 stays open for its remaining security and CI work; this bounded patch addresses one TOML advisory, represented by two open Dependabot alerts (#30/#34), not all sixteen development dependency alerts. Public Worker exploitability is not established by the alert inventory.

## Progress Report

Canonical repo `C:/Users/Adam/data-foundry`, reused clean isolated worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`. Base main `711c123a7392b6fdfe6b30a52f724288491247fa` closes the quota release; its exact-main CI 38865114438 passes 5,282 tests / 264 files and real-Postgres checks. Preserve the old dirty chat checkout, unrelated worktrees and ignored receipts.

Reuse branch `dependabot/npm_and_yarn/smol-toml-1.9.0`, original head `2c1e061a210450aa190b034eaf79f898b2e972ff`, rather than opening another dependency PR. Merge current main locally and keep the PR draft during repair. The manifest/lockfile retain the existing update to 1.9.0. The hardcoded closed contract is round-tripped through TOML once; input remains subject to `isDeepStrictEqual`, including extra fields and wrong types. Four regression cases cover string/boolean and string/number confusion, an unquoted TOML date where a string is required, and an extra nested route capability.

The unchanged ingestion compiler regenerates only `implementation_digest` and `runtime_digest` in the governed HVAC artifact. All other payload fields and implementation-input coverage remain identical. No fingerprint inputs are removed to make the dependency update pass.

## Problems Found and Fixed

The [upstream advisory](https://github.com/squirrelchat/smol-toml/security/advisories/GHSA-r4xh-jqrq-34v2) identifies a quadratic key-parsing path in versions through 1.8.0 and fixes it in 1.9.0. [Release notes](https://github.com/squirrelchat/smol-toml/releases/tag/v1.9.0) describe the new null-prototype tables. Existing PR #91 had failed full CI on October 6: four synthetic-ingestion assertions rejected an otherwise unchanged configuration. Complete failing job logs were downloaded/read before repair, with no rerun. The same four failures reproduce locally on the updated graph; 23 synthetic-profile tests pass after repair.

An attempted broad Windows tooling run stalled in Bash-based fixtures: the host's `bash` resolves to the WindowsApps WSL launcher. Process ancestry identified the two blocked fixture children. Only the owned test process tree and its client processes were stopped; shared WSL host processes were left alone. This interrupted run is not a passing full-suite result. The affected TOML consumers and ingestion Worker were then checked directly, without changing or skipping any protected CI checks. The full Linux suite remains required.

## Required User Actions

None. No provider credential, purchase, subscription, price, legal agreement or publication gate is changed. The cached local-model benchmark remains unstarted while only 6.5 GiB of memory headroom was available versus its historical 8.5 GB peak; this maintenance lane does not consume API allowance or run inference.

## Recommended Next Steps

Finish final-head review/protected CI and exact-main CI before marking this source maintenance complete; read back the dependency alerts after merge. Keep #48 open for the remaining graph advisories and maintenance criteria. Productive collector output, current-runtime benchmark, CPSC history and scheduled source-error verification retain their own gates. No public interface changes require a landing, OpenAPI or RapidAPI edit in this patch.

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

Serving source remains `1fb2cb8d0846ab69e5b2e46ff0f525c4b9739106`, existing Worker `data-foundry-recalls`, version `cb45d589-0006-4501-bef1-a3731c719116` at 100%. Read-back in this session confirms D1 migrations 0001–0004, CPSC 10,053 / HC 5,216, fixture suspended/zero active keys, both extraction-publication flags 0 and existing channel/kill settings preserved. No public Worker or private-canary deployment is performed or certified by this source maintenance. Public API/browser/gateway acceptance remains bound to [the quota release](quota-reset-20261016.md).

Recovery: revert the bounded dependency/validator change and regenerate the governed artifact through the existing compiler. Restoring 1.8.0 would reintroduce its advisory and requires a fresh security decision. No database migration, source deletion or cloud cleanup is involved.
