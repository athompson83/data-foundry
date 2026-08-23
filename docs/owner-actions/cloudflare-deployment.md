# Owner actions — Cloudflare deployment and monetization

Everything here needs a person in a dashboard or a billing relationship.
`apps/edge` is complete and tested; none of it can reach a customer until these
are done, and two of them are not code problems at all.

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

`GET https://<your-route>/v1/health` returns 200. A 503 with
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

## 5. Metered API access — the part that is code, and is not built yet

Distinct from item 4 and the larger revenue surface.

`apps/api/README.md` is accurate: "No auth, no rate limiting, no tenancy. There
is no account, API-key or tenant concept anywhere in `db/migrations`." Metering
API requests per customer needs tables that do not exist — tenants, keys, usage
counters — plus a Stripe relationship for billing.

Nothing to do in a dashboard yet. Listed here so item 4 is not mistaken for it:
enrolling in pay per crawl does not produce a metered API, and building a metered
API does not enrol the zone.
