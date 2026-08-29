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

### Task 10 MCP objective

Turn the pure six-tool MCP contract into a deployable Cloudflare Streamable
HTTP surface without duplicating canonical query behavior, weakening rights
freshness, or making analytics invoice eligible.

### Completed

- Added neutral `packages/access-auth` and moved database-backed bearer-key,
  tenant, environment and one-vertical authorization out of `apps/edge` without
  changing the REST error adapter.
- Added migration `0018_mcp_access_channel.sql`: exact `MCP/NONE` credentials,
  four fixed MCP analytics routes and `POST` events. No key or event is
  backfilled/reclassified. Database and wire checks reserve MCP route keys,
  `POST`, and `rows_served = 0` for `MCP/NONE`; direct/marketplace reads remain
  `GET`/`HEAD` and MCP usage is not invoice eligible.
- Kept `apps/mcp` transport-free and added `apps/mcp-worker` as the Cloudflare
  composition/protocol adapter over `@modelcontextprotocol/server@2.0.0`.
- Implemented MCP 2026-07-28 per-request Streamable HTTP plus only the required
  claimless legacy `initialize`. Modern `initialize`, request methods without
  ids, id-bearing/unknown notifications, batches, malformed body/header mirrors,
  wrong Host/Origin, wrong-channel keys, and unsupported methods fail closed.
- Cached one driver/store/base QueryModel per warm isolate while binding a fresh
  `MCP` surface model per tool call, so later kill switches, rights changes and
  review/terms expiry apply on the next request without reopening the pool.
- Compiled `verticals/<slug>/mcp.yaml` into a static Worker runtime and replaced
  aspirational HVAC/domain tools and unused card paths with the exact six
  executable generic tools. Updated agent intents and the reusable vertical
  template to the same contract.
- Awaited Cloudflare Queue acceptance for metered responses and kept event data
  to fixed operation keys and server-created counters/ids. Tool names,
  arguments, JSON-RPC ids, entity ids, targets, bodies, response payloads and
  plaintext credentials do not enter usage events; queue failure is opaque 503.
- Added the MCP Wrangler template, shared Queue/Hyperdrive topology validation,
  four-Worker credential-free dry-run/PGlite isolation, CI drift checks, and
  current Cloudflare/revenue/new-industry runbooks.

### Verification

- Full repository suite passed: 159 files / 2,254 tests.
- TypeScript typecheck, JSON Schema/OpenAPI drift checks, PGlite migration
  apply/idempotency, vertical validation, edge/MCP/web runtime drift, and
  Cloudflare topology checks passed.
- Wrangler dry-run built all four production Worker artifacts and found no
  PGlite/WebAssembly runtime.
- Disposable PostgreSQL 16 clean apply and exact reapply-as-no-op passed. Real
  PostgreSQL accepted a fixed-route zero-row `MCP/NONE` POST and refused both a
  direct `API_PAID/DIRECT` POST and an MCP POST carrying a non-MCP route key.
- Focused auth/edge/MCP verification passed 7 files / 118 tests; the MCP Worker
  package passed 2 files / 31 tests, including protocol, auth, privacy, rights
  freshness, neighboring-surface refusal and Queue failure controls.

### Deployment / Database Activity

- No deployment, hosted database migration, credential creation, grant creation,
  source approval, provider resource, or production change was performed.
- One isolated disposable local PostgreSQL 16 container was created for
  verification and removed afterward; its data was intentionally disposable.

## Blockers

- No real HVAC source has the exact effective MCP grant bundle and independent
  legal/rights review required for agent publication; this is independent from
  public-web, paid API, RapidAPI and bulk permission.
- Canonical Cloudflare account/zone/routes, MCP hostname/origin allowlist,
  Queue/DLQ, Hyperdrive and hosted Postgres connectivity are not evidenced as
  configured, so no live MCP/Queue proof was possible.
- This isolated branch still requires integration-owner review and replay after
  the accepted Task 9 `0017` migration; `0018` deliberately remains the next
  reserved migration number and does not infer Task 9 state.

## Risks

- The current MCP credential is a custom high-entropy Data Foundry bearer key,
  not a standards-based OAuth token. No authorization server or OAuth
  interoperability is claimed.
- Cloudflare Queue retry/DLQ behavior, real Hyperdrive pooling, live client
  compatibility and deployment observability still require provider-backed
  verification.
- Engineering tests prove enforcement behavior, not legal approval, customer
  terms, pricing, or an effective source grant.

## Required User Actions

See `PROJECT_CHECKLIST.md` items `UA-001` through `UA-003`. No routine local implementation or verification work is assigned to the Product Owner.

## Recommended Next Steps

1. Release-owner: freeze the final integrated 40-character SHA after the combined
   full-suite, generated-artifact, PostgreSQL, and review gates complete.
2. Owner/platform: configure hosted Postgres/Hyperdrive, the REST/MCP/web/
   acquisition/usage-consumer Workers, R2, Queue/DLQ, hostnames/routes, allowed
   origins, and protected credentials; then perform live channel smoke tests.
3. Owner/legal: record only exact evidenced surface grants for the first real
   HVAC source; absent grants remain refusal and do not block a synthetic-data
   platform deployment.
4. Owner/business: complete RapidAPI enrollment, listing, plan, payout, and
   marketplace proxy-secret configuration before marketplace traffic is enabled.

## Production Impact

None. Repository code, tests, generated artifacts, documentation, and disposable
local verification databases changed only; no hosted/provider state changed.

## Previous Session Summary

Task 8 closed the core rights model; Task 9 added scheduled acquisition and
rights-backed readiness; Task 10 added deployable MCP. The integration branch
replays them in dependency order with migrations `0017` then `0018`. Hosted
state and real-source permission remain external evidence, never inferred here.
