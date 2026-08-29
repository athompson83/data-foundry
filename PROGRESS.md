# Progress

## Current State

- Product: Data Foundry
- Lifecycle stage: MVP integration / pre-deployment
- Control-graph node: `FINAL_DOCUMENTATION_RECONCILIATION -> VERIFY -> REVIEW`
- Current milestone: freeze and verify the integrated, revenue-capable platform
  candidate without implying that a real HVAC dataset is cleared
- Branch: verify the current isolated-worktree branch at handoff
- PR: not recorded here; reconcile live before release action
- Preview: none verified
- Production: not deployed
- Database target: repository migrations verified locally/disposably; no hosted
  target or grant state was changed during this documentation reconciliation

## Integrated Repository State

- Corrected Option B is accepted and implemented. Exact effective rights-matrix
  decisions authorize each operation/channel surface independently. Missing,
  stale, automated-only, or otherwise ineffective permission refuses.
- Legacy `GREEN`/`AMBER` classifications and permission booleans are inventory
  metadata and additional hard stops only. Migrations created no `ALLOW`.
- REST and MCP await Cloudflare Queue acceptance before returning a metered
  success. Missing/rejected enqueue returns an opaque retryable 503. Only the
  later Postgres persistence remains asynchronous and idempotent.
- Task 9 exists: `apps/acquisition-worker` is an hourly Cron/R2 composition root
  backed by migration 0017 and exact stored `ACQUIRE`/`STORE`/`CACHE` checks.
  Rights are rechecked before provider construction and transport.
- Rights-backed readiness exists and requires canonical `--as-of` plus either a
  named-environment live database or a schema/digest-validated qualified
  snapshot. YAML/fixture metadata alone never proves a current grant.
- RapidAPI is a thin authenticated proxy into the canonical edge Worker, with a
  generated OpenAPI contract and disjoint `RAPIDAPI/RAPIDAPI` usage. Those rows
  are excluded from direct invoices.
- MCP is a deployable, one-vertical, custom-bearer MCP 2026-07-28 surface with
  exact `MCP/NONE` analytics. It is not OAuth, not anonymous, and not deployed.
- The final Cloudflare topology is five Workers: edge, web, usage-consumer,
  acquisition-worker, and mcp-worker.

## Source and Product Truth

- HVAC remains `DRAFT`. All four registered sources are synthetic fixtures.
- No real HVAC source has an effective reviewed publication/commercial bundle.
- The proposed ENERGY STAR source is `DEFERRED`, `UNDER_REVIEW`, `UNREVIEWED`,
  unapproved, outside the runtime registry, and has no grant. Do not sign,
  promote, acquire, publish, contact, or initiate publisher outreach.
- The only approved general product wording for regulatory-filing values is:
  “Manufacturer-reported, as filed with US regulators”. Do not broadly call
  filings certified, verified, approved, or regulator-determined unless exact
  provenance genuinely supports that narrower statement.

## Deployment and Revenue State

- Repository code is ready for final integrated verification; repository-ready
  does not mean deployed or production-ready.
- RapidAPI enrollment, proxy-secret configuration, plans, payout setup, live
  route, and real subscriber proof remain external.
- Cloudflare account/zone/routes, Hyperdrive, production Postgres, R2,
  Queue/DLQ, hostnames, protected values, and exact deployment IDs remain
  external and unverified.
- Public 200 responses advertise one hour of freshness plus 86,400 seconds of
  stale-while-revalidate. That creates revocation staleness and requires an
  emergency provider-cache purge path plus the ability to force `no-store`,
  remove stale-while-revalidate, or reduce TTL during an incident. The
  repository does not control every provider cache rule.

## Verification

- Documentation-specific, proposed-source, repository-policy, and README
  inventory suites passed: 4 files / 35 tests.
- Full repository TypeScript typecheck passed after the two documentation-test
  wording/manifest updates.
- Named stale-phrase sweeps and `git diff --check` passed before commit.
- The resulting 40-character commit still requires freeze and the broader
  exact-candidate gates before merge/deployment. Any candidate-affecting change
  invalidates SHA-sensitive evidence.

## Blockers

- Final integrated verification and review are not yet recorded for the
  documentation-reconciled commit.
- No Cloudflare deployment or hosted database/Queue/R2 proof exists.
- No real HVAC source has the required exact grants and human rights review.
- RapidAPI and MCP have no live external-channel proof.

## Required User Actions

See `PROJECT_CHECKLIST.md` `UA-001` through `UA-003`. ENERGY STAR remains
deferred; it is not an action request in this work package.

## Production Impact

None. This reconciliation changes repository documentation and two
documentation-specific tests only. It performs no deployment, hosted migration,
grant activation, source acquisition, publisher contact, or provider mutation.

## Previous Session Summary

The integrated branch combines usage accounting/auth, corrected Option B
rights, public web, RapidAPI, Task 9 scheduled acquisition/readiness, and Task 10
MCP in dependency order through migrations 0012–0018. This session reconciles
the final documentation to that combined truth before exact-candidate checks.
