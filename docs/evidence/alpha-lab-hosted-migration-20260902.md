# Alpha Lab hosted private-schema migration and grant activation — 2026-09-02

**Scope:** Owner-preauthorized application of the exact repository migration
set and the runtime-role grant packet to the private `data_foundry` schema in
the shared Alpha Lab database target, followed by read-only verification.

**Redaction:** This record omits provider account, project, connection, and
credential identifiers. It contains no connection string, secret, database
password, or provider-token value. No password was created, viewed, or stored.

**Status:** `SCHEMA_STAGED` — the private schema, migration ledger, object
ownership, and runtime-role privileges exist and are verified. This is not a
deployment, live-Hyperdrive, runtime-health, source-rights, data-availability,
or commercial-readiness certificate. The schema holds no source, entity, fact,
tenant, or credential rows.

## Evidence lineage

- **Migration set:** the 26 files under `db/migrations/` at PR #26 head
  `93a668b6d0231fc94446c972390910031a5481fb`. That tree
  (`3045e3eb4a37c245a71797ec4c69e9e5f0a0659f`) is byte-identical to
  `db/migrations/` on `origin/main` `5dde773a4b64a8e004ca429706100399a678cf74`.
- **Packet generator:** `tooling/scripts/export-supabase-migration-packets.ts`
  at the same PR #26 head produced the `data-foundry-supabase-migration-plan/v1`
  plan: preflight, bootstrap, 26 attested migration packets, verification, and
  the `postMigrationGrants` packet. Private-schema checksums are the exporter's
  `sha256("data-foundry-private-schema-v1\0" + effectiveSql)` values.
- **Execution path:** the provider's authenticated management SQL connector,
  running as the connector's administrative role and switching to the
  controlled migration owner with `SET LOCAL ROLE` inside each packet. Direct
  TLS Postgres is unreachable from the automation container (the Direct origin
  is IPv6-only and container egress is limited to an HTTPS proxy), so the
  connector was the only available path. The PR #26 runbook classes connector
  packets as archival; this application proceeded under the owner's explicit
  `OWNER_PREAUTHORIZED` production-provisioning task and is recorded here so
  that the deviation is visible rather than implied.
- **Atomicity proof:** before any migration ran, a multi-statement connector
  call whose final statement deliberately failed was shown to roll back every
  preceding DDL statement. Each packet therefore executed as one implicit
  transaction: role switch, transaction-local search path, ledger lock, exact
  ledger-prefix guard, migration SQL, ledger insert, and reset either all
  committed or none did.
- **Restricted source reference:** the authenticated Alpha Lab database audit
  view remains the owner-restricted source of record. Native connector responses
  are intentionally not committed; this file keeps only scoped, redacted
  assertions and the exporter-defined verification outcomes.

## What was executed, in order

1. Preflight and bootstrap packets: confirmed the `extensions` namespace and
   the private schema/ledger precondition state expected by the exporter.
2. Migration packets `0001` through `0026`, one connector call each, each
   guarded by the exporter's exact ledger-prefix `DO` block. Two oversized
   packets were sent in the exporter's own statement order without edits.
3. Grant-packet preconditions, executed before the grant packet because the
   hosted state differed from the exporter's assumptions:
   - database `CONNECT` granted to the five runtime roles (as the connector's
     administrative role);
   - as the migration owner: pre-existing schema `USAGE` removed from the five
     runtime roles so the packet's "no prior grant" guard could hold; the
     built-in `PUBLIC` pseudo-role removed from the `data_foundry` schema, all
     its tables, sequences, and functions; default privileges for future
     tables, sequences, and functions created by the migration owner set to
     exclude `PUBLIC`.
   These statements touched only `data_foundry` objects and the Data Foundry
   roles. The shared `public` schema was not referenced.
4. The `postMigrationGrants` packet, followed by its `verificationSql` block.

## Verified hosted state (observed `2026-09-02T01:00:21.280Z`)

| Check | Observed |
| --- | --- |
| Migration ledger | 26 rows, versions `0001`..`0026`, comment marker `data-foundry:schema_migrations:v1`; every checksum equals the exporter's attested value |
| Objects in `data_foundry` | 46 tables, 3 views, 57 functions; every table, view, and sequence owned by the migration owner |
| `SECURITY DEFINER` functions | 0 |
| Schema ACL | migration owner `USAGE, CREATE`; each of the five runtime roles `USAGE` only; no `PUBLIC` entry |
| Runtime privileges | the exporter's runtime-grant verification `DO` block passed with no exception (200 expected object grants, 57 function signatures) |
| Runtime roles | all five are `NOLOGIN`, non-superuser, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, role default search path `data_foundry, pg_catalog, extensions`; no password set |
| Migration owner | `NOLOGIN`, non-superuser; reached only through the connector's administrative membership |
| Shared `public` schema | 7 tables, ACL string unchanged from the 2026-08-31 reconciliation; no grant, revoke, or object change |
| Data | only the migration-seeded `api_route_keys` rows (14) and the ledger; zero source, entity, fact, tenant, credential, or usage rows |

## Provider advisories observed after migration

- `ERROR rls_disabled_in_public` on `public.automation_runs` — pre-existing,
  belongs to the unrelated Alpha Lab application, not remediated by automation.
  The owner decides whether to enable RLS there; Data Foundry code never reads
  or writes that table.
- `WARN function_search_path_mutable` on all 57 `data_foundry` functions —
  introduced by the migration set itself. None is `SECURITY DEFINER`, the
  runtime pins a transaction-local search path per operation, and `PUBLIC`
  `EXECUTE` is revoked. A repository-side follow-up (pinning `search_path` in
  the function definitions via a new migration) would clear the warning; it
  must not be applied as a hosted-only change.
- `WARN pg_graphql_*_table_exposed` on six `public` tables — unrelated
  application; unchanged.

## Consequences

- `PROD-001` now has hosted schema, ledger, ownership, and grant evidence. It
  still lacks backup, restore-test, and recovery-point evidence.
- `FOUNDATION-006` still lacks every Cloudflare-side element: no Data Foundry
  Worker, Hyperdrive configuration (zero configurations observed at the same
  time), exact production manifest, or deployment identifier exists.
- The next hosted step is owner-only: assign a password and `LOGIN` to each
  runtime role through the provider's secure credential flow, create one
  Hyperdrive per role with caching disabled against the Direct origin, then run
  the exporter's `postCredentialVerificationSql`. Automation must never receive
  or print those passwords.
- Nothing here changes source rights. `hvac` remains `DRAFT` with four
  synthetic fixture sources; ENERGY STAR remains deferred and unreviewed. No
  real dataset is loaded, cleared, or claimed.
