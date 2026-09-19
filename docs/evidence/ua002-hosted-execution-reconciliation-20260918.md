# UA-002 hosted execution independently reconciled — 2026-09-18

**Scope.** A second, independent, read-only reconciliation of the hosted UA-002
execution that a separate session performed earlier on 2026-09-18 (migrations
`0027`–`0033`, runtime credentials, six Hyperdrives, five private-canary queues,
the receipt bucket, seven route-less private-canary Workers, and one successful
private-canary cycle). Nothing in this record was taken from that session's
prose without re-reading it from the provider or the hosted database. Where a
claim could not be re-read with the available read-only tooling, it is marked
**NOT INDEPENDENTLY READ BACK** rather than repeated as fact.

**Repository at reconciliation.** Protected `main` `55804842f5c5131640dd0435c7d203a66e95b63c`
(clean worktree; the one stray untracked draft that was breaking `pnpm typecheck`
locally was moved out of the checkout — see "Local verification"). Release pin for
migrations, runner, exporter and canonical store: `2063ea8d72247a9b2643e1c690e37ab55ab14252`;
those paths are byte-identical between the two SHAs, and so are the seven private-canary
application bundles (proved below).

**Evidence classification.** Everything under "Database" and "Cloudflare" was
**read back** in this session. "Reported by the executing session" items are
listed separately at the end and are not restated as verified.

**What this is not.** Private-canary success on route-less temporary Workers.
It is not an ordinary production deployment, not a public cutover, not source
activation, and not a commercial launch. No public hostname, route, Cron,
ordinary Worker, real source, billing configuration or DNS record was created
or changed, by that session or by this one.

---

## Database (Supabase project `fgxinxaqkwoqyywdgobs`, PostgreSQL 15.14, `ACTIVE_HEALTHY`)

Read through the management connector's `execute_sql`, which authenticates as
`supabase_read_only_user` inside a read-only transaction; observed at
`2026-09-18T16:09:29Z`. No statement mutated anything.

### Ledger

| Check | Result |
| --- | --- |
| `data_foundry.schema_migrations` rows | **33**, first `0001`, last `0033` |
| Ledger marker / columns / primary key | `data-foundry:schema_migrations:v1`; canonical five columns; primary key on `version` |
| `0027`–`0033` `applied_at` | `2026-09-18T14:06:06.766Z` → `2026-09-18T14:06:12.106Z`, one row per second, `execution_ms` 679–907 |
| `0001`–`0026` | unchanged from the 2026-09-01/02 rows |
| Release exporter at `2063ea8` run against a snapshot of these 33 rows | `repositoryMigrationCount 33`, `appliedMigrationCount 33`, `pendingMigrationCount 0`, `repositoryDigest 8097711644f0b4ecdd91c21b2ba512b29bd4451597af4946f4bee6bf81871d8d`, `upgradeFrom0028Checksum d73fe6718648ff459cb416d2b665496f841c4a430bc06647c6c55013dd04dd65` |
| Release ledger-drift query (`expected` vs `actual`, all 33 effective checksums) | **empty result — 0 missing, 0 unexpected or mismatched** |

Ledger snapshot digest (version, filename, checksum only): sha256
`6064cc2ba06ac85285e5922b00c87ce782e54397ceb36ad845034d305d7d23b5`. Exported
manifest digest: sha256 `f105da138667c62dffcc86c1dc8417a55407a52d98aa01db220592748d358972`.
Neither file contains a credential; both were kept outside the repository.

### The release's own `postCredentialVerificationSql`, executed read-only

The manifest's `postMigrationGrants.postCredentialVerificationSql` (the LOGIN
form, since the runtime roles are now active) was split at its statement
boundaries and every statement was executed as the release generated it. The
two `DO` blocks raise on drift and returned without error; the `SELECT`
statements returned the values below.

