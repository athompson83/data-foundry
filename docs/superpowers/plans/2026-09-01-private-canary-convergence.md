# Private-canary convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #26 a single exact-SHA, repository-validated six-Worker private-canary candidate without provider, credential, database, DNS, queue, or deployment mutation.

**Architecture:** The route-less private-canary release set consists of five database-backed target Workers plus one no-database harness Worker. The artifact gate must bundle and scan all six while injecting a dry-run Hyperdrive only into the five targets. Each reduced target must use a dedicated Worker identity so it cannot overwrite an ordinary Worker that owns public routes, Cron, R2, or ordinary Queue configuration. Direct Postgres role checks must use the canonical certificate-verifying configuration, and every live ingestion path must reject any non-`data_foundry` schema before creating a driver or running a migration.

**Tech Stack:** TypeScript, Vitest, pnpm 9.15.4, Wrangler dry-run, PostgreSQL 16 disposable CI, Cloudflare TOML manifests, GitHub Actions.

**Spec:** User continuation prompt dated 2026-09-01; `AGENTS.md`; `APP_PROJECT_CONTROL_STANDARD.md`; `PROJECT_CHECKLIST.md`; `PROGRESS.md`; `docs/owner-actions/cloudflare-deployment.md`; `docs/evidence/sensitive-browser-state-containment-20260901.md`.

## Global Constraints

- Do not reopen, inspect, export, or reuse the prior browser state; do not print or request protected values.
- Do not perform Cloudflare, database, DNS, route, queue, R2, Hyperdrive, credential, or deployment mutations.
- Do not merge PR #26 until current-head local/hosted requirements and review closeout have been reconciled.
- Treat the known PR review comments as leads; prove each claim in current source before modifying code or resolving a thread.
- The five reduced target Workers are `edge`, `web`, `usage-consumer`, `acquisition-worker`, and `mcp-worker`; the sixth is `private-canary` and must not receive Hyperdrive.
- Use `data_foundry` as the only permitted live-ingestion schema. Reject `DATA_FOUNDRY_SCHEMA=public` before any migration or application driver creation.
- The disposable CI migration role receives database `CONNECT`, never database `CREATE`; it may create only in the already-created `data_foundry` schema.
- A final candidate is repository-validated, not provider-authorized or deployable, until the separate owner-only/provider gates have evidence.

---

### Task 1: Six-Worker artifact gate

**Files:**
- Modify: `tooling/scripts/check-cloudflare-artifacts.ts`
- Modify: `tooling/test/cloudflare-artifacts.test.ts`
- Test: `tooling/test/cloudflare-artifacts.test.ts`

**Interfaces:**
- Produces: `buildCloudflareArtifacts()` returns the ordered six-service list `['edge', 'usage-consumer', 'web', 'acquisition-worker', 'mcp-worker', 'private-canary']`.
- Produces: every service descriptor has a `needsHyperdrive: boolean` field.
- Consumes: `apps/private-canary/wrangler.toml` as a deployable artifact input with `needsHyperdrive: false`.

- [x] **Step 1: Write failing artifact-gate assertions**

Add an exported testable renderer or descriptor assertion so the test proves the five database targets receive the sentinel binding and `private-canary` does not:

```ts
expect(result.services).toEqual([
  'edge', 'usage-consumer', 'web', 'acquisition-worker', 'mcp-worker', 'private-canary',
]);
expect(renderDryRunConfig(privateCanarySource, privateCanaryMain, false)).not.toContain('hyperdrive');
expect(renderDryRunConfig(edgeSource, edgeMain, true)).toContain('binding = "HYPERDRIVE"');
```

- [x] **Step 2: Run the focused test and observe the five-service failure**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/cloudflare-artifacts.test.ts`

Expected: the current result has five services and the renderer cannot express the no-Hyperdrive private-canary case.

- [x] **Step 3: Implement manifest-aware descriptors**

Replace the anonymous five-item service list with descriptors of this shape and use the boolean in the renderer:

```ts
{ name: 'private-canary', configPath: join(REPO_ROOT, 'apps', 'private-canary', 'wrangler.toml'), mainPath: join(REPO_ROOT, 'apps', 'private-canary', 'src', 'index.ts'), needsHyperdrive: false }

