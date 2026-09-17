# UA-002 hosted catch-up — consolidated execution packet

**Verdict: READY_FOR_SCOPED_EXECUTION, gated on one owner action.**

Everything engineering can settle is settled and re-measured today. What
remains is not code, a checksum, a version decision or a schema repair: it is a
**`df_migration` login credential plus a host with a PostgreSQL route to the
project origin**. That is an owner action, and it is the only one.

Measured 2026-09-17 through the read-only management connector
(`current_user` = `supabase_read_only_user`). No mutation was attempted and the
connector's read-only posture is unchanged.

---

## 1. Identity, and the version question answered rather than assumed

| Fact | Value |
| --- | --- |
| Project | `fgxinxaqkwoqyywdgobs`, named **`data-foundry`**, region `us-west-1` |
| Organization | `libfwgpwbsxsbtclpruc` — **not** the Valor org |
| Server | **PostgreSQL 15.14**, `server_version_num` `150014`, engine 15 |
| Origin address | `inet_server_addr()` returns an **IPv6** address |

The project is the one the repository documents:
`PROGRESS.md` names it as the database target, and
`docs/owner-actions/cloudflare-deployment.md` states it is
"`fgxinxaqkwoqyywdgobs`, not Valor". The organization separation is deliberate,
not drift. `list_organizations` returns only Valor, which is why the project
does not appear in a default project listing — access to it is nonetheless
confirmed.

### PostgreSQL 15 needs no upgrade — proven, not assumed

The repository's CI proves PostgreSQL **16**. The target runs **15**. That gap
was closed by running the release against a real PostgreSQL 15, rather than by
reasoning about it or by proposing an upgrade.

Disposable PostgreSQL **15.19** cluster, certificate-verified TLS, an HBA that
rejects non-TLS TCP, and the CI job's own narrow `df_migration` bootstrap. The
runner was executed from a **clean detached checkout at the release**
`2063ea8d72247a9b2643e1c690e37ab55ab14252`, because it requires
`DATA_FOUNDRY_RELEASE_SHA` to equal `HEAD` with a clean worktree:

```
### 3. Apply all 33 migrations with the release's own runner
Applying 33 migration(s) to postgres (direct TLS)
  apply 0001_verticals_and_sources.sql (70ms)
  … all 33 applied …

### 4. Re-apply must be a no-op
  skip 0001 … skip 0033 (already applied)

### 5. Ledger and object inventory on PostgreSQL 15
ledger_rows=33
max_version=0033
tables=51
views=3
functions=59
functions_with_proconfig=59
security_definer=0
```

**No major-version upgrade is required.** All 33 migrations apply, re-apply is
a clean no-op, and the resulting object inventory is exactly what the release
intends.

Two refusals encountered on the way are worth recording, because both were the
release's own controls working correctly rather than PostgreSQL 15 defects:

- Running from the working tree at a different SHA produced an unclassified
  `Direct PostgreSQL migration failed.` — the release-SHA/clean-worktree guard.
- A bootstrap missing `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`
  produced `[migration-role-external-capability]`. `df_migration` inherits
  PUBLIC's CONNECT on `postgres` and `template1`, and the release refuses to
  migrate while it holds external CONNECT it should not.

## 2. The ledger agrees with the release exactly

```
repository migrations: 33
hosted ledger rows:    26   (0001 … 0026)
differing:             0
```

Computed with the repository's own `effectiveMigrationChecksum`, not a
reimplementation. **A naive raw-file SHA-256 reports all 26 rows differing and
is wrong**: this install uses the private `data_foundry` schema, so the ledger
stores `sha256(transform_version ‖ NUL ‖ scoped_sql)`. Anyone re-checking this
must use the release's function or they will manufacture a drift blocker that
does not exist.

**Pending (7):** `0027_runtime_security_hardening`,
`0028_audited_foreign_key_indexes`, `0029_ingestion_delivery`,
`0030_operator_actions`, `0031_operation_alerts`,
`0032_current_alias_source_projection`, `0033_not_modified_claim_boundary`.

### Release reference conflict, resolved without repinning

`PROGRESS.md` says UA-002 was "rebound to `1a37241`"; the handover is bound to
`2063ea8`. Resolved by measurement rather than by moving the pin to latest
`main`:

```
git diff 2063ea8..41dd2ec -- db/migrations/                     (empty)
git diff 2063ea8..41dd2ec -- tooling/scripts/migrate.ts
                              tooling/scripts/export-supabase-migration-packets.ts
                              packages/canonical-store/                (empty)
```

Migrations, runner, exporter and canonical store are **byte-identical** at
`2063ea8` and current `main`. Every migration-derived value is therefore the
same at either SHA, so there is no correctness reason to move the pin — and a
strong reason not to: the published checksums, `repositoryDigest` and grant
values are all computed at `2063ea8`, and moving it invalidates them for no
benefit. **`2063ea8` stands.** The PROGRESS wording describes re-verification
performed while `main` happened to be at `1a37241`, not a change of pin.

## 3. Role posture — the actual blocker

| Role | LOGIN | SUPERUSER | BYPASSRLS | Memberships |
| --- | --- | --- | --- | --- |
| `df_migration` | **false** | false | false | 0 |
| `df_acquisition`, `df_edge`, `df_mcp`, `df_usage`, `df_web` | **false** | false | false | 0 |