| Assertion | Result |
| --- | --- |
| Migration-role confinement `DO` block (posture, durable settings, session, default ACLs, external direct ACLs, reachable external capability, external owned objects) | **passed, no exception** |
| Complete private direct ACL for the six runtime roles | `missing 0`, `unexpected 0`, **286 live / 286 expected** |
| Relation inventory (55 expected relations, all owned by `df_migration`) | `0` differences |
| Function inventory (59 signatures, owned by `df_migration`, `proconfig = search_path=data_foundry, pg_catalog, extensions`) | `0` differences; `security_definer_count 0`; `function_search_path_difference_count 0` |
| Migration-role default object ACLs | `0` unsafe |
| Runtime-role durable settings (exactly one current-database row each, no role-global row) | `0` unsafe |
| `PUBLIC` / null-ACL privileges on private objects | `0` |
| `public` schema `CREATE` for `PUBLIC` | `false` |
| Six runtime roles LOGIN, NOINHERIT, non-superuser, non-createdb, non-createrole, non-replication, non-bypassrls | `true` (6 of 6); no incoming or outgoing membership |
| Runtime-role external direct ACLs | exactly the 12 expected rows: non-grantable `CONNECT` on the current database and non-grantable `USAGE` on `extensions`, per role; `0` drift |
| Runtime-role reachable external capability (other databases, other schemas, FDW/servers, extensions, owned objects, large objects, parameters) | `0` |
| `df_migration` private schema privileges / function `EXECUTE` | `CREATE,USAGE`; 59 non-grantable `EXECUTE`; `0` grantable relation privileges |
| Private grants to any non-`df_*` role (relations, columns, functions) | `0` |
| `public` schema ACL fingerprint | `{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,postgres=U/pg_database_owner,anon=U/pg_database_owner,authenticated=U/pg_database_owner,service_role=U/pg_database_owner}` (untouched shared schema) |

Object counts corroborate the local PostgreSQL 15 proof from 2026-09-17: 51 tables,
3 views, 59 functions, `security_definer 0`, `functions_with_proconfig 59`.
Schema owner: `df_migration`. Private-schema ACL: `USAGE` for the six runtime
roles, `USAGE,CREATE` for `df_migration`, nothing for `anon`, `authenticated`,
`service_role` or `PUBLIC`.

### Roles

| Role | LOGIN | INHERIT | super / createrole / createdb / replication / bypassrls | member of | durable setting |
| --- | :-: | :-: | :-: | --- | --- |
| `df_acquisition` | yes | no | none | — | `postgres: search_path=data_foundry, pg_catalog, extensions` |
| `df_edge` | yes | no | none | — | same |
| `df_ingestion` | yes | no | none | — | same |
| `df_mcp` | yes | no | none | — | same |
| `df_migration` | yes | no | none | — | same |
| `df_usage` | yes | no | none | — | same |
| `df_web` | yes | no | none | — | same |

`df_migration` remains `LOGIN` after the run; the runbook does not require
deactivation, and it is the credential the operator would need again for a
replay or a forward fix. Whether to park it is a Part 2 decision, recorded
there rather than acted on here.

### Provider ledger and fixture cleanup

The provider migration ledger holds the two Data Foundry rows expected
(`20260901001729 data_foundry_private_schema_role_skeleton`,
`20260918001016 ua_002_provider_staging`) and nothing else attributable to
this project; the application migrations correctly left no provider-ledger row
because they ran through the direct-TLS operator, not `apply_migration`.

Private-canary fixture residue: `verticals` slug `private-canary-*` 0,
`api_tenants` 0, `api_keys` with `canaryedge`/`canarymcp` prefixes 0,
`api_usage_events` 0. All four tables are empty in total. **Cleanup verified.**

---

## Cloudflare (account `c2832821a9ab36419cde6ee08112f6d3`)

Read through the Cloudflare bindings connector and an authenticated `wrangler
4.127.1` (the pinned devDependency) using only read commands: `whoami`,
`hyperdrive`/`workers`/`r2` listings, `queues list`, `queues info`, `versions
list`, `versions view`, `deployments list`, `cert list`, `r2 object get`, and
the connector's Worker source download. No deploy, create, update or delete was
issued.

### Hyperdrives — six, exact

