# Owner actions — Cloudflare deployment and monetization

Everything here either requires a person in a dashboard/billing relationship or
coordinates repository work with Cloudflare resources that cannot be inferred
from source code alone.

## 2026-09-01 private-canary control (current workstream)

This workstream is **not** a public deployment or hostname cutover. It
overrides any later-public-route instruction below until the synthetic canary
has passed and an owner separately authorizes public production. Do not create
or change a public DNS record, Worker route, custom domain, workers.dev
endpoint, preview URL, real-source record, or public endpoint variable.

The private Alpha Lab schema is already staged: the 2026-09-02 hosted record
proves 26 ledgered migrations, objects, ownership, and the then-current 200
grants for five `NOLOGIN` runtime roles. It also records 57 function-search-path
warnings. Repository migration `0027` closes those issues locally and `0028`
adds the four justified rights-path indexes; both remain pending hosted
authorization and application, so no hosted warning closure is claimed.
That historical application used the authenticated management SQL connector
under the owner's preauthorization because direct TLS was unreachable from the
automation environment. It is not a Worker deployment or a substitute for the
remaining password, Hyperdrive, Queue, R2-binding, or route-less canary proof.
For any later replay or recovery action, follow the direct-TLS procedure below
unless a separately recorded owner-authorized exception is required.

The only permitted initial deployment is a route-less, service-bound synthetic
canary:

1. **Containment is a provider-side gate; repository remediation continues in
   parallel. Repository state alone designates no Worker release candidate.** The
   originally authorized candidate `504d91fd10afa91001abe02cf9aaa4c95034cfca`
   was superseded by runtime hardening in
   `e60d664a998f3fa4051aa7fd0b7dc9dc99a83d85`. The shared-DLQ repair
   `df4a66561eab2a5fdc4d93e3489f07ff82ccd382`, reconciliation head
   `64bb05bdb2dc5877f526acf9e38c02146d2d5831`, and pre-repair PR #26 head
   `effa3ec82c96e8f68d21ddc4d2b32919497dbddb` are historical provenance only.
   Never select one from a later checkout or infer artifact identity from
   source-path equivalence.

   Any PR #26 head may merge normally after fresh exact-head checks/reviews meet
   the active `main` ruleset. Before any provider action, its merged/reviewed SHA
   must contain the runtime code, tests, six-artifact gate, and aligned
   documentation, and a clean checkout
   of that exact SHA must run `pnpm cloudflare:artifacts:check`, which dry-runs
   and scans all six route-less private-canary Worker artifacts: five reduced
   target Workers plus the private-canary harness (without Hyperdrive). The
   target profiles receive only synthetic Hyperdrive configuration for the
   credential-free artifact build; the harness receives none. A missing target
   entrypoint, manifest, or generated artifact directory fails the gate closed.
   This is repository provenance, not provider deployment evidence. Do not add a
   documentation-only follow-up commit after that verification.

   A provider-side containment result is still required before a deployment or
   any new credential-bearing migration/recovery action. If sanitized evidence
   cannot identify the provider/item, record it; recording
   `unable_to_target_from_sanitized_evidence` is not a successful containment
   result and does not authorize provider activity. Obtain and
   record a security-owner disposition before any provider action; continue only
   if that disposition explicitly clears the provider gate. Do not guess, reopen
   prohibited browser state, or rotate unrelated credentials. After successful
   containment and an affirmative, recorded security-owner disposition
   explicitly clearing the provider gate, and after exact-SHA repository
   validation, check out the selected SHA and begin with a read-only direct-TLS
   check of the hosted ledger versions/checksums, object
   ownership, role state, and direct ACLs. If and only if that proves the exact
   historical `0001`–`0026` state, set `DATA_FOUNDRY_RELEASE_SHA` to the same SHA
   and apply only the pending migrations (`0027` and `0028`) through direct PostgreSQL TLS
   using the approved secret interface. Do not replay the 26 already-ledgered
   migrations. The direct
   URL must not have query parameters that could override its TLS or host
   settings. The runner requires a clean worktree and reads migration SQL from
   that exact Git object. Do not put the migration URL on argv, in a manifest, or
   in a transcript. Application migrations remain direct-TLS-only; the only
   permitted export is the credential-free exact-SHA `postMigrationGrants`
   payload. It is an input to the separately provider-authorized direct-TLS
   procedure after the pending direct migration. It does not authorize provider
   activity during repository-only work.
2. Create five distinct least-privilege runtime identities/passwords through
   the approved secure interface, then create exactly five TLS Hyperdrives—one
   for each edge, web, usage-consumer, acquisition-worker, and MCP role. Never
   bind the migration principal to a Worker. Read back the hosted ledger,
   private schema, five roles, 57 expected function signatures with exact
   `data_foundry, pg_catalog, extensions` function paths, and 199 exact grants
   before creating any Hyperdrive.
3. Preserve the existing `data-foundry-usage-events` and
   `data-foundry-usage-events-dlq` queues unchanged at 1,209,600 seconds
   (14 days). Only the ordinary `data-foundry-usage-consumer` consumes
   `data-foundry-usage-events`; the ordinary pair is not a canary ingress or
   failure path. Before deployment, explicitly create or update all five
   dedicated canary queues at 1,209,600 seconds (14 days): synthetic metering
   uses `data-foundry-private-canary-usage-events` ->
   `data-foundry-private-canary-usage-events-dlq`, while control uses
   `data-foundry-private-canary-events` ->
   `data-foundry-private-canary-dlq` ->
   `data-foundry-private-canary-quarantine`. Do not rely on a provider-created
   default DLQ retention. Then create the dedicated private-canary receipt
   bucket, copy the six tracked route-less templates to their ignored deployment
   manifests, and copy the five ordinary templates to ignored collision-control
   manifests:
   ```powershell
   Copy-Item apps/edge/wrangler.private-canary.toml apps/edge/wrangler.private-canary.production.toml
   Copy-Item apps/web/wrangler.private-canary.toml apps/web/wrangler.private-canary.production.toml
   Copy-Item apps/usage-consumer/wrangler.private-canary.toml apps/usage-consumer/wrangler.private-canary.production.toml
   Copy-Item apps/acquisition-worker/wrangler.private-canary.toml apps/acquisition-worker/wrangler.private-canary.production.toml
   Copy-Item apps/mcp-worker/wrangler.private-canary.toml apps/mcp-worker/wrangler.private-canary.production.toml
   Copy-Item apps/private-canary/wrangler.toml apps/private-canary/wrangler.production.toml

   Copy-Item apps/edge/wrangler.toml apps/edge/wrangler.production.toml
   Copy-Item apps/web/wrangler.toml apps/web/wrangler.production.toml
   Copy-Item apps/usage-consumer/wrangler.toml apps/usage-consumer/wrangler.production.toml
   Copy-Item apps/acquisition-worker/wrangler.toml apps/acquisition-worker/wrangler.production.toml
   Copy-Item apps/mcp-worker/wrangler.toml apps/mcp-worker/wrangler.production.toml
   ```
   Add the same non-secret account id to all six temporary canary/harness
   manifests, and add one role-specific Hyperdrive object with exactly `binding`
   and `id` to each of the five target manifests only. All five target manifests
   must name the same account and five distinct Hyperdrives. The private-canary
   manifest has no Hyperdrive or Queue producer. The deployment-mode canary checks load the
   five ignored ordinary deployment manifests as collision controls. They are not deployment inputs for this canary phase; do not add provider bindings to or
   deploy those ordinary manifests while the route-less canary is running. Do
   not add a service-binding environment selector, a local connection string, a
   public route, hostname, R2 raw-artifact binding, Cron, `POSTGRES_URL`, or
   protected value to the six temporary manifests.

   The five reduced profiles create temporary dedicated Worker identities:
   `data-foundry-private-canary-edge`,
   `data-foundry-private-canary-web`,
   `data-foundry-private-canary-usage-consumer`,
   `data-foundry-private-canary-acquisition-worker`, and
   `data-foundry-private-canary-mcp-hvac`. The private-canary harness binds
   only to those identities. Never deploy a reduced profile under an ordinary
   Worker name: it can replace that Worker's Cron, R2, Queue, or future ordinary
   configuration.
