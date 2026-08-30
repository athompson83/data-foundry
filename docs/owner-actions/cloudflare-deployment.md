# Owner actions — Cloudflare deployment and monetization

Everything here either requires a person in a dashboard/billing relationship or
coordinates repository work with Cloudflare resources that cannot be inferred
from source code alone.

Protected `main` contains the final five-Worker topology:
`apps/edge`, `apps/web`, `apps/usage-consumer`,
`apps/acquisition-worker`, and `apps/mcp-worker`. No production deployment of
the integrated protected-main tree is recorded or verified. Live Cloudflare
account state could not be inspected from the available environment; exact deployment
IDs and runtime probes remain owner/platform evidence. Repository state is not
proof that Cloudflare resources or real-source rights have been provisioned.

The minimal owner/platform work is: choose the canonical account/zone and
database; provision Hyperdrive, one raw-artifact R2 bucket, the usage Queue/DLQ,
and the five Worker deployments; set protected values without exposing them;
then prove the exact deployed SHA, rights behavior, Queue persistence, Cron/R2
acquisition, and emergency public-cache purge. RapidAPI and MCP live-channel
proof are separate external gates.

---

## 1. Cloudflare account, zone and Worker routes

### Why automation cannot finish this from repository code alone

The repository does not contain production account identifiers, routes,
Hyperdrive configuration ids or credentials. Those are environment facts and
must remain outside source control.

### Checklist

1. Create or choose the Cloudflare account.
2. Add the production domain as a Cloudflare zone and move its nameservers.
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

---

## 2. Hyperdrive binding to Postgres

### Why this is operational

Creating Hyperdrive requires a live production database connection string. The
credential must not be committed.

### Checklist

1. Provision the production Postgres database and require TLS.
2. Supply `POSTGRES_URL` only through the approved secret-bearing environment,
   then apply the exact repository migrations twice from the frozen release SHA:
   ```powershell
   pnpm migrate
   pnpm migrate
   ```
   The first run must apply every pending migration and the second must report
   all 25 migrations already applied. Do not pass the connection string on argv
   or archive it with the command receipt.
3. Create a Hyperdrive configuration for the API Worker.
4. Configure the usage-consumer Worker with its `HYPERDRIVE` binding.
5. Configure the public Worker with `HYPERDRIVE` and the non-secret
   `PUBLIC_ORIGIN=https://<public-host>` value. Missing or non-origin values
   fail closed; only explicit localhost HTTP is accepted for local development.
6. Configure `apps/mcp-worker` with `HYPERDRIVE`, `VERTICAL_SLUG`, the live-key
   namespace, exact MCP host/origin allowlist and `PUBLIC_ORIGIN`. It reuses the
   canonical database; it is not a second data backend.
7. Configure `apps/acquisition-worker` with `HYPERDRIVE`, `VERTICAL_SLUG`, the
   canonical `RAW_ARTIFACTS` R2 binding/name, and only the provider credentials
   needed by already admitted targets. No provider secret is a grant.
8. Record the environment bindings outside the repository and make them
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
deployment, apply all 25 migrations before enabling any route or Cron, then
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

### Verify

Mint a one-vertical `df_live_*` key, then an authenticated
`GET https://<your-route>/v1/health` with `Authorization: Bearer <key>` returns
200. An unauthenticated probe correctly returns 401. A 503 with
`x-unavailable-reason: configuration` means the binding is missing or
`VERTICAL_SLUG` is unset; `startup` means the database is unreachable. The Worker
never falls back to an empty in-memory database, so a 503 here is the intended
behaviour rather than a fault to work around.

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

## 3. Verify and remove only stale Data Foundry Vercel App access

There is no Data Foundry project in the connected Vercel team, no repository
webhook, and recent commits have no Vercel status. GitHub App installation
`122728140` still exists, but its exact repository selection is hidden behind an
independent GitHub owner sudo/passkey ceremony. This hygiene item remains
independent of Cloudflare adoption and does not block protected merge or deploy.