function renderDryRunConfig(source: string, mainPath: string, needsHyperdrive: boolean): string {
  const config = parse(source) as TomlObject;
  config.main = mainPath.replaceAll('\\\\', '/');
  if (needsHyperdrive) config.hyperdrive = [{ binding: 'HYPERDRIVE', id: DRY_RUN_HYPERDRIVE_ID }];
  return stringify(config);
}
```

Pass `service.needsHyperdrive` at the dry-run call site. Keep artifact-directory creation and recursive scanning for every descriptor unchanged.

- [x] **Step 4: Run focused artifact tests**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/cloudflare-artifacts.test.ts`

Expected: all artifact tests pass; the full dry-run test proves all six directories are produced and scanned when Wrangler is locally available.

- [x] **Step 5: Preserve the reviewed Task 1 diff uncommitted**

The user requires one final commit containing executable changes, tests, and aligned documentation. Review this task now, retain its diff, and do not create an intermediate candidate SHA.

### Task 2: Dedicated reduced-Worker identities and topology invariant

**Files:**
- Modify: `apps/edge/wrangler.private-canary.toml`
- Modify: `apps/web/wrangler.private-canary.toml`
- Modify: `apps/usage-consumer/wrangler.private-canary.toml`
- Modify: `apps/acquisition-worker/wrangler.private-canary.toml`
- Modify: `apps/mcp-worker/wrangler.private-canary.toml`
- Modify: `apps/private-canary/wrangler.toml`
- Modify: `tooling/scripts/check-cloudflare-topology.ts`
- Modify: `tooling/test/cloudflare-topology.test.ts`
- Modify: `tooling/test/cloudflare-deployment-doc.test.ts`
- Test: `tooling/test/cloudflare-topology.test.ts`

**Interfaces:**
- Produces: five dedicated canary service names that are disjoint from ordinary names: `data-foundry-private-canary-edge`, `data-foundry-private-canary-web`, `data-foundry-private-canary-usage-consumer`, `data-foundry-private-canary-acquisition-worker`, and `data-foundry-private-canary-mcp-hvac`.
- Produces: `apps/private-canary/wrangler.toml` service bindings target exactly those five names.
- Consumes: ordinary manifests remain byte-for-byte unchanged in their Worker identity, Cron, R2, and ordinary Queue configuration.

- [x] **Step 1: Write failing collision and binding tests**

Extend the topology tests to construct a target deployment manifest whose `name` equals its ordinary Worker name and require an error. Assert the canonical harness bindings are the five dedicated names:

```ts
expect(errors.join('\\n')).toMatch(/private-canary target.*must not reuse.*ordinary/i);
expect(harness).toContain('service = "data-foundry-private-canary-acquisition-worker"');
expect(harness).not.toContain('service = "data-foundry-acquisition-worker"');
```

- [x] **Step 2: Run topology tests and observe the current collision acceptance**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/cloudflare-topology.test.ts tooling/test/cloudflare-deployment-doc.test.ts`

Expected: current manifests and validator accept ordinary/canary name collisions.

- [x] **Step 3: Change the five target manifests and harness bindings together**

Set each reduced target `name` to its dedicated `data-foundry-private-canary-*` identifier. Do not change any ordinary manifest. Point the five `[[services]]` entries in the harness at exactly the dedicated names.

- [x] **Step 4: Enforce the no-collision invariant in topology code**

Keep ordinary and target expected names as separate constants. Fail validation whenever a target `name` equals its ordinary counterpart, and require the service-binding list to equal the dedicated target-name list with the existing entrypoint constraints. Update deployment fixtures to use the same dedicated names.

- [x] **Step 5: Update only the canary runbook assertions**

Make the runbook say the five reduced target deployments create temporary dedicated Worker identities, the harness binds to them, cleanup removes only those temporary identities after evidence capture, and rollback is deletion/disablement of the temporary canary identities without touching ordinary Worker configuration.

- [x] **Step 6: Run focused topology/doc tests**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/cloudflare-topology.test.ts tooling/test/cloudflare-deployment-doc.test.ts`

Expected: target and full topology checks accept only the dedicated names; collision fixtures fail; ordinary manifests remain unchanged.

- [x] **Step 7: Preserve the reviewed Task 2 diff uncommitted**

