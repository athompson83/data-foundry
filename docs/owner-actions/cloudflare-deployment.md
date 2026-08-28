# Owner actions — Cloudflare deployment and monetization

Everything here needs a person in a dashboard or a billing relationship.
`apps/edge` and `apps/usage-consumer` are complete and tested; none of it can
reach a customer until these are done, and two of them are not code problems
at all.

Each item states what to do, why automation cannot, and how to verify afterwards.

---

## 1. Cloudflare account, zone and Worker route

### Why automation cannot

The repository has no Cloudflare credentials. `wrangler.toml` deliberately omits
`account_id`, the Hyperdrive `id` and the route: committing an account id is how
a repository starts carrying deployment-shaped secrets, and the values differ per
environment anyway.

### Checklist

1. Create (or choose) a Cloudflare account, and note the **Account ID** from the
   dashboard sidebar.
2. Add the production domain as a **zone** and move its nameservers to
   Cloudflare. Pay per crawl (§4) operates per zone and is unavailable without
   this — a Worker on `*.workers.dev` cannot be enrolled.
3. `npx wrangler login`, then set `account_id` in `apps/edge/wrangler.toml`.
4. Add a `route` (or a Workers Custom Domain) binding the Worker to the hostname
   the API should answer on.

### Verify

`npx wrangler deploy --dry-run` resolves the account and route without error.

---

## 2. Hyperdrive binding to Postgres

### Why automation cannot

Creating a Hyperdrive configuration means handing Cloudflare a live database
connection string. That is a credential this environment does not hold and should
not.

### Checklist

1. Have the production Postgres reachable from the public internet with TLS
   (Supabase is fine; note the **session pooler** connection string).
2. Apply migrations to it once: `POSTGRES_URL=postgres://... pnpm migrate`.
3. Create the config:
   ```
   npx wrangler hyperdrive create data-foundry \
     --connection-string="postgres://user:pass@host:5432/db"
   ```
4. Uncomment the `[[hyperdrive]]` block in `apps/edge/wrangler.toml` and paste
   the returned id.

### Verify

Mint a one-vertical `df_live_*` key, then an authenticated
`GET https://<your-route>/v1/health` with `Authorization: Bearer <key>` returns
200. An unauthenticated probe correctly returns 401. A 503 with
`x-unavailable-reason: configuration` means the binding is missing or
`VERTICAL_SLUG` is unset; `startup` means the database is unreachable. The Worker
never falls back to an empty in-memory database, so a 503 here is the intended
behaviour rather than a fault to work around.

---

## 3. Disconnect the Vercel Git integration

Carried over from ADR-0005, still outstanding.

### Checklist

Vercel dashboard → the project for this repository → Settings → Git →
**Disconnect**.

### Verify

A push creates no Vercel deployment and posts no `Vercel` commit status. Once
confirmed, delete `vercel.json` and amend ADR-0005 — until then the file is the
only thing suppressing failing deployments.

---

## 4. Pay per crawl — enrolment, not implementation

**This is not something the repository can build.** It is worth stating plainly
because it changes what "wire up pay per crawl" means.

### What it actually is

Per Cloudflare's documentation: pay per crawl is a feature of **AI Crawl
Control** that sets a **price per zone**. An AI crawler either presents payment
intent in request headers and gets `HTTP 200`, or receives `HTTP 402 Payment
Required` with the price in a `crawler-price` header. **Cloudflare is the
Merchant of Record**; payouts run through Stripe. It is configured entirely in
the dashboard.

So there is no Worker code to write. There is an account to enrol and a price to
set.

### Constraints that affect the plan

- **Closed beta.** Enrolment is via the pay-per-crawl signup form, or an account
  executive for existing Enterprise customers. Availability is not guaranteed and
  is outside anyone here's control.
- **Zone-scoped.** It prices content served through the Cloudflare zone — the
  human-facing pages a crawler fetches. It does **not** meter the JSON API per
  customer; that is item 5.
- **It trades against ad revenue.** Cloudflare's own guidance: setting Search
  Engine Crawlers to Charge or Block "may negatively impact your site's SEO
  performance, as search engines may not be able to properly index your
  content." A frontend monetized by ads needs search traffic, and search traffic
  needs crawlers that are not being charged. The two goals point in opposite
  directions and the split has to be chosen deliberately — charge the AI
  crawlers, allow the search crawlers — rather than enabled globally.
- **WAF and Bot Management override it.** A crawler blocked by either never
  reaches the charge.

### Checklist

1. Join the beta (signup form or account executive).
2. Dashboard → AI Crawl Control → Account Settings → set the domain's visibility
   to **Visible**.
3. **Payments** tab → Pay Per Crawl → Enable → set a default price (minimum
   $0.001 USD per crawl).
4. **Security** tab → per crawler, choose Charge / Allow / Block. Use the
   **Category** column to keep Search Engine Crawlers on **Allow** if the
   frontend is meant to rank.
5. Connect Stripe for payouts.

### Verify

An anonymous fetch of a payable page as a charged crawler returns `402` with a
`crawler-price` header. The Metrics tab reports successful deliveries.

---

## 5. Metered API access — built, but not provisioned

Distinct from item 4 and the larger revenue surface.

The code side is done: `db/migrations/0011_api_tenancy.sql` has the
tenant/API-key/usage schema, `apps/edge/src/auth.ts` authenticates and
scope-checks every request before it reaches a route, and `apps/edge`
publishes a usage event per successful request to a Cloudflare Queue that
`apps/usage-consumer` persists idempotently. What remains is provisioning —
item 6 below — and minting real API keys for real tenants, which is an
operational action (insert a row, hash and hand the secret to the customer
once) rather than a code change.

Deliberately still absent, and out of scope for this increment: pricing,
plans, invoices, subscriptions, or any Stripe relationship. What exists
today is measurement, not billing — see `packages/usage-events` for the
event contract.

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
   Both names must match `apps/edge/wrangler.toml`'s `[[queues.producers]]`
   block and `apps/usage-consumer/wrangler.toml`'s `[[queues.consumers]]`
   block exactly — they are already committed there, since a queue name is
   not a credential. The 14-day retention update requires a paid/configurable
   Workers plan; Workers Free is fixed at 24 hours and is not an eligible
   production accounting topology.
2. Provision `apps/usage-consumer`'s own Hyperdrive binding (or point it at
   the same Hyperdrive configuration `apps/edge` uses — both read and write
   the same database) following item 2's steps, then deploy both Workers:
   ```
   npx wrangler deploy   # from apps/edge
   npx wrangler deploy   # from apps/usage-consumer
   ```

### Verify

A successful, authenticated `GET` against the edge Worker returns its answer
immediately. Within a few seconds, `select count(*) from api_usage_events` on
the production database increases by one, and the row's `route_key` column
holds a registered key (`entities.detail`) rather than any path, query, slug,
or entity id. Confirm `npx wrangler queues info data-foundry-usage-events`
reports 1,209,600 seconds of retention. Killing the consumer Worker's database connectivity temporarily
must not change the edge Worker's response time or status — that decoupling
is the property this whole design exists for, and is exercised (against
PGlite, not this queue) by `apps/edge/test/index.test.ts`'s "the response
does not depend on the queue" suite.