### Checklist

Open <https://github.com/settings/installations/122728140>, complete the GitHub
owner sudo/passkey prompt, and inspect **Repository access**. If and only if
`athompson83/data-foundry` is selected, remove that repository without changing
access for other Vercel-managed repositories. Keep `vercel.json` until this
selection check proves Data Foundry has no remaining App access.

### Verify

Record the repository-selection result without credentials. Delete
`vercel.json` only in a separately reviewed cleanup after absence of App access
is proved; the already-verified lack of a Vercel project alone is insufficient.

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
Never put the URL or a plaintext API key on argv. File delivery intentionally
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

## 6. The usage-metering queue and its dead-letter queue

### Why automation cannot

Creating a Cloudflare Queue is an account-scoped action; this environment has
no Cloudflare credentials to make the API call with, the same constraint as
item 1.

### Checklist

1. Create the dead-letter queue first, since the main queue's config
   references it:
   ```
   pnpm exec wrangler queues create data-foundry-usage-events-dlq --env-file tooling/wrangler-empty.env
   pnpm exec wrangler queues create data-foundry-usage-events --env-file tooling/wrangler-empty.env
   pnpm exec wrangler queues update data-foundry-usage-events --message-retention-period-secs 1209600 --env-file tooling/wrangler-empty.env
   ```
   Both names must match `apps/edge/wrangler.toml` and
   `apps/mcp-worker/wrangler.toml`'s `[[queues.producers]]` blocks and
   `apps/usage-consumer/wrangler.toml`'s `[[queues.consumers]]`
   block exactly — they are already committed there, since a queue name is
   not a credential. The 14-day retention update requires a paid/configurable
   Workers plan; Workers Free is fixed at 24 hours and is not an eligible
   production accounting topology.
2. Provision `apps/usage-consumer`'s own Hyperdrive binding (or point it at
   the same Hyperdrive configuration `apps/edge` uses — both read and write
   the same database) following item 2's steps.
3. Keep every tracked `wrangler.toml` free of live account, route and Hyperdrive
   ids. For CLI deployment, copy each service manifest beside the original as
   `wrangler.production.toml`; the five conventional paths are already ignored
   by this repository. Put only non-secret live account/binding ids, routes, and
   exact host/origin values in those copies. Protected values remain Wrangler
   secrets or provider bindings, never manifest text or command output.
   From the repository root, create the ignored deployment manifests with:
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
   MCP implementation is already merged.
2. Provision Cloudflare Postgres/Hyperdrive, all five Workers, R2, Queue/DLQ,
   routes and secrets.
3. Deploy and prove exact-SHA health/readiness plus real queue behavior.
4. Rights-clear and ingest the first real commercial vertical.
5. Mark a vertical `ACTIVE` only after its real-source review is complete, and
   enable public pages only for exact `PUBLIC_WEB` grants. A rendered page may
   be indexed or enter a sitemap only when `SEARCH_INDEX` covers those same
   rendered facts, attributions and relationships claim by claim.
6. Verify the acquisition Cron/R2 path only for an exact rights-admitted target;
   include the post-transport `PRE_PERSISTENCE` refusal and bounded-response
   negatives, and keep ENERGY STAR deferred and outside the runtime registry.
7. Configure the already-built thin RapidAPI channel and publish one marketplace
   vertical only after enrollment, proxy secret, plan/payout, and live subscriber
   proof.
8. Measure demand/cost before expanding plans, verticals or building first-
   party billing.

Public production requires `PUBLIC_CACHE_MODE=no-store`; the runtime rejects the
shared-cache mode. Live purge, provider cache-bypass, and stale-object probes are
still required incident controls because the repository controls response
headers, not every provider cache rule or purge result. Enabling public caching
requires a later reviewed implementation that binds cache retention and
invalidation to exact rights effective and expiry state.