| Name | ID | Origin user | Created / last modified (UTC) |
| --- | --- | --- | --- |
| `df-edge` | `a3c7014d62d04165bb06a3988a2b5729` | `df_edge.fgxinxaqkwoqyywdgobs` | 14:38:17 / 14:50:30 |
| `df-web` | `574ab2f0442b42558bc7a52a835d6fa8` | `df_web.fgxinxaqkwoqyywdgobs` | 14:41:09 / 14:51:18 |
| `df-mcp` | `ff4f6dfc29154e679ace7476bb0e74ab` | `df_mcp.fgxinxaqkwoqyywdgobs` | 14:42:08 / 14:51:21 |
| `df-usage` | `15a92d9ef2eb4b31814abb51fcd4acf9` | `df_usage.fgxinxaqkwoqyywdgobs` | 14:42:51 / 14:51:24 |
| `df-acquire` | `d40b41e504024a7698836e21ea9a8ff2` | `df_acquisition.fgxinxaqkwoqyywdgobs` | 14:43:32 / 14:51:27 |
| `df-ingestion` | `c9d4a85c587c43bba646c4aed5f178a5` | `df_ingestion.fgxinxaqkwoqyywdgobs` | 14:44:22 / 14:51:29 |

All six, identically: origin `aws-0-us-west-1.pooler.supabase.com:5432`,
database `postgres`, scheme `postgres`, `origin_connection_limit 60`,
**`caching.disabled: true`**, **`mtls.sslmode: verify-full`**,
`mtls.ca_certificate_id 4856c681-5728-4008-8b1c-41323ce203bc`. The
`modified_on` stamps (14:50–14:51Z, after every `created_on`) are consistent
with the executing session's account of correcting caching and TLS mode before
the canary; the corrected state is what exists now.

CA certificate read back with `wrangler cert list`: ID
`4856c681-5728-4008-8b1c-41323ce203bc`, name `data-foundry-supabase-root-2021`,
issuer `CN=Supabase Root 2021 CA, O=Supabase Inc`, created 2026-09-18, expires
**2031-04-26**, `CA: true`.

This machine reaches the IPv4 pooler on 5432 and 6543 (plain TCP connect, no
credential) — unlike the earlier restricted container — which is why a direct
migration was possible from an ordinary developer host, exactly as the handover
said it would be.

### Queues — five dedicated plus the untouched ordinary pair

| Queue | ID | Created (UTC) | Producers | Consumers |
| --- | --- | --- | --- | --- |
| `data-foundry-private-canary-usage-events` | `885c1cc5bfc844369ab62593cb9f9f37` | 14:54:36 | `data-foundry-private-canary-edge`, `data-foundry-private-canary-mcp-hvac` | `data-foundry-private-canary-usage-consumer` |
| `data-foundry-private-canary-usage-events-dlq` | `4c28b7fa8da64870a469a894400a0480` | 14:54:40 | none | none |
| `data-foundry-private-canary-events` | `2ed5af96f0344adfa2854c330e6605c3` | 14:54:43 | none (fixture-only ingress) | `data-foundry-private-canary-usage-consumer` |
| `data-foundry-private-canary-dlq` | `eb33fcbd0d604814816cb0c0320465fc` | 14:54:45 | none | `data-foundry-private-canary` |
| `data-foundry-private-canary-quarantine` | `c88a2e60524947ab9c4e56df6c1f5ce5` | 14:54:48 | none | none |
| `data-foundry-usage-events` (ordinary) | `a24850363e8e4e94b9e290d66f98e906` | 2026-09-01 | none | none |
| `data-foundry-usage-events-dlq` (ordinary) | `2b08643cee734c2c9f498a9ec04f3e84` | 2026-09-01 | none | none |

The producer/consumer topology matches the runbook's table exactly, and the
ordinary pair has no private-canary producer or consumer attached. Consumer
settings deployed with the Workers match the tracked manifests (usage
consumer: batch 100 / 5 s / 3 retries → `…-usage-events-dlq`, and batch 1 / 1 s /
3 retries → `…-canary-dlq`; harness: batch 1 / 1 s / 3 retries → `…-quarantine`).

**NOT INDEPENDENTLY READ BACK:** message retention (reported as 1,209,600 s on
all five) and current queue depth (reported as zero in quarantine). `wrangler
queues info` in 4.127.1 and 4.135.0 prints neither, and the connector has no
queue tool. Carried to Part 2 as a read-back gap.