The final candidate must remain one combined runtime/test/documentation commit; review this task without creating an intermediate candidate SHA.

### Task 3: Canonical TLS enforcement for runtime-role probes

**Files:**
- Modify: `tooling/scripts/check-runtime-role-connections-postgres.ts`
- Modify: `tooling/test/runtime-role-connections-postgres.test.ts`
- Test: `tooling/test/runtime-role-connections-postgres.test.ts`

**Interfaces:**
- Consumes: `directPostgresTlsConfig` exported from `@data-foundry/canonical-store`.
- Produces: a default connection factory that calls `new pg.Client(directPostgresTlsConfig(connectionString))` while injected test factories retain `(connectionString, role)` behavior.

- [x] **Step 1: Write failing URL/TLS regression tests**

For a test environment with every role URL populated, require rejection before the injected factory is called for each query string: `?sslmode=disable`, `?SSLMode=disable`, `?ssl=no-verify`, `?sslmode=verify-full`, `?host=%2Ftmp`, and `?options=-csearch_path%3Dpublic`. Keep a positive test that records all five injected factory calls.

- [x] **Step 2: Run runtime-role tests and observe query override acceptance**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/runtime-role-connections-postgres.test.ts`

Expected: at least the TLS/host query cases are currently accepted because only `options` is inspected.

- [x] **Step 3: Replace duplicate local URL parsing with the canonical helper**

Import `directPostgresTlsConfig`; call it for every connection string before `connect`. Remove the local `URL`/`searchParams` branch because the canonical helper rejects non-Postgres protocols and every URL query override and provides `ssl: { rejectUnauthorized: true }`.

```ts
connect: ConnectionFactory = async (connectionString) => new pg.Client(directPostgresTlsConfig(connectionString)) as Connection,
...
directPostgresTlsConfig(connectionString);
const client = await connect(connectionString, role);
```

- [x] **Step 4: Correct swapped test descriptions**

Name the test with `search_path_is_exact: false` as the effective-session search-path rejection and the test with `durable_search_path_is_exact: false` as the durable role/database setting rejection.

- [x] **Step 5: Run focused TLS tests**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/runtime-role-connections-postgres.test.ts packages/canonical-store/test/sql-driver-schema.test.ts`

Expected: all direct probes reject bad URLs before connecting and retain injectable test factories.

- [x] **Step 6: Preserve the reviewed Task 3 diff uncommitted**

Keep the reviewed TLS repair in the shared final candidate diff; do not create an intermediate candidate SHA.

### Task 4: Disposable PostgreSQL migration-role confinement

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tooling/test/ci-workflow.test.ts`
- Test: `tooling/test/ci-workflow.test.ts`

**Interfaces:**
- Produces: `df_migration` gets `CONNECT ON DATABASE data_foundry`, owns or receives `USAGE, CREATE` only on the pre-created `data_foundry` schema, and lacks database-level `CREATE`.
- Produces: the disposable real-Postgres job proves the migration replay and a negative unrelated-schema creation probe under `df_migration`.

- [x] **Step 1: Write failing workflow policy assertions**

Require CI YAML to omit `CREATE ON DATABASE data_foundry TO df_migration`, contain `GRANT CONNECT ON DATABASE data_foundry TO df_migration`, and contain a negative `SET ROLE df_migration; CREATE SCHEMA` probe that must fail outside `data_foundry`.

- [x] **Step 2: Run CI workflow tests and observe the database-wide grant**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/ci-workflow.test.ts`

Expected: the current bootstrap grants `CONNECT, CREATE ON DATABASE data_foundry TO df_migration`.

- [x] **Step 3: Narrow the database grant and preserve schema capability**

Change the database statement to `GRANT CONNECT ON DATABASE data_foundry TO df_migration;`. Retain schema creation only through the existing `CREATE SCHEMA data_foundry AUTHORIZATION df_migration` / schema-level grant path. Add a disposable SQL assertion that treats successful arbitrary `CREATE SCHEMA` as a failure and cleans up only the locally-created probe schema if it unexpectedly exists.

- [x] **Step 4: Add the disposable runtime-role gate with its complete ephemeral setup**

