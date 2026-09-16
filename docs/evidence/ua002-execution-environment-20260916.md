# UA-002 execution environment — measured 2026-09-16

Everything the release needs is prepared and verified. What is missing is not
code, a checksum or a decision: it is **a machine that can open a PostgreSQL
session to the project origin while holding the `df_migration` credential**.

This record establishes that by measurement, so the next session does not repeat
the search, and names the one external capability that would unblock the run.

No mutation was attempted. Every database observation below came through the
read-only management connector, and the connector's read-only posture is
unchanged.

## 1. The hosted baseline has not drifted

Read-only, against project `fgxinxaqkwoqyywdgobs` (`us-west-1`, PostgreSQL
15.14):

| Measurement | Value | Expected |
| --- | --- | --- |
| Ledger rows | 26 (`0001`–`0026`) | 26 |
| `data_foundry` tables / views / functions | 46 / 3 / 57 | 46 / 3 / 57 |
| `SECURITY DEFINER` functions | 0 | 0 |
| Functions carrying `proconfig` | 0 | 0 — `0027` is what sets them |
| `public` tables | 7 | 7, untouched |
| `df_*` roles | 6 | 6 |
| `df_ingestion` present | no | no — `0027`–`0033` stage it |
| `df_*` roles with LOGIN | 0 | 0 |

That fourth row is worth keeping: it is the measurement that made a proposed
`function-posture` search-path preflight a false blocker rather than a check.
All 57 functions still carry no `proconfig`, because migration `0027` is what
sets it. A preflight comparing them to the canonical search path today would
raise 57 blockers and make the catch-up impossible to start.

## 2. The hosted ledger is byte-identical to the release

The 26 applied rows were read from `data_foundry.schema_migrations` and compared
against the checksums the merged release computes for the same files:

```
hosted ledger rows: 26 (0001..0026)
hosted vs release: 26 hosted rows, 26 release rows, 0 differing
```

So the hosted database and release `2063ea8` agree exactly on everything already
applied. There is no drift to reconcile before the pending seven.

## 3. The prepared artifacts reproduce from the real hosted ledger

The documented sequence was run end to end at the named release — clean detached
checkout at `2063ea8d72247a9b2643e1c690e37ab55ab14252`, the **real** hosted
ledger supplied via `--applied-ledger`, manifest written to a `mktemp -d`
directory outside the checkout:

| Value | Result |
| --- | --- |
| Repository / applied / pending | **33 / 26 / 7** |
| `repositoryDigest` | matches |
| Grant roles / signatures / expected grants | 6 / 59 / 286, all match |
| `postMigrationGrants` checksum | matches |
| `upgradeFrom0028Checksum` | matches |
| Pending checksums `0027`–`0033` | **7 / 7 match** |

All ten documented rows reproduce. The worktree stayed clean throughout, so the
exporter's own source-identity guard passed rather than being worked around.

## 4. The operator stops at exactly one place

Run against that manifest from the same clean checkout:

```
$ DATA_FOUNDRY_RELEASE_SHA=2063ea8... tsx tooling/scripts/ua002-direct-tls-operator.ts \
    --packet <manifest outside the repo>
Error: DATA_FOUNDRY_MIGRATION_DATABASE_URL is required; this runner never takes
a credential as an argument.
```

Packet parsing, the release-SHA guard and the clean-checkout identity guard all
passed before this. The credential is the first and only thing missing.

## 5. The three role prerequisites, re-measured

| Role | LOGIN | INHERIT | Privileged | Role-global `search_path` row | Current-database row |
| --- | --- | --- | --- | --- | --- |
| `df_migration` | no | no | no | **1 (forbidden)** | **0 (required)** |
| `df_edge` | no | no | no | **1** | **0** |
| `df_web` | no | no | no | **1** | **0** |
| `df_mcp` | no | no | no | **1** | **0** |
| `df_usage` | no | no | no | **1** | **0** |
| `df_acquisition` | no | no | no | **1** | **0** |

Twelve violations, unchanged: every role carries the all-databases form
(`setdatabase = 0`), which follows the role into every other database on the
instance, and none carries the per-database row the grant upgrade requires. The
grant packet raises on exactly this — and it raises *after* the migrations would
already have applied, which is why the operator checks it up front.