### R2

Buckets: `data-foundry-private-canary-receipts` (created 2026-09-18T14:54:55Z,
location ENAM, Standard) and `data-foundry-raw-artifacts` (created 2026-08-31).
No other bucket.

Receipt retrieved by exact key
`runs/475e622a-a1bf-48a5-9d2b-52126281bff4/20260918150924235.json`
(892 bytes, sha256 `81435077ca99d64868f031d733bb849b3dc3193fa7cc3f3b255925c9c91269e4`).
The key is `runs/<run_id>/<issued_at with -, :, ., T and Z removed>.json`,
which is what the implementation writes; the executing session's first lookup
with a hand-built key was an operator slip, not a canary failure. Verbatim:

```json
{"kind":"data-foundry.private-canary-receipt.v2","run_id":"475e622a-a1bf-48a5-9d2b-52126281bff4","issued_at":"2026-09-18T15:09:24.235Z","completed_at":"2026-09-18T15:11:55.858Z","probes":[{"worker":"edge","runId":"475e622a-a1bf-48a5-9d2b-52126281bff4","readiness":"READY","metering":"QUEUED"},{"worker":"web","runId":"475e622a-a1bf-48a5-9d2b-52126281bff4","readiness":"READY","metering":"NOT_APPLICABLE"},{"worker":"usage-consumer","runId":"475e622a-a1bf-48a5-9d2b-52126281bff4","readiness":"READY","metering":"NOT_APPLICABLE"},{"worker":"acquisition-worker","runId":"475e622a-a1bf-48a5-9d2b-52126281bff4","readiness":"READY","metering":"NOT_APPLICABLE"},{"worker":"ingestion-worker","runId":"475e622a-a1bf-48a5-9d2b-52126281bff4","readiness":"READY","metering":"NOT_APPLICABLE"},{"worker":"mcp-worker","runId":"475e622a-a1bf-48a5-9d2b-52126281bff4","readiness":"READY","metering":"QUEUED"}]}
```

What the receipt proves by construction: the harness consumes **only**
`data-foundry-private-canary-dlq`, so a receipt exists only after the control
envelope went through the ingress Queue, exhausted the consumer's three
retries and was dead-lettered — retry and DLQ delivery are proven by the
receipt's existence. Each `READY` is reported only after the target verified
that both its session and current database roles equal its dedicated `df_*`
identity through its own Hyperdrive, with private-schema `USAGE`, no `CREATE`,
and its narrow capability. `metering: QUEUED` from the edge and MCP targets
means each sent its synthetic usage event **twice** to the metering Queue;
the executing session's `verify` step then found each event present exactly
once, and this session confirms the fixture is gone. Together that is
at-least-once delivery, duplicate suppression, retry, dead-letter routing and
durable persistence on real, isolated provider resources.

### Workers — seven route-less private-canary identities, no ordinary Data Foundry Worker

