# ADR-0014 — Self-service Stripe billing for the direct paid API

**Status:** Accepted by Product Owner, 2026-09-26 ("Stripe self-service and RapidAPI service")

**Relates to:** ADR-0007 (rate limiting, accounting and quota are three systems), ADR-0009 (usage metering over a queue), ADR-0012 (capability hostnames), `docs/owner-actions/direct-api-pricing-and-invoicing-decision.md`.

## Context

The direct `API_PAID`/`DIRECT` channel had authentication, metering and a published plan ladder, but no way for a customer to pay. The earlier pricing decision sheet proposed manual monthly invoicing for a first cohort. The Product Owner chose self-service Stripe instead, alongside RapidAPI. The pricing page also promised a "hard stop at the allowance", but nothing enforced it.

## Decision

1. **Stripe Checkout (subscription mode) sells the vertical's published plans.** The plans in `verticals/<slug>/product.yaml` are compiled into the edge runtime. `STRIPE_PRICE_IDS` maps each paid plan code to a Stripe price id per deployment, because sandbox and live ids differ. A free plan is never sold through Checkout.
2. **The edge Worker owns the billing routes** on the direct API origin only:
   - `GET /v1/billing/plans` lists the purchasable plans.
   - `POST /v1/billing/checkout` starts a Checkout session.
   - `GET /v1/billing/claim` is the Checkout success page. It issues the API key.
   - `POST /v1/billing/stripe-webhook` receives signed subscription events.
   - `POST /v1/billing/portal` returns a Stripe billing-portal link. It requires the customer's API key.

   The RapidAPI origin never serves these routes.
3. **A paid key is an ordinary `API_PAID`/`DIRECT` key** scoped to one vertical. Rights, authentication, metering and every other gate apply unchanged.
4. **The key is shown once.** Provisioning is keyed on the Checkout session id, so the webhook and the redirect may arrive in either order. A reload returns `409 ALREADY_CLAIMED` rather than a second key.
5. **Webhooks are verified and idempotent.** The `Stripe-Signature` HMAC is checked with a 300-second tolerance. The event id and its effect commit in one transaction.
6. **Subscription state drives tenant state.**
   - `active`, `trialing` and `past_due` keep access. Stripe is still retrying a `past_due` card, and cutting a machine client off at the first failed charge would turn a declined card into an outage.
   - `unpaid`, `canceled`, `paused` and `incomplete` suspend the tenant, and authentication then answers 403.
   - A plan change moves the allowance.
7. **The monthly allowance is a hard stop, never an overage.**
   - Migration `0035` adds `api_tenant_allowances` and `api_usage_monthly_counters`.
   - The counter is incremented by an `AFTER INSERT` trigger on `api_usage_events`, so a replayed event never counts twice and a 5xx never counts at all.
   - At its allowance, a paid key receives `429 ALLOWANCE_EXHAUSTED` with `retry-after` set to the next UTC month.
   - Metering is asynchronous (ADR-0009), so a burst can overshoot by the queue lag. It is never billed.
   - Keys without an allowance row are unaffected: operator-provisioned, marketplace and MCP keys.
8. **Least privilege, extended narrowly.**
   - `df_edge` gains column-scoped `INSERT` on `api_tenants`/`api_keys` and `UPDATE (status, updated_at)` on `api_tenants`.
   - It also gets the new billing tables and `SELECT` on the counter.
   - It still cannot change a key's classification (0015/0018 trigger), read key labels or secrets, or modify usage history.
   - `df_usage` gains the counter table, for its trigger.
   - The runtime grant inventory is now 313 grants and 60 functions.
9. **Configuration is all-or-nothing.** The required settings are `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (Worker secrets), plus `STRIPE_PRICE_IDS`, `BILLING_PUBLIC_ORIGIN` and `BILLING_RETURN_URL`. A partial configuration refuses to start. Production accepts only live-mode keys. The topology checks refuse any of these in a tracked manifest.

## Consequences

- The "manual invoicing" proposal in the pricing decision sheet is superseded for the direct channel. Stripe issues invoices and receipts and collects payment.
- The public pricing page sells through this API only when the vertical's `product.yaml` declares `direct_checkout` (API origin and optional path prefix) and the offer is `available` with approved terms, privacy and support. Each paid plan is then a no-JavaScript form posting to `/v1/billing/checkout`. Direct checkout and the RapidAPI `listing_url` are independent: either, both or neither may be configured, and `available` requires at least one.
- RapidAPI remains an independent channel with its own billing authority. `RAPIDAPI` usage is never an allowance or Stripe matter.
- Revenue still requires a sellable dataset with effective `API_PAID` rights (ADR-0013). Billing sells access; it never creates permission.
- Owner-side prerequisites: an activated live Stripe account, and the webhook endpoint registered in Stripe. See `docs/owner-actions/stripe-billing-setup.md`.
