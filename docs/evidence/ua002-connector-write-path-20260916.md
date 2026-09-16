# UA-002 — the approved connector path is read-only, measured 16 September 2026

Status: **the owner-approved database exception could not be executed.** No
migration was applied, no grant was changed, no role was created, and nothing
was written to the hosted project. The single write attempted was an
authorization probe, and it failed closed before any statement of consequence.

This record exists because the exception was approved in good faith on an
assumption that turned out to be stale: that the management connector still
carries the write authority it demonstrably carried on 2 September 2026. It no
longer does. The assumption, not the approval, is what changed.

## Order of work

The exception's safety conditions required precondition verification before the
first mutation, exact checksums from the selected Git object, and a stop if the
hosted baseline differed materially from the reviewed expected state. All three
were performed first. The baseline was clean; the interface was not.

## 1. Hosted baseline — verified, no drift

Read 2026-09-16T16:16:23Z against project `fgxinxaqkwoqyywdgobs`, schema
`data_foundry`. Every value matched the reviewed expected state exactly.

| Property | Expected | Observed |
| --- | --- | --- |
| Ledger range | `0001`–`0026` | `0001`–`0026` |
| Ledger marker | `data-foundry:schema_migrations:v1` | matched |
| Tables | 46 | 46 |
| Views | 3 | 3 |
| Functions | 57 | 57 |
| `SECURITY DEFINER` functions | 0 | 0 |
| Objects not owned by `df_migration` | 0 | 0 |
| `df_*` roles | 6, all `NOLOGIN`, non-privileged | matched |
| `df_ingestion` exists | false | false |
| `public` schema | untouched, 7 tables | untouched, 7 tables |
| Non-zero row counts | `api_route_keys`, `schema_migrations` | `api_route_keys: 14`, `schema_migrations: 26` |

**There is no drift.** The database is exactly where the review left it. That
matters for the handover: the prepared artefacts are valid against this state
and do not need to be re-derived.

## 2. Migration artefacts — regenerated and independently verified

Exported from the merged release `eb7e998e6d4a574fa735d8ff54014cde18c25e27`
against the ledger snapshot above:

- 33 repository migrations, 26 applied, **7 pending**.
- `repositoryDigest` `8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`.
- `sourceIdentity.relevantInputsClean: true`; `releaseSha` equals `headSha`.
- Grant packet covers six roles including `df_ingestion`, 59 function
  signatures and **286 expected grants**.

Each pending packet checksum was then recomputed **independently of the
exporter**, directly from the Git blob at that SHA, as
`sha256("data-foundry-private-schema-v1\0" || blob)`:

| Version | File | Checksum | Verified |
| --- | --- | --- | --- |
| 0027 | `0027_runtime_security_hardening.sql` | `8ebfb172feb2b9e8c5b04056b7153d830e9d93230b46c62762bc435e8531da2a` | ✅ |
| 0028 | `0028_audited_foreign_key_indexes.sql` | `7a70c3ca21a82f7d0090fa85996fc9415bb7d41840bea76314e92d40994dabbe` | ✅ |
| 0029 | `0029_ingestion_delivery.sql` | `1cf18cf40e2fb1d8096f446daf088fc163b25262bd64f5a73e05f599d23ca6ae` | ✅ |
| 0030 | `0030_operator_actions.sql` | `19021ff6233773e5e4acfd62dcbf0370f120fac98a8b65f66020f6e7f802282e` | ✅ |
| 0031 | `0031_operation_alerts.sql` | `9ccb1bb09c1db9d08a098d8cf62e3253397fa9d1db16dfca93406e8d499c496e` | ✅ |
| 0032 | `0032_current_alias_source_projection.sql` | `dab8727d2ea7f686228002ab3f063d9f6681749a39f73d3fa8bf5164ca5bcf67` | ✅ |
| 0033 | `0033_not_modified_claim_boundary.sql` | `23a6eed8170286550e85784b8563f1dada52f8b2a98da81f2cd897845cbb6b88` | ✅ |

7 matched, 0 mismatched. The grant packet's own checksum is
`b6c7e197aac427b21e232a988567b8d180ef6cc767a3e7cd691eb61febc8413c`, and the
exact-baseline upgrade path is
`d73fe6718648ff459cb416d2b665496f841c4a430bc06647c6c55013dd04dd65`.

## 3. The stop

The exception required migration behaviour equivalent to the demonstrated
September transaction behaviour. That behaviour depends on assuming the
migration owner, because every private object is owned by `df_migration` and
the connector identity is not that role. The probe:

```
SET LOCAL ROLE df_migration;
→ ERROR: 42501: permission denied to set role "df_migration"
```

Investigation of why, all read-only:

| Probe | Result |
| --- | --- |
| `current_user` / `session_user` | `supabase_read_only_user` (was `postgres` on 2 September) |
| Role memberships | `pg_monitor`, `pg_read_all_data` only |
| Superuser | no |
| `pg_has_role(current_user, 'df_migration', 'MEMBER')` | **false** |
| Members of `df_migration` | `postgres` only |
| `has_schema_privilege('data_foundry', 'CREATE')` | **false** |
| `has_table_privilege('data_foundry.schema_migrations', 'INSERT')` | **false** |
| `has_schema_privilege('data_foundry', 'USAGE')` | true |
| `has_table_privilege('data_foundry.schema_migrations', 'SELECT')` | true |
| `pg_is_in_recovery()` | **false** |
| `transaction_read_only` | **on** |
| `default_transaction_read_only` | **on** |

Two independent layers block writes, and they are not the same layer:

1. **Identity.** The connector authenticates as a read-only role with no path
   to `df_migration`. Even in a writable session it could not own the objects
   the migrations alter.
2. **Session posture.** `default_transaction_read_only` is `on` while
   `pg_is_in_recovery()` is `false`. This is not a standby or a failover
   artefact — it is deliberate configuration of a primary.

Supabase documents the control: the MCP server accepts a `read_only=true` URL
parameter which "execute[s] all queries as a read-only Postgres user", and it
combines with `project_ref=<id>`, which "scope[s] to a specific project
(disables account tools)". The observed identity and posture are exactly what
that parameter produces.

## Why this was not worked around

Because it is a safety control that someone deliberately turned on, and the
standing instruction for this work is that approval to use a connector is not
approval to bypass a security control. There is no technically clever path here
that is also an honest one: any route around `read_only=true` is a route around
the decision it encodes.

Equally, this is a **capability limit, not a refusal**. The work the exception
authorized is prepared, checksum-verified and ready. What is missing is a write
interface, and the two ways to obtain one — with their real costs — are set out
in [the handover](../owner-actions/ua-002-hosted-migration-handover.md).

## What must not be concluded from this record

- Not that the migrations are risky or wrong. They are unapplied, not rejected.
- Not that the hosted database is broken. It is healthy and undrifted.
- Not that runtime credentials or Hyperdrives moved. They did not, and database
  progress would not have implied they had.
