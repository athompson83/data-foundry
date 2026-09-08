# Disposable ingestion PostgreSQL control — 2026-09-08

This is local runtime evidence for the uncommitted revenue-platform worktree based
on `0ae6c7aeb2dee70ce380663cb438d5e1d047b634`. It is not an immutable release-SHA
attestation, hosted migration certification, Cloudflare deployment evidence, or
approval to acquire a commercial source.

The parent task provisioned an isolated PostgreSQL 16 instance on loopback port
25439. The final 31 repository migrations applied to its private `data_foundry`
schema. The test connected directly as `df_ingestion` after applying its current
reviewed grant inventory (286 entries across six runtime identities). Both `current_user` and `session_user` were
`df_ingestion`. No provider credentials were used. Synthetic rights, fixture
transport, and an in-memory R2-compatible object store replaced commercial
sources and Cloudflare services.

The real-role run identified missing sequence and lock prerequisites which a
superuser fixture run had not exercised. The final policy adds sequence USAGE
for `ingestion_job_transitions_id_seq`, column UPDATE(id) for snapshot-acceptance
row locks, and table UPDATE for the dependency cycle-check table lock. Existing
immutable-history triggers continue to reject actual changes.

`tooling/scripts/check-ingestion-postgres.ts` now provides the reusable control.
It requires explicit disposable-test mode, matching loopback connections to the
`data_foundry` database, and the direct `df_ingestion` runtime login. The caller
must already have applied migrations and exact grants. The script refuses a
database with non-fixture sources, uses only fictional transport, and prints a
closed receipt. Its CLI does not print connection or database error contents. TLS remains the default, including CI; plaintext requires the separate explicit `DATA_FOUNDRY_INGESTION_PLAINTEXT_LOOPBACK=1` opt-in on the already loopback-restricted control.

Command: `pnpm ingestion:postgres:check`, with the three explicit test environment
variables described by the script and control/runtime URLs supplied by the local
test harness. Observed receipt:

```json
{"kind":"data-foundry.ingestion-postgres-control.v1","published":true,"duplicateIgnored":true,"runtimeIdentity":"df_ingestion","activeFacts":61,"evidence":61,"rejectedMutations":10}
```

The control published canonical facts with evidence, ignored the duplicate
completed delivery, and rejected ten mutation/capability attempts:

- Snapshot acceptance identifier changes and no-op updates: SQLSTATE `23514`.
- Fact dependency changes and no-op updates: SQLSTATE `55000`.
- Dependency DELETE/TRUNCATE, direct sequence SELECT, source status UPDATE, and
  raw-artifact metadata UPDATE, and direct private rights-activation function
  execution: SQLSTATE `42501`.

The final run also required zero effective private-function EXECUTE privileges
for `df_ingestion`. Review found that one intermediate disposable rebuild had
recreated functions without revoking PostgreSQL's default PUBLIC EXECUTE. That
intermediate run is superseded: the fixture was rebuilt again, all PUBLIC and
runtime privileges were revoked before applying the exact ingestion grants,
and both the positive pipeline and all ten negative checks passed. The reusable
gate now refuses that permissive PUBLIC state before exercising the pipeline.

The initial replay refused the stale local `0030` checksum after that uncommitted migration changed. The test verified the exact disposable cluster identity and rebuilt only its synthetic private schema, then applied all 31 migrations from scratch. No ledger checksum was overwritten. The reusable CLI seeded the empty fixture database through a pinned PostgreSQL transaction and emitted the receipt above.

`pnpm typecheck` passed. The latest platform-focused run passed 178/178 tests across topology, CI policy, deployment/provenance documentation, local PostgreSQL target guards and the separate synthetic phase. A further 44/44 tests passed across core artifact and private-canary contracts. These include thirteen credential-free core Wrangler bundles plus a separately named fourteenth synthetic ingestion profile; no bundle carries PGlite/WASM and no ingestion bundle carries the fixture filesystem/PDF extraction graph. The separate synthetic profile's twelve runtime tests pin JSON/CSV fixture bytes and refuse source, hash, object path, mode and environment drift before processing.

The final frozen-input run used migration digest
`65e1cad2a788d7157dd8d54a2bead120c36267557bf2a91fa85fc0e9ed912bc2`
and ingestion runtime digest
`82299b3f20ac23f8eaa23e6eab116c3b9e930887b4c0810e798b14ca9cf71fed`.
This includes the final `RETIRE_DELIVERY` action constraint in migration `0030`.
`corepack pnpm ingestion:check` and the native gate passed after that freeze.
The final targeted command was:

```text
corepack pnpm exec vitest run tooling/test/cloudflare-artifacts.test.ts tooling/test/synthetic-ingestion.test.ts tooling/test/ingestion-implementation.test.ts tooling/test/ingestion-postgres.test.ts tooling/test/cloudflare-topology.test.ts tooling/test/ci-workflow.test.ts apps/ingestion-worker/test/synthetic-ingestion.test.ts
```

All 175 tests across seven files passed, including the thirteen core Wrangler
dry-run bundles and the separately named fourteenth synthetic profile. The
deployment and provenance document suites separately passed 23/23. These final
runs supersede the earlier focused counts above for their affected inputs.
The strict native fixture subsequently passed the
[local database restore control](local-postgres-restore-20260908.md).

The current source-free canary still proves role readiness only. A separately
isolated Cloudflare synthetic artifact-to-canonical Queue/R2 run remains
required. Re-run the local control after any later migration, grant, or runtime
change. Migration `0031_operation_alerts.sql` is included in this local database proof. Final immutable-SHA and hosted gates remain pending.


Final platform review tightened synthetic deployment validation to the thirteen actual ignored ordinary/reduced/harness manifests. Both ordinary deployment and full private-canary topology checks must pass, every account must match, the synthetic Hyperdrive must equal the reviewed reduced ingestion binding, and actual deployment resources must remain disjoint. Missing controls refuse. `pnpm typecheck` passed again; the final synthetic/deployment-document/provenance-document suites passed 41/41, including an integration fixture of all thirteen deployment controls and the separate fourteenth build. The native control was replayed successfully after the final ingestion runtime digest changed. No provider deployment was performed.
