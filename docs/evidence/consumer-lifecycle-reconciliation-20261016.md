# Consumer-recall source reconciliation and freshness repair — 2026-10-16

## Verdict

The Windows policy CLI and CPSC false-freshness defect are repaired in source. Health Canada's scoped identity set is independently reconciled; CPSC/composite qualification remains open. Exact-source deployment acceptance is a separate delivery gate. No independent revenue is verified by this package.

## Checklist Snapshot

**REV-011 remains IN_PROGRESS.** Health Canada's consumer-product member is independently reconciled and LIVE. CPSC and the composite stay BUILDING until full-history source reconciliation succeeds. Existing deployed API/marketplace availability is separate from lifecycle qualification. REV-008/REV-013 (independent paid buyers) and REV-012 (productive collector qualification) remain IN_PROGRESS. The portfolio denominator is not stable, so no completion percentage is asserted. See [PROJECT_CHECKLIST.md](../../PROJECT_CHECKLIST.md).

## Progress Report

Base `075544f2471cf594b427039726b45799744e86d8`, canonical repo `C:/Users/Adam/data-foundry`, reused worktree `C:/Users/Adam/data-foundry-worktrees/revenue-20261015`, branch `codex/consumer-lifecycle-20261016`, PR #102. The old dirty chat checkout and ignored receipts are preserved. Documentation-main CI 38844322835 is successful.

The policy generator now executes on Windows. Health Canada's scope/name and stage describe its reconciled consumer-product slice. CPSC/composite next actions name the missing source gate instead of repeating completed hosted acceptance. Source-rights channel notes reflect prior RapidAPI activation; rights grants are unchanged. Generated policy changes are metadata only: tasks, rates, rights, acquisition classes, memberships and prohibited domains remain identical. No collector reinstall, restart or permission change was executed.

The focused CPSC error-body guard already proposed in PR #88 is qualified against a newly observed official error and scheduled-sync regressions. The broader ENERGY STAR/scout changes in #88 remain separate; source counts alone do not qualify a live product or composite join.

## Problems Found and Fixed

The Windows CLI entry guard split paths only on `/`, silently skipping generation/checks. A real subprocess regression reproduced empty output. The existing portable `isMain` helper repairs execution: stale `--check` exits 1, generation writes the policy, and a current check confirms it.

Initial lifecycle reconciliation compared D1 with stats derived from that same table. Review correctly identified insufficient upstream proof: upserts do not remove disappeared notices. The corrected qualification independently downloads the official HC index. Current CPSC source errors prevent full reconciliation, so CPSC/composite are not advanced to LIVE.

CPSC returned HTTP 200 with a nonempty recall-shaped error: null RecallNumber and title `Error retrieving Recalls: The underlying provider failed on Open.` Previously the recent-window path skipped this and marked the run SUCCEEDED, falsely advancing public freshness. The guard fails nonempty CPSC responses without a publishable notice before notice writes. FAILED runs retain raw source evidence; existing notices and last successful freshness remain intact. Empty recent windows stay valid. A full pass aborts at the first erroneous window, failing both window and overall runs; HC continues independently.

The catalog sample is September 27 parser output, accurately labeled `product-recall-structuring@1`. All 32 displayed business-field leaves match current canonical @2 storage. It stays historical parser output, not a captured API response. Its counterpart resolves through the exact stored declared citation; title similarity and HC's joint marker do not create links.

## Required User Actions

None. Upstream CPSC availability is an external gate with agent-owned follow-up. Outreach remains unsent; no subscription upgrade, purchase or legal acceptance is required.

## Recommended Next Steps

After evidence of CPSC recovery, compare the full upstream ID set with storage and explain differences before LIVE qualification. Avoid repeated failing downloads. Continue collector/service improvements within existing allowance and closed extraction-publication gates. Operator fixtures do not establish independent paid buyers for REV-008/REV-013.

## Repository and Evidence Record

### Independent source comparison

Official [HC index](https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json), downloaded `2026-10-16T04:09:40.141Z`: HTTP 200, 15,778,221 bytes, SHA-256 `56a5a67e83c4c443d48e18f55463b85fc2ceb0bcc1c4513c651d059c6c0db288`, 34,226 records. Predicate: Organization exactly `Consumer product safety`, NID 1–8 digits, nonempty title. All 5,216 in-scope IDs are valid and unique. Comparison at `04:13:29.515Z` exactly matches D1's sorted unique ID JSON SHA-256 `de8eba36ce7abd017b89613a6f9e537e44f879313f774fb738a39e7de02be4aa`: zero missing/extra IDs.

