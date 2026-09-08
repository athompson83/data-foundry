# Local PostgreSQL restore control — 2026-09-08

This completed drill qualifies a local database dump/restore procedure for the
uncommitted revenue-platform worktree based on
`0ae6c7aeb2dee70ce380663cb438d5e1d047b634`. It does not attest a release SHA,
provider backup, hosted restore, production RPO/RTO, or recovery of R2 objects.
Only the disposable synthetic database from the
[ingestion control](ingestion-postgres-control-20260908.md) was read. Source
cluster `/tmp/data-foundry-revenue-0Jk0rA/db`, loopback port 25439, remained
unchanged. The separate migration-upgrade control on port 25440 was untouched.

The drill used PostgreSQL 16 `pg_dump --format=custom` with an exported
repeatable-read snapshot, followed by `pg_restore --exit-on-error
--single-transaction` into a new local PostgreSQL 16 cluster on port 25441.
The destination was `/tmp/data-foundry-restore-EwsSfGzU`; its process, directory,
and dump were removed after comparison. No provider credentials, password
catalogs, or external services were accessed.

| Observed control | Result |
| --- | --- |
| Application tables / rows | 51 / 483; every complete row compared |
| Migration ledger | 31 rows, included in exact table comparison |
| Private functions | 59; definitions, owners and ACLs compared |
| Sequence states | 1; value and `is_called` matched |
| Custom roles | 2; attributes, memberships and exact database search path matched |
| Canonical query | 11 facts matched at the same entity/time, including direct `df_ingestion` access |
| Private function access | Zero effective EXECUTE privileges for the restored ingestion login |
| Source recheck | All table, catalog, role, sequence and selected query results unchanged |
| Dump | 466,230 bytes; SHA-256 `f858a2a30e08e3bcdd54fab53c5b51d38804f0dc21fa8908438b399d09f129bd` |
| Local timing | Dump 184 ms; restore 776 ms; complete control 2,895 ms |
| Cleanup | Destination stopped and removed; dump not retained |

Table-content inventory SHA-256:
`e0914d8d9926fd52c77b0f33bbf47dc4a0ebcf9e63cde74c76a49d940949dc46`.
Catalog inventory SHA-256:
`ff24de58c8c06d5c27b998c5b6820dd90d3e9c3689e9aa25ebd7c171490c5d44`.
Selected canonical-query SHA-256:
`7825be42e4ff2f8a13971875246eb33430e60a44f552d0770b52264a06660790`.

The comparison preserves exact complete row serialization, owners, column
types/defaults, constraint and index definitions, triggers, function definitions
(including security mode and per-function settings), role attributes,
memberships, and the required database search path. It uses PostgreSQL's own
`acldefault`/`aclexplode` to compare grantor, grantee, privilege and grantability
after default-ACL expansion. It compares live-column order rather than physical
positions left by dropped columns, and uses `pg_get_constraintdef(oid, true)`
for PostgreSQL's canonical pretty deparse. No SQL expression text is rewritten.

To repeat this local procedure:

1. Prepare a new isolated PostgreSQL 16 fixture database, apply the current
   migrations and exact ingestion grant policy, revoke default PUBLIC access,
   and pass `pnpm ingestion:postgres:check`. Verify the database name, loopback
   address, port, server version and owned cluster directory before proceeding.
   Require only the four fictional source domains and the known two test roles.
2. Open a repeatable-read, read-only source transaction and export its snapshot
   using `SELECT pg_export_snapshot()`. Keep that session open through the dump.
   Inventory every `data_foundry` table using complete `to_jsonb(record)::text`
   rows in deterministic order, sequence values, schema catalogs and a selected
   canonical query at one fixed timestamp. Bound row and byte counts.
3. Verify the new destination port is unused. Initialize a fresh owned
   `mktemp` directory with PostgreSQL 16 `initdb`, explicit UTF-8 and the source
   locale. Start it on loopback only. Create the same database and explicitly
   recreate only the known test role flags and exact database search path;
   do not copy password catalogs or use a shared cluster.
4. Run the following through the local native PostgreSQL binaries. The snapshot
   identifier comes from step 2; the dump stays inside the verified private
   destination directory with a restrictive umask:

   ```text
   pg_dump -h 127.0.0.1 -p 25439 -U adam -d data_foundry --format=custom --snapshot=SNAPSHOT_ID --file=OWNED_DESTINATION/fixture.dump
   pg_restore -h 127.0.0.1 -p 25441 -U adam -d data_foundry --exit-on-error --single-transaction OWNED_DESTINATION/fixture.dump
   ```

5. Compare all rows, the full migration ledger, sequence states, and the catalog
   and role inventory under the rules above. Compare the selected query through
   the shared canonical query layer and the direct ingestion login. Assert zero
   effective private-function EXECUTE privileges for that login. Close the
   source snapshot, re-read the source, and confirm it did not change.
6. Capture only counts, hashes, timing and boolean outcomes. Close connections,
   stop only the owned destination cluster, verify its absolute directory, and
   remove only that destination and dump. Assert removal before recording PASS.

The one-off implementation and receipt are intentionally ignored local files:
`.data/backup-restore-control.ts` and `.data/local-backup-receipt.json`.
The executed harness SHA-256 was
`5265a451baf376b1fecded5684bb6fe9c052d5667f9fd2a5ae60c9cd320bab4f`.
Its command was `corepack pnpm exec tsx .data/backup-restore-control.ts`, with
the explicit local-only flag `DATA_FOUNDRY_LOCAL_BACKUP_TEST=1`. A future checkout
must prepare and review its own isolated harness from the procedure above.

The small fixture timing is not a capacity or recovery promise. The dump covers
the database and its artifact metadata; the synthetic raw bytes were held by the
ingestion test's in-memory object store and were not included. Hosted database
backups, actual object retention/restoration, production-scale recovery and
measured recovery objectives remain separate launch requirements.