| Worker | Script ID | Version ID | Created (UTC) | Handlers | Bindings read back |
| --- | --- | --- | --- | --- | --- |
| `data-foundry-private-canary-edge` | `5f239630c3f041a5805c431c1fc839d3` | `fbfdaf4f-9618-4b50-aeb5-8604eb25fdaf` | 15:00:44 | fetch | `USAGE_EVENTS_QUEUE` → `…-usage-events`; `HYPERDRIVE` `a3c7014d…`; `DEPLOYMENT_ENVIRONMENT=production`; `PRIVATE_CANARY_MODE=service-binding` |
| `data-foundry-private-canary-web` | `f0cec822a064402e8c639f6c73dbeb9a` | `d7c3dc0d-cfca-4a1c-9b73-c5c1952a3efe` | 15:00:49 | fetch | `HYPERDRIVE` `574ab2f0…`; the two vars |
| `data-foundry-private-canary-usage-consumer` | `261bf126d8124b90bce1bae7e75e328c` | `1054c4ae-a488-441b-b049-3347a65da7d8` | 15:00:53 | queue | `HYPERDRIVE` `15a92d9e…`; the two vars |
| `data-foundry-private-canary-acquisition-worker` | `c3350d5ee6dc41aea23542f1adf7a508` | `84bb8bee-d3b9-4269-b810-944d598f04cf` | 15:00:58 | scheduled | `HYPERDRIVE` `d40b41e5…`; the two vars |
| `data-foundry-private-canary-ingestion-worker` | `57fca94b22684dae88b475e46f5a04cb` | `843164ae-240f-43be-9c47-aaea440cd457` | 15:01:01 | queue, scheduled | `HYPERDRIVE` `c9d4a85c…`; the two vars |
| `data-foundry-private-canary-mcp-hvac` | `80deac12e6f342d0b81c6826abe35ba4` | `92e7cc51-2f07-436f-b8c9-8e4941180606` | 15:01:06 | fetch | `USAGE_EVENTS_QUEUE` → `…-usage-events`; `HYPERDRIVE` `ff4f6dfc…`; the two vars |
| `data-foundry-private-canary` | `18b61b93fbe14aceae7fe7f8dba21c57` | `19271081-1c95-4336-a9da-253e700b09cd` | 15:01:55 | queue | `CANARY_RECEIPTS` → `data-foundry-private-canary-receipts`; six service bindings to `<target>#PrivateCanaryEntrypoint`; `DEPLOYMENT_ENVIRONMENT=production`; **no Hyperdrive, no Queue producer** |

Each Worker has exactly one version and one deployment (100 %). No R2
raw-artifact binding, Cron, `POSTGRES_URL`, secret, or service-binding
environment selector appears on any of the seven. The only other Workers in
the account (`canvasjwk`, `lti-launch-handler-black-hall-dfe2`) predate Data
Foundry and are unrelated. **No ordinary Data Foundry Worker exists.**

**Provenance binding.** The deployed `index.js` of each of the seven Workers
was downloaded and compared with an in-place `wrangler deploy --dry-run` build
of the corresponding tracked manifest (`apps/<app>/wrangler.private-canary.toml`,
`apps/private-canary/wrangler.toml`) at `main` `55804842f5c5131640dd0435c7d203a66e95b63c`,
using the pinned toolchain (Node 24.19.0, wrangler 4.127.1, esbuild 0.28.2).
After normalizing the multipart transport's line endings, **all seven are
byte-identical**. The same builds from the release worktree at `2063ea8` are
identical too, because no application source changed between the two SHAs.

| Worker bundle | sha256 (deployed = in-place build) | bytes |
| --- | --- | --- |
| edge | `f2a98d2d7ebcef43f55211280e49a9d3063eadf0950c61d92ba93d4381765080` | 1,211,255 |
| web | `bee348483ca0194d06fe020ddb0ac245df05c7f7dbec1a63c6c51480ede0d80f` | 1,267,409 |
| usage-consumer | `f7a3f557ddda800253c2285e3ff0657e50580254abe042f673508b3ee2de8473` | 890,991 |
| acquisition-worker | `b486d28100092092e7d4f60325c5060530c3ad90a9d76ef0e75a27309881b406` | 1,303,664 |
| ingestion-worker | `9a9e29cd05582385509e38d4427c612468c0534ab022e5c74992e77f2dc73887` | 1,538,844 |
| mcp-worker | `41bce790983e699676a3604c100c9ff7922d6032cb5a11cf8cac1ec4f12fbf1f` | 1,675,583 |
| private-canary (harness) | `1f1687e0100c71864230f966d01c9c4f4d748d50e895e0be24f41d991f9d8329` | 58,383 |

The repository's own gate, `pnpm cloudflare:artifacts:check`, also passes at
`5580484` on this machine (thirteen artifacts, 39 files).

**NOT INDEPENDENTLY READ BACK:** Worker routes, custom domains, `workers.dev`
and preview-URL flags. `wrangler` 4.x has no read command for them and the
connector exposes none; the tracked manifests set `workers_dev = false` and
`preview_urls = false` and declare no route, and the deployed bindings match
those manifests. The three canonical hostnames (`data.aroqon.com`,
`api.data.aroqon.com`, `mcp.data.aroqon.com`) resolve publicly to
non-Cloudflare addresses (the historical Vercel placement), so no Worker is
serving them. A route/subdomain read-back is a Part 2 gap.

