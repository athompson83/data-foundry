# Progress

## Current State

- Product: Data Foundry
- Lifecycle stage: MVP integration / pre-deployment
- Control-graph node: `MERGED_MAIN -> EXTERNAL_DEPLOY`
- Current milestone: deploy and prove the protected-main,
  synthetic-data-capable platform without implying that a real HVAC dataset is
  cleared
- Release authority: the live 40-character `origin/main`. Integration PR
  [#19](https://github.com/athompson83/data-foundry/pull/19) is merged; PRs
  #13–#17 are closed as superseded after path, patch, ancestry, and behavioral
  reconciliation. Dependency follow-up PR #21 removes the remaining `esbuild`
  advisory from the post-integration lockfile. PR #22 merged the closeout tree
  as `9c917c0f708352dfb79861110023145eb23806e3`, including migrations
  `0025`–`0026`, exact alias evidence, bounded surface-catalog authorization,
  one request-wide query snapshot, and database-free request pre-routing.
  Its exact head `501b33d08fafe5cdf1c9c0c9877f0b38b4b265c0` passed hosted run
  `33352124668`, both automated reviews, and sealed security scan
  `24b34cd2-2f8d-40ae-bfd2-f4460daa419f`. Every later
  candidate-affecting change still requires fresh exact-SHA local, hosted,
  review, and ruleset evidence.
- Preview: none verified
- Production: no deployment of the integrated protected-main tree is recorded or
  verified; Wrangler was unauthenticated in the verification environment
- Database target: repository migrations verified locally/disposably; no hosted
  target or grant state was changed during this integration

## Protected-Main Implementation State

PR #19, the PR #21 dependency repair, and the PR #22 closeout are on protected
`main`. The bullets below describe that merged tree; repository-ready still does
not mean deployed or commercially publishable.

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
  attempts rotate tokens on the same slot row. Only a winning claimant receives
  the current fencing token; active/terminal duplicate observations and
  diagnostic/freshness reads physically omit it. Direct and provider
  transports enforce finite response, record, pagination, cursor, diagnostic,
  and cumulative-artifact bounds without partial persistence.
- Offline entity resolution uses one driver-managed transaction executor for
  manufacturer, entity, alias, judgment, and evidence writes. A transactional
  failure rolls the batch back. No usable strong identifier is instead a
  fail-closed zero-claim result whose provenance revision can still finalize,
  so a refresh does not leave the superseded record falsely current.
- Re-ingestion now supersedes a logical source record's current immutable
  revision rather than mutating or deleting provenance. Migrations `0021`–
  `0023` preserve historic evidence, record a one-way supersession link, make
  source-record lifecycle explicit (`PROVISIONAL` versus `FINALIZED`), and make
  each entity/fact/relationship lineage cite its exact artifact. The persisted
  `source-record-evidence@3` fingerprint covers the exact resolved entity and
  manufacturer targets, accepted alias claims and locators, fact projections,
  resolution audit, and relationship dispositions/endpoints/writer. An exact
  replay does not churn `updated_at`; any evidence, target or mapping-semantic
  change appends a successor instead of retaining stale evidence.
- Migration `0023` adds append-only alias claims and authority epochs. It
  deliberately creates no authority claim for a legacy alias. Resolution and
  search read only claim-backed current aliases; entity and relationship
  surfaces require current `FINALIZED` supporting evidence. A refresh without
  a usable strong identifier still finalizes a zero-claim successor, withdraws
  the prior source-only identity from customer surfaces, and creates no phantom
  manufacturer while preserving immutable history.
- Migration `0025` binds every source-record alias claim to its exact immutable
  `ALIAS` entity-evidence row. A claim without that link—and every legacy row
  for which the repository cannot prove the link—stays outside resolution and
  search. The ingest pipeline records the claim and evidence in one pinned
  transaction, so the alias's source is included in the surface-rights AND.
- Every customer-facing query operation uses a fresh read-only repeatable
  snapshot and request-local authorizer. Compound REST, MCP, public-web, search,
  facet, relationship, and comparison flows cannot reuse authorization from an
  older contribution set or observe a mid-operation alias commit. REST parses
  all matched-route inputs before acquiring that snapshot; the web Worker
  rejects methods, malformed targets, `robots.txt`, and unmatched paths before
  loading the database-backed deployment.
- Migration `0024` requires explicit source-stream membership and
  `full_snapshot` versus `incremental` refresh semantics. Complete snapshots
  retire omitted current records atomically with append-only artifact evidence;
  incremental streams do not. Unknown legacy membership is revoked rather than
  inferred, then restored only by a rights-admitted reingest.
- Rights-backed readiness exists and requires canonical `--as-of` plus either a
  named-environment live database or a schema/digest-validated qualified
  snapshot. YAML/fixture metadata alone never proves a current grant.
- RapidAPI is a thin authenticated proxy into the canonical edge Worker, with a
  generated OpenAPI contract and disjoint `RAPIDAPI/RAPIDAPI` usage. Those rows
  are excluded from direct invoices.
- The fail-closed credential provisioner admits exactly `API_PAID/DIRECT`,
  `RAPIDAPI/RAPIDAPI`, and `MCP/NONE` for one tenant and one vertical. File
  delivery is POSIX-only, owner-only and outside the worktree; marketplace
  delivery goes to the repository-pinned Wrangler entry point through the
  validated edge manifest, a sanitized child environment, and an explicit empty
  env file. Reserved and `workers.dev` marketplace hosts are refused. It creates
  no rights grant, plan, invoice or source approval.
- MCP is a deployable, one-vertical, custom-bearer MCP 2026-07-28 surface with
  exact `MCP/NONE` analytics. It is not OAuth or anonymous; no live deployment
  is verified.
- The final Cloudflare topology is five Workers: edge, web, usage-consumer,
  acquisition-worker, and mcp-worker. Deployment validation requires every
  exact manifest to name the same canonical 32-hex `account_id`.

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

- The PR #19 integration, PR #21 dependency repair, and PR #22 closeout are on
  protected `main`. Repository-ready does not mean deployed or commercially
  publishable; the live deployment and real-source gates remain independent.
- RapidAPI enrollment, proxy-secret configuration, plans, payout setup, live
  route, and real subscriber proof remain external.
- Cloudflare canonical account/zone/routes, Hyperdrive, production Postgres, R2,
  Queue/DLQ, hostnames, protected values, and exact deployment IDs remain
  external and unverified.
- GitHub `main` is protected by active ruleset `21855694`; its two strict
  required checks are bound to GitHub Actions. Private vulnerability reporting,
  Dependabot vulnerability/security-update controls, secret scanning, and push
  protection are enabled, and repository hooks are empty. Only the Vercel App's
  sudo-gated repository selection remains an owner-only governance check; it
  does not block protected merge or Cloudflare deployment.
- Protected `main` upgrades the production PDF parser to `unpdf@1.8.1`, removing
  the legacy `canvas` / `node-pre-gyp` / vulnerable `node-tar` install chain
  behind all twelve Dependabot advisories discovered on the prior
  default-branch lockfile. The dependency follow-up also updates `esbuild`,
  removing the remaining development-tool advisory. Parsed-lockfile regression
  coverage and `pnpm audit --audit-level moderate` keep those dependency
  repairs executable rather than documentary.
- Public production requires `PUBLIC_CACHE_MODE=no-store`; the runtime rejects
  `cache` in production because request-time rights checks cannot revoke an
  object already retained by a browser or intermediary. Shared caching is a
  later engineering capability only after cache keys and invalidation follow
  exact rights lifetimes. Provider purge and stale-object probes remain live
  incident checks because the repository does not control every provider rule.
- Public sitemap work is keyset-paged and subject to one validated raw-page
  budget per request, shared across all verticals and segments for the global
  index. Capacity exhaustion returns an opaque, non-cacheable retryable 503
  without partial XML; malformed and configuration-impossible shard aliases do
  no query work. A provider-level rate limit still requires live configuration
  and verification.

## Verification

- Focused test-first repair cycles cover post-transport rights revocation,
  exact historical selection, recursive contributors, bulk refusal, pinned
  reconciliation transactions and advisory locks, source-record currentness,
  alias epochs/claims, identifier-less successors, bounded provider input,
  Queue privacy/idempotency, bounded sitemap work, and credential-delivery
  refusal/compensation paths, plus removal of the vulnerable transitive
  `node-tar` chain.
- PR #22 exact head `501b33d08fafe5cdf1c9c0c9877f0b38b4b265c0`
  passed the complete 183-file/2,926-test Vitest suite, typecheck/build, all 26
  ordered and idempotent migrations, generated schema/OpenAPI/runtime drift
  checks, vertical/acquisition checks, repository Cloudflare topology, all five
  Worker artifact checks, disposable PostgreSQL 16
  replay/reconciliation/concurrency gates, and the moderate-level dependency
  audit. Hosted run `33352124668` passed the protected ruleset checks. Sealed
  security scan `24b34cd2-2f8d-40ae-bfd2-f4460daa419f` closed 32/32
  worklist rows across all 65 changed files and 10/10 surfaces with zero
  findings, candidates, deferred items, or suppressions. PR #22 merged normally
  as `9c917c0f708352dfb79861110023145eb23806e3`.
- Repository topology centralizes production endpoint classification, rejects
  loopback/unspecified endpoints and plaintext protected values, and keeps
  deployment-only fields out of tracked templates. Deployment-mode validation
  additionally requires five ignored exact manifests with one canonical
  `account_id`. It is expected to refuse safely until those external manifests
  and resources exist.

## Blockers

- No exact deployment of protected `main` or hosted database/Queue/R2 proof is
  recorded. Live Cloudflare account state could not be inspected here.
- Public sitemap rate limiting and its ordinary-crawler bypass policy have not
  been configured or verified on the canonical Cloudflare account.
- No real HVAC source has the required exact grants and human rights review.
- RapidAPI and MCP have no live external-channel proof.

## Required User Actions

See `PROJECT_CHECKLIST.md` `UA-001` through `UA-004`. ENERGY STAR remains
deferred; it is not an action request in this work package.

## Production Impact

Repository code, fifteen forward migrations (`0012` through `0026`), tests,
generated artifacts, and control documents changed on protected `main`. This
work performed no deployment, hosted migration, grant activation, source
acquisition, publisher contact, or provider mutation.

## Previous Session Summary

Protected `main` combines usage accounting/auth, corrected Option B rights,
public web, RapidAPI, scheduled acquisition/readiness, and MCP in dependency
order through migration `0026`. Final review repairs add a last
practical pre-persistence rights checkpoint, exact historical authorization,
one-client resolution transactions, `source-record-evidence@3`, claim-backed
alias epochs/currentness, identifier-less successor handling, a fail-closed
credential provisioner, bounded provider-controlled input and surface
authorization, recoverable server-clock acquisition leases with
non-owner capability redaction, request-bounded keyset sitemap enumeration,
same-account deployment validation, and non-actionable HVAC source research
consistent with the owner decisions.
