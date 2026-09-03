# Progress

## Current State

- Product: Data Foundry
- Lifecycle stage: Alpha Lab schema staged / protected main / pre-deployment
- Control-graph node: `PROTECTED_MAIN -> EXTERNAL_DEPLOY`
- Current milestone: bind the staged Alpha Lab schema to the five Workers
  through owner-provisioned credentials and Hyperdrives, prove the first lawful
  Cloudflare canary, and open the first rights-admitted source and revenue
  channel without implying that a real HVAC dataset is cleared
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
  `24b34cd2-2f8d-40ae-bfd2-f4460daa419f`. Every later commit, including
  documentation-only, creates a new repository SHA and requires fresh exact-SHA
  local, hosted-CI, review, and ruleset evidence before it can be designated for
  provider action. The Alpha Lab isolation branch merged as
  `290df1342094433e92978ec97eb37cc02fc4eb50`; PR #24 (`/docs` page names the
  API contract) merged as `5dde773a4b64a8e004ca429706100399a678cf74`.
  PR #26 then merged normally as
  `02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493` from reviewed head
  `8a43b7f7600fef10c1b26f0281a4c087f8610373` after both required
  checks, both automated reviews, and all review threads were clean. That merge
  does not authorize a hosted migration or deployment; those retain separate
  containment, credential, exact-SHA, and provider gates.
- Repository state alone designates no Worker release candidate.
- The required source gate
  is six route-less private-canary Worker artifacts: five reduced targets and
  one harness. The canary path also requires the five dedicated 14-day queues
  `data-foundry-private-canary-usage-events`,
  `data-foundry-private-canary-usage-events-dlq`,
  `data-foundry-private-canary-events`, `data-foundry-private-canary-dlq`, and
  `data-foundry-private-canary-quarantine`; none may repurpose the ordinary
  usage Queue/DLQ pair.
- Preview: none verified
- Production: no Data Foundry Cloudflare deployment exists. The Aroqon zone is
  active/full, but `data.aroqon.com` currently returns Vercel `404: NOT_FOUND`.
- Database target: shared Alpha Lab Supabase project `fgxinxaqkwoqyywdgobs`.
  The private `data_foundry` schema now carries all 26 ledgered migrations,
  migration-owner ownership, the `PUBLIC` revoke, and the historically verified
  200-grant runtime matrix for five staged `NOLOGIN` roles. The same hosted
  snapshot records `df_migration` as `NOLOGIN`; it is not yet the controlled
  direct login required by the current migration runner. Repository migration
  `0027` pins all 57 function search paths and narrows acquisition access to the
  199-grant matrix; repository migration `0028` adds the four justified rights-
  path indexes. Both remain pending hosted authorization and application at a
  newly reviewed exact SHA. It holds no source, entity, fact, tenant, or
  credential rows.
  See the [2026-09-02 hosted migration evidence](docs/evidence/alpha-lab-hosted-migration-20260902.md).

## Latest Session — Protected-Main PR #26 Release-Boundary Merge

- Reconciled every PR #26 review thread and extended the
  same shared PostgreSQL 16 policy across the direct migration runner,
  connector packets, runtime-grant installer/verifiers, five direct role
  probes, and every route-less private-canary target. The merged implementation
  rejects unsafe role posture, memberships, role/database settings, effective
  parameter and large-object privileges, FDW/server access, ownership, all-
  database `CREATE`, and `CONNECT` to any other live non-template database.
- Direct migrations now require `df_migration` to be a controlled direct
  `LOGIN NOINHERIT` session/current user with exactly one current-database
  durable `search_path=data_foundry, pg_catalog, extensions` row and no global
  role settings. The configured and resolved live path is checked before the
  first broader policy query and before/after every pending migration.
- Generated provider packets recheck migration-role durable/default/external
  state before and after each migration, prove `current_user=df_migration`
  around migration SQL, and refuse quoted as well as unquoted shared-`public`
  qualification. Drift rolls back before both the ledger insert and any later
  migration. Exact reviewed Git migration bytes remain the trusted computing
  base; these controls do not claim to sandbox a malicious provider admin.
- Negative controls cover neighboring default permissions independently,
  effective privileges inherited through `PUBLIC`, PostgreSQL 16 parameter and
  large-object catalogs, exact extension membership, unmanaged and shared
  object ownership, foreign tables, search-path poisoning, role escape, and
  cross-database reachability. Tests directly assert the non-generic extension
  and numeric shared-ownership branches so a broader rejection cannot mask
  them. The disposable PostgreSQL CI job applies and cleans each mutation and
  preserves only allowlisted error signatures in mode-`0600` captures.
- Repository-only verification is green. Exact PR head `8a43b7f` passed
  protected run `33697035331`, including disposable TLS PostgreSQL 16, and
  both automated reviews found no remaining issue. A clean checkout of merge
  commit `02e90d7` passed TypeScript, 202 files / 3,244 tests, 28 ordered
  idempotent migrations, generated schema/OpenAPI/runtime checks, topology, and
  eleven PGlite-free Worker artifacts. Protected-main push run `33698213600`
  also passed both required jobs. None of this is live provider evidence.