---

## Local verification on `main` `5580484`

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | clean |
| `pnpm typecheck` | pass (after moving the stray untracked draft out — see below) |
| `pnpm cloudflare:artifacts:check` | pass, thirteen artifacts |
| `pnpm test` (full suite, Windows 11, Node 24) | **3,556 / 3,583 passed; 27 failed in 3 files; 2 vitest worker-timeout errors** |
| Hosted CI on the same SHA (run `35291689381`, Linux) | **green** |

The 27 local failures are confined to `tooling/test/ua002-migration-pgpassfile.test.ts`
(20), `tooling/test/ua002-credential-placement-doc.test.ts` (4) and
`tooling/test/ci-postgres-readiness.test.ts` (3). Every one is a POSIX
assumption that Git Bash on Windows does not satisfy: `0600`/`0755` file modes
read back as `666`, Git Bash remaps `/tmp` so the emitted path differs from the
Node temp path, the doc test looks for a backslash-separated helper path, and
the readiness loop uses a shell `read` timing that behaves differently here.
CI runs them on Linux and passes. They are **local portability debt**
(recorded on `FOUNDATION-008`), not a code defect and not a release blocker.

A stray untracked file, `tests/integration/judgment-history.test.ts` (dated
2026-08-18, present on no branch, referencing a type shape that no longer
exists), was making `tsc` fail on the main checkout. It was moved, not deleted,
to `C:\Users\Adam\data-foundry-worktrees\stray-untracked-20260918\` so no
unique work is lost silently; it is not part of any release.

---

## Reported by the executing session, corroborated but not re-run

- **The six direct runtime-role probes** (`pnpm runtime-roles:postgres:check`
  through six credential paths: "OK: 6 direct LOGIN runtime-role PostgreSQL
  connections are least-privileged"). The credentials are not, and must not be,
  in this session. Corroboration: Cloudflare validates the origin connection
  when a Hyperdrive is created, all six exist; and every target reported
  `READY` only after asserting its own session/current role through its
  Hyperdrive.
- **The `df_edge` credential was rotated** after an earlier value was exposed
  in a screenshot. The old value was not sought and is not recoverable from
  anything read here; the `df-edge` Hyperdrive was modified at 14:50:30Z after
  its creation, consistent with that rotation.
- **One Hyperdrive was first created with caching enabled and corrected**, and
  **all six were first `require`/default TLS and corrected to `verify-full`**
  after the CA upload. Current state is the corrected one for all six.
- **`pgpass` deprecation warning for a future `pg@9`.** Technical debt, not a
  failure; carried on `PROGRESS.md`.
- **Queue retention 1,209,600 s and zero quarantine depth** — see the
  read-back gaps above.

## Disposition

`UA-002`'s acceptance — controlled migration credential activated, pending
reviewed migrations and the exact-baseline grant upgrade applied, six distinct
runtime credentials and six cache-disabled Hyperdrives activated — is satisfied
by the read-backs above, and the route-less private canary that the runbook
placed after it has passed. `UA-002` is **COMPLETE**. `BETA-002` (live Queue
and database integration proof on real isolated provider resources) is
satisfied by the same cycle. `FOUNDATION-006`, `MVP-005`, `PROD-001`,
`PROD-002` and `REV-006` advance but stay open: ordinary Workers, routes, Cron,
backup/restore and rollback exercises, and the public cutover (`UA-005`) are
separate gates.

## Temporary resources deliberately left in place

Seven private-canary Workers, six Hyperdrives, five private-canary queues, the
CA certificate, the receipt bucket and the receipt object. Their disposition
(reuse as validation infrastructure, or removal of the temporary Worker
identities) is Part 2's decision; nothing was deleted, and the receipt must not
be.

*Later on 2026-09-18: decided in
[ADR-0013](../decisions/ADR-0013-private-canary-resource-disposition.md) —
retained as standing pre-cutover validation infrastructure. The two read-back
gaps above are covered by `pnpm cloudflare:readback:check`, not yet executed
against the account.*
