# Owner decision — direct API pricing and invoicing

Prepared 2026-09-16. This is the last commercial decision standing between a
deployed direct API and a paid machine request. It is deliberately a short
decision, not a pricing study: four questions, each with a proposed answer and
the reasoning behind it, so the owner can accept, adjust or reject rather than
start from a blank page.

Scope is the **direct `API_PAID` billed `DIRECT`** path only. RapidAPI has its
own billing authority and is structurally excluded from the direct invoice
projection — `aggregateDirectInvoiceEligibleUsage` is a closed `API_PAID`/`DIRECT`
predicate, so a marketplace call cannot become a direct invoice line. Pay per
crawl is a Cloudflare-merchant channel and has no access tier here at all.

**Nothing here can be published before `UA-001`.** Selling requires an active
`SELL_API_ACCESS` decision on `DIRECT_CUSTOMER_API`; a free tier is a separate
`API_FREE` surface with its own cells. Pricing that outruns the rights decision
is a promise the resolver will refuse to keep.

## What already exists

The web runtime carries four plans, presented as *hypotheses for validation* and
not purchasable, with `availability: prelaunch` and no listing URL:

| Plan | Monthly USD | Included requests |
| --- | --- | --- |
| Evaluate | 0 | 100 |
| Developer | 49 | 5,000 |
| Growth | 149 | 25,000 |
| Scale | 299 | 75,000 |

The implemented behaviour is a **hard stop at the allowance with no automatic
overage**. That is a real constraint, not a placeholder: changing it is
engineering work, not a number change.

> **Correction, 2026-09-19.** When this was written nothing enforced the hard
> stop — `api_keys` held no limits (ADR-0007) and no allowance existed anywhere.
> It is enforced now by [ADR-0014](../decisions/ADR-0014-request-allowance-hard-stop.md)
> and migration `0034`: a synchronous per-period reservation on every direct
> request, `429 QUOTA_EXHAUSTED` with `Retry-After` when spent, allowance headers
> on served responses, and the evaluation tier capped by the same mechanism.
> It reaches the hosted database only when `0034` and the regenerated grant
> SQL are applied there.

## Decision 1 — keep this ladder?

**Proposed: keep it, unchanged, for the first paying customers.**

Rationale. The ladder's shape is defensible for a slow-moving reference dataset:
upstream refreshes roughly every two weeks, so request volume is driven by a
customer's *own* catalogue size and integration cadence rather than by data
freshness. The $49 → $149 → $299 steps with 5× then 3× volume give a buyer an
obvious next rung without a negotiation, and the top rung is low enough that
anyone who outgrows it is a conversation worth having rather than a lost sale.

The honest caveat: these numbers have no observed cost or demand data behind
them, because there are no customers and no deployment telemetry. They are a
starting point chosen to be easy to raise. Raising a price after a small cohort
is normal; discovering that $299 undercuts your own serving cost is not
recoverable without repricing existing contracts.

**What would change the answer:** if per-request cost at Scale volume turns out
material against $299, the ladder needs a floor before the first contract, not
after. That measurement needs a deployment, which is `UA-002`.

| Decision | |
| --- | --- |
| Keep the four-tier ladder as-is | |
| Adjust — new values | |
| Different structure entirely | |

## Decision 2 — hard stop, or metered overage?

**Proposed: keep the hard stop.**

Rationale. A hard stop is what is built, it is honest about what the customer
will be charged, and it never produces a surprise invoice — which matters
disproportionately for machine clients, where a retry loop can burn an allowance
overnight with no human watching. Metered overage is the standard alternative and
it is strictly more engineering: an overage rate, a cap, a notification path, and
a dispute story for the first runaway agent.

The cost of the hard stop is real: a customer who hits the ceiling mid-month
stops getting data, which is worse for them than a small overage charge. The
mitigation is an upgrade path that takes effect immediately rather than at the
next cycle.

| Decision | |
| --- | --- |
| Hard stop at allowance (no code change) | |
| Metered overage — rate, cap | |

## Decision 3 — how is an invoice actually issued and collected?

**Proposed: manual invoicing for the first cohort, and no billing integration
before there is demand to justify it.**

> **Superseded, 2026-09-19.** The self-service direction removes manual
> invoicing, founder-led onboarding and interviews as launch prerequisites. The
> first paid channel is the existing RapidAPI adapter (marketplace billing,
> payout and per-subscriber plans handled by the marketplace); the direct path
> gets a hosted checkout with automatic entitlement provisioning **only** as the
> fallback when RapidAPI has a verified external blocker, and one channel is
> built at a time. The `api_entitlements` period, `RENEW_ENTITLEMENT` and
> `CANCEL_ENTITLEMENT` (ADR-0014) are the seams a payment provider's signed,
> idempotent events will drive. The cycle/currency/terms questions below remain
> the direct-path defaults; the invoicing *mechanism* is no longer a
> spreadsheet.

Rationale. The repository's own revenue analysis already concluded that building
self-service billing should not block launch, and nothing since has changed that.
The usage side is done — `API_PAID`/`DIRECT` events aggregate into an invoice
projection today — so what remains is issuing a document and taking a payment,
which for a handful of customers is a spreadsheet and a bank transfer, not a
system.

This is a deliberate trade of operational effort for avoided build cost, and it
stops being correct somewhere around the fifth or tenth customer.

Four things still have to be decided, because they appear on the first invoice:

| Question | Proposed | Decision |
| --- | --- | --- |
| Billing cycle | Monthly in arrears, aligned to the calendar month | |
| Currency | USD, matching the published plan values | |
| Payment terms | Net 30 | |
| Non-payment | Suspend at 30 days past due, after one notice; suspension disables the key rather than deleting the tenant | |

> **Capability note:** the Stripe connector is present in this session but not
> authorized, so no billing integration could be inspected or built even if it
> were wanted. Authorizing it is a claude.ai connector-settings action, and it is
> not needed for the manual path proposed here.

## Decision 4 — is there a free tier at launch?

**Proposed: yes, `Evaluate` at 100 requests/month, but only if `UA-001` returns
`API_FREE` permission.**

Rationale. A machine client cannot evaluate coverage without querying, and
coverage is exactly what this product asks buyers to check before subscribing —
the web copy already tells them to. 100 requests is enough to test an integration
and sample the data, and far too few to run anything on.

The catch is a rights one, not a commercial one: `API_FREE` is a distinct surface
from `API_PAID`. If the reviewer approves paid access but not free access, the
Evaluate tier cannot exist and the coverage claim has to be validated some other
way — most likely a published sample rather than a live tier.

| Decision | |
| --- | --- |
| Evaluate tier at 100/month, subject to `API_FREE` rights | |
| No free tier; publish a static sample instead | |
| Different allowance | |

## What happens once this sheet comes back

Engineering flips `availability` from `prelaunch`, publishes the agreed values,
and the direct paid path is commercially complete on the repository side. What
remains after that is deployment (`UA-002`) and an approved source (`UA-001`) —
neither of which this decision blocks, and both of which block it.
