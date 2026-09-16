# Owner action — UA-002 hosted migration handover

Prepared 2026-09-16. The checksums below were first computed against
`eb7e998e6d4a574fa735d8ff54014cde18c25e27` and re-verified against merged `main`
`0026b14b7ef0156519305fec756fae8fa083b169`: 7 matched, 0 mismatched, because
`db/migrations/` did not change between them. They stay valid for any release SHA
whose `db/migrations/` tree is identical — and the operator refuses the run rather
than assuming that, by recomputing every checksum from the Git objects at whatever
SHA the manifest names.

## Why this document exists

The database half of `UA-002` was approved as a scoped exception: use the
authenticated management connector over HTTPS, because direct PostgreSQL TLS is
not reachable from the agent execution environment. That approval was sound when
it was given. It is not executable now, because **the connector itself became
read-only** — it authenticates as `supabase_read_only_user` with
`default_transaction_read_only = on`, and has no membership in `df_migration`.
The measurements are in
[the 2026-09-16 connector write-path record](../evidence/ua002-connector-write-path-20260916.md).

Nothing was applied. Nothing drifted. Everything the exception authorized is
prepared and independently verified, and this document hands it over in a form
that can be executed by someone who has a write path.

## What is already done, so it does not need repeating

- **The hosted baseline is verified and undrifted.** Ledger `0001`–`0026`,
  46 tables, 3 views, 57 functions, zero `SECURITY DEFINER`, zero non-owner
  objects, six `df_*` roles all `NOLOGIN`, `df_ingestion` absent, `public`
  untouched at 7 tables. This is exactly the reviewed expected state.
- **The seven pending packets are checksum-verified against the Git objects**
  at the release SHA, recomputed independently of the exporter that produced
  them. 7 matched, 0 mismatched.
- **The grant upgrade is derived and bounded:** six roles, 59 function
  signatures, 286 expected grants, applied by the exact-baseline
  `upgradeFrom0028Sql` which refuses to run against anything but the frozen
  199-grant legacy shape.

Expected checksums, for comparison against whatever you regenerate. The preflight
checks these for you; the table is here so a human can spot-check without running
anything:

| Artefact | Checksum |
| --- | --- |
| 0027 `runtime_security_hardening` | `8ebfb172feb2b9e8c5b04056b7153d830e9d93230b46c62762bc435e8531da2a` |
| 0028 `audited_foreign_key_indexes` | `7a70c3ca21a82f7d0090fa85996fc9415bb7d41840bea76314e92d40994dabbe` |
| 0029 `ingestion_delivery` | `1cf18cf40e2fb1d8096f446daf088fc163b25262bd64f5a73e05f599d23ca6ae` |
| 0030 `operator_actions` | `19021ff6233773e5e4acfd62dcbf0370f120fac98a8b65f66020f6e7f802282e` |
| 0031 `operation_alerts` | `9ccb1bb09c1db9d08a098d8cf62e3253397fa9d1db16dfca93406e8d499c496e` |
| 0032 `current_alias_source_projection` | `dab8727d2ea7f686228002ab3f063d9f6681749a39f73d3fa8bf5164ca5bcf67` |
| 0033 `not_modified_claim_boundary` | `23a6eed8170286550e85784b8563f1dada52f8b2a98da81f2cd897845cbb6b88` |
| `postMigrationGrants` | `b6c7e197aac427b21e232a988567b8d180ef6cc767a3e7cd691eb61febc8413c` |
| `upgradeFrom0028Sql` | `d73fe6718648ff459cb416d2b665496f841c4a430bc06647c6c55013dd04dd65` |
| `repositoryDigest` | `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d` |

If a regenerated manifest disagrees with any row above, **stop** — that means
the release SHA or the worktree is not what this handover assumed. The preflight
treats the same disagreement as a blocker and mutates nothing.

## The two ways forward

### Option 1 — direct-TLS operator run (recommended)

This is not a workaround. It is the procedure
[the deployment runbook](cloudflare-deployment.md) already specifies: the
manifest's `packets[]` and `bootstrapSql` describe "an archival connector path,
not the current procedure", and "the direct-TLS runner owns all application
migration and replay work". The connector exception existed only because this
environment cannot open port 5432/6543.

