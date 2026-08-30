# Progress

## Current State

- Product: Data Foundry
- Lifecycle stage: MVP integration / pre-deployment
- Control-graph node: `REVIEW_REPAIR -> EXACT_SHA_VERIFY -> HOSTED_REVIEW -> OWNER_MERGE_DECISION`
- Current milestone: freeze, verify, and review the integrated revenue-capable
  platform candidate without implying that a real HVAC dataset is cleared
- Branch: `codex/revenue-integration-20260826`
- PR: [#19](https://github.com/athompson83/data-foundry/pull/19); reconcile
  its live head and checks before any merge action
- Preview: none verified
- Production: no deployment of this integration candidate is recorded or
  verified; live Cloudflare account state was unavailable for inspection
- Database target: repository migrations verified locally/disposably; no hosted
  target or grant state was changed during this integration

## Integrated Repository State

- Corrected Option B is accepted and implemented. Exact effective rights-matrix
  decisions authorize each operation/channel surface independently. Missing,
  stale, automated-only, or otherwise ineffective permission refuses.
- Legacy `GREEN`/`AMBER` classifications and permission booleans are inventory
  metadata and additional hard stops only. Migrations created no `ALLOW`.
- Historical queries select one exact immutable fact and recursive contribution
  graph at `policy.at`, while source status, terms, and surface grants are
  evaluated at the response/export `asOf`. A current successor is never
  substituted for the selected historical fact.
- REST and MCP await Cloudflare Queue acceptance before returning a metered
  success. Missing/rejected enqueue returns an opaque retryable 503. Only the
  later Postgres persistence remains asynchronous and idempotent.
- Scheduled acquisition uses migrations 0017, 0019, and 0020 with immutable
  versioned receipts and fenced recoverable execution leases. Pre-migration
  terminal rows remain contract v1; every new or reclaimed claim is contract v2
  and requires ordered `INITIAL`, `PRE_PROVIDER`, `PRE_TRANSPORT`, and
  `PRE_PERSISTENCE` authorization within the current attempt before R2
  persistence or `NOT_MODIFIED` freshness. Unexpected orchestration failures
  that escape expected terminal handling release still-owned claims; expired
  attempts rotate tokens on the same slot row. Direct and provider
  transports enforce finite response, record, pagination, cursor, diagnostic,
  and cumulative-artifact bounds without partial persistence.
- Offline entity resolution uses one driver-managed transaction executor for
  manufacturer, entity, alias, judgment, and evidence writes. Any failure or
  unusable strong identifier rolls the record back.
- Rights-backed readiness exists and requires canonical `--as-of` plus either a
  named-environment live database or a schema/digest-validated qualified
  snapshot. YAML/fixture metadata alone never proves a current grant.
- RapidAPI is a thin authenticated proxy into the canonical edge Worker, with a
  generated OpenAPI contract and disjoint `RAPIDAPI/RAPIDAPI` usage. Those rows
  are excluded from direct invoices.
- MCP is a deployable, one-vertical, custom-bearer MCP 2026-07-28 surface with
  exact `MCP/NONE` analytics. It is not OAuth or anonymous; no deployment of
  this integration candidate is verified.
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

- Repository implementation is in final exact-SHA verification and review;
  repository-ready does not mean deployed or production-ready.
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

- The last broad pre-freeze repair-tree run passed TypeScript typecheck, 170
  Vitest files / 2,520 tests, 20 ordered/idempotent migrations over 41 tables,
  schema/OpenAPI/runtime/topology/artifact gates, and PostgreSQL 16 migration
  plus scheduled-acquisition checks.
- Subsequent focused test-first repair proved post-transport rights revocation,
  exact historical selection, recursive historical contributors, bulk-export
  refusal, one-client resolution transactions, bounded direct/provider
  transports, no partial acquisition persistence, bounded surface-authorization
  fan-out, keyset sitemap enumeration beyond 10,000 rows, an empty-parent
  `noindex` control, and server-clock same-row acquisition recovery with stale
  fencing.
- Final authority is the frozen 40-character PR head and its complete local/CI
  gate set. Any candidate-affecting change invalidates SHA-sensitive evidence;
  do not use the earlier rejected `1ca6f61` candidate as release proof.

## Blockers

- No exact deployment of this candidate or hosted database/Queue/R2 proof is
  recorded. Live Cloudflare account state could not be inspected here.
- No real HVAC source has the required exact grants and human rights review.
- RapidAPI and MCP have no live external-channel proof.

## Required User Actions

See `PROJECT_CHECKLIST.md` `UA-001` through `UA-003`. ENERGY STAR remains
deferred; it is not an action request in this work package.

## Production Impact

Repository code, one forward migration, tests, generated artifacts, and control
documents changed. This work performs no deployment, hosted migration, grant
activation, source acquisition, publisher contact, or provider mutation.

## Previous Session Summary

The integrated branch combines usage accounting/auth, corrected Option B
rights, public web, RapidAPI, scheduled acquisition/readiness, and MCP in
dependency order through migration 0020. Final review repairs add a last
practical pre-persistence rights checkpoint, exact historical authorization,
one-client resolution transactions, bounded provider-controlled input and
surface authorization, recoverable server-clock acquisition leases, keyset
sitemap enumeration, and non-actionable HVAC source research consistent with
the owner decisions.
