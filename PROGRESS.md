# Progress

## Current session — 2026-09-18/19 (third session): Part 2 opened — canary disposition recorded, provider read-back tooling, route-less deployment gate

**Verdict: READY_FOR_USER_REVIEW for this work package. No provider mutation.
No production change. The read-back has not been executed against the account.**

- **Current state.** Protected `main` `fabd85d71b257eeeb7e9a6c4adb1b0effdd6e7e6`
  (PR #53 merged). Lifecycle stage unchanged: MVP integrated / private canary
  passed / pre-production. Control-graph node: `State changed → refresh
  baseline → invalidate only affected evidence → rerun affected gates →
  continue`; nothing hosted changed since the second session, so the baseline
  is the second session's reconciliation.
- **Session objective.** Pick up where the local "autonomous takeover Part 1"
  session stopped: it ended waiting on the disposition of the seven temporary
  Workers and five canary queues, and on a read-back for the two facts the
  reconciliation could not observe (queue retention/backlog; Worker routes,
  custom domains, `workers.dev` and preview flags). This session was run from
  a remote container with no Cloudflare or PostgreSQL credential, so it did the
  two Part 2 items that are engineering rather than provider work and left the
  provider-touching items (ordinary route-less deployment, backup/restore and
  rollback exercise) for an authenticated operator session.
- **Disposition decided — [ADR-0013](docs/decisions/ADR-0013-private-canary-resource-disposition.md).**
  The seven private-canary Workers, five private-canary queues, six
  Hyperdrives, CA, receipt bucket and receipt are **retained** as standing
  pre-cutover validation infrastructure. Reasoning: `REV-006` requires exact
  current-SHA canaries before every public cutover, so the canary is a
  recurring gate rather than a one-off; the Hyperdrives are the ordinary
  production bindings anyway; and route-less idle Workers and empty queues have
  no measurable cost. Consequences: the canary Workers are redeployed from each
  new release SHA before its run; deletion of the identities becomes the
  rollback path, not routine closeout; the receipt is never deleted or
  lifecycle-expired. Engineering disposition, reversible, owner may override.
- **Read-back gaps closed in tooling — `pnpm cloudflare:readback:check`**
  ([`tooling/scripts/check-cloudflare-readback.ts`](tooling/scripts/check-cloudflare-readback.ts)).
  Expectations are derived from the tracked manifests (every
  `[[queues.producers]]`/`[[queues.consumers]]` block, `workers_dev`,
  `preview_urls`, no routes), not typed in twice. With a read-only token it
  reads `GET /accounts/{id}/queues` (retention, delivery pause/delay,
  producers, consumers with batch/retry/wait/concurrency/DLQ),
  `GET /accounts/{id}/queues/{queue}/metrics` (backlog), the Workers script
  list, each `data-foundry-*` script's `/subdomain` flags, the zone's Worker
  routes (zone resolved read-only by name `aroqon.com` when no id is given) and
  the account's Worker custom domains, then fails closed on any difference.
  Two phases: `private-canary` (current: seven Workers, five canary queues
  exact, ordinary usage pair untouched by any canary script, nothing
  `data-foundry-*` routed or exposed, no ADR-0012 canonical hostname served by
  any Worker) and `ordinary-route-less` (next: six ordinary Workers present,
  ordinary usage and ingestion topologies exact, still nothing routed).
  Terminal queues (both DLQs, quarantine, ingestion DLQ) must have zero
  backlog. Output is sanitized (names, booleans, counts, seconds; no
  identifiers, route patterns or token); `--capture` writes the raw responses
  to a `0600` file as out-of-band evidence and `--snapshot` re-evaluates one
  offline. API response shapes were taken from Cloudflare's published OpenAPI
  schema, not from memory.
- **Route-less ordinary deployment gated and documented (2026-09-19
  continuation).** The second session's recommendation — establish the ordinary
  topology from the six tracked manifests with the six Hyperdrive IDs and no
  routes — had no pre-deployment check: `cloudflare:deployment:check` demands
  canonical routes, `PUBLIC_ORIGIN`, `MCP_HOSTNAME` and `MCP_ALLOWED_ORIGINS`,
  so it would rightly reject route-less manifests, and the runbook's launch
  order deployed the ordinary Workers only after public authorization. Added
  `--mode route-less-deployment` to `check-cloudflare-topology.ts`
  (`pnpm cloudflare:route-less-deployment:check`): same account, six distinct
  Hyperdrives, `no-store`, privacy-flag and plaintext-secret rules as
  `deployment`, but every route and every public endpoint variable is
  forbidden. Four new tests (happy path that `deployment` mode rejects for
  lacking routes; route/`RAPIDAPI_HOSTNAME`/`PUBLIC_ORIGIN`/`MCP_*` rejected
  without echoing hostnames or ids; shared account/Hyperdrive/cache/preview
  drift; absent manifest fails closed); the topology suite is 115 / 115. The
  runbook gains a "Part 2: ordinary route-less deployment" procedure
  (preconditions, what the two Crons will do against the production database
  from the first minute — hourly `REFUSED`/`RIGHTS_REFUSED` acquisition audit
  rows for any compiled target and five-minute health snapshots with alerts
  disabled — six steps, read-back, rollback), and the launch order's step 4 is
  split accordingly. No provider mutation; the step is documented, not run.
- **Tests and verification.** `pnpm install --frozen-lockfile`; `pnpm
  typecheck` pass; new
  [`tooling/test/cloudflare-readback.test.ts`](tooling/test/cloudflare-readback.test.ts)
  23 / 23 (manifest-derived expectations for both phases, an agreeing snapshot
  passes, then one fact broken at a time: retention, pause, delay, backlog,
  consumer policy, DLQ target, extra/R2 producer, missing/doubled/wrong
  consumer, absent Worker/queue, unexpected queue, subdomain/preview/route/
  domain exposure, canonical hostname via route, wildcard route and trailing-dot
  domain, unreadable zone; fake-fetch capture with bearer header, per-script
  probing limited to `data-foundry-*`, zone lookup by name, pagination, API
  error without token echo; CLI parsing including pnpm's forwarded `--`,
  credential refusal, offline exit codes). Full `tooling` project 43 files /
  852 tests pass on Linux. CLI smoke: a manifest-derived snapshot passes the
  `private-canary` phase and fails the `ordinary-route-less` phase with the six
  absent ordinary Workers and two absent ingestion queues named.
- **Documents.** Runbook banner, step 5 and section 6 (checklist item 2 and
  Verify) carry dated ADR-0013 and read-back notes; `README.md` provider
  paragraph and key commands; the reconciliation record's "left in place"
  section points to the decision; `PROJECT_CHECKLIST.md` rows
  `FOUNDATION-006`, `BETA-002`, `BETA-003`, `PROD-002` updated (statuses
  unchanged). History was annotated, not rewritten.
- **Not done, deliberately.** The read-back was **not executed** against the
  account: this container holds no Cloudflare token, and the connector exposes
  no queue, route, domain or subdomain read. Until an operator runs it once
  with a read-only token, retention/backlog and route/domain/subdomain state
  remain unattested exactly as the reconciliation recorded. No ordinary Worker
  was deployed; no backup/restore or rollback exercise was run (needs
  PostgreSQL egress and Wrangler authentication); no `UA-005` packet was
  written because it depends on the ordinary route-less deployment passing the
  new read-back first.
- **Open PR noted, not acted on.** The owner opened PR #54
  (`REVENUE_PLAN.md`, revenue-first execution plan) after the second session.
  Its MVP item "deploy ordinary paid API/MCP route" is the same work as
  `PROD-002` → `UA-005`; nothing in this session conflicts with it, and it was
  left for the owner to merge or amend.
- **Deployment environment / database target.** Cloudflare account
  `c2832821a9ab36419cde6ee08112f6d3` (read-only connector: nine Workers listed,
  seven of them `data-foundry-private-canary*`, unchanged). Supabase
  `fgxinxaqkwoqyywdgobs`, private schema `data_foundry` at `0033`, untouched.
  **Production changed by this session: no.**
- **Blockers.** None for this package. Owner-only gates unchanged: `UA-001`,
  `UA-005`, `UA-004`, `UA-007`, `UA-008`.
- **Required user actions.** None new. Optional and recommended: run
  `pnpm cloudflare:readback:check --phase private-canary --capture <private-path>`
  once from a machine with a read-only Cloudflare token and record the
  sanitized stdout as evidence; if it fails, the failure text is the finding.
- **Recommended next steps (Part 2, continued).** (1) Execute the read-back
  once (above). (2) In an authenticated operator session, follow the runbook's
  Part 2 procedure: decide on the Cron consequences, populate the six ignored
  manifests, pass `pnpm cloudflare:route-less-deployment:check`, create
  `data-foundry-ingestion` and `-dlq` at 14 days, deploy the six ordinary
  Workers **without routes**, then require `pnpm cloudflare:readback:check
  --phase ordinary-route-less` to pass (`PROD-002`). (3) Hosted backup/isolated
  restore/rollback exercise (`BETA-003`, `REV-006`). (4) Only then the
  `UA-005` public-cutover decision packet.

## Earlier — 2026-09-18 (second session): UA-002 hosted execution independently reconciled and closed

**Verdict: UA-002 COMPLETE. BETA-002 DONE. Private-canary success only — not
production, not public cutover, not source activation, not commercial launch.**

- **Current state.** Protected `main` `55804842f5c5131640dd0435c7d203a66e95b63c` (hosted CI run
  35291689381 green). Lifecycle stage: MVP integrated / private canary passed /
  pre-production. Control-graph node: `State changed → refresh baseline →
  invalidate only affected evidence → rerun affected gates → continue`; this
  session was the refresh. Current milestone: still "integrate and deploy the
  first lawful, revenue-capable dataset".
- **Session objective.** Take over from the earlier 2026-09-18 hosted
  execution, verify its material claims from the provider and the database
  rather than from its prose, preserve sanitized evidence, and reconcile the
  status documents. Full record:
  [`docs/evidence/ua002-hosted-execution-reconciliation-20260918.md`](docs/evidence/ua002-hosted-execution-reconciliation-20260918.md).
- **What was read back, and matched.** Hosted ledger 33 / 33 / 0 with every
  effective checksum equal to release `2063ea8d72247a9b2643e1c690e37ab55ab14252` (the exporter run against a
  snapshot of the live ledger reports zero pending and the release's own
  ledger-drift query returns empty). The release's
  `postMigrationGrants.postCredentialVerificationSql` executed read-only:
  both `DO` blocks pass, 286/286 runtime grants, 0 missing, 0 unexpected, 55
  relations and 59 functions owned by `df_migration` with the canonical
  `search_path`, 0 `SECURITY DEFINER`, 0 unsafe default ACLs, 0 unsafe
  durable settings, 0 `PUBLIC` private ACLs, runtime roles LOGIN and
  non-privileged with no memberships, external ACLs exactly `CONNECT` +
  `extensions USAGE`, 0 reachable external capability. Six Hyperdrives with
  the expected names, IDs and role users, all `caching.disabled`,
  `verify-full`, CA `4856c681-5728-4008-8b1c-41323ce203bc`
  (`data-foundry-supabase-root-2021`, expires 2031-04-26). Five private-canary
  queues with the expected IDs and the runbook's exact producer/consumer/DLQ
  topology; the ordinary usage pair untouched with no producer or consumer.
  Both R2 buckets; the receipt retrieved by its exact key (sha256
  `81435077ca99d64868f031d733bb849b3dc3193fa7cc3f3b255925c9c91269e4`): six
  `READY` probes, edge and MCP metering `QUEUED`. Fixture residue: none.
  Seven route-less Workers with the expected version IDs; bindings read back
  and matching the tracked manifests; **deployed bundles byte-identical to
  in-place builds of the tracked manifests at `5580484`** (and at
  `2063ea8`, whose app sources are identical).
- **What could not be read back with read-only tooling** (carried as Part 2
  gaps, not asserted): queue retention and depth, Worker route / workers.dev /
  preview flags. The six direct runtime-role credential probes were not re-run
  (no credential is or should be in this session); they are corroborated by
  Hyperdrive creation and by each target asserting its own role before
  `READY`.
- **Checklist changes.** `UA-002` → COMPLETED; `BETA-002` → DONE;
  `FOUNDATION-006`, `MVP-005`, `PROD-001`, `PROD-002`, `REV-006` evidence
  advanced, status unchanged; `FOUNDATION-008` records the Windows-only test
  debt below. `README.md`, `SECURITY.md`, the Cloudflare runbook and the
  UA-002 handover carry dated banners; history was kept, not rewritten.
- **Tests and verification.** `pnpm install --frozen-lockfile`; `pnpm
  typecheck` pass; `pnpm cloudflare:artifacts:check` pass (thirteen
  artifacts); full `pnpm test` on Windows 3,556 / 3,583 with the 27 failures
  confined to three POSIX-only tooling tests from PR #47 plus two vitest
  worker-timeout errors, while Linux CI on the same SHA is green. The doc and
  tooling suites relevant to this change were re-run after editing (see the
  PR).
- **Problems found and corrected.** (1) The main checkout was parked on the
  stale branch `claude/foundation-hardening-20260818` with a stray untracked
  draft test that broke `tsc`; the checkout was moved to `main` and the draft
  was moved, not deleted, to `C:\Users\Adam\data-foundry-worktrees\stray-untracked-20260918\`.
  (2) `node_modules` predated the lockfile (no `wrangler`); reinstalled from
  the frozen lockfile. (3) Status documents still described the hosted state
  as 26/33 with no Workers/Hyperdrives/R2; reconciled.
- **Branch / PR.** `claude/ua002-hosted-reconciliation-20260918`, a
  documentation-only PR (the CI scope gate runs the documentation-only path).
- **Deployment environment / database target.** Cloudflare account
  `c2832821a9ab36419cde6ee08112f6d3`: seven temporary route-less Workers, no
  ordinary Worker, no route. Supabase `fgxinxaqkwoqyywdgobs`, private schema
  `data_foundry` at `0033`. **Production changed by this session: no.**
- **Blockers.** None for Part 2's technical work. Owner-only gates unchanged:
  `UA-001` (first real source rights), `UA-005` (public cutover), `UA-004`,
  `UA-007`, `UA-008`.
- **Risks / debt.** `pgpass` deprecation warning for a future `pg@9` (record
  only). Three POSIX-only tooling tests fail on Windows. `df_migration`
  remains `LOGIN`; parking it is a Part 2 decision. The temporary canary
  Workers, queues, CA, bucket and receipt are intentionally retained until Part
  2 decides their disposition; do not delete the receipt.
- **Required user actions.** None new.
- **Recommended next steps (Part 2).** Decide the disposition of the seven
  temporary Workers and five canary queues; establish the ordinary production
  topology from the six tracked manifests (ignored deployment manifests with
  the six Hyperdrive IDs, no routes); add a read-back for queue retention and
  Worker routes/subdomain flags; recovery/rollback exercise on the hosted
  target (`BETA-003`, `REV-006`); then the public-cutover decision packet
  for `UA-005`.

## Earlier — 2026-09-18 (first session): UA-002 provider staging executed and verified on the hosted database

**First hosted mutation of UA-002. The three provider-path prerequisites are
cleared. No migration was applied and none should be read into this.**

- **The reviewed `ua-002-provider-staging.sql` ran unchanged against project
  `fgxinxaqkwoqyywdgobs`** and its own verification query returns **0 / 0 / 7**:
  zero all-databases role settings remaining, zero privileged-or-inheriting
  `df_*` roles, seven `df_*` roles present. `df_ingestion` now exists
  `NOLOGIN NOINHERIT` with CONNECT and `extensions` USAGE and — correctly —
  *without* `data_foundry` USAGE, which the grant upgrade in the pending set
  delivers. All seven roles carry exactly one current-database `search_path` row.
  `df_migration` is `LOGIN`. Provider ledger row `20260918001016`.
- **A correction to my own earlier record.** The 2026-09-16 entry concluded "the
  connector is still read-only". That was measured against `execute_sql`, and
  `execute_sql` is still read-only — probing it with the authorized
  `ALTER ROLE df_migration LOGIN` returns `ERROR 25006: cannot execute ALTER ROLE
  in a read-only transaction`, mutating nothing. But the conclusion was drawn
  about *the connector* from one of its tools. `apply_migration` runs on a
  privileged connection and had never been tested. It is the same provider path
  the `20260901001729 data_foundry_private_schema_role_skeleton` came through,
  and the handover already assigns role creation and role-settings repair to
  "the secure provider path" rather than to the migration runner. Option 2's
  whole-project write mode was **not** enabled and remains un-taken.
- **The pending migrations were deliberately not applied through that tool**,
  although it could physically run them. `migrate.ts` asserts that the
  connection's `session_user` *and* `current_user` are both `df_migration`;
  `session_user` is fixed at connection time, so no in-session manoeuvre
  satisfies it, and the handover says a broader credential "is rejected by the
  runner, not merely discouraged". Applying by hand would also bypass the
  fifteen-probe preflight and the exact-baseline ACL-drift refusal, and leave
  `data_foundry.schema_migrations` unwritten — writing those rows by hand is the
  improvised SQL the standard forbids.
- **Pending set re-verified against the real hosted ledger**, exported from a
  clean worktree at the pinned release: **33 / 26 / 7**, pending `0027`–`0033`,
  `repositoryDigest 8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`.
  Undrifted.
- **The remaining blocker is reachability, not credential custody, and it was
  re-measured rather than assumed.** The same pooler hostname is OPEN on 443 and
  TIMES OUT on both 5432 and 6543, so the block is port-based; the origin is
  IPv6-only and this container has zero `inet6` addresses, no default IPv6 route,
  and no DNS answer for it at all. A probe of whether the HTTPS proxy would
  tunnel `CONNECT` to 5432 was **denied by the sandbox policy classifier as a
  containment escape** — recorded, not worked around.
- **No credential was created, on purpose.** A password this session generated
  would have to exist here to be useful, which the security boundary forbids; one
  generated server-side so it never enters this context would be known to nobody.
  Either way it would be unusable from here, because the port is unreachable.
- **Advisors unchanged by this work.** The 57 `function_search_path_mutable`
  warnings in `data_foundry` are what pending `0027` exists to repair and are not
  treated as blockers; `public.automation_runs` was left exactly as it is.
- Records: [the 2026-09-18 execution
  record](docs/evidence/ua002-provider-staging-executed-20260918.md) (new), a
  dated update banner on [the
  handover](docs/owner-actions/ua-002-hosted-migration-handover.md) marking the
  prerequisites section and execution step 4 as no longer applicable, and the
  `UA-002` rows of `PROJECT_CHECKLIST.md`.

**Exactly one owner action remains before the run:** set a password for
`df_migration` through the provider's secure credential path, then run the merged
sequence from a machine with ordinary PostgreSQL egress. Nothing about that value
belongs in chat, a repository file, a shell history or a log, and this session
neither needs nor wants it.

## Earlier — 2026-09-17 closeout: two PRs merged, hosted catch-up ready, commercial validation not started

**Merged implementation, hosted verification and commercial validation are three
separate tracks. Only the first advanced.**

### Merged implementation

- **PR #46 merged as `41dd2ec`.** The multi-dataset machine-data direction is
  standing repository authority, with ADR-0012 recording capability-based
  canonical hostnames while **preserving ADR-0011's implemented per-vertical
  edge isolation**. The two Codex P2 findings were answered and resolved: the
  delivered plan tasks are ticked, and Task 3 states why executive-state
  reconciliation was deferred to this closeout rather than raced from a branch
  that could not see both PRs.
- **PR #47 merged as `8a9542d`.** Both recorded parent-directory residuals in
  the UA-002 credential helper are closed, and both were reproduced against
  `44cec28` first. Ownership: a root run staged a credential into a 0755
  directory owned by another user at exit 0, and that user then unlinked it and
  substituted a symlink. Ancestors: a swapped symlink component put the password
  line **in the attacker's directory at exit 0** — the residual had recorded this
  as "not demonstrated", and it is demonstrated now. A defect the fix itself
  introduced (`--file .../` has no basename, producing a `mv` into a directory
  that BSD `mv` would accept) was found by re-reading the diff and rejected
  outright. Eight tests, 45 → 53; six fail against `44cec28`, two are controls.
  Local parity 15/15 with identical before/after tree fingerprints; exact-head
  CI green on `a3eb1bc`.

### Hosted verification — READY_FOR_SCOPED_EXECUTION, not done

Read-only reconciliation of `fgxinxaqkwoqyywdgobs` on 2026-09-17, plus a local
PostgreSQL 15 compatibility proof. Full packet:
[`docs/evidence/ua002-hosted-catchup-decision-20260917.md`](docs/evidence/ua002-hosted-catchup-decision-20260917.md).

- **PostgreSQL 15 needs no upgrade.** CI only ever proved 16. Against a real
  PostgreSQL 15.19 cluster with certificate-verified TLS, run from a clean
  detached checkout at release `2063ea8`, all 33 migrations applied, re-apply was
  a clean no-op, and the result was 51 tables / 3 views / 59 functions,
  `security_definer=0`, `functions_with_proconfig=59`.
- **The ledger agrees exactly: 33 / 26 / 7, 0 differing.** A raw-file SHA-256
  comparison reports all 26 rows differing and is **wrong** — this install uses
  the private schema, so the ledger stores the effective transformed checksum.
  Anyone re-checking must use the release's own `effectiveMigrationChecksum`.
- **Release pin not moved.** `PROGRESS` previously said UA-002 was "rebound to
  `1a37241`"; that described re-verification, not a change of pin. Migrations,
  runner, exporter and canonical store are byte-identical at `2063ea8` and
  current `main`, so `2063ea8` stands and its published checksums stay valid.
- **The 57 mutable search paths are what migration `0027` repairs**, not a
  blocker. A preflight comparing them before the catch-up would raise 57 false
  blockers and make the catch-up impossible to start.
- **Disabled RLS on private `data_foundry` tables is not public exposure.** The
  schema grants USAGE to the six `df_*` roles only; `anon`, `authenticated` and
  `service_role` have none. Supabase's own linter agrees — one ERROR finding,
  and it is not a Data Foundry table.
- **`public.automation_runs` is another workload's table** (ESO/ZOLL EMS
  automation): 5 rows, all from 2025-02-16, zero triggers, FKs, views or
  referencing functions, `anon` holding full CRUD with RLS off. Smallest
  containment proposed, deliberately not executed — the shared `public` schema
  is out of scope and the table belongs to its own owner.
- **Cloudflare state is UNKNOWN.** No connector, no credential, `wrangler
  whoami` unauthenticated. Historical inventories are not restated as current.
- **The one blocker is a `df_migration` LOGIN credential plus a PostgreSQL route
  to the origin.** All six `df_*` roles are NOLOGIN today. That is an owner
  action, not engineering.

### Commercial validation — CONTINUE_TARGETED_VALIDATION

Full decision:
[`docs/commercial-validation/first-paid-slice-decision-20260917.md`](docs/commercial-validation/first-paid-slice-decision-20260917.md).

- **Zero independent buyer interviews.** Every threshold on PR #49's scorecard
  reads 0. Interview #0 was the owner's own organisation and is correctly
  excluded; the two figures it produced — "a few hours a month" of burden, and
  single-state operation — both cut against the hypothesis.
- **Zero real sources.** All four HVAC sources are declared
  `SYNTHETIC — fictional publisher`. UA-001's blocker is a counsel question, not
  an engineering one.
- **One slice proposed, held weakly:** US Vehicle Intelligence (VIN → open
  recalls). Its differentiation was re-measured today — `HONDA`/`CR-V` (vPIC,
  JSON), `HONDA`/`ACCORD` (recalls, JSON), `Acura`/`Aston Martin` (EPA, **XML**)
  — three naming conventions and two formats across two agencies. It has no
  buyer and no rights determination, and the portfolio's own rule stands: every
  candidate is a research note.
- **Next action is not engineering**: run PR #49's existing instrument for 5–8
  independent conversations, and obtain one commercial-redistribution rights
  determination for the NHTSA endpoints in parallel.

### What is not true

No hosted migration was applied. No credential was created, requested, used or
rotated. No role was activated, no provider state changed, no deployment, no DNS
change, no public route, and no payment of any kind. The PostgreSQL 15 result is
a **local compatibility proof**, not hosted certification.

## Earlier — 2026-09-16 disposable-Postgres verification evidence, levels 2+ unproven

**Highest level proven: Level 1 (externally inspectable disposable-Postgres E2E integration proof). Next unproven: Level 2, hosted database reconciliation — blocked on PostgreSQL egress plus the `df_migration` credential.**

- **Level 1 work landed as PR #47.** The existing real-Postgres CI job now carries a `workflow_dispatch` trigger with a non-secret correlation id and publishes sanitized per-stage evidence to the run summary. It reuses the proven job rather than adding a second test implementation. The emitter is a tested script, not inline YAML, with 8 tests: the correlation id cannot carry a path or URL, the output cannot contain a value it was not given (asserted against a planted connection string, Cloudflare token and `PGPASSWORD`), a missing stage reports `not-run`, every stage can fail the run alone, and **a skipped stage is treated as unproven rather than a pass**.
- The evidence carries `kind: disposable-postgres-e2e-integration-proof` and a `notAProofOf` list as **data**, so the disclaimer travels with the document: not hosted-production, not Cloudflare deployed-runtime, no real Queue delivery, no real R2, no REST/MCP readback.
- **The repository's own CI policy test caught my first attempt.** I widened the Postgres job's `if:` for `workflow_dispatch`; `tooling/test/ci-workflow.test.ts` pins that expression and failed. It was right — the scope step already sets `run_postgres=true` for any non-`pull_request` event, so dispatch was already covered and the change only loosened a fail-closed guard. Restored verbatim.
- **Local verification, per instruction, with a partial result reported as partial.** Built a PostgreSQL 16.13 cluster with certificate-verified TLS and **applied all 33 migrations of the release to a fresh real database over it**. Stopped short of the full grant payload: it hit the release's genuine `df_migration` default-object-ACL precondition, which CI satisfies in a dedicated step, and re-deriving CI's ~400-line bootstrap locally stopped being economical. Two release behaviours confirmed along the way — the runner refuses non-TLS connections outright, and rejects any URL carrying `sslmode` or other TLS/endpoint query overrides.
- **UA-002 rebound to `1a37241`** against a freshly read hosted ledger (26 rows, `df_ingestion` absent, 0 `SECURITY DEFINER`, no drift): 33 / 26 / 7 and all ten checksums reproduce.
- **UA-002 environment determination:** this container has neither egress nor credential — the origin resolves IPv6-only and the container has zero IPv6 addresses. The handover now carries two credential-free commands the owner can run on their own machine to determine which blocker they have, plus a `.pgpass` placement that keeps the password out of arguments and history, escapes the `:` and `\` that are `.pgpass` metacharacters, and takes the login name from the route the owner actually has — bare `df_migration` direct, project-qualified through Supavisor.
- **PR #47 credential-guidance repair, with coverage that fails on the pre-fix revisions.** Two review findings on the UA-002 `.pgpass` guidance were real: a bare `df_migration` login that cannot authenticate through the Supavisor pooler the same section recommends, and a password written into `.pgpass` without escaping the `:` and `\` that are metacharacters there. Both fixed, and both now covered by tests that **execute** the documented block rather than assert its prose — 9 of 11 fail against the pre-fix document. A third finding followed on the same block — it appended to `.pgpass` where libpq uses the FIRST matching line, so a stale entry from an earlier password would win. Reproduced against a live PostgreSQL 16 cluster with `scram-sha-256` (stale-first fails to authenticate, correct-alone and correct-first connect), fixed, then two more found on the fix itself: a stale `*` wildcard still won, because libpq honours `*` in any of the first four fields; and a cancelled prompt replaced a working credential with an empty password while exiting 0. All measured against a live cluster, not reasoned from documentation. The block now writes the new entry FIRST (which is what beats a wildcard) while deliberately keeping wildcards that may serve the operator's other hosts, and refuses to write at all unless the read succeeded and returned something. A sixth followed: with a writable-but-unreadable `.pgpass` the rewrite failed, `mv` installed a file containing only the new entry, every unrelated credential was destroyed, and the block reported success — now `chmod`/`mv` are chained onto the rewrite succeeding. **Six findings across four rounds on one shell snippet, with CI green through all of them.** The gating checks do not reach a procedure written in prose, which is why these tests execute the block. Done rather than left open: the block is replaced by `tooling/scripts/ua002-migration-pgpassfile.sh`, which writes a dedicated password file and never touches `~/.pgpass`, so the whole class is gone by construction. Alternate-file support was confirmed **through the real runner** before adopting the design — `createPostgresDriver` against a live TLS PostgreSQL 16 connects with `PGPASSFILE` set, still connects when `~/.pgpass` holds a wrong password, and fails with no password file at all. 14 tests pin the acceptance conditions. **Correction:** I said the sanitized evidence was waiting on the merge; that conflated the trigger with the artifact. The evidence step runs on every PR run, and [run 35165734258](https://github.com/athompson83/data-foundry/actions/runs/35165734258) already emitted `overall: "pass"` with all ten stages and both fixtures verified for `29f142c`. Only `workflow_dispatch` needs `main`. A seventh finding then landed — the first the redesign did **not** make impossible: the helper cannot unset the caller's environment, so a `PGPASSFILE` or `DATA_FOUNDRY_MIGRATION_DATABASE_URL` left over from an earlier attempt would silently be used by the next migration command. The helper now names both on every failure and the handover says to clear them first. An eighth finding, **P1 and introduced by the redesign itself**, followed: the signal handler cleaned up and *returned*, so an interrupt after `mktemp` let the script resume, recreate the deleted file under the ambient umask and install it — reproduced as a **world-readable file containing the password, with the script exiting 0**. Signal handlers now exit (130/143) while `EXIT` keeps ordinary cleanup, and `umask 077` removes the dependency on the caller's umask. A ninth round found four more, including a **P1 that no test of the helper could have caught**: the execution sequence checked out release `2063ea8`, which does not contain the helper (`git cat-file -e` confirms), so the documented command would fail exactly when the credential was needed — the credential step now comes first. Two later blocks also re-exported a secret-bearing URL over the helper's password-free one, bypassing `PGPASSFILE` further down the same document. Plus `printf %q` for paths containing quotes, and rejection of directory targets (`mv` into a directory had reported success with the password in a random file inside). A tenth round then pinned the **whole operator path**: the helper is copied out of the reviewed checkout with a recorded SHA-256 and re-verified after the release checkout, so the migration release stays at `2063ea8` rather than moving and invalidating every release-dependent packet and checksum. A new `--check` mode stops the procedure when `PGPASSFILE`/the URL are missing, the file is not owner-only, or the URL carries a password. **The complete documented sequence was then run end to end** in an isolated checkout against disposable TLS PostgreSQL through `createPostgresDriver` itself — helper preserved, tree stripped of it, digest re-checked, `--check` passed, driver CONNECTED, decoy `~/.pgpass` byte-identical. An eleventh round caught two more: the section still *opened* by telling a fresh operator to start from the `2063ea8` checkout, where even the `cp` preserving the helper would fail — now split so the migration steps use that checkout and the credential step precedes it; and a `SIGINT` arriving after `mv` committed reported *"nothing was installed"* over an already-rotated credential, which is the more damaging wrong answer. The helper now tracks how far it got and says the outcome is uncertain rather than guessing. A twelfth round then caught that the procedure verified the helper against a digest it generated itself — proving the copy unchanged but nothing about provenance, so a tampered helper in a dirty checkout would capture the password and pass every check. The handover now **publishes the reviewed SHA-256**, checked before the helper is ever run, with a test binding the published value to the file. Also: `chmod 700` ran unconditionally, so a `--file` target in a shared directory had other users' access revoked even on a cancelled run; only a helper-created directory is restricted now. A thirteenth round moved to the verification workflow itself: a `workflow_dispatch` on `main` shared a concurrency group with ordinary pushes under `cancel-in-progress`, so a manual verification could be cancelled by a push or by a second request — now keyed on the event with each dispatch in its own group; and the evidence emitter needs a successful install, so a checkout/install failure produced **no evidence at all** despite `always()` — now backed by a shell-only fallback that sanitizes its correlation id and can only ever report `fail`. That fallback then regressed the ordinary path — the emitter exits 1 on a `fail` verdict *by design*, so a real stage failure got its accurate evidence plus a second block falsely blaming checkout/install. Fixed by measuring whether the emitter wrote anything rather than trusting its exit status. My regression, not a new class of defect. A fifteenth round then found the published-digest gate was **advisory**: with no `set -e` in a pasteable block, a failed `shasum -c` printed and the next line ran the unverified helper anyway. Each guard is now chained with `&&` to what it guards — verified with a wrong digest, the helper never runs and never sees a password. A sixteenth round found the same gap one step further down — `pnpm ua002:operator` ran unchained after a failed `--check`. Rather than chain that one site, the assertion was written against the class (**every** invocation must be gated), and it immediately failed on my own fix: 4 invocations, 3 gated. It found a fourth call site neither I nor the review had noticed. A seventeenth round showed the limit of that approach: a `set -e`-free pasted block cannot gate “the remainder” at all, because manual steps sit between the checks. Every helper invocation is now digest-gated **at the point of use** (six invocations, six gates), which also covers a copy modified after an earlier check. The class assertion I had written was itself hard-coded to a count — assert-the-case in test form — and is now genuinely class-based. The TCP readiness repair got the same treatment: the loop is driven against a stubbed probe replaying the observed init-server race, and 4 of 5 fail against the socket-probe version. An eighteenth round found the first defect here that is about the shell rather than the procedure, and it is the same shape as all the others: `printf '%s' "$(escape_field "$x")"` reports the status of `printf`, never of the substitution, so `set -e` could not see a failing `sed` and `pipefail`'s verdict died with the subshell. Reproduced against `b9ec9b9` — a `sed` failing for every field installed `::::` at **exit 0**, and a `sed` failing for the password alone installed a line matching the real host and login with an **empty password**, which is precisely what this helper exists to make impossible. `--check` accepted both, because it validates the file's type and permissions rather than its contents. Every field is now escaped into a checked variable **before anything is created**, by assignment, whose status *is* the substitution's; an empty result on a zero status is also rejected. Three of four new tests fail against `b9ec9b9`; the fourth is the control. A nineteenth round found a credential source the procedure never mentioned: `PGPASSWORD` does not compete with `PGPASSFILE`, it **overrides** it. Confirmed in `pg@8.23.0`'s source (`val('password', …)` falls back to the environment, and `pgpass` is consulted only when the resolved password is still `null`), then behaviourally through `createPostgresDriver` against a disposable TLS PostgreSQL 16 with `scram-sha-256`: a **correct** password file plus a stale `PGPASSWORD` **fails to authenticate**, and one that happened to be valid would authenticate with a credential this procedure never placed. The handover now clears it and `--check` refuses while it is set — checked first, because every other check would otherwise be reporting on a file the driver will not read. Also recorded rather than acted on: `pg@8.23.0` warns that pgpass support is removed in `pg@9`, which the whole `PGPASSFILE` design rests on. A twentieth round closed the last finding, on the same recurring shape: `cleanup()` ran `rm -f` and then `return 0` unconditionally, so a removal that **failed** could not affect the outcome — the helper printed "nothing was installed" and exited 1 while a mode-0600 file holding the complete password line stayed on disk at a path it never named. Reproduced against `e9f2735` as an unprivileged user (root bypasses the directory permission check, and my first attempt as root wrongly showed nothing). Cleanup is now a reported outcome: it checks whether the file is still present after the attempt, names it and says it holds the password in clear text, and no summary line reads as an all-clear unless removal was established — on ordinary failure, `INT`, `TERM` and `EXIT` alike. Four new assertions fail against `e9f2735`; two are controls. Exact commands and results, including two failures, in [the local verification record](docs/evidence/pr47-local-verification-20260916.md). A twenty-first round closed the two findings I had verified and declined to fix under the earlier stop. The first was a credential-integrity defect in the same shape as the rest: `mktemp` creates the staged file safely, but `printf ... > "$temporary"` resolves that name a **second** time, so in a directory another local user can write to, that user can unlink the entry and leave a symlink in its place. Reproduced against `bd0666e` two ways -- deterministically, with the complete password line landing in a file the attacker chose while the helper printed "Wrote" and exited 0; and in a live race between two real unprivileged users, where the attacker's symlink was installed as the target and the run still reported success. The helper cannot make a shell redirection race-safe, and it must not tighten a directory it did not create (the twelfth round fixed exactly that), so it now refuses a group- or world-writable parent before reading the password -- and refuses just as firmly when it could not read the parent's mode at all, because a mode that could not be read is unknown rather than acceptable. The default `~/.data-foundry` path is unaffected. The second was an evidence-integrity defect: the shell fallback fired whenever the emitter wrote nothing and concluded from that alone that "checkout or install did not complete", publishing `"stages": []`. An import-time error inside the emitter produces the identical condition **after** all ten PostgreSQL stages have run and recorded their outcomes, so the evidence stated a cause nothing had established and discarded outcomes sitting in its own environment. The fallback now carries every recorded outcome through -- sanitized to the four GitHub outcome values, `not-run`, or `unrecognized`, so a value that is not a step outcome can never be echoed -- stays `fail`-only, and names no cause. Seven new tests fail against `bd0666e`; one is a control.
- **CI on PR #47 runs now that it is no longer a draft.** Every job is gated on `github.event.pull_request.draft == false`, which is why the run for `e177e2d` skipped all three. Since the PR was marked ready, all three jobs are green on every head CI has reached, and the real-Postgres job emits the sanitized evidence document on each one — ten stages `success`, both pinned fixtures matching, `overall: "pass"` ([run 35176901239](https://github.com/athompson83/data-foundry/actions/runs/35176901239)). Full local `verify`-job parity (14 commands, 224 test files, 3510 tests) is recorded alongside it rather than in place of it.
- **Cloudflare activation (Level 3) cannot proceed from here:** the Cloudflare connector is unauthenticated and its tools are not loadable at all. No Worker, Hyperdrive, Queue or R2 state can be read or changed.

## Earlier — 2026-09-16 no first-source candidate is selectable

- **An external verification canary was requested and deliberately not built.** [The record](docs/owner-actions/external-verification-canary-20260916.md) states why: a public HTTPS canary would be a facade over a pipeline that is not deployed. Four measured reasons — the Cloudflare connector is unauthenticated here; the private canary is **route-less by design** (`workers_dev = false`, and its own header says "deliberately no public route, workers.dev endpoint, preview URL, Hyperdrive, database credential"); no runtime role has a credential; and the hosted schema is seven migrations behind with `df_ingestion` absent. The second reason would still apply even if the other three were solved, and the request's own security rules forbid weakening the auth model to work around it.
- **The fallback already exists, is green, and is publicly readable.** CI's real-Postgres job performs the synthetic transaction against real PostgreSQL with certificate-verified TLS, the real acquisition and ingestion runners, and the real `df_ingestion` role with its exact grants, asserting `facts > 0` and `fact_evidence > 0` — every stage an independent step. Reference run on `2063ea8`: `actions/runs/35137492353/job/104933454084`. All passwords are generated per-run with `openssl rand` and die with the container, so there is nothing to leak.
- **What it does not prove is recorded as prominently as what it does:** no real Cloudflare Queue delivery, no real R2 (the check uses `InMemoryObjectClient`), no deployed Workers, and no read from the hosted database. It is a code-path proof against ephemeral infrastructure, not a deployed-system proof.

- **Owner direction received: proceed with counsel review of ENERGY STAR as the preferred US first-source candidate.** A [counsel packet](docs/owner-actions/energy-star-counsel-packet.md) is prepared carrying only what is needed to answer one narrow question — the per-dataset licence attachment, the verbatim EPA text, the field-origin evidence, the exact fields and transformations proposed, the intended commercial use, and the explicit commitment not to use the ENERGY STAR mark or imply EPA endorsement. Trademark is kept as a separate issue from data-use rights, as directed.
- **Counsel's answer is necessary but not sufficient.** ENERGY STAR needs a second, separate approval: the acquisition method, which review packet §2 records as *proposed, not authorised*. The packet says so explicitly so a favourable legal answer cannot be mistaken for clearance to activate.
- **AU Energy Rating is qualified as the fallback and deliberately not built** — [the minimum viable AU/NZ slice](docs/owner-actions/au-energy-rating-fallback-slice.md) records one equipment class, the exact fields (natively AS/NZS, no cross-standard conversion), the claim the product could honestly make, and the five things that must happen first. Licensing being easier does not make it closer to revenue: it carries a robots blocker and a schema blocker that ENERGY STAR does not.
- **The DOE inquiry reduces to one send authorization.** Neither of the owner's two conditions is met: the CCMS contact page returns 403 to an honest agent so the contact route cannot be confirmed from here, and the only reachable DOE addresses are press/executive/clearinghouse routes rather than the CCMS program. Sender identity remains blank because asserting one on the project's behalf is not mine to do. [The authorization](docs/owner-actions/doe-send-authorization.md) names the three candidate routes in preference order.
- **A parallel dataset-discovery workstream is open** — [thirty candidates across six unrelated domains, reduced to ten finalists](docs/sources/dataset-portfolio-20260916.md), with every **factual** claim labelled `[MEASURED]`, `[INFERRED]` or `[UNVERIFIED]` because this session produced three errors from treating availability as authorisation. Judgement calls — demand, competitive intensity, monetization and the finalist ranking itself — are reasoned opinion, not measurements, and the document says so rather than implying the ranking is evidence-derived. Measured today: reachability for seventeen endpoints, `robots.txt` **bodies** for eleven hosts, and licence text for two. Two measured blockers are already recorded — ClinicalTrials.gov's `robots.txt` **disallows `/api/`**, and Open Food Facts is **ODbL share-alike**, which may be incompatible with a closed commercial derivative.
- The best-evidenced candidate is **US vehicle intelligence**, because the reconciliation problem is measurable rather than asserted: the same 2003 Accord is `HONDA`/`Accord` in NHTSA vPIC, `HONDA`/`ACCORD` in NHTSA recalls, and EPA fuel economy uses title case in XML — three identifier conventions, two formats, two agencies, no shared key, and two of those are the same agency.

- **Conclusion, after four correct review findings: no candidate is selectable today.** An earlier draft of this session's work recommended ENERGY STAR conditional on counsel with AU Energy Rating as a rights-clear fallback. Both halves were overstated and are withdrawn. The record is [the first-source decision sheet](docs/owner-actions/ua-001-first-source-decision-20260916.md).
- **The same error three times, which is the thing worth carrying forward.** I repeatedly let *reachability* stand in for *permission*: (1) I fetched `data.gov.au/robots.txt`, recorded `http=200`, never read the body — it is `User-agent: * / Disallow: /` for the entire host, and this platform sets `respect_robots: true`, so AU has **no approved automated acquisition path** despite a genuine CC-BY 3.0 AU licence; (2) I called ENERGY STAR's acquisition side "clean" on the strength of robots permitting `/api/` and `/resource/`, when the review packet §2 already says the SODA method is *proposed, not authorised* and states the rule outright — **"Robots not disallowing a route is not a grant"** — with terms, rate limits and redistribution constraints **[UNVERIFIED]**; (3) I presented the EPA licence attachment as new evidence narrowing the blocker when the packet already recorded the pointer **[VERIFIED]**, reproduced its text and analysed the same scope problem.
- **ENERGY STAR therefore needs two approvals, not one:** the rights question (does the EPA licence reach partner- and certification-body-submitted values?) **and** an acquisition-method authorisation. Counsel answering the first does not make it selectable.
- **The internal cell count was undercounted.** `docs/source-onboarding.md` Stage 2 requires effective `ACQUIRE`, `STORE` **and `CACHE`** before transport, and the ingest pipeline separately requires `NORMALIZE` and `DERIVE`. That is five internal cells, so a paid direct API needs **at least eight** cells, not seven. Omitting `CACHE` fails the first fetch closed.
- **AU Energy Rating** also has a field-coverage blocker beyond robots: AS/NZS star ratings and kW versus the dictionary's US DOE `seer2`/`eer2`/`hspf2` — different test procedures, not different units, so conversion would invent facts. Route to yes is written DCCEEW permission plus a schema decision.
- **DOE CCMS** is not selectable on access rather than rights: the edge returns **403 to an honest agent for `robots.txt` itself**, so crawl permission cannot be established without impersonating a browser, and no CCMS dataset appears in data.gov's advertised sitemap (all 112 shards, 559,455 URLs) — absence from the sitemap, not proof no catalogue record exists, since the catalogue API and search are broken and it appears mid-rebuild.
- Refresh cadence is **unknown** for both AU and ENERGY STAR; dated observations establish no frequency. Nothing was activated, no publisher was contacted, and the DOE inquiry remains unsent.

## Earlier — 2026-09-16 UA-002 execution environment identified

- **UA-001 gained a documented alternative to CCMS, and a clean negative on the open data.gov question.** Enumerating all 112 data.gov sitemap shards — 559,455 URLs — establishes that **CCMS has no catalogue entry**; the only `ccms` match is an unrelated workers-compensation system. The catalogue's own API is unusable (`/api/3/action/*`, `/api/action/*`, `/api/1/*` and `/api/` all return a non-CKAN `{"detail":{},"message":"Not Found"}`, and its `robots.txt` still carries literal `# TODO` placeholder text), so the sitemap was the only route left and it worked.
- The same enumeration surfaced [ENERGY STAR certified products](docs/sources/energy-star-certified-products-qualification-20260916.md), published by the EPA on Socrata with `provenance: official`. It resolves the exact objection that stopped CCMS: measured today with a plain descriptive user agent, `robots.txt` (200) disallows only `/browse?*` query-parameter variants — not `/api/` or `/resource/` — and both the metadata and row endpoints return 200. No impersonation, no undocumented endpoint, documented CSV/JSON/XML distributions, and `rowsUpdatedAt` on the day of measurement. 31 HVAC-relevant datasets carry stable identifiers.
- The coverage figure is deliberately **not** quoted as a total. The naive sum across the 21 core certified datasets is 875,613, and it is wrong twice: *Central Air Conditioners* and *Mini-Split Air Conditioners* both return **0 rows** while reporting `publicationStage: published`, and *Air-Source Heat Pumps* and *Heat Pumps* report identical row counts and update timestamps but different column counts (48 vs 50), so they may overlap and must not be added. The distinct count is unestablished and is recorded as something to measure, not to assume.
- Two things are explicitly **not** resolved by this find. ENERGY STAR is a *voluntary* label and therefore a higher-efficiency **subset**, whereas CCMS is the *mandatory* database for regulated equipment — different populations, not substitutes. And its rights position is open: no `licenseId`, an empty `license` object, and "ENERGY STAR" is a registered certification mark with its own usage rules, so it needs its own rights determination rather than inheriting CCMS's. Nothing was activated.

- The database half is blocked on exactly one capability, now established by measurement rather than assumption: **a host with PostgreSQL egress to the project origin, running release `2063ea8`, with the `df_migration` password available to libpq without appearing in a command line.** Any ordinary developer machine with internet access and the password satisfies it. [Measurements](docs/evidence/ua002-execution-environment-20260916.md).
- Every alternative was checked, not assumed. `list_environments` returns exactly one environment and `get_session` confirms it is the one this session already runs in, so a sibling session is the same container by another name. The origin resolves IPv6-only (`2600:1f1c:825:9500:de6d:a3aa:4fb1:e23b`, no A record) against a container with zero IPv6 addresses. Raw TCP to the IPv4 Supavisor addresses was refused at the sandbox policy layer, so the restriction is policy rather than routing. A Vercel function was rejected on judgement — it would put the migration credential into a hosting provider nobody approved for that purpose.
- The hosted baseline was re-measured read-only and has not drifted: ledger `0001`-`0026`, 46 tables, 3 views, 57 functions, 0 `SECURITY DEFINER`, 0 functions carrying `proconfig`, `public` untouched at 7, six `df_*` roles all `NOLOGIN`, `df_ingestion` absent. That `proconfig` count is the measurement that keeps a search-path preflight out of the operator: `0027` is what sets it, so checking it today would raise 57 false blockers.
- The 26 applied ledger rows were read from the hosted database and compared against the release's own recomputation: **0 differing**. The hosted database and `2063ea8` agree exactly on everything already applied.
- The corrected documented sequence was then run end to end with that **real** hosted ledger — clean detached checkout at `2063ea8`, `--applied-ledger`, manifest written to `mktemp -d` outside the repository: **33 / 26 / 7** and all ten documented checksums reproduce. The operator run against it cleared packet parsing, the release-SHA guard and the clean-checkout guard, and stopped at exactly one line: the credential.
- The twelve durable-setting violations are unchanged (each of the six roles carries the forbidden all-databases `search_path` row and none carries the required per-database row). `postgres` is a member of `df_migration` with no admin option, which is the session `ua-002-provider-staging.sql` is written for — it is not an execution path, because the operator requires `session_user` and `current_user` to both equal `df_migration` and rejects `SET ROLE` by design.
- One operational detail that would have cost a cycle: the IPv4 Supavisor pooler must be used in **session mode (port 5432)**. Transaction mode on 6543 does not preserve the session state the runner asserts (`session_replication_role = origin`, `lo_compat_privileges = off`).
- No mutation was attempted. The management connector was re-measured as `supabase_read_only_user` with `transaction_read_only = on` and no `df_migration` membership; only reads were issued and its read-only posture is preserved.

## Earlier — 2026-09-16 UA-002 operator merged and bound to the release

- PR #42 merged as `2063ea8d72247a9b2643e1c690e37ab55ab14252` after six review rounds (`a75e75f` 3 findings, `7945930` 2, `f34697a` 3, `20ea79a` 2, `1754f33` 1, `d9b0e13` 1). Every finding was verified against the code, the migration SQL or the live hosted inventory before being accepted; all eleven threads are answered and resolved.
- The operator's preflight is fifteen read-only probes derived from the exporter's own SQL rather than a paraphrase, because a preflight that checks something subtly different from what the grant install raises on buys false confidence. It reports every blocker in one pass, and `--apply` executes a grant payload **rebuilt from the release** rather than the manifest's — the manifest's checksum hashes the SQL beside it and so proves nothing against an edit, and its verifier had no integrity binding at all.
- The dominant lesson of the review rounds was a failure mode worse than a missing check: **blocking on drift the pending migrations themselves repair**, which would make the catch-up impossible to start, since the runner refuses to apply while any finding exists. Three instances were found and excluded on measured grounds: function search paths (`0027` sets all 57, which would have produced 57 false blockers), the `SECURITY DEFINER` functions `0029` and `0033` replace with `INVOKER` definitions, and the acquisition ACL reshape.
- That third one arrived as a review finding proposing a check, and was declined with evidence rather than implemented. The hosted runtime-role private ACL is 200 entries (schema 5, relation 100, column 38, function 57); `LEGACY_RUNTIME_GRANTS_0028` is 199 (schema 5, relation 98, column 39, function 57). The difference is `0027` lines 56-58 revoking two relation grants and adding one column grant, so comparing the existing-object subset against that baseline before mutation would fire on three entries `0027` exists to repair.
- Artifacts regenerated from the merged release and re-verified: 33 repository migrations, 26 applied, 7 pending, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, six grant roles, 59 function signatures, 286 expected grants. All seven pending checksums match the Git objects at `2063ea8d72247a9b2643e1c690e37ab55ab14252`, and the rebuilt grant payload reproduces the exported manifest byte for byte across all three executable fields.
- The handover is now bound to that SHA and carries the exact direct-TLS command sequence with the values filled in. Nothing was executed against the hosted database; the management connector remains read-only.
- PR #43 merged as `5e263fc9326962de4e009b9047e5af1a04053df5`, closing three review findings on the handover. Two were P1s caused by the same mistake — documenting a command without executing it — and both were reproduced before being fixed: the export omitted `--applied-ledger`, so it produced `33 0 33` instead of `33 26 7` and would have flagged all 26 applied migrations as replays; and redirecting the manifest into the checkout created an untracked file that tripped the exporter's own clean-worktree guard (`?? ua002-packet.json`). Both now use `$(mktemp -d)` outside the repository.
- The third finding was a P2 on a claim, and measurement confirmed it: the table's checksums do **not** all follow from an identical `db/migrations/` tree. `upgradeFrom0028Sql` is 269,595 characters and embeds all 59 entries of `PRIVATE_FUNCTION_SIGNATURES` plus the 199-entry `LEGACY_RUNTIME_GRANTS_0028` baseline, neither of which lives under `db/migrations/`. The seven migration checksums and `repositoryDigest` do follow (`effectiveMigrations` hashes the migration SQL and the schema constant; `repositoryDigest` hashes only version, filename and checksum over those), so the document now splits the two cases and requires exact-SHA regeneration for the grant values.
- Artifacts regenerated from `5e263fc` after the merge, as the owner instruction requires before any live database work: 33 / 26 / 7, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, six roles, 59 signatures, 286 expected grants, `postMigrationGrants` checksum `b6c7e197aac427b21e232a988567b8d180ef6cc767a3e7cd691eb61febc8413c`, `upgradeFrom0028Checksum` `d73fe6718648ff459cb416d2b665496f841c4a430bc06647c6c55013dd04dd65`, and all seven pending migration checksums. All ten documented rows reproduce unchanged, which is the expected result for a documentation-only merge and is now recorded in the handover so either SHA can be used.
- One diagnosability trap is now documented rather than left to be rediscovered: once `DATA_FOUNDRY_MIGRATION_DATABASE_URL` is set, `migrationFailureMessage` redacts any error outside its safe-category allowlist to the bare sentence `Direct PostgreSQL migration failed.`, because a raw driver error can carry the connection string. Measured both ways on the merged release — the same failing run prints the full message and stack with the variable unset. Packet parsing, the release-SHA guard and the clean-checkout guard all run before the driver is created, so they can be diagnosed with no database at all.
- `UA-001`: an attempt to find a documented CCMS distribution on data.gov could not reach the catalogue API — `catalog.data.gov` serves its root but every `/api/3/action/*` call returns `{"detail":{},"message":"Not Found"}`, which is not CKAN's error envelope. That neither confirms nor rules out a documented distribution, and is recorded in the unsent inquiry draft as a reason to ask DOE rather than as a finding.

## Earlier today — 2026-09-16 direct-TLS operator, merged PR #41, and the remaining commercial decision

- PR #41 was marked ready, reviewed, corrected and merged as `0026b14b7ef0156519305fec756fae8fa083b169`. Codex raised three P1 findings and all three were correct: the paid-API rights bundle needs seven cells rather than six (`SURFACE_REQUIREMENTS.API_PAID` ANDs `SERVE_API_ACCESS`, `SELL_API_ACCESS` and an unconditional `REDISTRIBUTE_NORMALIZED`); the handover described `SET ROLE` where the runner requires connecting **as** `df_migration` and that role is `NOCREATEROLE`; and the topology needs six Hyperdrives, not five. Each was verified against the code before being accepted, fixed in `e996c25`, answered on its thread and resolved.
- The seven pending migration checksums were re-verified against the Git objects at the merged `main` SHA: 7 matched, 0 mismatched, and `db/migrations/` is unchanged between `eb7e998` and `0026b14`, so the prepared artefacts carry over intact.
- `tooling/scripts/ua002-direct-tls-operator.ts` is the new executable half of the handover, exposed as `pnpm ua002:operator`. Preflight is the default and mutation is opt-in behind `--apply`. It reads the credential only from `DATA_FOUNDRY_MIGRATION_DATABASE_URL`, never as an argument, and never prints it.
- The operator exists because of a specific failure mode rather than for tidiness. The migration runner's per-transaction guards check the session `search_path`, the role binding and the default ACL, but not durable role settings — and the grant packet raises on exactly those. Against the measured hosted state a naive run would have applied `0027`-`0033`, written seven ledger rows, and only then failed at the grant upgrade. Preflight therefore checks identity, session writability, durable settings for all seven roles, role existence and shape, the ledger marker and range, replay, and every checksum both pending and already applied — reporting all blockers in one pass, because the repairs need a privileged provider session anyway.
- Grant-upgrade failure rolls back and then *proves* the session recovered before reporting, rather than assuming PostgreSQL did it. 19 unit tests cover the blocked-run-mutates-nothing path, the apply ordering, and both rollback outcomes; the composed durable-setting probe was parsed against real PostgreSQL via PGlite before shipping. Full tooling suite: 37 files, 715 tests, passing.
- `UA-001` now separates **rights** from **acquisition method** as two approvals, recording the owner's decision that the undocumented, browser-user-agent-dependent endpoint is not to be used in production pending review or a supported path. The decision sheet gained exact-field, transformation, retention, refresh and downstream-channel sections, and a concise DOE access inquiry is drafted and deliberately unsent pending authorization.
- The remaining commercial decision is reduced to four questions with proposed values and rationale: keep the existing $0/$49/$149/$299 ladder, keep the hard stop rather than building metered overage, invoice manually monthly-in-arrears at Net 30 rather than building billing before there is demand, and offer the 100-request Evaluate tier only if `UA-001` returns `API_FREE` permission.

## Earlier today — 2026-09-16 UA-002 connector exception and first-source decision sheet

- Objective: execute the owner-approved `UA-002` database exception (management connector over HTTPS for the migration and grant-verification portion only), and advance the unblocked revenue tracks alongside it.
- Preconditions were verified before any mutation, in the order the exception required. The hosted baseline at `2026-09-16T16:16:23Z` matched the reviewed expected state **exactly, with no drift**: ledger `0001`-`0026` under marker `data-foundry:schema_migrations:v1`, 46 tables, 3 views, 57 functions, zero `SECURITY DEFINER`, zero non-owner objects, six `df_*` roles all `NOLOGIN` and non-privileged, `df_ingestion` absent, `public` untouched at 7 tables, and non-zero rows only in `api_route_keys` (14) and the ledger (26).
- The packet was regenerated against the merged release `eb7e998`: 33 repository migrations, 26 applied, 7 pending, `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, `relevantInputsClean: true`, grants covering six roles, 59 function signatures and 286 expected grants. All seven pending checksums were then recomputed **independently of the exporter**, directly from the Git blobs at that SHA: 7 matched, 0 mismatched.
- The exception could not be executed. The management connector now authenticates as `supabase_read_only_user`, not `postgres` as in September. `SET LOCAL ROLE df_migration` failed with `ERROR: 42501: permission denied to set role "df_migration"`, and read-only probes confirmed two independent blocking layers: no `df_migration` membership (only `postgres` is a member) and `default_transaction_read_only = on` while `pg_is_in_recovery()` is `false` — deliberate configuration of a primary, not a standby artefact. Supabase's `read_only=true` MCP parameter produces exactly this identity and posture.
- The control was **not worked around**, because approval to use a connector is not approval to bypass a security control. No migration was applied, no grant changed, no role created; the only write attempted was the authorization probe, which failed closed. This is a capability limit, not a refusal, and the prepared work was handed over rather than abandoned — see [the write-path evidence](docs/evidence/ua002-connector-write-path-20260916.md) and [the handover](docs/owner-actions/ua-002-hosted-migration-handover.md), which sets out the direct-TLS run (the runbook's own canonical path, and the contained one) against re-enabling connector write mode (which would widen write authority across the whole project, including the unrelated application's `public` schema).
- `UA-001` advanced on the unblocked side. A fillable [rights decision sheet](docs/owner-actions/ua-001-doe-ccms-rights-decision.md) now states the minimum that earns revenue: **seven** operation/channel cells — `ACQUIRE`/`STORE`/`CACHE`/`NORMALIZE` on `INTERNAL_PROCESSING` plus `SERVE_API_ACCESS`, `SELL_API_ACCESS` and `REDISTRIBUTE_NORMALIZED` on `DIRECT_CUSTOMER_API` — with every other surface left `UNKNOWN` so it refuses by default. Seven and not six because `API_PAID` in `packages/rights-engine/src/surfaces.ts` is an AND-bundle whose redistribution requirement is unconditional; a six-cell decision would fail closed on every normalized API request.
- A second measurement found **real drift the first baseline did not cover**. Running the release's own durable-setting policy SQL read-only returned twelve violations: all six `df_*` roles carry a forbidden role-global (`setdatabase = 0`) `search_path` row and none carries the required current-database row. That SQL is embedded in the grant packet under `RAISE EXCEPTION`, while the migration runner's per-transaction guards check only the session search path, role binding and default ACL — so a direct-TLS run against the current state would apply `0027`-`0033`, write seven ledger rows, and only then fail at the grant upgrade. The operator sequence therefore checks durable settings before the first mutation. Repair belongs to the provider path: `df_migration` is `NOCREATEROLE` and can alter only its own settings.
- Codex raised three P1 findings on PR #41 and all three were correct: the paid-API bundle needs seven cells rather than six; the handover described `SET ROLE` when the runner requires connecting **as** `df_migration` and that role cannot create `df_ingestion`; and the topology needs six Hyperdrives, not five. All three are fixed.
- A material correction to the same-day source qualification: the DOE edge serves **only browser user agents**. `curl/8.5.0`, a bare `Mozilla/5.0` and a descriptive `data-foundry-research` token all returned 403; only a full Chrome UA string returned 200. The earlier "reachable with a plain descriptive user agent" cell was not reproducible and has been corrected in place.
- The query surface was confirmed from the shipped bundle: `POST` to `<solrUrl>select` with `wt=json` and `q`/`fq`/`fl`/`start`/`rows`/`sort`, the equipment-class facet is `Product_Group_s`, and CSV export is assembled client-side via `papaparse`. `solrUrl` itself is still not resolvable from published assets — the bundle carries only AjaxSolr's `http://localhost:8983/solr/` default — so the review packet's exact-endpoint cell still cannot be filled from public evidence.
- Those three facts together (browser-only edge, undocumented internal endpoint, bundle re-versioned the day before reading) are recorded as a reviewer decision rather than an engineering detail. Engineering's recommendation is to ask DOE for a supported bulk path before building a revenue-bearing pipeline on an endpoint the publisher never agreed to serve.

## Earlier the same day — 2026-09-16 machine-access channel reconciliation

- Objective: reconcile the owner's corrected business direction — Data Foundry as a supplier of machine-readable data, with agent and crawler monetization as core channels rather than deferred features — against live primary evidence, and select the minimal supported paid-machine release path.
- Live hosted database, read directly through the authenticated management connector at `2026-09-16T13:42Z`: ledger `0001`-`0026`, 46 tables, 3 views, 57 functions, zero `SECURITY DEFINER`, `df_ingestion` absent, all `df_*` roles `NOLOGIN` with no password, relation grants 25 each for `df_edge`/`df_web`/`df_mcp`/`df_acquisition` plus column grants (11/11/16), shared `public` schema unchanged at 7 tables, and no rows beyond the migration-seeded `api_route_keys` (14) and the ledger. The release at `af9fc68` carries `0033`, six roles and 286 expected grants, so the hosted target is seven migrations, one role and the grant upgrade behind.
- The pending export was built and validated against that live ledger: 7 packets (`0027`-`0033`), 286 expected grants, 59 function signatures, six roles including `df_ingestion`.
- The hosted catch-up did not proceed. Direct TLS was unreachable on three independently measured grounds: no migration credential in the environment, an IPv6-only direct origin against a container with no IPv6 stack, and IPv4 pooler endpoints timing out behind an HTTPS-only proxy. The runbook states the manifest's `liveUseAuthorized: false` does not authorize connector execution and directs stopping rather than substituting a connector. The September connector application of `0001`-`0026` was covered by a recorded owner preauthorization; nothing covers `0027`-`0033`. The work stopped rather than being worked around.
- Channel capability was established from official provider documentation and the implemented model, not from previous assistant claims: `API_ACCESS_TIERS` is `API_FREE`, `API_PAID`, `RAPIDAPI`, `MCP` and `API_BILLING_SOURCES` is `DIRECT`, `RAPIDAPI`, `NONE`. There is no paid-crawler access tier, rights surface or billing source in the application model.
- Cloudflare Pay Per Crawl verified 2026-09-16 as **closed beta** with no self-serve enablement. Identity is Web Bot Auth request signatures plus verified-bots registration, never a `User-Agent`. The flow is `HTTP 402` with `crawler-price`, a retry carrying `crawler-exact-price` or `crawler-max-price`, and a charged 2xx carrying `crawler-charged`; Cloudflare is Merchant of Record and distributes earnings. WAF and Bot Management block rules take precedence over charging, so a crawler refused before the charging flow earns nothing. Since 2026-06-16 price may be set dynamically from the origin, which corrects the earlier internal assumption that pay per crawl involves no Worker code.
- Selected minimal path: the **direct `API_PAID` API billed `DIRECT`** is the shortest supported route to a paid machine request. It needs no third-party enrollment, marketplace agreement or beta admission — only deployment, an approved source and a published price. RapidAPI and pay per crawl remain live channels behind their own external enrollments; neither blocks the first release.
- Records updated: `docs/evidence/machine-access-channel-capability-20260916.md` (new), `docs/sources/hvac-first-source-qualification-20260916.md` (new), the pay-per-crawl and channel-table sections of `docs/owner-actions/revenue-readiness.md`, the deployment runbook's pay-per-crawl item, an amendment to ADR-0006, and `PROJECT_CHECKLIST.md` (`UA-002` re-measured, release target realigned, `UA-008` added for beta admission).
- `UA-002` credential paths exhausted, not merely asserted: only TCP 443 leaves this container (`1.1.1.1:443` open, `:53` blocked; the Supavisor host answers on 443 but times out on 5432 and 6543). The blocker is therefore network reachability, not credential custody — no secret store or credential bridge can make the PostgreSQL wire protocol reachable from here. The only database path over 443 is the management API, which the runbook forbids for application migrations. This reduces to a two-option owner decision: record an exception for the connector path as was done in September, or run the direct-TLS procedure from an environment that has both the credential and 5432 egress.
- `UA-001` advanced in parallel. DOE CCMS is reachable (200) and structurally acquirable — a Solr-backed JSON API with `fq` filtering, `start`/`rows` pagination and exact `numFound`, which permits a slice that is complete in its own terms rather than a truncated class. Upstream refresh is approximately two weeks; scope is current basic models submitted within the past year; provenance is manufacturer self-certification with accuracy disclaimed and no legal significance, so absence is not discontinuation and this is never independent certification. `energyrating.gov.au` refused the same automated client (403) and could not be qualified. Recommendation: advance DOE CCMS, let the Australian register lapse to unqualified. Rights remain entirely the reviewer's.
- Direct paid path verified against the release: 61 tests pass across `api-keys` and `usage-events`, including the closed `API_PAID`/`DIRECT` invoice predicate that keeps marketplace events structurally out of the invoice projection. What remains is a price, an invoicing mechanism, terms and a deployment.
- Production impact: none. No provider, credential, DNS, schema, rights, listing or billing mutation occurred. The Cloudflare and Stripe interfaces were not authorized in this session, so this account's zone settings, bot rules, plan level, beta admission and product state remain unverified.
- Next dependency order is unchanged in substance: owner credential activation (`UA-002`) unblocks deployment and the private canary; the source rights decision (`UA-001`) unblocks real data; a price and invoicing decision plus `UA-007` unblock the first direct sale. `UA-004` and `UA-008` open the additional channels afterwards.

## Current session — 2026-09-08 revenue platform implementation

- Objective: implement the accepted HVAC-first RapidAPI launch plan, reusable across industries with regular refresh and a $300/month operating ceiling.
- Baseline: live main 0ae6c7aeb2dee70ce380663cb438d5e1d047b634, README-only PR29 and zero open issues. Work is isolated on codex/revenue-platform-20260908. Four pre-existing original-checkout changes were preserved and integrated in this worktree; no original checkout was reset.
- Current release shape: six ordinary Workers and database roles, six reduced capability targets plus credential-free harness (thirteen core bundles), and one separately built synthetic ingestion phase using isolated Queue/DLQ/artifact storage. Migrations extend through0033; 59 private functions,51 tables and286 exact runtime grants. The historical hosted inventory remains26 migrations/five staged roles/200 grants; it was not re-certified or changed.
- Pipeline: acquisition completion inserts an immutable processing identity transactionally; opaque UUID messages, independent five-minute outbox recovery, database-clock leases/fences, bounded verified JSON/CSV artifacts, atomic canonical promotion, retained revisions and 304 verification. A NOT_MODIFIED run may reuse only a matching FETCHED run whose completion and freshness both precede its own claim, preventing overlapping work from borrowing a future artifact. Source permissions are checked during processing and delivery. The production path imports no fixture filesystem or PDF graph.
- Operations: 1–8760-hour optional source interval (12 hours only where reviewed terms permit); separate acquisition/verification/publication observations; closed production telemetry; immutable operator action history, replay/backfill/pause/resume/retraction/revocation/account closure; durable incident and failure/recovery email states. Alerts default off; unknown sends never automatically repeat.
- Foundation/customer work: one compiled identifier contract for ingestion and exact lookup, synthetic second-industry proof, /hvac canonical pages and old-path redirects, useful filters/pagination, honest coverage/pricing, fail-closed listing/approved-policy/contact configuration, TypeScript/Python examples and rights-filtered selected-fact evidence. Unreviewed query-bearing evidence URLs are omitted while artifact identities/hashes remain.
- Source/commercial work: fresh source documentation assessment, bounded initial data dictionary, pricing/cost envelopes, three-partner trial criteria, unsent outreach copy and reviewable customer policy drafts. No source was approved/acquired, no agreement accepted, no marketplace billing/listing configured and no customer contacted.
- Prior native local evidence (before migration0032): all31 migrations apply; exact legacy199-to286 grant upgrade and complete postcondition verifier pass, including same-count ACL drift refusal and unchanged ledger. Restricted df_ingestion publishes61 synthetic facts with61 evidence rows, ignores duplicates and rejects ten mutation/capability probes, including function execution after PUBLIC access is revoked. These are disposable local controls, not hosted/TLS/Hyperdrive/backup evidence.
- Verification records: docs/evidence/revenue-platform-implementation-20260908.md, docs/evidence/identifier-and-buyer-verification-20260908.md and docs/evidence/ingestion-postgres-control-20260908.md. Candidate-wide checks and exact-head hosted CI/reviews belong to the implementation PR evidence; a later SHA requires fresh applicable verification before release designation.
- Material repairs found in review: missing real-role sequence/lock privileges, absent legacy ACL upgrade, operator UUID-case idempotency and audit TRUNCATE bypass, query-bearing evidence URL leakage, malformed UTF-8 acceptance and unqualified multi-target source ordering.
- Production impact: none. No provider, credential, DNS, real-source, billing or outreach mutation occurred. Existing containment/credential/source/marketplace/public-cutover gates remain; approved retention and verified alert/support contact are now explicitly UA-007.
- Next dependency order: owner containment (UA-006) and source/policy decisions (UA-001/007); agent-run recovery/provider staging after secure activation (UA-002); private capability and synthetic ingestion proof; owner marketplace agreements/payouts (UA-004), live subscription/limits/cancellation; action-time public cutover (UA-005). First actual external payment plus useful access, scheduled real refresh/recovery and budget evidence remain the revenue milestone.
- Source qualification limits:16 artifacts,1 MiB each,4 MiB total,1,000 records,10,000 affected entity/property pairs per delivery (including retirements and dependent facts) and one acquisition target per source. Larger complete snapshots, target partitions, HTML/PDF runtime qualification, approved-policy erasure, independent provider outage/spend alerts and later paid channels are not claimed complete.

- Follow-up integration: PR #30 merged as `eed284599ab9a2bf1892039705eb294a0e99fbd1` after hosted run34254514199 passed both required jobs for `2ba6ad8b4833253f1ba782071b7b2cdaf63d70ac`. PR #29 then reconciled the README presentation onto that operational baseline and merged as `1fb406c8f91540bde1beb5b678e6953365de4768`. Migration0032 exposes all current alias source memberships through the existing view without granting raw-history access. Production promotion scopes its work to affected entity/property pairs; a small update beside10,001 unrelated entries passes. Search pages are always noindex and remain outside sitemaps.
- Follow-up checks: the final sequential suite passed3,450/3,450 in220 files (397.90 seconds); all14 type/schema/runtime/topology checks and all14 build profiles passed. Hosted run34254514199 passed its full job in13m50s and its real-PostgreSQL job in1m14s. The README reconciliation's documentation-scoped protected run34256317967 passed; its real-PostgreSQL job was correctly skipped.
- Delayed304 repair: PR30 comment3959304808 is covered at both completion boundaries. The test first claims the304, then completes a matching FETCHED run; the304 is refused because that artifact became available after the claim boundary. A separate raw terminal-update regression proves the database guard also refuses the same bypass. Migration0033 reasserts that fence in the terminal guard and pins its function search path. Focused acquisition, migration, packet and runtime-grant controls passed; the final sequential suite passed3,450/3,450 in220 files (397.90 seconds), followed by all14 configuration checks and all14 build profiles. The exact candidate's protected checks passed before merge. No deployment or revenue claim is made.
- UA-006 disposition: the Product Owner affirmatively cleared provider containment on 2026-09-08. This record is sanitized: it stores no item, credential, identifier, browser state, or security detail. Frozen `origin/main` was `bc6d8f060153853d8c8d79087775fec99c1805a1`; its local sequential suite passed3,450/3,450 in220 files (1,402.43 seconds), private-canary/synthetic-ingestion topology gates passed, and thirteen core plus the separate synthetic-ingestion artifact builds passed. Its credential-free migration packet reports33 migrations and six runtime roles. The worktree contains no direct-TLS migration/runtime credential. On 2026-09-09 Wrangler authenticated and a read-only Cloudflare inventory confirmed only the preserved ordinary usage Queue/DLQ pair and raw-artifact bucket, with no Hyperdrives; direct-TLS inspection, migrations, grant upgrade, credential activation, new queues/buckets, and the route-less canary remain precisely blocked at UA-002's owner-controlled secure-entry interface. No provider mutation occurred.
## Prior-session record

Everything below is preserved historical context. Its five-Worker topology and
earlier SHA/provider observations do not override the current six-role plan,
current checklist or fresh primary evidence.

## Historical state through the prior session

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

## Latest Session — Local Clone, Windows Test Repair, and E2E

- Populated the previously empty local checkout from `origin/main` at merge
  commit `0ae6c7a` on branch `local-test`; installed the pinned pnpm lockfile
  dependencies with `pnpm install --frozen-lockfile`.
- Fixed the Windows-only architecture-boundary test failure caused by using a
  URL pathname without decoding `%20` in a workspace path. Both boundary
  suites now use Node `fileURLToPath`.
- Focused verification passed: 2 files / 10 tests. The local factory E2E proof
  passed: 1 file / 34 tests. The repeated full local suite passed: 202 files /
  3,246 tests. `pnpm build` passed schema generation and TypeScript typecheck.
- No hosted CI, provider, database, deployment, rights, billing, DNS, or
  source state changed. This local branch is not a release candidate.
- Repeat validation on 2026-09-03 reproduced no failures: focused boundary
  tests 10/10, factory E2E 34/34, full suite 3,246/3,246, and build/typecheck
  passed again.

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
- Repository-only verification is green. Exact PR head
  `8a43b7f7600fef10c1b26f0281a4c087f8610373` passed
  protected run `33697035331`, including disposable TLS PostgreSQL 16, and
  both automated reviews found no remaining issue. A clean checkout of merge
  commit `02e90d70d0000d21c7f9b070b4e1b2e1d5dd7493` passed TypeScript, 202
  files / 3,244 tests, 28 ordered idempotent migrations, generated
  schema/OpenAPI/runtime checks, topology, and eleven PGlite-free Worker
  artifacts. Protected-main push run `33698213600` also passed both required
  jobs. None of this is live provider evidence.
- No provider, source, rights, billing, DNS, or deployment state changed. The
  hosted target still needs `UA-006`, a secure `df_migration` credential with
  the exact current-database `data_foundry, pg_catalog, extensions` search path,
  a read-only cross-database topology result, pending
  migrations `0027`–`0028`, `postMigrationGrants.verificationSql`, five distinct
  runtime-role credentials with that same exact current-database search path,
  `postMigrationGrants.postCredentialVerificationSql`, a successful five-path
  `pnpm runtime-roles:postgres:check`, five cache-disabled Hyperdrives, five
  separate 14-day private-canary queues, both required R2 buckets, and the
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
- Secure `df_migration` credential entry with the exact current-database
  `data_foundry, pg_catalog, extensions` search path, the pending exact-SHA
  migrations, `postMigrationGrants.verificationSql`, then secure activation of
  all five runtime-role credentials, each distinct and using that same exact
  current-database search path,
  `postMigrationGrants.postCredentialVerificationSql`, a successful five-path
  `pnpm runtime-roles:postgres:check`, five cache-disabled Hyperdrives, five
  separate private-canary queues with 14-day retention, and the absent
  raw-artifact and canary receipt buckets are needed in that order before the
  route-less canary can run. Preserve and reverify the standard usage model and
  ordinary 14-day Queue/DLQ pair; never reuse that ordinary pair for any
  private-canary path.
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