It needs an operator machine with ordinary PostgreSQL egress, plus two things
that do **not** exist yet on the hosted project. See
[the prerequisites](#prerequisites-that-are-not-yet-satisfied) — they are not
optional, and the run fails without them.

**How the identity actually works — this matters and is easy to get wrong.**
The direct runner does not use `SET ROLE`. `tooling/scripts/migrate.ts` asserts
that the connection's `session_user` *and* `current_user` are both
`df_migration`, so the operator connects **as that role**, reading the
connection string only from `DATA_FOUNDRY_MIGRATION_DATABASE_URL`. A broader
operator credential is rejected by the runner, not merely discouraged.

That has a consequence: `df_migration` is `NOCREATEROLE` and not a superuser, so
it **cannot create `df_ingestion`** and cannot alter any other role's settings.
Role creation and role-settings repair belong to the secure provider path, as
the runbook already says. They are separate steps with a separate identity, and
this document treats them that way.

**Why it is still the contained option:** the migration identity is a single
narrow role that owns only `data_foundry` objects, every statement lands inside
that schema, the exact-baseline upgrade refuses unexpected ACL drift instead of
normalizing it, and no other application on the project gains a write path for
even a moment.

### Option 2 — re-enable connector write mode

Removing `read_only=true` from the Supabase MCP configuration restores a
writable identity (in September this was `postgres`, which *is* a member of
`df_migration`; `supabase_read_only_user` is not, so read-only mode alone is
not the only thing that would have to change if a different identity is used).

**The cost, stated plainly rather than glossed:** that setting is not scoped to
`data_foundry`. It widens write authority across the whole Alpha Lab project,
including the unrelated Rise application's `public` schema, which every session
working on this repository has been under standing instruction never to touch.
It trades a broad, persistent capability for a one-time task that Option 1 can
do with a narrow one.

If Option 2 is chosen anyway, pair it with `project_ref=fgxinxaqkwoqyywdgobs`
so account-level tools stay disabled, and turn `read_only=true` back on the
moment the run completes.

**Recommendation: Option 1.** Option 2's blast radius is disproportionate to
the job, and the job has a documented narrow path.

## Prerequisites that are not yet satisfied

Measured read-only against the hosted project on 2026-09-16. Each of these
blocks the run, and none of them can be done by `df_migration`.

### 1. `df_migration` cannot log in

`rolcanlogin` is `false`. The release's own posture check treats that as the
violation `migration_role_is_not_login`, and the direct runner cannot connect at
all. The owner must activate the migration credential through the provider's
secure path — this is the long-standing `UA-002` credential step, not a new ask.

### 2. All six `df_*` roles carry the wrong kind of durable setting

This is **new drift**, found by running the release's own policy SQL read-only
against the hosted database. It is not cosmetic: the packet raises on it.

Every one of the six roles — `df_migration`, `df_edge`, `df_web`, `df_mcp`,
`df_usage`, `df_acquisition` — has a **role-global** (`setdatabase = 0`)
`search_path=data_foundry, pg_catalog, extensions` setting, and **none** has the
per-current-database row the release requires. That is twelve violations:

| Violation | Count | Roles |
| --- | --- | --- |
| `role_global_setting` | 6 | all six |
| `missing_current_database_role_setting` | 6 | all six |

The release forbids the all-databases form precisely because it follows the role
into every other database on the instance. `buildMigrationRoleUnsafeDurableSettingSql`
is embedded in the grant packet, which does
`IF drift_count <> 0 THEN RAISE EXCEPTION`, so the run would **apply migrations
0027–0033 successfully and then fail at the grant upgrade** — the worst possible
ordering. The operator sequence below therefore checks this *before* the first
mutation.

The repair, for each of the six roles, run by the provider path (a privileged
role — `df_migration` cannot alter other roles):

```sql
ALTER ROLE <role> RESET search_path;
ALTER ROLE <role> IN DATABASE <current-database>
  SET search_path = data_foundry, pg_catalog, extensions;
```

### 3. `df_ingestion` does not exist

It must be created by the provider path as a `NOLOGIN`, `NOINHERIT`,
non-privileged, non-member role, matching the five existing siblings exactly:
no superuser, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`,
connection limit `-1`, no valid-until, with only direct non-grantable `CONNECT`
on the current database and `USAGE` on `extensions`, plus the same
per-current-database `search_path` row described above. No database `CREATE`, no
grant options, no `public`-schema privilege and no private object privilege at
this staging step — the grant upgrade adds its capabilities afterwards.

## Execution sequence

Run from a clean checkout of the release you intend to deploy — merged `main`,
at or after `0026b14`. The export refuses to run unless that SHA is `HEAD` and the
non-ignored worktree is clean, including untracked files.

1. **Regenerate the manifest** using the runbook's direct invocation:

   ```
   node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts --release-sha <release-sha> > <non-secret-local-packet-path>
   ```

   Confirm `pendingMigrationCount: 7`, `repositoryDigest` and every checksum
   against the table above before anything is applied.

2. **Run the preflight.** Export the connection string into the environment —
   never onto a command line, into a file, or into a log — and run:

   ```
   export DATA_FOUNDRY_MIGRATION_DATABASE_URL='...'   # from the secret store, not typed
   pnpm ua002:operator -- --packet <non-secret-local-packet-path>
   ```

   This is read-only and mutates nothing. It checks, in one pass: the session is
   a direct `df_migration` login and is writable and not a standby; the durable
   settings of all seven roles satisfy the exact policy the grant packet raises
   on; every role exists in the reviewed shape; the ledger carries this
   project's marker and is where the packet expects; no packet would replay an
   applied migration; and every checksum — pending *and* already applied —
   recomputes from the Git objects at the release SHA.

   It prints every blocker at once rather than stopping at the first, because
   the repairs need a privileged provider session anyway and you want one trip,
   not three. **Exit status 2 means blockers were found and nothing was
   touched.**

3. **Confirm the prerequisites above are done** — migration login active, all
   six roles' durable settings repaired, `df_ingestion` staged. These are
   provider-path steps with a privileged identity, completed *before* the
   direct-TLS session opens; the migration role can verify them but cannot
   perform them.

4. **Apply, once the preflight is clean**, with the same command and one more
   flag:

   ```
   pnpm ua002:operator -- --packet <non-secret-local-packet-path> --apply
   ```

   It re-runs the whole preflight first — a clean report from ten minutes ago is
   not a precondition — and then, in order: applies `0027` through `0033`, each
   in its own transaction as `df_migration` with its ledger row written in that
   same transaction and already-applied versions skipped rather than replayed;
   applies `postMigrationGrants.upgradeFrom0028Sql` in a single transaction
   (**not** the fresh-install `sql`, which refuses pre-existing runtime ACLs);
   and runs `postMigrationGrants.verificationSql`.

   If the grant upgrade fails, the runner rolls back and then *proves* the
   session recovered before reporting, rather than assuming PostgreSQL did it —
   a session left in a failed transaction silently swallows everything after.
   Unknown ACL drift must fail; do not normalize or revoke unrelated grants.

5. **Expect, at the end:** 33 applied migrations, six roles, 59 function
   signatures and 286 grants.

## Where this stops

Database success is the start of `UA-002`, not the end of it, and it must not be
described as a deployment. Still outstanding afterwards, in order:

- Runtime-role credentials created through the provider's secure path — six
  distinct values, never entered into chat, a repository file, or a log.
- `postCredentialVerificationSql` plus the six direct runtime probes.
- **Six** cache-disabled Hyperdrives, bound only after those probes pass — one
  per database-backed Worker (edge, web, usage-consumer, acquisition-worker,
  ingestion-worker, mcp-worker). `check-cloudflare-topology.ts` states that
  only those six runtime Workers have role-specific database identities, and
  the private-canary must bind none.
- The route-less private canary and the recovery exercise.

**Do not infer any of these from migration success.** They are independent, and
the schema being current says nothing about whether a credential works.

## What this document does not authorize

Source rights approval, public DNS or Worker cutover, contract acceptance, or
any mutation outside `data_foundry`. Those remain exactly where they were.
