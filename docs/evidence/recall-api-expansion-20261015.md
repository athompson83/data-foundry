# Recall API expansion — 2026-10-15

## Verdict

Candidate under local verification; hosted checks and production acceptance are required before this work package is COMPLETE. This extends the two existing live recall datasets; it does not publish another source or establish paid revenue.

## Checklist snapshot

REV-014 is the bounded API expansion: public machine-readable discovery and a cross-dataset identifier lookup on the existing recalls Worker. Its acceptance criteria are payload parity, provenance and raw-evidence integrity, fail-closed requested coverage, one direct request unit, the existing monthly hard stop, independent marketplace/extraction gates, and authenticated production acceptance with revocation. REV-008/REV-013 (first independent paid consumption/buyer validation) remain separate. PROJECT_CHECKLIST.md and PROGRESS.md will be updated once at verified closeout.

## Progress report

Canonical base: `986b3170d83e90754678874bcb2eb50963b5aff0`; prior serving source: `94c852cf85ed39e57886c122d099f305eefd3baa`, version `733e7d49-75d6-4d5f-bc2d-6019c39ed2d0`. The clean existing revenue worktree is reused on `codex/recall-api-expansion-20261015`. The older dirty chat checkout is preserved.

- `GET /v1/datasets`: public, unmetered, revalidated JSON from the same catalog and gates as the site. Includes stable dataset/registry IDs, fields, sources and terms, limitations, refresh intention, stats and documentation URLs. Counts and actual freshness remain at each stats endpoint.
- `GET /v1/lookup?code=...`: authenticated exact lookup across both datasets; `datasets=recalls` or `datasets=product-recalls` explicitly narrows coverage. One direct HTTP data request consumes one monthly request unit. Results preserve each dataset's complete existing lookup payload, match details, attribution and evidence; notices are not merged. The aggregate truncation flag is true when any dataset is truncated.
- Default coverage always requests both datasets. Any withdrawn requested dataset yields 503 before direct metering; no silent omission. Malformed/duplicate/unknown parameters are rejected before metering. The existing gateway authentication and independent marketplace extracted-identifier entitlement remain in force.
- `include=raw` requires exactly one explicitly selected dataset (400 before direct metering otherwise), preserving the existing response memory envelope. It uses the existing digest verification, consumer-record redactions and caps (FDA 10 or consumer products 25; otherwise 100 each). Evidence failure yields an error, never partial success. Empty results explicitly do not establish safety or complete recall coverage.
- OpenAPI, human docs, API root and llms references expose these interfaces under the same publication gates. The existing production acceptance runner now checks public discovery, both lookup payloads against their original endpoints, exact metering and post-run revocation on the new route.

## Problems found and fixed

Integrators previously had to discover fields from HTML/OpenAPI and make separate identifier requests to each dataset. The new interfaces reduce this work without creating another canonical store, parser or billing ledger. A new route could otherwise silently omit withdrawn sources or expose extracted identifiers on the wrong channel: regression tests cover both boundaries. Review identified that retaining both datasets' raw payloads could exceed the original per-response memory envelope. Raw queries now require a single dataset; a failing regression reproduced the combined-response admission before the repair.

## Required user actions

None for this engineering release. Existing outreach remains unsent and separately requires a sending instruction. No purchase, paid subscription change, settlement change or legal acceptance is part of this work package.

## Recommended next steps

1. Agent-owned REV-014: complete required candidate checks, protected merge, exact-main qualification, guarded Cloudflare deployment and fresh authenticated acceptance.
2. Agent-owned REV-011: reconcile the already accepted live consumer-dataset lifecycle metadata independently of the unmerged scout work.
3. Agent-owned portfolio expansion: assess the ENERGY STAR prototype in PR #88 and its composite dataset/source rights, linkage, acquisition and freshness gates before publishing another product.
4. REV-013/REV-008: validate actual independent integration demand and paid consumption; API expansion alone does not demonstrate either.

## Repository and evidence record

Repository: `athompson83/data-foundry`; runtime remains Worker `data-foundry-recalls`, account `c2832821a9ab36419cde6ee08112f6d3`, D1 `84acdedd-4d3e-457e-9bdc-3b118590e172`, existing R2 `data-foundry-raw-artifacts`, canonical `data.aroqon.com`/`api.data.aroqon.com`. No schema, infrastructure or publication-flag change is required. Rollback is the preceding Worker version.

Local checks use at most two test workers to preserve Windows resource headroom:

- `corepack pnpm run typecheck` — passed.
- `corepack pnpm --filter @data-foundry/recalls-worker typecheck` — passed.
- `corepack pnpm exec vitest run apps/recalls-worker/test packages/recall-structuring/test packages/product-recall-structuring/test --maxWorkers=2` — 11 files, 282 tests passed after the raw-response review repair, including the production acceptance runner against the real Worker and SQLite/R2 adapters.
- `corepack pnpm exec wrangler deploy --dry-run --config apps/recalls-worker/wrangler.toml --outdir .data/api-expansion-bundle` — bundle qualification; this does not publish.
- `git diff --check` — passed.

The lookup registry is exhaustive over `DatasetKey`: adding a third dataset without its own validator and query fails typechecking instead of silently labeling consumer-recall results as another product. Existing public-behavior parity tests cover dispatch for both current datasets and explicit subsets.

Hosted checks and exact production identities remain to be recorded after qualification.