- No provider, source, rights, billing, DNS, or deployment state changed. The
  hosted target still needs `UA-006`, a secure `df_migration` credential and
  canonical role setting, a read-only cross-database topology result, pending
  migrations `0027`–`0028`, five runtime credentials/Hyperdrives, and the
  private canary before any public deployment.

## Previous Session — Hosted Private-Schema Migration and Grant Activation

- Applied the exact `db/migrations/` set (tree shared by PR #26 head `93a668b`
  and `main` `5dde773`) to the Alpha Lab target through the exporter's attested
  connector packets, each submitted as one multi-statement query that
  PostgreSQL runs as a single implicit transaction; demonstrated by a rollback
  probe and by every object being owned by the migration owner through
  `SET LOCAL ROLE`, not assumed from client documentation. Direct TLS Postgres
  is unreachable from the automation container, so the connector path was used
  under the owner's explicit production-provisioning preauthorization and is
  recorded as a documented deviation from the runbook's direct-TLS preference.
- Verified: ledger `0001`–`0026` with exporter-matching checksums, 46 tables,
  3 views, 57 functions, every object owned by the migration owner, zero
  `SECURITY DEFINER` functions, the `PUBLIC` pseudo-role removed from the
  private schema and its objects, and the exporter's 200-grant runtime
  verification block passing. The shared `public` schema ACL and table count
  are unchanged.
- Staged, not activated: the five runtime roles have database `CONNECT`,
  schema `USAGE`, and object grants but no password and no `LOGIN`. Assigning
  credentials and creating the five cache-disabled Hyperdrives is owner-only
  (`UA-002`). Zero Hyperdrive configurations and no Data Foundry Worker exist.
- Provider advisories after migration: the pre-existing `public.automation_runs`
  RLS error belongs to the unrelated Alpha Lab application and was left for the
  owner; 57 `function_search_path_mutable` warnings on `data_foundry` functions
  were observed. Repository migration `0027` implements the forward fix, but it
  has not been applied or reverified on the hosted target; no warning closure is
  claimed.
- Latest redacted Cloudflare evidence at 2026-09-02T14:46Z records the standard
  usage model and the ordinary usage Queue/DLQ pair at 14-day retention, with
  zero Data Foundry Workers, Hyperdrives, R2 buckets, hostname record, or route.
  The earlier same-day raw-bucket observation is historical and superseded.
- The FK-advisor review justifies exactly four rights-path indexes in repository
  migration `0028`. The other 31 INFO notices are non-blocking and deferred to
  post-traffic `EXPLAIN`/advisor monitoring rather than speculative indexes.
- Merged PR #24 (`/docs` page names the API contract) as `5dde773`. The hosted
  `0001`–`0026` application predates repository migrations `0027`–`0028`; any
  pre-continuation SHA-specific canary or exporter evidence remains historical
  only and cannot authorize the pending hosted work.
- Data and revenue remain gated exactly as before: `hvac` is `DRAFT` with four
  synthetic fixture sources, ENERGY STAR is deferred and unreviewed, RapidAPI
  enrollment is owner-only (`UA-004`), and no Stripe product or listing exists.
  No source acquisition, publisher contact, listing, or billing change was made.

## Session 2026-08-31 — Alpha Lab Isolation and Provider Reconciliation (historical, superseded where noted)

- Corrected the data boundary: Data Foundry is a private `data_foundry` schema
  inside Alpha Lab, not part of Valor. Real-Postgres operational commands now
  default to that private schema; legacy `public` use is explicit only.
- Hardened migrations to preflight the private schema and `extensions` access,
  refuse legacy Data Foundry public installations, and retain an independent
  schema-scoped migration ledger.
- Made the disposable real-Postgres CI service create the same `extensions`
  namespace before private-schema migration, preserving the production guard
  instead of weakening it for a generic PostgreSQL container.
- Hardened Cloudflare Hyperdrive usage: each Worker invocation owns and closes a
  fresh client; every private-schema operation uses and verifies a transaction-
  local search path; snapshot setup is constrained and serialized so a pooled
  transaction cannot inherit another Alpha Lab consumer's path.
- Added regression coverage across the canonical store, migration runner,
  ingest CLI, and all five Worker lifecycle roots.
- Historical observation: `aroqon.com` was active/full with no Data Foundry
  Workers, Hyperdrives, Queues, or R2 buckets, and the account appeared Workers
  Free. The Queue/R2/plan assertions are superseded by the 2026-09-01/09-02
  redacted evidence: the account uses the standard usage model and the ordinary
  14-day Queue/DLQ pair exists. The 2026-09-02T14:46Z refresh found zero Data
  Foundry Workers, Hyperdrives, or R2 buckets and supersedes an earlier same-day
  raw-bucket observation. No Worker, route, Hyperdrive, or live binding proof
  exists. The configured Vercel project has
  disconnected Git and no viable deployment, so it is not a rollback target.
  The [redacted 2026-08-31 provider reconciliation](docs/evidence/alpha-lab-provider-reconciliation-20260831.md)
  records the read-only observations and excludes provider identifiers and
  credentials.
