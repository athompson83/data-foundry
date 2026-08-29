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

Implement Task 9's rights-aware source-readiness command so release readiness is derived from exact canonical rights evidence at an explicit instant, without treating inventory metadata as legal permission.

### Completed

- Made `--as-of` mandatory and canonical UTC for every readiness evaluation; the command no longer falls back to wall-clock time or YAML permission booleans.
- Evaluated `PUBLIC_WEB`, `SEARCH_INDEX`, `API_FREE`, `API_PAID`, `RAPIDAPI`, `MCP`, and `BULK_EXPORT` through the canonical rights engine using the conservative whole-source `DATA` / `NORMALIZED_FACT` scope.
- Added live-database evidence selected by environment-variable name only, with credential values excluded from command output.
- Added a versioned offline snapshot format with explicit generation/as-of/provenance metadata, deterministic code-unit ordering, canonical SHA-256 digest validation, generated JSON Schema, and drift checks. Snapshot output is explicitly qualified as snapshot-backed rather than live-current proof.
- Made absent evidence deterministically return `UNKNOWN` for all seven surfaces and report each exact missing operation/channel cell; malformed, stale-for-request, or non-canonical snapshots fail closed.
- Kept the proposed ENERGY STAR source opt-in and `DEFERRED`; even matching snapshot grants cannot mark it ready while its governance blockers remain.
- Changed aggregate revenue readiness to consider only real, active, enabled publication candidates, so synthetic fixtures and inactive/deferred neighbors neither manufacture nor suppress readiness.
- Added negative controls for field-scoped versus source-wide grants, neighboring permission non-implication, source filtering, deferred-source behavior, snapshot integrity, and secret-safe failures.
- Updated the existing revenue-readiness, onboarding, industry-addition, README, and proposed-source documentation with the exact evidence modes and command contract.

### Verification

- Focused source-readiness and CLI entry suites passed, including the seven-surface, snapshot, deferred-source, aggregation, and scope negative controls.
- Full repository suite passed: 154 files / 2,234 tests.
- TypeScript typecheck, JSON Schema and source-readiness-schema drift checks, OpenAPI drift check, PGlite migration apply/idempotence check, vertical validation/runtime drift check, web runtime drift check, Cloudflare topology check, and production Worker artifact check passed.
- Wrangler dry-run built all three production Worker artifacts with no PGlite runtime leakage.

### Deployment / Database Activity

- No deployment, hosted database connection, hosted migration, grant creation, source approval, provider resource, or production change was performed.
- Migration verification used the repository's in-memory PGlite target. The live-database readiness path remains unexercised because no approved credential environment variable was supplied.

## Blockers

- No real HVAC source has the exact effective grants and independent legal/rights review required for publication or paid distribution.
- Canonical Cloudflare account/zone/routes, queue/DLQ, Hyperdrive, and hosted Postgres connectivity are not evidenced as configured.
- This isolated branch still requires integration-owner review and reconciliation with the scheduled-acquisition and other release slices.

## Risks

- A snapshot digest proves integrity of canonical snapshot bytes, not authenticity, authority, or live-current database state; operational review must preserve the declared provenance qualification.
- Readiness is deliberately assessed at whole-source `DATA` / `NORMALIZED_FACT` scope. Field-scoped grants are not silently promoted to equivalent source-wide permission.
- Engineering verification does not provide legal approval or manufacture any rights decision. Legacy GREEN/AMBER labels and booleans remain inventory/risk metadata only.

## Required User Actions

See `PROJECT_CHECKLIST.md` items `UA-001` through `UA-003`. No routine local implementation or verification work is assigned to the Product Owner.

## Recommended Next Steps

1. Integration-owner: review and replay this commit with the Task 9 scheduled-acquisition slice and other release branches, resolving overlap without weakening the exact-bundle or evidence boundaries.
2. Owner/legal: review the first real HVAC source and record only exact evidenced grants; absent grants remain refusal.
3. Owner/platform: expose an approved hosted database URL through a named protected environment variable, then run `sources:readiness` at an explicit canonical UTC instant and retain qualified evidence.
4. Release-owner: freeze the integrated 40-character SHA before hosted certification or deployment.

## Production Impact

None. Repository code, tests, documentation, generated schema, and local verification state changed only.

## Previous Session Summary

The preceding Task 8 session completed core rights, fact-lineage, kill-switch, and bulk-pagination hardening. This Task 9 readiness slice began from explicit base `b19257d6ecda4a0c677e5e30f981a8625df1e2e9`; hosted state and the integrated candidate must be refreshed before any merge or deployment claim.