D1 sets queried at `04:13:25.443Z` with `SELECT agency, group_concat(source_id) AS source_ids FROM product_recall GROUP BY agency`; split, deduplicate, lexicographically sort, JSON serialize and SHA-256 hash. Hashing ran inside the connector before returning bounded output, avoiding long-string truncation. CPSC: 10,053 unique stored IDs, hash `17ed02e10b7267edd7d0267b290ab40b5c9127799505505df2cf735b3855e5bd`; this is storage observation, not a source match.

Official [CPSC API](https://www.saferproducts.gov/RestWebServices/Recall?format=json), downloaded `04:09:38.414Z`: HTTP 200, 442 bytes, SHA-256 `6b3abe800b2a99210cc42cbd6d63fe575a618bd0bf94f4a373db6caa204d81c8`, one error record. Production's 1900–1989 window and an independent 1973 annual window also returned unusable errors; collection stopped. A bounded 2025 query at `04:13:29.693Z` returned 420 valid records, 1,337,269 bytes, SHA-256 `f5cffa61335b512171577c6129c27f975dbeea40700cde19e0c68d64439dfd52`. One year does not reconcile full history. No observer download deleted or republished source data. Exact bytes/manifests remain in ignored `.data/consumer-upstream-*`, `.data/consumer-cpsc-*` and `.data/consumer-hc-upstream-reconciliation.json`.

### Production baseline

Fresh observation `2026-10-16T03:50Z`, Cloudflare account `c2832821a9ab36419cde6ee08112f6d3`, D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`, R2 `data-foundry-raw-artifacts`:

- Before this repair: source `f84280c02bf371f000426d38c5d6481405b3a9e1`, version `07ee9246-42b8-4104-a793-2e18c014fd30`, deployment `3289ea1d-c372-46bc-a19f-e2db4e7b1a91`, 100%.
- Migrations 0001–0004. CPSC 10,053 + HC 5,216 = 15,269 notices, all parser @2; zero rows lack a 64-character digest or nonempty evidence reference. This checks reference presence, not every R2 object.
- Stats: 347 resolved declared links; newest CPSC 2026-10-15 / HC 2026-10-13. Successful refreshes CPSC `2026-10-16T00:20:14.828Z`, HC `2026-10-16T00:20:32.332Z`; timestamps alone do not prove upstream reconciliation, especially before repair.
- Sample cpsc-25203: model DXH70CFAVX, GTIN 00089301008588, US/Canada units 21,250/500, raw SHA-256 `708dd4a8d900f30dc380225039c8af12cbbeb0f242e885bd0da10f5c336f4b6d`; 32 displayed leaves match. Declared counterpart hc-77184 raw SHA-256 `d6d0233d1cc1fe8b9a58e93735a18e1ce2185646449b4883720c4a3ba55c2724`, description/remedy text withheld. Notices stay separate.
- Baseline [acceptance 38843342262](https://github.com/athompson83/data-foundry/actions/runs/38843342262) passed 27 checks, raw integrity/redactions, filters/lookup parity, exact 13-unit metering and revocation (401/401/401). Its success was rechecked; it does not accept the new repair.
- [Channel-alignment evidence](channel-alignment-20261015.md) covers desktop/mobile, ten RapidAPI endpoints, actual gateway behavior and distinct direct accounting. No route, schema or UI changes in this package; definitions stay aligned. Extracted-identifier gates, source grants, prices, subscriptions and payouts are unchanged.

### Verification and recovery

Before repair, captured-error regressions failed: recent sync falsely succeeded; full sync requested all 29 erroneous windows before failing its count floor. After repair, both paths preserve freshness/notices/evidence, stop after one CPSC fetch, and complete HC; the empty-window regression passes. Windows CLI/permission parity remains qualified. Final protected candidate/main CI, guarded deployment and fresh authenticated acceptance are recorded in PR #102 and the delivery closeout; no live repair claim precedes those gates.

Local checks: `corepack pnpm run typecheck` passed. `corepack pnpm exec vitest run apps/recalls-worker/test tooling/test/source-pipeline.test.ts tooling/test/readme-inventory.test.ts tooling/test/private-canary-provenance-doc.test.ts tooling/test/repository-policy.test.ts tooling/test/local-collector-policy-cli.test.ts tooling/test/cli-entry.test.ts --maxWorkers=2` passed 14 files / 1,291 tests. Three additional focused collector policy/rights checks passed. Windows generation/current-policy check, semantic permission comparison, sample/D1 comparison and `git diff --check` passed. Logs are ignored `.data/consumer-final-*` and `.data/cpsc-error-regression-*`.

Recovery: revert the bounded code/metadata changes and regenerate policy. Deployed rollback uses the recorded baseline version through the established operations workflow. No deletion/migration is needed.
