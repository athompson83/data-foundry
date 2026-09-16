# Owner action — UA-002 hosted migration handover

Prepared 2026-09-16 and **bound to merged `main` `2063ea8d72247a9b2643e1c690e37ab55ab14252`**, which carries the
operator this document tells you to run.

The checksums below were re-verified against that SHA on 2026-09-16: 7 matched, 0
mismatched. The grant payload rebuilt from that release also reproduces the
exported manifest byte for byte across `upgradeFrom0028Sql`,
`upgradeFrom0028Checksum` and `verificationSql`, so the operator's own integrity
check passes against a manifest generated from it.

Re-verified after `#43` merged: regenerating at `main`
`5e263fc9326962de4e009b9047e5af1a04053df5` reproduces all ten rows of the table
below unchanged, because that merge touched documentation only. Either SHA is
usable for this run. The same sequence was then run once more against the
**real hosted ledger** read out of `data_foundry.schema_migrations` rather than a
reconstruction — 26 rows, 0 differing from what this release computes for the
same files — giving 33 / 26 / 7 and all ten checksums again. Any *further* commit needs its own regeneration — see the
next paragraph for why the migration tree alone does not settle it.

Only the migration-derived values survive a change of release: the seven
migration checksums and `repositoryDigest` are computed from `db/migrations/`
alone, so an identical migration tree reproduces them at any SHA. The grant
values — `postMigrationGrants`, `upgradeFrom0028Sql` and the SQL they hash — are
not: they are built from `packages/private-canary/src/runtime-role-policy.ts`
(all 59 function signatures are embedded in the upgrade SQL),
`tooling/fixtures/runtime-grants-0028.ts` (the 199-entry legacy baseline the
upgrade diffs against) and the exporter's own emission order, none of which live
under `db/migrations/`. Regenerate them at this exact SHA. The operator relies on
neither claim: it recomputes every checksum from the Git objects at whatever SHA
the manifest names.

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

If a manifest regenerated at `2063ea8d72247a9b2643e1c690e37ab55ab14252`
disagrees with any row above, **stop** — that means the worktree is not what
this handover assumed. A manifest generated at a later SHA may legitimately
differ in the two grant rows without any migration having changed; that is a
different release, and it needs its own checksum table rather than this one.
The preflight treats the same disagreement as a blocker and mutates nothing.

## The single thing still missing — 2026-09-16

Everything in this document is prepared and re-verified. One capability is
absent, and it is not code, a checksum or a decision:

> **A host with PostgreSQL egress to the project origin, running this release,
> with the `df_migration` password available to libpq without appearing in a
> command line.**

Any ordinary developer machine with internet access and the password satisfies
it. It needs Node 22+, `pnpm`, a clean checkout at the release, and either an
IPv6 route to `db.fgxinxaqkwoqyywdgobs.supabase.co` or the IPv4 Supavisor pooler
**in session mode (port 5432)** — transaction mode on 6543 will not work,
because the runner asserts `session_replication_role = origin` and
`lo_compat_privileges = off` and transaction pooling does not preserve session
state.

Every alternative available to the agent environment was checked and ruled out
by measurement rather than assumption — only one execution environment exists
and it is the restricted one; the origin is IPv6-only against a container with
no IPv6 stack; raw TCP is refused at the sandbox policy layer; the management
connector is still read-only and stays that way; and binding the migration
principal to a Worker is forbidden. The measurements are in
[the 2026-09-16 execution-environment record](../evidence/ua002-execution-environment-20260916.md),
which also confirms the hosted baseline is undrifted, the 26 applied ledger rows
are byte-identical to this release, and the full export sequence reproduces
33 / 26 / 7 with all ten checksums from the real hosted ledger.

## Determining whether your machine can run this — two commands

Run these on the machine you would use. Neither needs a credential, so neither
can leak one, and together they answer which of the two blockers you have.

**1. Can it reach the origin at all?**

```
getent ahosts db.fgxinxaqkwoqyywdgobs.supabase.co
nc -vz -w 8 db.fgxinxaqkwoqyywdgobs.supabase.co 5432
```

The origin is **IPv6-only** — it publishes an `AAAA` record and no `A` record.
If `getent` shows only an IPv6 address and `nc` reports success, you have direct
egress and need only the credential. If `nc` fails or your network has no IPv6,
use the IPv4 Supavisor pooler in **session mode (port 5432)** instead —
transaction mode on 6543 does not preserve the `session_replication_role` and
`lo_compat_privileges` this runner asserts.

**2. Place the credential without it ever becoming an argument.**

**First settle the login name, because it is not always `df_migration`.** Which
route step 1 selected decides it:

| Route from step 1 | Login name to use |
| --- | --- |
| Direct IPv6 origin, `db.<project-ref>.supabase.co` | bare `df_migration` |
| IPv4 Supavisor pooler, session mode 5432 | **project-qualified**, not bare |

Supavisor routes on a qualified login rather than on the hostname, so a bare
`df_migration` fails authentication there before any of this project's logic
runs. Read the exact form from the project's connect dialog at the time — it is
`<role>` and the project reference joined, but confirm the separator and
ordering against the dialog rather than assuming them from this document.

This changes only how the *pooler* identifies the tenant. The database-side
identity is unaffected: the runner asserts that `session_user` and
`current_user` are both `df_migration` and refuses the run otherwise, so if a
pooler login ever did present a different role to PostgreSQL the run would fail
closed rather than migrate under the wrong identity. That assertion is the
check — do not treat this paragraph as one.

Then place the credential, substituting that login name in **both** places:

```
umask 077
IFS= read -rs -p 'migration password: ' df_pw; echo
printf '%s:%s:%s:%s:%s\n' \
  '<host>' 5432 '<database>' '<login-name>' \
  "$(printf '%s' "$df_pw" | sed -e 's/[\\:]/\\&/g')" >> ~/.pgpass
unset df_pw
chmod 600 ~/.pgpass
export DATA_FOUNDRY_MIGRATION_DATABASE_URL='postgresql://<login-name>@<host>:5432/<database>'
```

The URL carries **no password** — libpq reads it from `.pgpass` by matching the
host, port, database and user, so the `.pgpass` user field must be the same
login name the URL carries, character for character.

**The `sed` is not decoration.** In `.pgpass`, `:` is the field separator and
`\` is the escape character, so a password containing either must have it
backslash-escaped or libpq parses the line into the wrong fields and
authentication fails with no indication why. That substitution escapes both and
leaves every other password unchanged.

`read -rs` keeps the password off the command line and out of shell history:
it is typed at a prompt, held in a shell variable that `printf` (a builtin)
consumes without spawning a process, and unset immediately. `sed` receives it on
stdin, never as an argument. Do not pass the password with `-W`, in
`psql "postgres://…:pw@…"`, or in any command-line argument: those land in the
process list and in history.

The runner also rejects a URL carrying `sslmode` or any other TLS or endpoint
query override — it configures TLS itself and verifies the certificate. Measured
2026-09-16: supplying `?sslmode=require` fails with *"Direct PostgreSQL TLS URLs
may not include endpoint or TLS query overrides."*

**This environment has neither.** Re-measured 2026-09-16: the origin resolves
IPv6-only and this container has zero IPv6 addresses, so the failure is
structural rather than configuration.

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

**They are three findings but one action.**
[`ua-002-provider-staging.sql`](ua-002-provider-staging.sql) does all three in a
single privileged session: it creates `df_ingestion` in the shape its five
siblings already have, repairs the durable settings on all seven roles, and marks
`df_migration` as `LOGIN`. It is idempotent, it is a single `DO` block so a
partial failure rolls back, it refuses to report success on a state the release
would reject, and it touches no application data, no other schema and no other
role.

It deliberately does **not** set the migration password. That value comes from
the provider's secure credential path and must never be pasted into a chat, a
file, a shell history or a log.

Validated against real PostgreSQL before publication: starting from the exact
measured drift (six role-global settings, `df_ingestion` absent, `df_migration`
`NOLOGIN`), it produced zero role-global settings, seven canonical
current-database rows, the correct `df_ingestion` shape and a `LOGIN` migration
role — and a second run changed nothing.

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

Run from a clean checkout of merged `main` `2063ea8d72247a9b2643e1c690e37ab55ab14252` — the release this document
is bound to. The export refuses to run unless that SHA is `HEAD` and the
non-ignored worktree is clean, including untracked files, and the operator refuses
unless `DATA_FOUNDRY_RELEASE_SHA` names the same SHA.

The whole procedure, with the values already filled in:

**Two things this command block gets wrong if you improvise them**, both of which
make the run impossible rather than merely awkward:

- The manifest and the ledger snapshot must live **outside the checkout**. The
  exporter and the operator each require the whole non-ignored worktree to be
  clean *including untracked files*, and neither `ua002-packet.json` nor
  `applied-ledger.json` is ignored — writing them into the repository makes the
  very command that creates them fail its own source-identity check.
- The export needs **`--applied-ledger`**. Without it the exporter defaults the
  applied set to empty and emits 33 pending / 0 applied, and the operator then
  reports a ledger-count mismatch and flags all 26 applied migrations as replays.

```bash
# On a machine with PostgreSQL egress to the Alpha Lab project.
export UA002_DIR="$(mktemp -d)"          # outside the checkout, on purpose
git fetch origin main && git checkout 2063ea8d72247a9b2643e1c690e37ab55ab14252
git status --porcelain --untracked-files=all    # must print nothing
pnpm install --frozen-lockfile
export DATA_FOUNDRY_RELEASE_SHA=2063ea8d72247a9b2643e1c690e37ab55ab14252