4. Run the fail-closed pre-deployment checks before a dry run or deploy:
   ```powershell
   pnpm cloudflare:private-canary:targets:check
   pnpm cloudflare:private-canary:deployment:check
   pnpm cloudflare:private-canary:targets:deployment:check
   pnpm cloudflare:private-canary:full-deployment:check
   ```
   The tracked `private-canary:targets:check` remains available without ignored
   deployment files. Each deployment-mode check (`private-canary-deployment`,
   `private-canary-target-deployment`, and `private-canary-full-deployment`)
   fails closed until all five ignored ordinary `wrangler.production.toml`
   manifests and the six ignored canary/harness manifests exist. Its sanitized
   output must not be worked around by changing tracked files.
5. Deploy the five route-less target profiles as the temporary dedicated Worker
   identities and then deploy the route-less private canary harness. Verify each
   private queue separately; the explicit mapping is:

   | Queue | Allowed producer | Consumer | Retry policy | Failure destination / terminal state |
   | --- | --- | --- | --- |
   | `data-foundry-private-canary-usage-events` | Dedicated reduced `edge` and `mcp-worker` targets only; synthetic metering only | `data-foundry-private-canary-usage-consumer` | 3 retries, batch size 100, timeout 5 seconds | Cloudflare moves an exhausted synthetic-metering message to `data-foundry-private-canary-usage-events-dlq` |
   | `data-foundry-private-canary-usage-events-dlq` | Cloudflare only, after the synthetic-metering consumer exhausts retries | No consumer | None; retain as terminal synthetic-metering failure evidence | Must be empty after a successful fixture cycle; investigate rather than purging on failure |
   | `data-foundry-private-canary-events` | Authenticated synthetic fixture only; no public Worker producer | `data-foundry-private-canary-usage-consumer` | 3 retries, batch size 1, timeout 1 second | Cloudflare moves an exhausted message to `data-foundry-private-canary-dlq` |
   | `data-foundry-private-canary-dlq` | Cloudflare only, after the ingress consumer exhausts retries | `data-foundry-private-canary` | 3 retries, batch size 1, timeout 1 second | Cloudflare moves an exhausted control message to `data-foundry-private-canary-quarantine` |
   | `data-foundry-private-canary-quarantine` | Cloudflare only, after the private-canary consumer exhausts retries | No consumer | None; retain as terminal synthetic failure evidence | Must be empty after a successful fixture cycle; investigate rather than purging on failure |

   Preserve the ordinary queue mapping separately: `edge` and `mcp-worker` may
   produce ordinary usage events to `data-foundry-usage-events`; only the
   ordinary `data-foundry-usage-consumer` consumes `data-foundry-usage-events`
   (3 retries, then `data-foundry-usage-events-dlq`). The private-canary Worker
   has no shared-DLQ consumer and no control envelope may be sent through either
   shared queue.
   An authenticated operator may create a new synthetic fixture cycle, then
   send the generated non-secret envelope only to
   `data-foundry-private-canary-events`. It must never send a credential,
   source URL, body, or real record. `prepare` emits a safe `issued_at`; pass
   that exact value with the same run id to both `verify` and `cleanup`. Verify
   the cycle-scoped receipt, database persistence, idempotency, retry/DLQ
   delivery, and an empty private quarantine after a successful cycle; never
   purge the shared usage DLQ. Before invoking a target, the harness recomputes
   all six fixture identifiers from the canonical run/cycle and retries any
   altered but structurally valid envelope without writing a receipt. Record
   provider deployment evidence that binds all six deployed Worker
   scripts/versions to the designated release SHA and
   read back all five private queue retentions, producers, consumers, retry
   counts, and dead-letter destinations; receipt contents alone do not attest a
   deployed script SHA. Each target also verifies that both its current and
   session database roles equal its dedicated nonprivileged, membership-free
   `df_*` identity, with private schema `USAGE`, no private-schema `CREATE`,
   and its narrow role capability (including the edge key-column deny), before
   it reports `READY` or queues synthetic metering.

   ```powershell
   pnpm tsx tooling/scripts/private-canary-fixture.ts prepare --run-id <new-uuid>
   # Copy only the emitted non-secret issued_at into the next two commands.
   pnpm tsx tooling/scripts/private-canary-fixture.ts verify --run-id <same-uuid> --issued-at <issued-at>
   pnpm tsx tooling/scripts/private-canary-fixture.ts cleanup --run-id <same-uuid> --issued-at <issued-at>
   ```

   After receipt and provider-attestation evidence are retained, cleanup removes only those temporary identities.
   If the synthetic canary must be stopped, rollback is deletion or disablement of the temporary canary identities without touching ordinary Worker configuration; ordinary manifests, Cron schedules,
   R2 bindings, and shared usage Queue configuration remain intact.

The conventional `wrangler.production.toml` procedure and all public
hostname/cutover steps below are later-production controls. They are not an
alternative canary route for this workstream.

Protected `main` contains the ordinary five-Worker production topology:
`apps/edge`, `apps/web`, `apps/usage-consumer`,
`apps/acquisition-worker`, and `apps/mcp-worker`, including the PR #22 closeout
merged as `9c917c0f708352dfb79861110023145eb23806e3`. No production
deployment of the integrated protected-main tree is recorded or verified. It is
separate from the temporary six-artifact private-canary topology above: five
reduced dedicated targets plus the no-Hyperdrive harness.
Wrangler is unauthenticated in the verification environment; exact deployment
IDs and runtime probes remain owner/platform evidence. Repository state is not
proof that Cloudflare resources or real-source rights have been provisioned.
The [redacted 2026-08-31 provider reconciliation](../evidence/alpha-lab-provider-reconciliation-20260831.md)
records the read-only Alpha Lab, Cloudflare, and Vercel observations behind this
runbook; it is not deployment or runtime proof.

The minimal owner/platform work is: choose the canonical account/zone and
database; provision Hyperdrive, one raw-artifact R2 bucket, the preserved
ordinary usage Queue/DLQ, all five dedicated temporary canary queues (the
synthetic-metering Queue/DLQ pair and control ingress/DLQ/quarantine chain), and
first the six temporary private-canary Workers, then only later the five ordinary
production Workers; set protected values without exposing them; then prove the
exact deployed SHA, rights behavior, Queue persistence, Cron/R2 acquisition,
and emergency public-cache purge. RapidAPI and MCP live-channel proof are
separate external gates.

The production database is Alpha Lab's shared Supabase project
`fgxinxaqkwoqyywdgobs`, not Valor. Data Foundry must be installed only in its
private `data_foundry` schema. Do not create, migrate, grant on, or otherwise
alter Alpha Lab's `public` schema: it already contains an unrelated Rise
application. The Supabase Data API must not expose `data_foundry` and neither
`anon` nor `authenticated` may receive grants on it.

---

## 1. Cloudflare account, zone and Worker routes

### Why automation cannot finish this from repository code alone

The repository does not contain production account identifiers, routes,
Hyperdrive configuration ids or credentials. Those are environment facts and
must remain outside source control.

### Checklist

1. Use the active/full `aroqon.com` Cloudflare zone. The authoritative
   2026-09-02T14:46Z refresh observed the standard usage model and exactly the
   ordinary 14-day Queue/DLQ pair, but zero Data Foundry Workers, Hyperdrives,
   R2 buckets, hostname records, or Worker routes. It supersedes the 2026-08-31
   no-Queue baseline and an earlier same-day raw-bucket observation. Provision
   the absent `data-foundry-raw-artifacts` bucket before ordinary acquisition
   and a separate private-canary receipt bucket for the synthetic proof.
   Preserve unrelated DNS while provisioning; a wildcard
   record is not evidence that Data Foundry is deployed. See the
   [redacted reconciliation record](../evidence/alpha-lab-provider-reconciliation-20260831.md)
   for the bounded, read-only observation.
2. Do not bind any canary custom domain or Worker route in the current
   workstream. A public canary hostname is a separately authorized later
   production action, not a substitute for the route-less service-bound test.
3. Authenticate Wrangler against the intended account.
4. Bind the API Worker to its production hostname/custom domain.
5. Bind the reviewed public web Worker to its production hostname/custom
   domain and configure its exact HTTPS `PUBLIC_ORIGIN`.
