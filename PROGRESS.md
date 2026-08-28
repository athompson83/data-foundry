# Progress

## Current State

- Product: Data Foundry
- Lifecycle stage: MVP implementation / pre-deployment
- Control-graph node: `RECONCILE -> IMPLEMENT -> VERIFY -> HANDOFF`
- Current milestone: Integrate and deploy the first lawful, revenue-capable HVAC vertical
- Branch: Verify the current isolated-worktree branch at handoff; this document does not record a transient branch name.
- PR: Not created at the time of this closeout-file update
- Preview: None verified
- Production: Not deployed
- Database target: Local PGlite and disposable PostgreSQL 16 verification only; no hosted target was changed

## Latest Session

### Objective

Close Task 8's core rights, fact-lineage, kill-switch, and bulk-pagination findings without fabricating grants or changing provider infrastructure.

### Completed

- Added forward migration `0016_core_rights_hardening.sql`, preserving legacy source kill-switch and fact-kind state as unknown/NULL and therefore fail-closed.
- Sealed field-group membership after first rights-cell reference while retaining the existing UPDATE/DELETE/TRUNCATE history guards.
- Persisted the registry kill switch through source synchronization and made every database-backed distribution surface refuse killed or unknown source state, including factless bulk entities.
- Classified fact outputs as `NORMALIZED_FACT` or `DERIVED_METRIC`; added an atomic derived writer with a non-empty immutable dependency set.
- Made canonical and surface query paths refuse ambiguous/incomplete output contracts, require exact-target `DERIVE` from both direct output evidence and every recursive input contribution, recursively authorize every input, and reject cycles.
- Updated the real HVAC mapping/normalization/ingestion path to record derived output lineage and preserve that lineage during promotion.
- Changed bulk enumeration to refuse changing totals, early empty pages, duplicate/no-progress pages, and unique-total mismatches before writing any artifact.
- Regenerated the canonical fact/source JSON Schemas.

### Verification

- Focused direct-output rights, bulk refusal, and deterministic recursive-lineage suites passed: 3 files / 14 tests.
- Full repository suite passed: 153 files / 2,204 tests.
- TypeScript typecheck, JSON Schema/OpenAPI drift checks, PGlite migration check, vertical validation/runtime drift check, and production Worker artifact check passed.
- Disposable PostgreSQL 16 clean apply/reapply and populated upgrade apply passed. Real SQL refused field-group expansion, field/dependency UPDATE and DELETE, output-kind mutation, unclassified inserts, and derived inserts without dependencies.
- Full commands, RED/GREEN evidence, and self-review are recorded in the Task 8 implementation report.

### Deployment / Database Activity

- No deployment, hosted database migration, grant creation, source approval, provider resource, or production change was performed.
- Only isolated disposable local PostgreSQL databases were created for verification and removed afterward.

## Blockers

- No real HVAC source has the exact effective grants and independent legal/rights review required for publication or paid distribution.
- Canonical Cloudflare account/zone/routes, queue/DLQ, Hyperdrive, and hosted Postgres connectivity are not evidenced as configured.
- This isolated branch still requires integration-owner review and reconciliation with the other release slices.

## Risks

- Existing legacy source kill-switch and fact output-kind values remain intentionally unknown until explicitly synchronized/classified; they will not be served meanwhile.
- Engineering verification does not provide legal approval or manufacture any rights decision.
- The in-memory export cap remains 10,000 entities; larger exports require a separately designed rights pre-pass/streaming architecture.

## Required User Actions

See `PROJECT_CHECKLIST.md` items `UA-001` through `UA-003`. No routine local implementation or verification work is assigned to the Product Owner.

## Recommended Next Steps

1. Integration-owner: review and replay this commit with Tasks 7 and 9 plus the web/runtime branch, resolving overlap without weakening the fail-closed boundaries.
2. Owner/legal: review the first real HVAC source and record only exact evidenced grants; absent grants remain refusal.
3. Owner/platform: configure the canonical hosted Postgres/Hyperdrive/Cloudflare topology, then run the same migration and surface negatives against an isolated hosted environment.
4. Release-owner: freeze the integrated 40-character SHA before hosted certification.

## Production Impact

None. Repository code, tests, documentation, generated schemas, and local disposable database state changed only.

## Previous Session Summary

The preceding Task 7 session completed repository-owned RapidAPI/OpenAPI and Cloudflare preflight work on `codex/rapidapi-openapi-20260828`, with no deployment or provider credential changes. Task 8 began from the explicit base `1ba45f88f164aa6a8d0ba19d2f6948879fbe75b2`; hosted state must be refreshed before any merge or deployment claim.
