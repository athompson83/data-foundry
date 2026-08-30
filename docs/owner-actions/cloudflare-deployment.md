# Owner actions — Cloudflare deployment and monetization

Everything here either requires a person in a dashboard/billing relationship or
coordinates repository work with Cloudflare resources that cannot be inferred
from source code alone.

The integration candidate contains the final five-Worker topology:
`apps/edge`, `apps/web`, `apps/usage-consumer`,
`apps/acquisition-worker`, and `apps/mcp-worker`. No production deployment of
this integration candidate is recorded or verified. Live Cloudflare account
state could not be inspected from the available environment; exact deployment
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
5. Bind the reviewed public web candidate to its production hostname/custom
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
2. Apply the exact repository migrations to production once.
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

## 3. Disconnect the legacy Vercel Git integration

Carried over from ADR-0005 and still independent of Cloudflare adoption.

### Checklist

Vercel dashboard → the project for this repository → Settings → Git →
**Disconnect**.

### Verify

A push creates no Vercel deployment/status. Only after that proof should
`vercel.json` be removed and the old ADR amended.

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

## 5. Metered API and MCP analytics — built, but not provisioned

The old statement that auth, tenancy and usage accounting were wholly absent is
stale. The integration candidate contains corrected usage-accounting semantics,
authentication and asynchronous usage persistence.

Candidate implementation exists in migrations `0011`, `0012`, `0015`, and
`0018`, `packages/usage-events`, `apps/edge`, and `apps/usage-consumer`.
`apps/edge/src/auth.ts` authenticates and scope-checks every request before it
reaches a route, then publishes a usage event per successful request to a
Cloudflare Queue that `apps/usage-consumer` persists idempotently. Exact-SHA
verification and merge, plus live Queue, DLQ, and Hyperdrive proof, remain
separate gates. Provisioning — item 6 below — and minting real API keys for real
tenants remain operational actions (insert a row, hash and hand the secret to
the customer once) rather than additional canonical API implementations.

Deliberately still absent, and out of scope for this increment: pricing,
plans, invoices, subscriptions, or any Stripe relationship. What exists
today is measurement, not billing — see `packages/usage-events` for the
event contract.

`apps/mcp-worker` uses the same shared database authenticator and Queue, but
accepts only the exact `MCP/NONE` pair. `NONE` is a billing source: the call is
authenticated and recorded for analytics, while remaining ineligible for Data
Foundry invoicing. These are custom high-entropy Data Foundry bearer keys, not
standards-based MCP OAuth tokens; no authorization server has been selected.

Nothing to do in a dashboard for *this* item beyond §6. Listed here so item 4
is not mistaken for it: enrolling in pay per crawl does not produce a metered
API, and a metered API does not enrol the zone.

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
   npx wrangler queues create data-foundry-usage-events-dlq
   npx wrangler queues create data-foundry-usage-events
   npx wrangler queues update data-foundry-usage-events --message-retention-period-secs 1209600
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
   ignored files. Set `PUBLIC_CACHE_MODE = "no-store"` in the web deployment
   manifest initially. Before every `wrangler deploy --dry-run` or deploy, run:
   ```powershell
   pnpm cloudflare:deployment:check
   ```
   A successful check intentionally prints no account ids, routes, URLs, or
   secret values, so its receipt is safe to archive.
   Deploy the edge and consumer from their directories with
   `npx wrangler deploy --config wrangler.production.toml`.
   Deploy the public Worker from `apps/web` with its exact non-secret
   `PUBLIC_ORIGIN` in the ignored manifest, not as a shell argument.
   Repeat the `--config wrangler.production.toml` form from `apps/edge` and
   `apps/usage-consumer`. Comparing to `HEAD` is required: a plain working-tree
   diff ignores staged edits and could falsely pass after a live id was staged.
   From `apps/mcp-worker`, deploy with its three exact non-secret values (quote
   the comma-separated origin value in the shell if it contains commas):
   ```powershell
   npx wrangler deploy --config wrangler.production.toml --var MCP_HOSTNAME:<mcp-host> --var MCP_ALLOWED_ORIGINS:https://<allowed-client-origin> --var PUBLIC_ORIGIN:https://<public-host>
   ```
   Deploy `apps/acquisition-worker` from its ignored manifest after adding the
   Hyperdrive id and canonical R2 binding. Its tracked hourly Cron and non-secret
   vertical/bucket names remain unchanged.

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
or entity id. Confirm `npx wrangler queues info data-foundry-usage-events`
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
`PUBLIC_CACHE_MODE` begins as `no-store`. It may change to `cache` only after a
live purge, provider cache-bypass check, and stale-object probes all pass; a
rights revocation first switches back to `no-store` and purges existing cached
objects because preventing new cache writes cannot remove older objects.

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
        | hidden Data Foundry bearer credential
        | marketplace proxy-secret header
        v
Cloudflare API Worker
        |
        v
canonical query layer
```

### Checklist

1. Create a dedicated Data Foundry marketplace tenant/service credential using
   the existing API-key system.
2. Store that credential as a hidden marketplace header; never expose it in
   public documentation or client-generated snippets.
3. Store the RapidAPI proxy secret as a Cloudflare secret and verify it on the
   marketplace path.
4. Classify the request as marketplace-originated only after both marketplace
   and Data Foundry authentication checks pass.
5. Record marketplace usage internally for reconciliation and unit economics,
   but do not feed those rows into future direct invoicing.
6. Export/generate the marketplace OpenAPI definition from the canonical API
   contract and add a drift check.
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

1. Review and land the already-reconciled rights, usage, auth/metering and web
   integration as one exact candidate; do not merge the stale PR trees blindly.
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

Public production starts in `PUBLIC_CACHE_MODE=no-store`. Switch to the bounded
shared-cache policy only after live purge, provider cache-bypass, and stale-object
probes have passed. For a rights revocation, switch back to `no-store` and purge
existing cached objects: disabling future cache headers does not remove objects
already retained by a provider. The repository controls response headers, not
every provider cache rule or purge result.