6. Bind each one-vertical MCP Worker to its exact production hostname and
   configure `MCP_HOSTNAME`, `MCP_ALLOWED_ORIGINS`, and the public site's
   `PUBLIC_ORIGIN`; do not infer these from requests.
7. Keep marketplace traffic on a dedicated hostname or clearly identifiable
   route if that makes operations and bypass testing simpler, but do not deploy
   a second API implementation.
8. Deploy the acquisition Worker with its hourly Cron trigger. It needs no
   public route and must not be bound to the usage Queue.
9. Apply a provider-level rate limit to the public sitemap routes
   (`/sitemap-index.xml` and each vertical's `/sitemaps/*`). The application
   already enforces an independent fail-closed raw scan-page budget; the edge
   rule limits repeated requests from one abusive source. Record the exact
   Cloudflare rule, scope, threshold and bypass policy outside source control.

### Verify

Dry-run deployment resolves the intended account/resources, and production DNS
points only at the intended Workers. A deployment should be attributable to an
exact repository SHA. Verify sitemap capacity failures return only an opaque
`503` with `Cache-Control: no-store` and `Retry-After`, and verify the provider
rate limit activates without blocking ordinary crawler fetches.

Also seed an isolated over-capacity catalog and prove the shared query layer
refuses it before authorization row loading: public web and REST must return no
partial body/count and only an opaque `503`; MCP must return declared,
non-retryable `SERVICE_UNAVAILABLE` with no candidate count. Repeat at exactly
10,000 entity candidates and exactly 50,000 fact candidates to prove the
sentinel is not off by one. The checked-in 100,000-row authorization ceiling
must likewise refuse entity/fact evidence fanout. Prove recursive dependency
graphs refuse above 100,000 distinct nodes, 100,000 edges, or any dependency
path deeper than 64, including a dense low-node/high-edge DAG and a long chain
whose root also has shortcut edges to every descendant. Deterministic catalog refusal must omit
`Retry-After`; only the separately budgeted sitemap response advertises a retry.
Record Worker CPU/memory and Hyperdrive query timings from these isolated probes
before any proposal to raise a ceiling.

---

## 2. Hyperdrive binding to Postgres

### Why this is operational

Creating Hyperdrive requires a live production database connection string. The
credential must not be committed.

### Checklist

1. Use Alpha Lab's Supabase project `fgxinxaqkwoqyywdgobs` and require TLS. For
   Cloudflare Hyperdrive, use the Supabase **Direct** origin
   `db.fgxinxaqkwoqyywdgobs.supabase.co:5432`, not Supavisor: Hyperdrive already
   supplies the connection pool. First prove the account can reach that IPv6
   Direct endpoint, or arrange Supabase IPv4 support before creating a live
   Hyperdrive configuration.
2. Create a controlled-login migration role that owns only `data_foundry`, and
   separate least-privilege login roles for edge, web, MCP, usage consumer, and
   acquisition. No runtime role may own objects, create in the shared `public`
   schema, or inherit broad roles. Give every role the **database default**
   search path `data_foundry, pg_catalog, extensions`, and grant only its
   required `data_foundry` and `extensions` privileges.

   The direct migration credential must authenticate with both `session_user`
   and `current_user` equal to `df_migration`. Provision it as `LOGIN`,
   `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`,
   and `NOBYPASSRLS`; it may not be a member of another role, retain effective
   database `CREATE`, or retain `CREATE` on any non-target ordinary schema. Its
   live session must have `session_replication_role=origin` and
   `lo_compat_privileges=off`. It must have exactly one current-database `pg_db_role_setting` row containing only
   `search_path=data_foundry, pg_catalog, extensions`, and no role-global setting row.
   Set that database-scoped default (substituting the exact target
   database name), then reconnect before running verification because an
   existing session does not acquire a new role default retroactively:

   ```sql
   ALTER ROLE df_migration IN DATABASE <database_name>
     SET search_path = data_foundry, pg_catalog, extensions;
   ```

   An operator/connector may separately be an
   incoming member of `df_migration` solely to run the reviewed runtime-grant
   packet's `SET LOCAL ROLE`; that operator session is not an accepted direct
   migration connection.

   Before granting any runtime privilege, connect as the controlled migration
   role and remove the PostgreSQL **`PUBLIC` pseudo-role** from the private
   **`data_foundry` schema** and its objects:

   ```sql
   -- `PUBLIC` is the built-in all-roles pseudo-role, not the `public` schema.
   REVOKE ALL PRIVILEGES ON SCHEMA data_foundry FROM PUBLIC;
   REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA data_foundry FROM PUBLIC;
   REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA data_foundry FROM PUBLIC;
   REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA data_foundry FROM PUBLIC;

   -- Run as the migration role so future objects it creates stay private.
   ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
   ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
   ALTER DEFAULT PRIVILEGES IN SCHEMA data_foundry REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
   ALTER DEFAULT PRIVILEGES IN SCHEMA data_foundry REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;

   -- PostgreSQL adds schema defaults to global defaults. Its global function
   -- default grants EXECUTE to PUBLIC, so this must not be schema-qualified.
   -- df_migration is confined to data_foundry and may not create elsewhere.
   ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ALTER DEFAULT PRIVILEGES IN SCHEMA data_foundry REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```

   Do **not** run those statements against the shared `public` schema, drop
   that schema, or alter its privileges: it belongs to the unrelated Alpha Lab
   application. Grant required object privileges only to the separately named
   Data Foundry roles; never to `PUBLIC`, `anon`, or `authenticated`. Keep role
   passwords in the provider's normal secure credential flow; never put them in
   the repository, a command line, or a deployment receipt.
3. Supply the migration role's `DATA_FOUNDRY_MIGRATION_DATABASE_URL` only
   through the approved secret-bearing environment. It is the sole accepted
   direct-Postgres migration credential; a generic `POSTGRES_URL` is not a
   substitute. Before mutation, use read-only SQL to verify the hosted ledger's
   exact versions/checksums, ownership, staged roles, and ACL state. When the
   existing ledger is the exact historical `0001`–`0026` prefix, set the
   non-secret exact checked-out release SHA and run the frozen migration runner
   twice: the first invocation applies only pending `0027` and `0028`; the second
   proves the full `0001`–`0028` chain is already applied.
   ```powershell
   $env:DATA_FOUNDRY_SCHEMA = "data_foundry"
   $env:DATA_FOUNDRY_RELEASE_SHA = "<40-character-reviewed-Git-SHA>"
   pnpm migrate
   pnpm migrate
   ```
   Do not replay or resubmit the 26 already-ledgered migrations. Future upgrades
   follow the same rule: verify the exact ledger prefix read-only, then let the
   runner apply only pending migrations from the immutable Git object. Verify
   that the private schema, rather than `public`, owns
   the ledger and every Data Foundry table. For direct Postgres execution the
   runner also requires that release SHA to equal Git `HEAD`, the entire
   worktree to be clean, a certificate-verified TLS connection with no
   query-string overrides, and migration SQL loaded from the attested Git
   object. It checks the migration owner's role posture, durable settings,
   external privilege and ownership boundary, live session safety, and
   effective default ACLs before any repository DDL. After preparing the
   private namespace, it requires both
   the exact configured and resolved `search_path` to be
   `data_foundry, pg_catalog, extensions`. Inside each transaction it rechecks
   the full migration-role posture, durable settings, external privilege and ownership
   boundary, live session safety, and effective default ACLs before and after each
   pending migration, with that exact configured-and-resolved
   path probe first at both boundaries. Any drift is rolled back before its
   ledger write. The archival
   packet form also reasserts `current_user=df_migration` after `SET LOCAL ROLE`
   and after each migration, before it may stamp the ledger. Do not pass the
   connection string on argv or archive it with the command receipt.

   This private-canary workstream requires direct PostgreSQL TLS for every
   application migration. Application migrations remain direct-TLS-only; the
   only permitted export is the credential-free exact-SHA
   `postMigrationGrants` payload. After the containment and provider gates
   authorize the procedure, after the pending direct migration above succeeds,
   and before any runtime password exists, generate that payload with the
   checked-out exact SHA:

   ```powershell
   node_modules/.bin/tsx tooling/scripts/export-supabase-migration-packets.ts --release-sha <40-character-release-SHA> > <non-secret-local-packet-path>
   ```

   The direct `tsx` invocation is required: redirecting `pnpm
   migrate:supabase:export` includes the package-manager banner and does not
   produce a parseable manifest. The local artifact contains no database
   credential and does not execute SQL, authorize provider activity, or replace
   direct TLS. Export succeeds only when that SHA is the checkout's exact Git
   `HEAD`. The entire non-ignored worktree is clean against `HEAD`, including
   non-ignored untracked files. Commit or restore every non-ignored change
   before generating an operator artifact; never export packets from an
   uncommitted migration implementation.

   The manifest's `preflightSql`, `bootstrapSql`, `verificationSql`, and
   `packets[]` fields describe an archival connector path, not the current
   procedure. Do not submit `bootstrapSql`, `packets[]`, or their
   application-migration `verificationSql` to a provider connector in this
   workstream. The direct-TLS runner owns all application migration and replay
   work.

   The one permitted direct-TLS runtime-grant packet is
   `postMigrationGrants`. Before exporting and using it, the secure
   provider path must create `df_edge`, `df_web`, `df_mcp`, `df_usage`, and
   `df_acquisition` as NOLOGIN, nonprivileged, non-member roles with only
   direct, non-grantable `CONNECT` on the current database and `USAGE` on
   `extensions`. Inherited `PUBLIC` database `CONNECT`/`TEMP` on the current
   database and catalog-marked templates remains unchanged and distinct from
   those required direct grants. The verifier observes and blocks, rather than
   mutating, inherited `CONNECT` to every other live non-template database.
   It must not grant database `CREATE`, grant options, a `public`-schema
   privilege, or any private Data Foundry object privilege at this staging step.
   Remove `PUBLIC` execute from every private function. The controlled direct-TLS
   migration operator must be authorized to `SET ROLE df_migration` and extract
   only `postMigrationGrants.sql`, its `verificationSql`, and its
   `postCredentialVerificationSql` into protected local files. On a fresh
   unprovisioned installation, apply `sql` in one direct-TLS transaction before
   running `verificationSql`. On the hosted exact-legacy upgrade, migration
   `0027` itself converts only the attested 200-grant acquisition shape to the
   exact 199-grant shape; `0028` then adds only the four audited rights-path
   indexes. Do not reapply the grant installer, which correctly
   refuses pre-existing runtime ACLs. Run `verificationSql` directly after
   `0027` and `0028`. Never submit
   the packet to a provider connector or provider migration record, and never
   use a password-bearing runtime connection for this step. The payload locks and
   validates
   the full canonical ledger, exact relation/function inventories and ownership,
   every one of the 57 exact function search paths, zero `SECURITY DEFINER`
   functions, private-schema/public-schema ACL
   prerequisites, and the absence of any pre-existing target-role privilege;
   it refuses drift instead of normalizing it. It then grants only the reviewed
   table/column matrix and, because a narrower call dependency cannot be proved
   statically, EXECUTE on the manifest's explicit 57-signature invoker-function
   inventory to `df_acquisition` alone. It changes neither the application
   ledger nor default privileges. The installer and both verifiers require the
   migration login's exact current-database durable search-path row and reject
   every role-global setting row. The guard computes `df_migration`'s effective
   defaults for future functions, tables, and sequences from both its global
   default ACLs and any schema-specific default ACLs for `data_foundry`. A
   missing explicit safe global function override resolves to PostgreSQL's
   hard-wired `PUBLIC EXECUTE` function default and fails. Any global or
   schema-specific default privilege for future functions, tables, or
   sequences granted to `PUBLIC` or another non-owner role also fails. Require
   every count/boolean in its
   `verificationSql` to be clean and compare `public_fingerprint_input` with
   the operator-approved pre-deployment fingerprint before the secure LOGIN
   transition.

   ACL validation is exact, not limited to the five runtime roles. The
   pre-grant private-schema baseline permits only the intrinsic owner ACLs on
   `data_foundry` and its explicit 57-routine inventory; relation owner entries
   that PostgreSQL materializes while granting another role are normalized as
   intrinsic owner privileges. Any direct private grant to `PUBLIC`, a Supabase
   API role, or an arbitrary observer is drift. For each runtime role, the only
   direct privileges outside `data_foundry` are non-grantable `USAGE` on
   `extensions` and non-grantable `CONNECT` on exactly the current database;
   direct schema, database, relation, column, routine, type, foreign-server/FDW,
   language, tablespace, large-object, parameter, or default privileges
   elsewhere are drift. Grant-option state is part of the ACL identity and must
   be false for every expected grant. Inherited `PUBLIC` database `CONNECT`/`TEMP`
   on the current database remains distinct from the required direct
   current-database `CONNECT` grant;
   inherited `PUBLIC` database `CREATE` is forbidden because it permits every
   runtime role to create durable schemas. Database `CREATE` is forbidden on every database.
   `CONNECT` to every other live non-template database is forbidden, including
   access inherited through `PUBLIC`; only the current database is allowed
   among live non-template databases. Catalog-marked templates are an explicit
   provider/system boundary excluded from this cross-database connection scan.
   Effective `SET` or `ALTER SYSTEM` on
   any ACL-governed parameter represented in `pg_parameter_acl` is forbidden,
   including access inherited through `PUBLIC` or another role. Large-object
   ownership or effective `SELECT` or `UPDATE`
   access through `PUBLIC` or role membership is also forbidden. The verifier
   also forbids effective foreign-data-wrapper or foreign-server `USAGE`,
   including through `PUBLIC` or another role, because either capability can
   expose a new foreign-data execution path. `df_migration` may not own a
   foreign table even in `data_foundry`; the target ownership allowance covers
   canonical local relations only. The verifier
   uses PostgreSQL 16's large-object metadata and ACL catalogs rather than a
   later-version helper, and `lo_compat_privileges=on` is itself a failure
   because it disables large-object ACL checks. The
   database/schema/data/custom-routine reachability check permits inert `PUBLIC`
   schema `USAGE` and type `USAGE`, because neither exposes table rows or
   executable code. Provider extension-member objects are access-exempt from
   the external relation/routine scan only when `pg_catalog.pg_depend` and
   `pg_catalog.pg_extension` attest exact whole-object extension membership
   (`objsubid` and `refobjsubid` are both zero). This exception is catalog
   membership, not the whole `extensions` namespace. Independently, no runtime
   role may own an extension or any whole object: an address-generic
   `pg_catalog.pg_shdepend` scan rejects every owner dependency that resolves to
   a runtime role, including non-extension text-search dictionaries, foreign
   servers, and shared database objects. Numeric catalog addresses make that
   ownership scan safe for objects in another database. Database `TEMP`
   privilege may remain, but a live temporary object owned by a runtime role
   still violates the strict no-ownership invariant. Trigger and
   event-trigger functions are outside this direct-call check because they
   cannot be invoked directly. This is an explicit provider-extension trust
   boundary, not a database-wide least-privilege claim: arbitrary public routines
   (including `SECURITY DEFINER`) remain drift, and unrelated public ACLs stay
   untouched rather than being normalized or revoked to make the check pass.
   Membership is forbidden in both directions: a runtime role cannot
   inherit another role, and no principal may inherit a runtime role.

   The NOLOGIN state is staging, not the Worker runtime state. After the grant
   payload and its `verificationSql` pass, use the provider's secure credential
   interface to assign a distinct password and enable LOGIN on those same five
   `df_*` roles; do not create wrapper roles, memberships, or password-bearing
   SQL artifacts. Then run `postCredentialVerificationSql` as the controlled
   operator. It requires all five roles to be direct, nonprivileged LOGIN roles
   while rechecking the exact ACL and membership invariants. Each Hyperdrive
   origin must authenticate directly as its matching `df_*` role; Workers do
   not issue `SET ROLE`.

   On a dedicated verification database, prove the actual credential paths by
   supplying the five role-specific connection URLs only through
   `DATA_FOUNDRY_EDGE_POSTGRES_URL`, `DATA_FOUNDRY_WEB_POSTGRES_URL`,
   `DATA_FOUNDRY_MCP_POSTGRES_URL`, `DATA_FOUNDRY_USAGE_POSTGRES_URL`, and
   `DATA_FOUNDRY_ACQUISITION_POSTGRES_URL`, setting
   `DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST=1`, and running
   `pnpm runtime-roles:postgres:check`. The check opens each role directly,
   rejects connection URLs with startup `options` and any ambient `PGOPTIONS`,
   verifies server-side session identity, requires the raw effective setting,
   resolved schema order, and an exact
   `pg_db_role_setting` created by `ALTER ROLE ... IN DATABASE ... SET
   search_path TO data_foundry, pg_catalog, extensions`, and checks
   representative positive/negative privileges. It never prints a connection
   string.

   The manifest's `transactionContract.liveUseAuthorized: false` and
   provider-ledger atomicity `unverified` apply only to its archival connector
   packets. They do not authorize connector execution. The approved direct-TLS
   grant sub-payload instead requires its own one-transaction direct TLS
   execution and verification. If that direct-TLS transaction cannot be
   established, stop rather than substituting a connector or retrying by
   renaming a packet.
4. Create one Hyperdrive configuration per Worker role (`df-edge`, `df-web`,
   `df-mcp`, `df-usage`, and `df-acquire`), with SQL query caching disabled.
   A single shared configuration would make all Workers share one upstream
   database credential and defeats least privilege. Configure conservative
   origin connection limits only after the Direct-origin reachability test.
   Hyperdrive pools in transaction mode and may reset session `SET` state or
   select a different origin connection between queries. The role's database
   default search path is the durable defense-in-depth boundary. The production
   Workers additionally run each schema-bound database operation in a serialized
   `BEGIN`/`SET LOCAL search_path`/verify/operation/`COMMIT` sequence, so the
   actual query cannot follow a reset into `public`. They intentionally create
   one Hyperdrive `pg.Client` per fetch, Queue batch, or Cron invocation and
   close it when that invocation completes; do not add an isolate-global `Pool`
   or cache a Hyperdrive client across invocations.
5. Configure the usage-consumer Worker with its own `HYPERDRIVE` binding.
6. Configure the public Worker with `HYPERDRIVE` and the non-secret
   `PUBLIC_ORIGIN=https://<public-host>` value. Missing or non-origin values
   fail closed; only explicit localhost HTTP is accepted for local development.
7. Configure `apps/mcp-worker` with `HYPERDRIVE`, `VERTICAL_SLUG`, the live-key
   namespace, exact MCP host/origin allowlist and `PUBLIC_ORIGIN`. It reuses the
   canonical database; it is not a second data backend.
8. Configure `apps/acquisition-worker` with `HYPERDRIVE`, `VERTICAL_SLUG`, the
   canonical `RAW_ARTIFACTS` R2 binding/name, and only the provider credentials
   needed by already admitted targets. No provider secret is a grant.
9. Record the environment bindings outside the repository and make them
   reproducible through deployment configuration/secret management rather than
   manual memory.

For a future upgrade from a deployment older than migration `0020`, temporarily
disable the acquisition Cron and confirm no invocation is active before applying
`0020`; then deploy the matching acquisition Worker SHA before re-enabling the
trigger. The older bundle does not supply the exact lease shape required for new
claims, while the newer bundle cannot select lease columns before the migration.
Migration `0020` starts a pre-upgrade active claim's 20-minute lease at the later
of migration time and its stored `claimed_at`. An abandoned claim can therefore
remain `ACTIVE` until that lease expires, and a future-skewed legacy timestamp can
extend the wait; retry after the recorded expiry rather than editing the row.
This coordination is unnecessary for the first deployment, where all migrations
are applied before any Worker or Cron is made live.

Migration `0023` intentionally creates no claims for legacy aliases: neither a
NULL `source_id` nor a historical source association proves current authority.
For an upgrade from a deployment older than `0023`, disable acquisition and
offline ingest, block the public/API/MCP publication routes, apply `0023`, and
deploy the matching query and ingest bundles before reopening those routes.
Re-ingest only rights-admitted sources so current finalized source records can
assert new claims, and add a curated claim only through an explicit reviewed
editorial action. Prove each enabled surface has the intended current identity
coverage before restoring traffic. This may temporarily hide legacy entities;
that fail-closed outage is preferable to manufacturing authority. On a first
deployment, apply every migration from the frozen release SHA (currently 28,
through `0028`) before enabling any route or Cron, then
ingest admitted sources with the matching bundle.

Migration `0024` adds explicit source-stream membership and complete-snapshot
retirement evidence. It intentionally marks every pre-`0024` record with unknown
stream membership non-current instead of guessing which stream asserted it. On
an upgrade, keep the same acquisition/ingest and publication block used for
`0023`, apply through `0024`, deploy the matching compiler/ingest/query bundle,
and re-ingest only rights-admitted sources. A stream may retire an omitted record
only when its mapping explicitly says `refresh_mode: full_snapshot`; an
`incremental` stream never treats absence as deletion. Verify the append-only
retirement rows cite the exact same-source artifacts before restoring traffic.

Migration `0025` requires every source-record alias claim to bind its exact
immutable `ALIAS` entity-evidence row. It deliberately does not infer that link
for existing evidence by matching a locator. On an upgrade from an older
deployment, keep acquisition/ingest and publication blocked through `0025`,
deploy the matching ingest/query bundle, and reingest only rights-admitted
sources. Prove exact identifier lookup and each enabled surface after reingest;
an unlinked historical source alias staying hidden is the intended fail-closed
result, not a reason to patch the row manually.

Migration `0026` adds the `(entity_id, id)` and `(fact_id, id)` evidence indexes
required for bounded, ordered surface-authorization probes. Its index creation
is intentionally ordinary rather than concurrent so the repository migration
remains transactional. Before applying it to an existing production database,
measure both tables on a production-like copy and schedule a write-safe window
for the observed index-build duration; record the lock/duration evidence. Do not
route production traffic to a new query bundle until `0026` is applied, and do
not claim the checked-in authorization ceilings as production capacity until the
isolated Worker/Hyperdrive probes above pass. The migration changes no grant,
evidence, or authority state.

Migration `0027` pins all 57 existing private functions to the exact trusted
search path, makes artifact evidence fully immutable, and narrows the
acquisition role's UPDATE surface. On an existing hosted `0001`–`0026` install,
verify the ledger/checksums and direct ACLs read-only first, then apply only
`0027`. Its ACL reconciliation accepts only the exact legacy, exact new, or
unprovisioned shape and refuses mixed/extra drift before mutation. Run the
exporter's read-only runtime `verificationSql` afterward; hosted success and
warning closure cannot be claimed until that exact-SHA check passes.

Migration `0028` adds exactly four FK-advisor-justified rights paths: nullable
source lookup for decision and terms cells, unique decision activation lookup,
and terms-version activation lookup. The other 31 INFO notices are non-blocking;
monitor them with post-traffic `EXPLAIN` and advisor evidence before considering
any additional write-amplifying index. Its ordinary `CREATE INDEX` statements
remain transactional and intentionally fail on a same-name collision. Before a
nonempty production upgrade, measure these four builds on a production-like copy
and schedule a write-safe window for the observed lock duration; do not replace
them with unchecked `IF NOT EXISTS` statements or silently adopt pre-existing
indexes outside the migration ledger.

### Verify

Mint a one-vertical `df_live_*` key, then an authenticated
`GET https://<your-route>/v1/health` with `Authorization: Bearer <key>` returns
200. An unauthenticated probe correctly returns 401. A 503 with
`x-unavailable-reason: configuration` means the binding is missing or
`VERTICAL_SLUG` is unset; `startup` means the database is unreachable. The Worker
never falls back to an empty in-memory database, so a 503 here is the intended
behaviour rather than a fault to work around.

Before accepting that health result as a database canary, inspect each upstream
role through the approved operator path and confirm its database-level search
path contains `data_foundry`, `pg_catalog`, and `extensions`, while excluding
`public`. Also confirm that `data_foundry` has no `PUBLIC` grantee while the
shared `public` schema's ACL was left untouched. Then exercise repeated
independent invocations of every Hyperdrive Worker role. Each must pass the
runtime private-schema verifier and must not reuse a connection from a previous
invocation. Run multiple independent queries and explicit transactions in each
probe; a single successful request is not proof that a transaction-pooled origin
will retain an application session setting.

Also verify that public pages query the same canonical data as REST/MCP and
that the usage consumer can persist a test event idempotently. A one-vertical
`MCP/NONE` `df_live_*` key must complete current `server/discover`, `tools/list`
and one `tools/call`; a direct or RapidAPI key must receive 403 at that same MCP
origin.

Verify the acquisition Worker separately: a terminal duplicate Cron slot is a
no-op; an unexpired concurrent owner fails retryably; an unexpected orchestration
failure that escapes expected terminal handling releases any still-owned claim
and resumes the same slot on the same database row; and an abandoned attempt can
be reclaimed after its 20-minute lease only by rotating the fencing token. Prove
that the stale token cannot pass `PRE_PERSISTENCE` or terminalize.
A missing/stale exact grant records refusal before provider construction,
transport, or R2; a revocation that lands while transport is in flight is
rechecked at `PRE_PERSISTENCE` before any R2 write or `NOT_MODIFIED` freshness;
and one authorized isolated target records the versioned run receipt plus
immutable R2 evidence. Also prove that an oversized declared and chunked direct
publisher response is refused without a partial object. No real source is
required for infrastructure proof. Browser Run proof must additionally cover
page and record ceilings, repeated-cursor refusal, cumulative decoded-artifact
limits, bounded provider diagnostics, and zero partial R2 writes. The deferred
ENERGY STAR proposal must remain untouched.

---

## 3. Vercel review and reversible Cloudflare cutover

Vercel has a `data-foundry` project (`prj_lU0xruXu9hA6A0UpZYeUZpxW3712`) and a
Production-domain configuration for `data.aroqon.com`, but it is **not** a
functional rollback: Git is disconnected, historical deployments fail because
no `public` output directory is produced, and the live data hostname currently
returns Vercel `404: NOT_FOUND`. The Cloudflare wildcard DNS record reaches
that failed Vercel target. Do not cut traffic back to it as a recovery plan.

### Checklist

1. Leave the current Vercel project available for forensic comparison, but do
   not call it a rollback or reconnect Git merely to mask the failed deployment.
2. Do not deploy the current private-canary workstream to `canary.aroqon.com`
   or another public hostname. A later public-canary phase must obtain separate
   authorization, then prove public data, cache headers, rights refusal, exact
   SHA, and repeated Hyperdrive schema isolation before changing the production
   hostname.
3. Before moving `data.aroqon.com`, obtain a specific owner confirmation at the
   point of action: it changes live traffic. Keep a verified Cloudflare canary
   deployment ready as the actual rollback path.
4. GitHub App installation `122728140` may require a GitHub owner passkey to
   inspect repository access. Do not use or request a passkey. It is unrelated
   to the Cloudflare deployment path.

### Verify

Record a successful Cloudflare canary and an exact deployment SHA before the
domain move. After cutover, test the canonical domain from a normal browser and
retain the successful canary deployment as the recovery target; Vercel's current
404 deployment is not recovery evidence.

---

## 4. Pay per crawl — enrollment, not implementation

Pay per crawl is a Cloudflare zone capability, not a Worker billing subsystem.
The repository's role is to provide a public site worth crawling; Cloudflare
controls enrollment, charging and payout mechanics.

### Checklist

1. Enroll the zone if the feature is available.
2. Keep normal search-engine crawlers allowed if organic search is a required
   acquisition channel.
3. Configure AI-crawler charging separately from search-engine crawling.
4. Connect the payout account required by Cloudflare.
5. Measure the effect on crawl volume and organic discovery before treating
   crawler revenue as primary.

### Verify

Charged crawler requests exhibit Cloudflare's expected payment behavior and
normal search crawlers remain able to index the public site.

---

## 5. Metered API and MCP analytics — built, awaiting live provisioning

The old statement that auth, tenancy and usage accounting were wholly absent is
stale. Protected `main` contains corrected usage-accounting semantics,
authentication and asynchronous usage persistence.

The merged implementation exists in migrations `0011`, `0012`, `0015`, and
`0018`, `packages/usage-events`, `apps/edge`, and `apps/usage-consumer`.
`apps/edge/src/auth.ts` authenticates and scope-checks every request before it
reaches a route, then publishes a usage event per successful request to a
Cloudflare Queue that `apps/usage-consumer` persists idempotently. Exact-SHA
repository verification and protected merge are complete; live Queue, DLQ, and
Hyperdrive proof remains a separate deployment gate.
`pnpm credentials:provision` now performs the tenant/key database transaction
and one-time secret delivery; running it against the live database
remains an operational action rather than another canonical API implementation.

Deliberately still absent, and out of scope for this increment: pricing,
plans, invoices, subscriptions, or any Stripe relationship. What exists
today is measurement, not billing — see `packages/usage-events` for the
event contract.

`apps/mcp-worker` uses the same shared database authenticator and Queue, but
accepts only the exact `MCP/NONE` pair. `NONE` is a billing source: the call is
authenticated and recorded for analytics, while remaining ineligible for Data
Foundry invoicing. These are custom high-entropy Data Foundry bearer keys, not
standards-based MCP OAuth tokens; no authorization server has been selected.

The command accepts a database connection only through `POSTGRES_URL`; inject it
through the approved secret-bearing environment before running these commands.
For Alpha Lab it opens only Data Foundry's private `data_foundry` schema; it must
not be pointed at a legacy/public installation. Never put the URL or a plaintext
API key on argv. File delivery intentionally
fails on native Windows because `chmod` is not an owner-only Windows ACL. Run
direct/MCP file delivery from Linux or WSL on a POSIX filesystem, and select an
absolute new path outside the git worktree. First validate, then provision a
direct paid customer credential:

Set the non-secret `CUSTOMER_SLUG`/`CUSTOMER_NAME` (or
`MCP_CLIENT_SLUG`/`MCP_CLIENT_NAME`) variables to the reviewed customer identity
before using the corresponding pair below.

```bash
pnpm credentials:provision -- --dry-run --environment live --tenant-slug "$CUSTOMER_SLUG" --tenant-name "$CUSTOMER_NAME" --vertical hvac --credential-label "production direct API" --access-tier API_PAID --billing-source DIRECT --output "/secure-delivery/${CUSTOMER_SLUG}-direct.json"
pnpm credentials:provision -- --environment live --tenant-slug "$CUSTOMER_SLUG" --tenant-name "$CUSTOMER_NAME" --vertical hvac --credential-label "production direct API" --access-tier API_PAID --billing-source DIRECT --output "/secure-delivery/${CUSTOMER_SLUG}-direct.json"
```

The second command exclusively creates a mode-`0600` one-time credential file
and refuses an existing path. It prints only the database credential id, display
prefix, fingerprint, classification, and selected path. Deliver that file using
the approved customer-secret channel; the database retains only the hash. After
the customer confirms receipt through that channel, securely remove the local
 mode-`0600` file and retain only its non-secret credential id/fingerprint receipt.
If the process is interrupted after the file is created but before the database
commit is confirmed, treat the file as an unconfirmed plaintext orphan: remove
it securely, inspect/revoke any matching database credential by non-secret id,
and retry with a new label. A completed-label replay never reconstructs a key.

Provision an MCP client the same way, with the independent analytics-only pair:

```bash
pnpm credentials:provision -- --dry-run --environment live --tenant-slug "$MCP_CLIENT_SLUG" --tenant-name "$MCP_CLIENT_NAME" --vertical hvac --credential-label "production MCP" --access-tier MCP --billing-source NONE --output "/secure-delivery/${MCP_CLIENT_SLUG}-mcp.json"
pnpm credentials:provision -- --environment live --tenant-slug "$MCP_CLIENT_SLUG" --tenant-name "$MCP_CLIENT_NAME" --vertical hvac --credential-label "production MCP" --access-tier MCP --billing-source NONE --output "/secure-delivery/${MCP_CLIENT_SLUG}-mcp.json"
```

Re-running an already completed tenant/vertical/label/classification is a no-op;
it never re-mints or tries to reconstruct the plaintext. A quarantined legacy
key may be classified only by adding its exact UUID as
`--classify-existing <credential-uuid>` and omitting every delivery flag.
Enrolling in pay per crawl does not produce a metered API, and a metered API
does not enrol the zone.

---

## 6. Usage-metering and private-canary queues

### Why automation cannot

Creating or reconfiguring a Cloudflare Queue changes account state. The
authoritative 2026-09-02T14:46Z refresh found the ordinary usage Queue and DLQ
already present with 14-day retention and zero consumers under the standard
usage model. Preserve and reverify that plan/retention state; do not recreate,
repurpose, or change retention on either shared queue.
The current private-canary path requires five new, dedicated 14-day canary
queues: a synthetic-metering Queue/DLQ pair and a control ingress/DLQ/quarantine
chain. Attaching consumers remains part of the route-less synthetic-canary
deployment and needs the exact provider evidence described above.

### Checklist

1. Preserve `data-foundry-usage-events` and
   `data-foundry-usage-events-dlq` at 1,209,600 seconds (14 days). Before a
   controlled deployment, verify both names still match
   `apps/edge/wrangler.toml` and
   `apps/mcp-worker/wrangler.toml`'s `[[queues.producers]]` blocks and
   `apps/usage-consumer/wrangler.toml`'s `[[queues.consumers]]`
   block exactly. Queue names are not credentials, but no queue mutation is
   authorized until the hosted private schema and route-less canary controls are
   ready.
2. Create or update all five dedicated canary queues at 1,209,600 seconds
   (14 days) before deploying the canary: synthetic metering goes from
   `data-foundry-private-canary-usage-events` to
   `data-foundry-private-canary-usage-events-dlq`; control goes from
   `data-foundry-private-canary-events` to
   `data-foundry-private-canary-dlq` and then to
   `data-foundry-private-canary-quarantine`. Read back, as sanitized provider
   evidence, those five names, their retentions, producers, consumers, retries,
   and dead-letter destinations. The synthetic-metering DLQ has no consumer; the
   shared usage DLQ must have no private-canary consumer. Check these bindings
   against both consumer blocks in
   `apps/usage-consumer/wrangler.private-canary.toml` and the private-canary
   consumer in `apps/private-canary/wrangler.toml`.
3. Provision `apps/usage-consumer`'s own least-privilege Hyperdrive binding;
   do not point it at `apps/edge`'s configuration. Each Worker role must use
   its own upstream database credential and have Hyperdrive SQL caching
   disabled, following section 2's steps.
4. Keep every tracked `wrangler.toml` free of live account, route and Hyperdrive
   ids. The conventional `wrangler.production.toml` path below is a later public
   production procedure. The current route-less canary must instead use the six
   ignored private-canary manifests: five reduced target Workers and the
   no-Hyperdrive harness, with the exact field restrictions in the 2026-09-01
   control at the top of this document. Its three deployment-mode checks also
   require all five ignored ordinary `wrangler.production.toml` manifests as
   collision controls; those ordinary manifests are not deployed in the canary
   phase. Protected values remain provider bindings, never manifest text or
   command output.
   For that later public procedure only, create the ignored deployment manifests
   from the repository root with:
   ```powershell
   Copy-Item apps/edge/wrangler.toml apps/edge/wrangler.production.toml
   Copy-Item apps/mcp-worker/wrangler.toml apps/mcp-worker/wrangler.production.toml
   Copy-Item apps/usage-consumer/wrangler.toml apps/usage-consumer/wrangler.production.toml
   Copy-Item apps/acquisition-worker/wrangler.toml apps/acquisition-worker/wrangler.production.toml
   Copy-Item apps/web/wrangler.toml apps/web/wrangler.production.toml
   ```
   Add the non-secret live binding/account/route/host values only to those five
   ignored files. All five must name the same exact 32-hex `account_id`. Set
   `PUBLIC_CACHE_MODE = "no-store"` in the web deployment manifest. Production
   rejects `cache` until rights-lifetime-aware invalidation exists.
    When the marketplace channel is enabled, add a second edge route for its
    dedicated origin hostname and set `RAPIDAPI_HOSTNAME` to that exact host.
    Keep the direct API on a different route so hostname-first classification
    cannot reinterpret a direct request as marketplace traffic. Do not infer the
    marketplace host from a request. The runtime and provisioner require a
    canonical public DNS name and
   reject loopback, unspecified, reserved (`.invalid`, `.example`, `.test`) and
   `workers.dev` names, including terminal-root-dot spellings. Before every
   `wrangler deploy --dry-run` or deploy, run:
   ```powershell
   pnpm cloudflare:deployment:check
   ```
   A successful check intentionally prints no account ids, routes, URLs, or
   secret values, so its receipt is safe to archive.
   Comparing tracked templates to `HEAD` is required: a plain working-tree diff
   ignores staged edits and could falsely pass after a live id was staged. Keep
   every non-secret live value in the matching ignored manifest rather than
   duplicating it on the command line. From the repository root, dry-run and
   deploy the five exact manifests with the repository-pinned Wrangler:
   ```powershell
   pnpm exec wrangler deploy --dry-run --config apps/edge/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --dry-run --config apps/web/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --dry-run --config apps/usage-consumer/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --dry-run --config apps/acquisition-worker/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --dry-run --config apps/mcp-worker/wrangler.production.toml --env-file tooling/wrangler-empty.env

   pnpm exec wrangler deploy --config apps/edge/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --config apps/web/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --config apps/usage-consumer/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --config apps/acquisition-worker/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler deploy --config apps/mcp-worker/wrangler.production.toml --env-file tooling/wrangler-empty.env
   ```
   Before those commands, store independently supplied protected values
   interactively without placing their values in shell history or any manifest.
   Use the exact Worker manifest that consumes each name. The RapidAPI proxy
   proof is externally supplied and remains an interactive secret:
   ```powershell
   pnpm exec wrangler secret put RAPIDAPI_PROXY_SECRET --config apps/edge/wrangler.production.toml --env-file tooling/wrangler-empty.env
   ```
   Create the dedicated marketplace tenant/key and pipe the newly minted
   `RAPIDAPI_API_KEY` directly to that Worker without echoing it or placing it
   on argv. `POSTGRES_URL` and authenticated Wrangler access must already be
   present in the process environment. The selected manifest is accepted only
   when it is the ignored `apps/edge/wrangler.production.toml`, retains the
   production/live, no-preview, no-invocation-log markers, and has its active
   exact nonzero 32-hex `account_id`, non-`workers.dev` production route, and
   nonzero 32-hex `HYPERDRIVE` id. The manifest's `API_KEY_ENVIRONMENT` and
   `VERTICAL_SLUG` must exactly match the requested credential scope. The
   provisioner runs the repository-pinned Wrangler entry point with a sanitized
   child environment and an explicit tracked empty env file, so caller-local
   `.env` and `.env.local` files cannot repopulate stripped variables. These
   values are validated but never printed:
   ```powershell
   pnpm credentials:provision -- --dry-run --environment live --tenant-slug rapidapi-hvac --tenant-name "RapidAPI HVAC marketplace" --vertical hvac --credential-label "production RapidAPI HVAC" --access-tier RAPIDAPI --billing-source RAPIDAPI --wrangler-secret RAPIDAPI_API_KEY --wrangler-config apps/edge/wrangler.production.toml
   pnpm credentials:provision -- --environment live --tenant-slug rapidapi-hvac --tenant-name "RapidAPI HVAC marketplace" --vertical hvac --credential-label "production RapidAPI HVAC" --access-tier RAPIDAPI --billing-source RAPIDAPI --wrangler-secret RAPIDAPI_API_KEY --wrangler-config apps/edge/wrangler.production.toml
   ```
   The marketplace handoff is deliberately ordered across a non-atomic provider
   boundary: the database transaction commits before Wrangler may replace an
   existing Cloudflare value. If Wrangler does not confirm success, the new
   database key is revoked. A process or network failure can be ambiguous after
   the provider receives the value, so do not assume the previous Cloudflare
   secret remains installed: verify the marketplace origin fails closed,
   inspect the Worker secret's provider metadata without reading its value,
   then provision a new label and replace the secret before restoring traffic.
   If the process is lost before Wrangler runs, revoke the reported/orphan
   database credential id and use a new label. A `CRITICAL` revocation error
   must be resolved before retrying.
   Add acquisition-provider secrets only for an exact rights-admitted target:
   `CLOUDFLARE_API_TOKEN` for Browser Run and/or `CRAWL4AI_API_TOKEN` for
   Crawl4AI. `CLOUDFLARE_ACCOUNT_ID` is a non-secret manifest variable when
   Browser Run is enabled. The acquisition Worker's tracked hourly Cron and
   non-secret vertical/bucket names otherwise remain unchanged.
   Set only the provider secrets the admitted runtime actually needs, using the
   acquisition Worker manifest so their values remain off argv and out of TOML:
   ```powershell
   pnpm exec wrangler secret put CLOUDFLARE_API_TOKEN --config apps/acquisition-worker/wrangler.production.toml --env-file tooling/wrangler-empty.env
   pnpm exec wrangler secret put CRAWL4AI_API_TOKEN --config apps/acquisition-worker/wrangler.production.toml --env-file tooling/wrangler-empty.env
   ```

   From the repository root, verify all five tracked templates together:
   ```powershell
   git diff --exit-code HEAD -- apps/edge/wrangler.toml apps/web/wrangler.toml apps/usage-consumer/wrangler.toml apps/acquisition-worker/wrangler.toml apps/mcp-worker/wrangler.toml
   ```

### Verify

A successful, authenticated `GET` against the edge Worker returns its answer
after Cloudflare Queues accepts its usage event, not after the consumer persists
that event to Postgres. Within a few seconds, `select count(*) from api_usage_events` on
the production database increases by one, and the row's `route_key` column
holds a registered key (`entities.detail`) rather than any path, query, slug,
or entity id. Confirm
`pnpm exec wrangler queues info data-foundry-usage-events --env-file tooling/wrangler-empty.env`
reports 1,209,600 seconds of retention. Killing the consumer Worker's database
connectivity temporarily must not change the edge Worker's response time or
status — that database-write decoupling is exercised (against PGlite, not this
queue) by `apps/edge/test/index.test.ts`. Before accepting paying traffic, also
verify invalid, revoked, expired and wrong-scope credentials fail before route
execution; duplicate delivery leaves one usage row; tenant and vertical remain
bound to the authenticating key; and real queue/DLQ behavior matches the tested
idempotency contract. Repeat the acceptance check through MCP: the row must use
only `mcp.server_discover`, `mcp.tools_list`, `mcp.tools_call`, or the fixed
protocol-failure class, have `POST`, `rows_served = 0`, and `MCP/NONE`, with no
tool name, arguments, JSON-RPC id, entity id, request target, or credential.
Also prove the workers.dev and preview URLs refuse traffic, then send a
non-secret URL canary and confirm no retained invocation log contains it.
`PUBLIC_CACHE_MODE` must remain `no-store`; production rejects `cache` because
request-time rights checks cannot revoke an object already retained by a browser
or shared intermediary. Exercise live purge, provider cache-bypass, and
stale-object probes as incident controls, but do not treat those manual checks as
authorization to enable shared caching. That requires a later implementation
whose cache keys and invalidation follow each exact rights lifetime.

---

## 7. RapidAPI / marketplace connection — proxy to Cloudflare, do not redeploy

RapidAPI should be treated as a marketplace/distribution and billing layer over
the canonical Cloudflare API. It does not require another database or another
copy of `apps/api`.

Target path:

```text
RapidAPI subscriber
        |
        v
RapidAPI gateway
        |
        | marketplace proxy-secret proof only
        v
Cloudflare API Worker
        | injects server-held RAPIDAPI_API_KEY
        |
        v
canonical query layer
```

### Checklist

1. Create a dedicated Data Foundry marketplace tenant/service credential using
   the existing API-key system and store it only as the edge Worker's
   `RAPIDAPI_API_KEY` secret.
2. Configure RapidAPI to send only its marketplace proxy proof. Do not store or
   forward the Data Foundry bearer in RapidAPI, public documentation, or
   client-generated snippets; marketplace-origin `Authorization` is ignored.
3. Store the independently supplied RapidAPI proxy secret as the edge Worker's
   `RAPIDAPI_PROXY_SECRET` and verify it on the marketplace hostname.
4. Classify the request as marketplace-originated only after both marketplace
   and Data Foundry authentication checks pass.
5. Record marketplace usage internally for reconciliation and unit economics,
   but do not feed those rows into future direct invoicing.
6. Publish `openapi/data-foundry-hvac-rapidapi-v1.openapi.json`, generated from
   the canonical API contract and drift-checked in CI. It deliberately omits
   the private Data Foundry origin bearer; RapidAPI subscribers authenticate to
   the marketplace, while only the Worker holds `RAPIDAPI_API_KEY`.
7. Disable/minimize marketplace request/response logging beyond what is needed
   operationally, particularly for query parameters that may reveal customer
   research patterns.
8. Perform a bypass test: direct requests to the marketplace hostname without
   valid marketplace proof must fail even if they attempt to spoof plan/channel
   headers.

### Billing rule

RapidAPI is the billing authority for marketplace-originated calls. Data
Foundry still pays its Cloudflare/Postgres infrastructure costs and records
usage, but must not issue a second invoice for the same requests. Direct API
customers remain on a separate billing source/channel.

---

## 8. Rights gate before any commercial route goes live

Deployment readiness is not publication-rights readiness. Accepted ADR-0010
distinguishes a public page from paid API, marketplace and sublicensed access.

Before enabling a paid Cloudflare route or RapidAPI listing:

1. Every contributing real source must have a reviewed rights decision.
2. The exact surface (`PUBLIC_WEB`, `SEARCH_INDEX`, `API_FREE`, `API_PAID`,
   `RAPIDAPI`, `MCP`, `BULK_EXPORT`, or another ADR-0010 surface) must resolve
   to an effective `ALLOW` or fully satisfied `CONDITIONAL` decision.
3. Every required attribution/condition must be enforced on that surface.
4. Unknown/absent grants fail closed.
5. Customer-facing terms must not grant rights broader than Data Foundry has.

Synthetic fixtures can prove deployment mechanics; they cannot satisfy this
commercial gate.

---

## 9. Production launch order

1. Freeze the live 40-character protected-main SHA and rerun its release gates;
   the reconciled rights, usage, auth/metering, web, RapidAPI, acquisition, and
   MCP baseline and PR #22 closeout hardening are merged through migration
   `0026`. Install it with `DATA_FOUNDRY_SCHEMA=data_foundry` in Alpha Lab, not
   in `public`. Do not reuse the pre-merge candidate evidence after a later main
   or deployment change.
2. Provision the isolated Alpha Lab roles/schema, five least-privilege runtime
   identities/Hyperdrives, R2, and the Queue/DLQ resources required by the
   route-less temporary canary. Do not change ordinary production Worker
   configuration at this stage.
3. Deploy and attest all six route-less private-canary Worker artifacts — five
   temporary reduced targets plus the no-Hyperdrive harness — then prove exact-SHA
   health/readiness, repeated Hyperdrive private-schema behavior, and real queue
   behavior before changing `data.aroqon.com`. Do not treat Vercel's current 404
   deployment as rollback.
4. Only after that private-canary proof and separate public authorization, deploy
   the five ordinary production Workers with their ordinary Cron/R2/Queue/route
   configuration.
5. Rights-clear and ingest the first real commercial vertical.
6. Mark a vertical `ACTIVE` only after its real-source review is complete, and
   enable public pages only for exact `PUBLIC_WEB` grants. A rendered page may
   be indexed or enter a sitemap only when `SEARCH_INDEX` covers those same
   rendered facts, attributions and relationships claim by claim.
7. Verify the acquisition Cron/R2 path only for an exact rights-admitted target;
   include the post-transport `PRE_PERSISTENCE` refusal and bounded-response
   negatives, and keep ENERGY STAR deferred and outside the runtime registry.
8. Configure the already-built thin RapidAPI channel and publish one marketplace
   vertical only after enrollment, proxy secret, plan/payout, and live subscriber
   proof.
9. Measure demand/cost before expanding plans, verticals or building first-
   party billing.

Public production requires `PUBLIC_CACHE_MODE=no-store`; the runtime rejects the
shared-cache mode. Live purge, provider cache-bypass, and stale-object probes are
still required incident controls because the repository controls response
headers, not every provider cache rule or purge result. Enabling public caching
requires a later reviewed implementation that binds cache retention and
invalidation to exact rights effective and expiry state.