Six `df_*` roles exist, all `NOLOGIN`, none privileged. `df_ingestion` is
absent — migrations `0027`–`0033` stage it. `df_migration` already carries the
canonical durable search path
`data_foundry, pg_catalog, extensions`.

**Nothing can connect as `df_migration` today.** That is the dependency.

## 4. Two advisor findings that are not what they look like

### The 57 mutable search paths are what `0027` repairs

All 57 are `data_foundry` functions, and every one carries no `proconfig`
because **migration `0027` is what sets it**. The PostgreSQL 15 run above ends
at `functions_with_proconfig=59` — i.e. after the catch-up every function is
pinned.

A preflight that compared these against the canonical search path *before* the
catch-up would raise 57 blockers and make the catch-up impossible to start.
**It must not be added.**

### Disabled RLS on private tables is not public exposure

```
schema        anon USAGE   authenticated USAGE   service_role USAGE
data_foundry  false        false                 false
```

`data_foundry`'s ACL grants `USAGE` to the six `df_*` roles only. No PostgREST
role can reach the schema, so RLS state on its tables is not an exposure
question. Supabase's own linter agrees: `rls_disabled_in_public` returns
**exactly one** finding, and it is not a Data Foundry table.

## 5. `public.automation_runs` — triaged separately, and it is not ours

| Property | Value |
| --- | --- |
| Owner | `postgres` |
| RLS | **disabled**, 0 policies |
| ACL | `anon=arwdDxt`, `authenticated=arwdDxt`, `service_role=arwdDxt` |
| Rows | **5**, all created 2025-02-16 |
| Triggers / FKs in / FKs out / views / referencing functions | **0 / 0 / 0 / 0 / 0** |

Columns are `eso_status`, `zoll_status`, `eso_data`, `zoll_data`,
`error_message`, `email_receipt_url`, `email_data` — an **ESO/ZOLL EMS
automation experiment**, not Data Foundry. Row contents were not read; only
counts, timestamps and structure.

This is the project's one ERROR-level finding: `anon` holds full CRUD
(`arwdDxt`) with RLS off, on a table carrying JSONB payloads and an email
receipt URL. It has been inert for roughly nineteen months and nothing depends
on it.

**Smallest containment, proposed and deliberately not executed** — it is another
owner's table and this scope forbids modifying the shared `public` schema:

```sql
-- Least-change option: remove anonymous reach, keep service_role working.
REVOKE ALL PRIVILEGES ON TABLE public.automation_runs FROM anon, authenticated;
-- Belt and braces, since the table is abandoned:
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
```

Both are single statements, reversible, and safe precisely because the
dependency count is zero. The decision belongs to whoever owns that workload.

The six `rise_*` tables are a different application again. Five have RLS
enabled; three of those have no policies, which is deny-all rather than
exposure. None is Data Foundry's.

## 6. Cloudflare — UNKNOWN

No Cloudflare connector is available in this session, no Cloudflare credential
is present in the environment, and `wrangler whoami` reports **not
authenticated**.

Current Worker, Hyperdrive, R2, Queue, route and DNS state is therefore
**unknown**. The historical inventories in the repository are point-in-time
records and are **not** restated here as current fact.

## 7. The execution packet

**Release** `2063ea8d72247a9b2643e1c690e37ab55ab14252` (unchanged).

**Pending changes** the 7 migrations listed above, plus the grant payload the
exporter rebuilds from that release.

**Prerequisites**
1. A `df_migration` **LOGIN** credential — created by the owner in the provider
   console, never passed through chat, an argument or an environment variable.
2. A host with a PostgreSQL route to `db.fgxinxaqkwoqyywdgobs.supabase.co`. The
   origin resolves IPv6-only; an IPv4-only host needs the Supavisor pooler
   route, which changes the login name to the project-qualified form.
3. The credential placed with
   `tooling/scripts/ua002-migration-pgpassfile.sh`, digest-verified at the
   point of use, then `--check` before the run.

**Recovery** each migration runs in its own transaction with a
rollback-before-ledger check; a partial failure rolls back and refuses to
report success. Re-running skips ledgered versions, so a failed attempt is
resumable rather than destructive. A checksum mismatch is a hard error.

**Success checks**
- ledger reaches **33** rows, `max_version = 0033`
- `functions_with_proconfig` reaches **59** (this is the 57-warning repair)
- `security_definer` stays **0**
- `df_ingestion` exists with its exact grant packet
- object inventory reaches **51 tables / 3 views / 59 functions**

Those five numbers are not predictions from documentation — they are what the
release actually produced on PostgreSQL 15 today.

**Genuinely missing owner authorizations**
1. The `df_migration` credential and the network route. **Blocking.**
2. A decision on `public.automation_runs` by its owner. **Not blocking UA-002**;
   separate and worth doing.
3. Cloudflare credentials, if any Cloudflare observation is wanted. **Not
   blocking the database catch-up.**

## What this is not

This is a **local PostgreSQL 15 compatibility proof plus a read-only hosted
reconciliation**. It is not a hosted migration, not a certification of the
hosted database, and not evidence that anything was applied there. Nothing
hosted was modified. No credential was created, requested, used or rotated.