`df_ingestion` does not exist yet. `df_migration` is `NOLOGIN` with no password.
None of this can be repaired by `df_migration` itself: it is `NOCREATEROLE` and
can alter only its own settings.

**One role does hold the membership:** `postgres` is a member of `df_migration`
(no admin option, LOGIN, not superuser). That is the session
[`ua-002-provider-staging.sql`](../owner-actions/ua-002-provider-staging.sql) is
written for. It does **not** make `SET ROLE` an execution path — the operator
requires `session_user` and `current_user` to both equal `df_migration` and
rejects `SET ROLE` deliberately, which is reviewed and unchanged here.

## 6. Why no connected tooling can execute it

Each candidate was checked rather than assumed.

**Another session in another environment — no.** `list_environments` returns
exactly one environment, `env_01WCTzdGoo2N1mfRrfG7PcJw` ("APEx",
`anthropic_cloud`), and `get_session` confirms it is the environment this
session already runs in. A sibling session inherits the same network policy, so
it is the same container by another name.

**Direct TLS from here — structurally impossible, not merely blocked.**

```
db.fgxinxaqkwoqyywdgobs.supabase.co
  AAAA -> 2600:1f1c:825:9500:de6d:a3aa:4fb1:e23b
  A    -> gaierror [Errno -5] No address associated with hostname
container IPv6 addresses: 0
```

The origin is IPv6-only and this container has no IPv6 stack at all. Separately,
outbound traffic is mediated by an HTTPS agent proxy
(`bundleCoversEveryHost: true`, no raw-TCP relay), and an attempt to open a raw
TCP socket to the IPv4 Supavisor addresses was refused by the sandbox as a
containment escape. The restriction is policy, not routing, so no amount of
retrying or re-addressing changes it.

**The management connector — no, and deliberately not retried.** Re-measured
today: `current_user` and `session_user` are both `supabase_read_only_user`,
`transaction_read_only` is `on`, `default_transaction_read_only` is `on`, and it
holds no membership in `df_migration`. The owner decision is to preserve that
read-only posture, so only reads were issued.

**A Cloudflare Worker with Hyperdrive — forbidden.** The standing constraint is
that the migration principal is never bound to any Worker. The Cloudflare
connector is also unauthenticated in this session.

**A Vercel function — rejected on judgement, not capability.** It could plausibly
reach PostgreSQL, but it would mean minting a new deployment and placing the
migration credential into a hosting provider nobody approved for that purpose. It
creates a new secret-handling surface to avoid asking a question, which is worse
than asking.

## 7. The one capability needed

> **A host with PostgreSQL egress to the project origin, running the release at
> `2063ea8`, with the `df_migration` password available to libpq without
> appearing in a command line.**

Everything else is done. Concretely, that host needs:

- **Network.** Either an IPv6 route to `db.fgxinxaqkwoqyywdgobs.supabase.co`, or
  the IPv4 Supavisor pooler in **session mode (port 5432)**. Transaction mode
  (6543) will not work: the runner asserts `session_replication_role = origin`
  and `lo_compat_privileges = off` and applies each migration in its own
  transaction, and transaction pooling does not preserve session state. The
  pooler's role name is project-qualified rather than bare — confirm the exact
  form against the project's connect dialog at the time, rather than assuming it.
- **Runtime.** Node 22+ and `pnpm`, a clean checkout at `2063ea8`.
- **Credential.** Supplied through `.pgpass`, a libpq service file, or
  environment injection — never as an argument, never in a file in the
  repository, never in an evidence record such as this one.

Any ordinary developer machine with internet access and the password satisfies
this. It does not need new infrastructure, and it is not a reason to change the
operator.

## 8. What happens once that host exists

Unchanged from the handover, and bounded:

1. `ua-002-provider-staging.sql` once, in a privileged provider session.
2. Fresh operator preflight — read-only, exit 2 means blockers and nothing was
   touched.
3. `--apply`: migrations `0027`–`0033`, then the grant upgrade rebuilt from the
   release, then verification, in that order.

Stop rather than continue on unexpected drift, a failed preflight, an unverified
transaction state, or a release mismatch.