- Fresh local evidence: `typecheck`; focused schema/Worker tests (78); the full
  Vitest suite (189 files, 2,969 tests); migration, generated-schema/OpenAPI,
  topology, vertical/runtime, and all-five-Worker artifact checks all pass.
  Source readiness at `2026-08-31T20:22:08.032Z` is correctly `NOT_READY`:
  HVAC has zero real sources and no effective surface grants.
- No Cloudflare, Vercel, Supabase, DNS, billing, source-rights, or production
  data mutation was made.

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
- The Aroqon Cloudflare zone is active/full. Latest redacted evidence shows the
  standard usage model and exactly the ordinary 14-day Queue/DLQ pair, with no
  Data Foundry Worker, route, Hyperdrive, or R2 bucket. The next deployment
  proof is the
  route-less, service-bound private canary; any public canary or
  `data.aroqon.com` cutover requires separate later authorization.
- The configured Vercel project has disconnected Git. Its production domain
  returns `404: NOT_FOUND` and historic deployments fail for a missing `public`
  output directory; it is not a viable rollback path.
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

- A provider-side containment result (`UA-006`) is required before any provider
  deployment or new credential-bearing migration/recovery action. Use only the
  affected provider's normal security/audit controls; do not reopen the prior
  browser state, reveal the item, or rotate unrelated credentials.
- Hosted Alpha Lab private-schema and grant proof is recorded; no Data Foundry
  Worker deployment, Hyperdrive, or live Queue/DLQ/R2 integration proof is.
- `df_migration` and the five runtime roles are staged `NOLOGIN` without
  passwords. Pending direct migrations wait on the controlled migration-login
  credential and canonical database-scoped path; every Worker database binding
  waits on its own secure credential and Hyperdrive (`UA-002`).
- The current PostgreSQL policy refuses effective `CONNECT` to any other live
  non-template database and `CREATE` on every database. No current hosted
  inventory proves that cluster boundary yet; a non-empty result is an explicit
  owner/provider topology blocker rather than a condition automation may
  normalize on the shared project.
- The current public data hostname is a Vercel 404, not a Data Foundry runtime.
- Secure migration/runtime database-role password entry, the pending exact-SHA
  migrations, five cache-disabled Hyperdrives, and post-credential verification
  are needed before the route-less canary can run; preserve and reverify the
  standard usage model and ordinary 14-day queues; provision the absent raw-
  artifact and canary receipt buckets.
- Public sitemap rate limiting and its ordinary-crawler bypass policy have not
  been configured or verified on the canonical Cloudflare account.
- No real HVAC source has the required exact grants and human rights review.
- RapidAPI and MCP have no live external-channel proof.

## Required User Actions

See `PROJECT_CHECKLIST.md` `UA-001` through `UA-006`. The immediate external
gates are provider-side containment (`UA-006`), rights review (`UA-001`), secure
role/Hyperdrive entry (`UA-002`), RapidAPI enrollment (`UA-004`), and separately
authorized public hostname confirmation (`UA-005`). Filling the schema with
real data depends entirely on `UA-001`: ENERGY STAR remains deferred and
unreviewed, and its review packet's open `[REVIEWER]` questions are the owner's
to answer; automation must not sign, acquire, publish, or contact the publisher.

## Production Impact

The merged Alpha Lab isolation change (`290df13`) governs runtime schema
selection and Hyperdrive transaction isolation/lifecycle. Merged PR #26
tightens migration/runtime-role safeguards, regression coverage, and deployment
documentation only; it made no hosted mutation. The preceding
session performed the hosted private-schema migration and grant activation
described above and merged PR #24. Neither session performed a Worker
deployment, credential creation, source acquisition, publisher contact,
listing, or billing change, and neither touched the shared `public` schema.

## Previous Session Summary

Protected `main` combines usage accounting/auth, corrected Option B rights,
public web, RapidAPI, scheduled acquisition/readiness, MCP, the private-canary
topology, and final runtime least-privilege/export hardening in dependency order
through migration `0028`. Hosted migrations `0027`–`0028` remain pending
separate exact-SHA authorization and application. Earlier
review repairs add a last
practical pre-persistence rights checkpoint, exact historical authorization,
one-client resolution transactions, `source-record-evidence@3`, claim-backed
alias epochs/currentness, identifier-less successor handling, a fail-closed
credential provisioner, bounded provider-controlled input and surface
authorization, recoverable server-clock acquisition leases with
non-owner capability redaction, request-bounded keyset sitemap enumeration,
same-account deployment validation, and non-actionable HVAC source research
consistent with the owner decisions.