# 1. Provider staging, in one privileged session — see step 2 of the numbered
#    procedure below — then the migration password through the provider's secure
#    credential path. Nothing after this point works until that is done.

# 2. Snapshot the hosted ledger. Run this SQL through whatever psql invocation
#    your secret handling allows; see the credential note below.
#      SELECT coalesce(
#               json_agg(json_build_object(
#                 'version', version, 'filename', filename, 'checksum', checksum
#               ) ORDER BY version),
#               '[]'::json)
#        FROM data_foundry.schema_migrations;
#    Write the single JSON array it returns to "$UA002_DIR/applied-ledger.json".
#    Expect 26 rows, 0001 through 0026.

# 3. Export the manifest against that ledger.
node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts \
  --release-sha "$DATA_FOUNDRY_RELEASE_SHA" \
  --applied-ledger "$UA002_DIR/applied-ledger.json" > "$UA002_DIR/ua002-packet.json"

# 4. Read-only readiness report. Exit 2 means blockers, nothing touched.
export DATA_FOUNDRY_MIGRATION_DATABASE_URL='...'   # from the secret store, never typed
pnpm ua002:operator -- --packet "$UA002_DIR/ua002-packet.json"

# 5. Only once step 4 is clean:
pnpm ua002:operator -- --packet "$UA002_DIR/ua002-packet.json" --apply
```

**Credential note for step 2.** `psql "$DATA_FOUNDRY_MIGRATION_DATABASE_URL"`
puts the connection string in the process list, where any other user on the host
can read it. Prefer a `.pgpass` entry, a libpq service file, or `PGPASSWORD` with
the other connection parameters, so the secret never becomes an argument. The
operator itself never takes one.

**If a step fails with only `Direct PostgreSQL migration failed.`** — no
category, no detail — that is deliberate, not a bug. Once
`DATA_FOUNDRY_MIGRATION_DATABASE_URL` is set in the environment,
`migrationFailureMessage` redacts every *thrown* error that does not match its
allowlist of safe categories, because a raw driver error can carry the
connection string. Diagnose it in this order, and note that only the third step
involves unsetting anything:

1. **Look for a `[category]` suffix.** `Direct PostgreSQL migration failed
   [migration-role-posture].` is the allowlist working: it names the class of
   failure without echoing anything sensitive. Most known migration-time
   conditions land here.
2. **Check whether it was a preflight blocker at all.** It probably was not.
   Preflight findings are *returned*, not thrown — they print as
   `BLOCK <check>: <detail>` and exit 2 with `N blocker(s). Nothing was
   mutated.` The redactor never touches them, so every preflight condition is
   already fully legible. A bare sentence means something threw instead.
3. **Only for the three pre-driver guards, re-run with the credential unset.**
   Packet parsing, the release-SHA guard and the clean-checkout identity guard
   all run before `createPostgresDriver`, so they reproduce with no database at
   all and print in full. **This does not work for anything later.** `main`
   resolves the credential before creating the driver, so unsetting it turns a
   connection, authentication, TLS or SQL failure into the unrelated
   `DATA_FOUNDRY_MIGRATION_DATABASE_URL is required` error and tells you
   nothing about the real one.
4. **For a post-credential failure, reproduce the connection by itself.** Open
   a plain `psql` session using the same `.pgpass` entry or libpq service file —
   never as an argument — and let libpq report its own authentication, TLS or
   network error directly. That path does not pass through the redactor, and it
   separates "cannot connect" from "connected, then failed", which is the
   distinction the opaque sentence hides.

Expect from the export: `repositoryMigrationCount: 33`, `appliedMigrationCount: 26`,
`pendingMigrationCount: 7`, `repositoryDigest`
`8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, six grant
roles, 59 function signatures, 286 expected grants, and `upgradeFrom0028Checksum`
`d73fe6718648ff459cb416d2b665496f841c4a430bc06647c6c55013dd04dd65`. All of those
were observed from this SHA.

1. **Regenerate the manifest** using the runbook's direct invocation, with the
   ledger snapshot and an output path outside the checkout:

   ```
   node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts --release-sha 2063ea8d72247a9b2643e1c690e37ab55ab14252 --applied-ledger <ledger-snapshot-path> > <non-secret-path-outside-the-repo>
   ```

   Confirm `pendingMigrationCount: 7`, `repositoryDigest` and every checksum
   against the table above before anything is applied.

