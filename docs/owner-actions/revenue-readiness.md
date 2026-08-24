# Owner actions — the revenue path, end to end

**Status check first, because it matters for how to read this document:**
ADR-0007, ADR-0008, ADR-0009 and `db/migrations/0012_usage_accounting_corrections.sql`
are proposed in PR #14 (`claude/df-usage-schema`); the auth/metering
implementation described below (`apps/edge/src/auth.ts`, `apps/usage-consumer`,
`packages/usage-events`) is proposed in PR #15 (`claude/df-edge-auth-metering`).
**Neither is merged to `main` as of this writing.** This document describes
the end-to-end path those two PRs design and partly implement, states plainly
where each piece stands, and stops short of any pricing, legal or financial
conclusion — those are the owner's decisions, not a repository's.

**Nothing here can be verified as "live" from this repository.** Everything
below that names a dashboard, a signup form, or a billing relationship is
something no code change can complete — and everything that names an open PR
is something a merge and a deploy have not yet completed either.

## The two revenue channels

| | Channel | Status |
|---|---|---|
| 1 | **Pay per crawl** — Cloudflare charges AI crawlers to fetch the free public site (`apps/web`) | Owner action, zone-scoped, closed beta |
| 2 | **Metered API access** — customers pay for programmatic reads of `apps/edge` | Designed and drafted (open PRs #14, #15) + a billing-collection decision still open |

Both channels read the SAME canonical data through the SAME query layer
(rule 5) — the free site is not a stripped-down preview of the paid API, and
the paid API is not a superset with different formatting. They differ in
audience, auth and cost model only, per
[ADR-0011](../decisions/ADR-0011-web-frontend-and-multi-industry-sites.md).

## Channel 1 — pay per crawl (the free site)

Per `docs/owner-actions/cloudflare-deployment.md` item 4, quoted here because
it is the fact this whole channel rests on:

> Pay per crawl is a feature of **AI Crawl Control** that sets a **price per
> zone**. An AI crawler either presents payment intent in request headers and
> gets `HTTP 200`, or receives `HTTP 402 Payment Required`... **Cloudflare is
> the Merchant of Record**; payouts run through Stripe. It is configured
> entirely in the dashboard.

**What this repository contributes:** `apps/web` is the thing being crawled —
a public, discoverable, SEO-correct site (ADR-0011) is the precondition for
this channel having any traffic to charge for. Nothing else. There is no
Worker code that implements pay per crawl, because there is none to write.

**What is an owner action, unavoidably:**
1. Join the pay-per-crawl beta (closed; signup form or an account executive).
2. Set a zone and a price in the Cloudflare dashboard.
3. Choose which crawler categories are Charged vs. Allowed — critically,
   **keep Search Engine Crawlers on Allow**. Charging Googlebot the same as an
   AI training crawler trades away the organic search traffic `apps/web`
   exists to earn; `cloudflare-deployment.md` states this tradeoff plainly and
   it has to be a deliberate choice, not a default.
4. Connect Stripe for payouts (Cloudflare's relationship, not this
   repository's).

**What this doc will not do:** state a price, predict revenue, or claim
enrollment is guaranteed. It is a closed beta; availability is Cloudflare's
call.

## Channel 2 — metered API access (the paid API)

### What is designed and drafted, pending review and merge

- **ADR-0007** (in PR #14) decides three separate systems — abuse protection,
  accounting, strict quota — fail in opposite directions on purpose, and that
  `api_keys` holds identity and scope, never a rate limit. On `main` today,
  `api_keys` still carries the earlier, unenforceable `rate_limit_per_minute`
  column PR #14 removes.
- **ADR-0008** (in PR #14) decides `api_usage_events` carries `tenant_id` and
  `vertical_id`, made unable to disagree with the authenticating key by two
  composite foreign keys — `db/migrations/0012_usage_accounting_corrections.sql`,
  not yet applied to `main`.
- **ADR-0009** (in PR #14) designs the metering pipeline: the edge Worker
  enqueues one message per billable response inside `ctx.waitUntil` (so
  metering is never on a paying customer's latency path and never able to
  block their request), a separate consumer Worker inserts batches
  idempotently, keyed on a producer-generated id so at-least-once delivery
  cannot double-bill.
- **PR #15** (`claude/df-edge-auth-metering`, draft as of this writing)
  implements the design against `main`'s current schema:
  `apps/edge/src/auth.ts` authenticates and scope-checks every request
  against `api_keys`/`api_tenants` before a route ever runs; `apps/usage-consumer`
  is the idempotent-persistence consumer; `packages/usage-events` is the
  shared message contract.

**In short: the metering and auth plumbing to know who called what, how
often, is designed and drafted — reviewed but not yet merged.** `apps/edge`
on `main` today serves reads with no auth and no metering at all; every claim
above describes what PR #14 and PR #15 would change, not what is deployed.

### What is not built, and is not a code problem

There is no prices/plans/invoices table anywhere in this schema, and that is
a decision recorded twice — 0011's closing note and ADR-0007's consequences —
not an oversight:

> What a caller is *entitled* to is a commercial arrangement, and this schema
> holds no commercial arrangements.

So `api_usage_events` can answer "what did tenant X read, and how much of
it" precisely. It cannot answer "how much does tenant X owe" without a
pricing model attached to it, and attaching one is a business decision this
repository does not make on its own:

- **Who bills, and how.** Two structurally different options, not a
  repository default:
  - **Cloudflare's own monetization**, if/when it extends beyond pay-per-crawl
    to a metered-API product — nothing to build, everything to watch for.
  - **A separate billing integration** (Stripe Billing's usage-based pricing
    is the common shape) that reads `api_usage_events` and turns it into
    invoices. This is new code this repository does not yet contain, and
    would be scoped as its own PR once the owner has chosen this path.
- **Pricing itself** — free tier size, per-call price, volume discounts. A
  business decision with no correct default; this document does not propose
  one.
- **Terms with API customers** — who is authorized to hold a key, what they
  may do with exported data (see `DATA_RIGHTS.md`, which already separates
  platform-code licensing from data licensing) — a legal decision, not a
  code one.

### The concrete unblock path, in order

1. **Decide the billing mechanism** (Cloudflare-native vs. a separate
   integration) — an owner decision with no dependency on anything else
   below.
2. **Merge PR #14 and PR #15 (or their successors), then deploy** — the schema
   correction and ADRs in #14, the auth/metering implementation in #15 — so
   `api_usage_events` starts actually filling with real traffic. Deployment
   itself is an owner action per `cloudflare-deployment.md`'s checklist
   (account, Hyperdrive, route), independent of the billing decision.
3. **If a separate billing integration is chosen**, that becomes new scoped
   work: a scheduled job or webhook that reads `api_usage_events` for a
   period, applies the chosen pricing, and creates invoices. Not started.
4. **Issue API keys to real customers** — needs both an actual customer
   relationship and terms (rights, pricing) settled first; this repository
   only mints and verifies the credentials (`packages/api-keys`), it does not
   decide who receives one.

## What ties the two channels together

`apps/web`'s docs page for each vertical (`{url_prefix}/docs`) is the
conversion point from channel 1 to channel 2: a person or agent who found the
free site through search or a crawl now knows the paid API exists and how to
reach it. Neither channel is complete without the other — pay-per-crawl has
nothing to charge for without a public site worth crawling, and the metered
API has no funnel without one.
