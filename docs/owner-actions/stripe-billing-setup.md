# Stripe self-service billing — setup and verification

Implements [ADR-0014](../decisions/ADR-0014-self-service-stripe-billing.md). Everything below can be done by an operator or an agent that holds the credentials, except where marked **owner**.

## 1. Stripe account (owner, once)

- Activate the **Aroqon Data** Stripe account for live payments: business details, bank account and public business information. Until then it only has test mode.
- In the billing-portal settings, enable cancellation and plan switching between the product's prices.

## 2. Products and prices (per vertical, per mode)

Create one product per sellable vertical and one monthly recurring USD price per paid plan in `verticals/<slug>/product.yaml`. Use the same amounts as the published plans. Record the price ids as the deployment variable:

```toml
STRIPE_PRICE_IDS = '{"developer":"price_…","growth":"price_…","scale":"price_…"}'
```

Keys must be exactly the paid plan codes: the lowercased plan names. The edge refuses a missing, extra or malformed id.

### Created 2026-09-26 (test mode, "Aroqon Data sandbox")

The vehicles product (`prod_VKbcy7DLL3iNSH`) exists with the published ladder as monthly USD prices:

```toml
STRIPE_PRICE_IDS = '{"starter":"price_1UJy2bLseI5hfWcxupnIYPn0","developer":"price_1UJwPXLseI5hfWcxp9dzKYrn","growth":"price_1UJwPhLseI5hfWcxwDINPTMq","scale":"price_1UJx9GLseI5hfWcxFJftDHey"}'
```

Lookup keys: `vehicles_{starter,developer,growth,scale}_monthly`. Starter ($9 / 1,000 requests) was added under the conversion-first decision (`docs/commercial-validation/conversion-first-decision-20260926.md`), and the vehicles `product.yaml` must list the same plan. Recreate these in live mode after the account is activated; live ids differ.

## 3. Webhook endpoint

Register `https://api.data.aroqon.com/v1/billing/stripe-webhook` for these events:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

Store the endpoint's signing secret as a Worker secret. Never put it in a manifest.

```bash
pnpm exec wrangler secret put STRIPE_SECRET_KEY --config apps/edge/wrangler.production.toml
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET --config apps/edge/wrangler.production.toml
```

Use a **restricted key** where possible. It needs write access to Checkout Sessions and Billing Portal Sessions, and read access to Subscriptions.

## 4. Deployment variables (ignored `wrangler.production.toml`)

```toml
[vars]
STRIPE_PRICE_IDS = '…'
BILLING_PUBLIC_ORIGIN = "https://api.data.aroqon.com"
BILLING_RETURN_URL = "https://data.aroqon.com/<slug>/pricing"
```

All five settings are all-or-nothing: set none of them to disable billing, or all of them to enable it. Production requires `sk_live_`/`rk_live_`.

## 4a. Public pricing page (per vertical, `product.yaml`)

The web pricing page offers direct purchase only when `verticals/<slug>/product.yaml` declares the direct channel and the offer is `available`:

```yaml
availability: available          # also requires approved terms_policy, privacy_policy and support_contact
listing_url: null                # the RapidAPI listing is an independent channel; either, both or neither
direct_checkout:
  api_origin: https://api.data.aroqon.com   # bare HTTPS origin of the edge that serves /v1/billing/*
  path_prefix: "/v1/vehicles"               # the edge API_PATH_PREFIX; "" for an unprefixed deployment
```

Each paid plan then renders a plain HTML form that posts `plan=<code>` (and an optional `email`) to `<api_origin><path_prefix>/billing/checkout` (`<api_origin>/v1/billing/checkout` when the prefix is empty); the edge answers `303` to Stripe Checkout. The `$0` plan never gets a form. The vertical's `/docs` page documents the billing endpoints and the `429 ALLOWANCE_EXHAUSTED` response whenever `direct_checkout` is present, marked "not open yet" until the offer is `available`. Run `pnpm web:compile` after editing `product.yaml`. Set `BILLING_RETURN_URL` to that pricing page.

## 5. Database

Apply migration `0035` and the post-migration grant upgrade. That brings the runtime grants to 313 and the private functions to 60. Use the same controlled path used for `0027`–`0033`.

## 6. Verification (test mode first)

1. `GET /v1/billing/plans` lists the paid plans.
2. `POST /v1/billing/checkout` with `{"plan":"developer"}` returns a Checkout URL. Pay with Stripe test card `4242 4242 4242 4242`.
3. The redirect to `/v1/billing/claim?session_id=…` shows a `df_live_…` key once. A reload answers `409`.
4. The key answers `200` on `/v1/health`, and on data routes only where `API_PAID` rights are effective.
5. Cancel in the portal (`POST /v1/billing/portal`). The webhook suspends the tenant, and the key then answers `403`.
6. Record the evidence (session id, subscription id, event ids, status codes, no secrets) under `docs/evidence/`.