2. **Run [`ua-002-provider-staging.sql`](ua-002-provider-staging.sql) once**, in
   a privileged provider session, and set the migration password through the
   provider's secure credential path.

   This comes before the preflight, not after it, for a blunt reason: on the
   recorded baseline `df_migration` is `NOLOGIN` and has no password, so the
   preflight cannot open a connection at all until this step has run. The
   preflight is how you *verify* staging, not how you discover it — the three
   prerequisites are already measured and recorded above.

   The migration role cannot perform any of this itself: it is `NOCREATEROLE`
   and can alter only its own settings.

3. **Run the preflight.** Export the connection string into the environment —
   never onto a command line, into a file, or into a log — and run:

   ```
   export DATA_FOUNDRY_RELEASE_SHA=2063ea8d72247a9b2643e1c690e37ab55ab14252
   export DATA_FOUNDRY_MIGRATION_DATABASE_URL='...'   # from the secret store, not typed
   pnpm ua002:operator -- --packet <non-secret-local-packet-path>
   ```

   This is read-only and mutates nothing. It checks, in one pass: the session is
   a direct `df_migration` login and is writable and not a standby; **every
   prerequisite the grant install asserts** — migration-role posture and session,
   default object ACLs, external capability, durable settings for all seven
   roles, runtime-role external ACLs, and forbidden `PUBLIC`/`anon`/
   `authenticated`/`service_role` grants on the private schema, plus any relation
   or function already present that the release does not expect, the schema's own
   owner and any object not owned by the migration role, and any
   `SECURITY DEFINER` function — using the exporter's own SQL rather than a
   paraphrase; every role exists in the reviewed shape with no outgoing
   memberships; the ledger carries this
   project's marker and is where the packet expects; no packet would replay an
   applied migration; **the ledger and the packet together account for every
   migration at the release**, so nothing gets applied unlisted; every checksum —
   pending *and* already applied — recomputes from the Git objects, with applied
   filenames compared too because the grant upgrade's ledger comparison includes
   them; and the grant payload the manifest carries matches one **rebuilt from
   the release**.

   That last check matters more than it sounds. The manifest's
   `upgradeFrom0028Sql` and `verificationSql` are executed as the schema owner,
   and its checksum is stored beside the SQL it hashes, so it proves nothing
   against an edit. The operator therefore rebuilds the payload from the release
   and **runs what it rebuilt**, treating the file as a declaration to verify
   rather than as the thing to execute. A substituted verifier cannot report
   success on an unverified database.

   Because the rebuild uses this checkout's code, the operator also requires
   `DATA_FOUNDRY_RELEASE_SHA` to equal the packet's release, `HEAD` to equal
   that SHA, and the worktree to be clean including untracked files.

   **One residual, stated rather than hidden.** Two of the install's
   prerequisites — the existing-privilege count and the complete private
   direct-ACL baseline — describe the object set *after* the pending migrations
   create their tables, so they cannot be checked beforehand without reporting
   drift that is merely the future. Object *inventory* is checked in the one
   direction that is answerable now: "present but unexpected" is drift today and
   stays drift afterwards, so it is a blocker; "expected but absent" is simply a
   migration that has not run yet, so it is not.

   Function search paths are a third such case. Migration `0027` is what sets
   `proconfig` on the existing functions, so on the current hosted database all
   57 legitimately have none — checking that here would have produced 57 false
   blockers against a run that should proceed. Ownership is always checked.
   `SECURITY DEFINER` is checked too, except on the functions a pending migration
   replaces with a definition carrying no security clause, which resets them to
   the default `INVOKER` — for the current pending set that is five names,
   including `source_record_snapshot_retirements_validate` and
   `scheduled_acquisition_run_terminal_guard`. A migration that mentions
   `SECURITY DEFINER` anywhere exempts nothing, because wrongly exempting a
   privilege-escalating function costs more than one extra repair cycle. They remain the one class that can still fail
   once migrations are committed. If that happens, the migrations are applied and
   the grants are not: re-run the preflight, repair what it names, and re-run
   `--apply`, which skips the already-ledgered migrations and retries the grant
   upgrade.

   It prints every blocker at once rather than stopping at the first, because
   the repairs need a privileged provider session anyway and you want one trip,
   not three. **Exit status 2 means blockers were found and nothing was
   touched.**

4. **If the preflight reports blockers, repair them and run it again.** Exit
   status 2 means nothing was touched. Most repairs belong to the same
   privileged provider session as step 2.

5. **Apply, once the preflight is clean**, with the same command and one more
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

6. **Expect, at the end:** 33 applied migrations, six roles, 59 function
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
