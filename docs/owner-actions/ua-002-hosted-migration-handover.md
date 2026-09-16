# Owner action — UA-002 hosted migration handover

Prepared 2026-09-16 against release `eb7e998e6d4a574fa735d8ff54014cde18c25e27`.

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

Expected checksums, for comparison against whatever you regenerate:

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
the release SHA or the worktree is not what this handover assumed.

## The two ways forward

### Option 1 — direct-TLS operator run (recommended)

This is not a workaround. It is the procedure
[the deployment runbook](cloudflare-deployment.md) already specifies: the
manifest's `packets[]` and `bootstrapSql` describe "an archival connector path,
not the current procedure", and "the direct-TLS runner owns all application
migration and replay work". The connector exception existed only because this
environment cannot open port 5432/6543.

It needs an operator machine with ordinary PostgreSQL egress and the existing
migration credential — nothing new to provision.

**Why it is the contained option:** authority stays scoped to `df_migration`
via `SET ROLE`, every statement lands inside `data_foundry`, the exact-baseline
upgrade refuses unexpected ACL drift instead of normalizing it, and no other
application on the project gains a write path for even a moment.

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

## Execution sequence

Run from a clean checkout of exactly `eb7e998e6d4a574fa735d8ff54014cde18c25e27`.
The export refuses to run unless that SHA is `HEAD` and the non-ignored worktree
is clean.

1. **Regenerate the manifest** using the runbook's direct invocation:

   ```
   node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts --release-sha eb7e998e6d4a574fa735d8ff54014cde18c25e27 > <non-secret-local-packet-path>
   ```

   Confirm `pendingMigrationCount: 7`, `repositoryDigest` and every checksum
   against the table above before anything is applied.

2. **Verify preconditions** with `preflightSql` and confirm the ledger is still
   at `0026`. If it is not, stop and re-derive: this handover's baseline no
   longer holds.

3. **Stage `df_ingestion`** as a `NOLOGIN`, non-privileged, non-member role
   with only direct, non-grantable `CONNECT` on the current database and
   `USAGE` on `extensions`. No database `CREATE`, no grant options, no
   `public`-schema privilege, no private object privilege at this step.

4. **Apply `0027` through `0033` in order**, each in its own transaction as
   `df_migration`, each writing its ledger row in that same transaction. If any
   packet fails, verify the rollback left the ledger and the object inventory
   untouched **before** continuing — a partial application is the one outcome
   this design is built to make impossible, and it should be proven rather than
   assumed.

5. **Apply `postMigrationGrants.upgradeFrom0028Sql`** — not the fresh-install
   `sql`, which refuses pre-existing runtime ACLs. It requires the frozen
   199-grant baseline and the full current ledger, adds only reviewed
   capabilities, and checks its postcondition in the same transaction. Unknown
   ACL drift must fail; do not normalize or revoke unrelated grants.

6. **Require `postMigrationGrants.verificationSql` to pass** after the upgrade.
   Expect 33 applied migrations, six roles, 59 function signatures and 286
   grants.

## Where this stops

Database success is the start of `UA-002`, not the end of it, and it must not be
described as a deployment. Still outstanding afterwards, in order:

- Runtime-role credentials created through the provider's secure path — six
  distinct values, never entered into chat, a repository file, or a log.
- `postCredentialVerificationSql` plus the six direct runtime probes.
- Five cache-disabled Hyperdrives, bound only after those probes pass.
- The route-less private canary and the recovery exercise.

**Do not infer any of these from migration success.** They are independent, and
the schema being current says nothing about whether a credential works.

## What this document does not authorize

Source rights approval, public DNS or Worker cutover, contract acceptance, or
any mutation outside `data_foundry`. Those remain exactly where they were.