After the two migration replays, create the five nonprivileged roles as `NOLOGIN`, grant only database `CONNECT` and `extensions` `USAGE`, generate the repository's `postMigrationGrants.sql` into a temporary file, and apply it as the disposable superuser. Then assign five distinct ephemeral passwords, enable `LOGIN`, set each role/database default search path to `data_foundry, pg_catalog, extensions`, export only the five runner-local URLs through `GITHUB_ENV`, and run `pnpm runtime-roles:postgres:check` with `DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST=1`. Do not print the URLs or passwords.

- [x] **Step 5: Run focused workflow validation**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/ci-workflow.test.ts`

Expected: YAML policy checks pass and enforce no database-level `CREATE` for `df_migration`.

- [x] **Step 6: Preserve the reviewed Task 4 diff uncommitted**

Keep the reviewed workflow repair in the shared final candidate diff; do not create an intermediate candidate SHA.

### Task 5: Private-schema-only live ingestion contract

**Files:**
- Modify: `services/ingest-worker/src/cli.ts`
- Modify: `services/ingest-worker/test/cli-schema.test.ts`
- Modify: `README.md`
- Test: `services/ingest-worker/test/cli-schema.test.ts`

**Interfaces:**
- Produces: real ingestion accepts only `data_foundry` before resolving migration/app-driver connections.
- Consumes: offline PGlite historical compatibility remains unaffected.

- [x] **Step 1: Write failing live-schema tests**

Replace the legacy opt-in assertion with these behaviors:

```ts
expect(resolveRealPostgresSchema({})).toBe('data_foundry');
expect(resolveRealPostgresSchema({ DATA_FOUNDRY_SCHEMA: 'data_foundry' })).toBe('data_foundry');
expect(() => resolveRealPostgresSchema({ DATA_FOUNDRY_SCHEMA: 'public' })).toThrow(/data_foundry/i);
```

Add a `main()` dependency-injection or exported preflight test that proves an explicit `public` failure occurs before migration source attestation, migration driver creation, and application driver creation.

- [x] **Step 2: Run the focused test and observe public opt-in acceptance**

Run: `node_modules\\.bin\\vitest.cmd run services/ingest-worker/test/cli-schema.test.ts`

Expected: the current resolver returns `public`, while `migrateRealPostgres()` later rejects it.

- [x] **Step 3: Enforce the contract at the live resolver boundary**

Make `resolveRealPostgresSchema()` pass its operational result through `assertDirectPostgresPrivateSchema`. Remove wording that advertises a live `public` opt-in. Preserve only offline migration compatibility that does not open a real connection.

- [x] **Step 4: Update README references**

Replace every live-ingestion `DATA_FOUNDRY_SCHEMA=public` instruction with the private-only contract. State that historical public installations require a separately reviewed migration plan, not a runtime switch.

- [x] **Step 5: Run focused ingestion tests**

Run: `node_modules\\.bin\\vitest.cmd run services/ingest-worker/test/cli-schema.test.ts tooling/test/real-postgres-check-schema.test.ts`

Expected: default/explicit private succeeds, `public` fails before real-mutation setup, and runtime/migration schema selection is identical.

- [x] **Step 6: Preserve the reviewed Task 5 diff uncommitted**

Keep the reviewed live-ingestion repair in the shared final candidate diff; do not create an intermediate candidate SHA.

### Task 5A: Final security-diff isolation controls

**Files:**
- Modify: `apps/edge/wrangler.private-canary.toml`
- Modify: `apps/mcp-worker/wrangler.private-canary.toml`
- Modify: `apps/usage-consumer/wrangler.private-canary.toml`
- Modify: `tooling/scripts/check-cloudflare-topology.ts`
- Modify: `tooling/test/cloudflare-topology.test.ts`
- Modify: `docs/owner-actions/cloudflare-deployment.md`

**Interfaces:**
- Produces: synthetic metering uses a dedicated `usage-events` / `usage-events-dlq` pair and never attaches a temporary consumer to the ordinary Queue.
- Produces: each deployment-mode canary validator compares every temporary Worker identity with the five ignored ordinary deployment manifests actually used by ordinary deployment.

- [x] **Step 1: Reproduce the shared-Queue consumer defect with a topology test**

The pre-repair target profile published and consumed synthetic metering through
the ordinary usage Queue. The regression test demonstrated that this would
conflict with the ordinary consumer and violate the temporary-canary isolation
boundary.

- [x] **Step 2: Isolate synthetic metering with a dedicated Queue/DLQ pair**

Route reduced `edge` and `mcp-worker` metering only to
`data-foundry-private-canary-usage-events`; route its reduced
`usage-consumer` retries only to
`data-foundry-private-canary-usage-events-dlq`. Retain the separate control
ingress/DLQ/quarantine chain and leave the ordinary usage pair unchanged.

- [x] **Step 3: Reproduce ignored ordinary deployment-name collisions**

Add deployment-mode regression tests that replace an ignored ordinary manifest
name with a temporary target or harness identity. Each test failed before the
deployment loader inspected the real ordinary deployment-manifest paths.

- [x] **Step 4: Require ordinary deployment manifests as collision controls**

Make `private-canary-deployment`, `private-canary-target-deployment`, and
`private-canary-full-deployment` parse the five ignored ordinary
`wrangler.production.toml` manifests, fail closed when any is absent, and reject
any ordinary/temporary identity collision. Keep tracked repository checks
independent of ignored provider inputs.

- [x] **Step 5: Document the five-Queue and eleven-manifest owner boundary**

The runbook now requires five 14-day temporary queues and treats the five
ordinary ignored manifests solely as collision controls alongside the six
canary/harness manifests. It records cleanup and rollback of only temporary
identities, never ordinary Worker configuration.

### Task 6: Exact-SHA documentation, PR closeout, and verification

**Files:**
- Modify: `README.md`
- Modify: `PROJECT_CHECKLIST.md`
- Modify: `PROGRESS.md`
- Modify: `docs/owner-actions/cloudflare-deployment.md`
- Modify: `docs/evidence/private-canary-readiness-reconciliation-20260901.md`
- Modify: `docs/superpowers/plans/2026-09-01-private-canary-convergence.md`

**Interfaces:**
- Produces: one truth: the historical repository-only candidate was committed,
  pushed, and CI-verified, but this owner continuation adds final repository
  security hardening before a new exact SHA is frozen. No SHA is thereby
  provider-authorized or deployable, and migrations `0027`–`0028` have no
  hosted-success evidence yet.

- [x] **Step 1: Write/update targeted documentation tests first**

Extend existing README/runbook documentation tests to require “six deployable canary Workers,” distinguish five Hyperdrive targets from the no-Hyperdrive harness, and reject a claim that the five ordinary manifests alone form the full canary artifact set.

- [x] **Step 2: Make docs consistent without selecting a provider candidate**

Update the checklist/progress/readme/runbook/reconciliation evidence to call `64bb05b` a historical reconciliation snapshot and `effa3ec` the pre-repair PR head; after final code commit, report that final SHA as repository-validated only if all six artifact evidence passes. Do not add a documentation-only follow-up commit.

- [x] **Step 3: Run scoped documentation checks**

Run: `node_modules\\.bin\\vitest.cmd run tooling/test/readme-inventory.test.ts tooling/test/cloudflare-deployment-doc.test.ts`

- [x] **Step 4: Historical candidate completed repository-only verification**

The historical candidate ending at `faabae7` was committed, pushed, and
CI-verified as repository-only evidence. It was not provider authorization,
deployment proof, or hosted migration-`0027`/`0028` proof.

- [ ] **Step 5: Complete the owner continuation's final repository hardening**

Add forward-only migration `0027`, exact runtime ACL/search-path verification,
acquisition least privilege, immutable artifact conflict reads, and immutable-
Git-object packet export. Add `0028` with only the four FK-advisor-justified
rights-path indexes and defer the remaining 31 INFO notices to post-traffic
`EXPLAIN`/advisor monitoring. Reconcile the existing plan/checklist/progress/runbook
without manufacturing hosted evidence, then create one coherent local commit.

- [ ] **Step 6: Freeze and reverify a new exact SHA**

Push the new exact SHA and rerun repository/CI checks, reviews, and six-artifact
evidence. When those fresh exact-head results satisfy the active `main` ruleset,
complete the normal PR #26 merge authorized by this owner continuation. The
merge does not authorize applying `0027`/`0028`, deploying, or creating public
exposure; hosted migration and deployment remain behind their separate exact-
SHA credential/provider gates, and no warning closure may be claimed from
repository results.
