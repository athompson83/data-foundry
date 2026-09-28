# SEO / developer-marketing plan — recall data products

Drafted 2026-09-28 by the portfolio growth lead. Assumptions and data
sources: ADR-0015, ADR-0016, `docs/README.md` rights table, Stripe
(`Aroqon Data`, live: 0 active subscriptions as of 2026-09-28), Vercel
project list (no Web Analytics enabled on any `data-foundry`-named Vercel
project — see note below), Cloudflare dashboard for `data-foundry-recalls`
[NEEDS DATA: not connected this session]. Nothing in this plan is published;
it is a recommendation for the Product Owner and next week's content run.

## Important infrastructure note

`data.aroqon.com` and `api.data.aroqon.com` serve from a Cloudflare Worker
(ADR-0015 §Decision.3), not from the Vercel `data-foundry` project. Vercel
Web Analytics on that Vercel project will never show this product's real
traffic — checking it would give a false "zero visitors" reading regardless
of actual usage. Traffic/signup numbers need the Cloudflare dashboard for
`data-foundry-recalls`, or a query against the D1 store for API-key
issuance and request counts. **Action for the Product Owner or engineering:**
confirm which of these is fastest to read, since this session has no
Cloudflare MCP connector.

## Goal and metric

North-star for this product: paid API keys issued (Developer tier or above),
read from Stripe on the `Aroqon Data` live account. Currently 0. Secondary:
Evaluate ($0) signups, as a proxy for developer interest before anyone pays.

## Audience and job-to-be-done

A developer or compliance engineer who needs "has this lot/GTIN/NDC been
recalled" answered inside their own product (a pharmacy system, a retailer's
inventory check, an AI agent doing due diligence) and is currently choosing
between: building their own openFDA/CPSC scraper, paying for a much larger
general compliance-data vendor, or doing nothing and checking manually.

## Where the funnel leaks (today)

- **Discovery:** no third-party surface points at `data.aroqon.com` or
  `api.data.aroqon.com` yet — no blog post, no directory listing, no MCP
  directory entry (MCP isn't enabled for this dataset per ADR-0015 anyway).
  `docs/marketing/` had no content before this draft.
- **Measurement:** no connector in this session reaches Cloudflare Worker
  analytics or D1 directly, so even if traffic exists, growth-hq cannot see
  it yet. Fix this before spending effort on more content — see the
  infrastructure note above.
- **Conversion:** every tier, including $0, requires a Stripe Checkout
  session (ADR-0015), which is a real but non-trivial step for a developer
  who just wants to try an endpoint. Whether an unauthenticated sample
  request/sandbox exists is `[NEEDS DATA: check apps/api and the Worker's
  public routes for an unauthenticated sample endpoint]`; if none exists, a
  free sample response embedded in the docs page substitutes for one without
  code changes.

## The plays

Ranked ICE (impact / confidence / ease, 1–10):

1. **Publish one developer-facing pillar page per live dataset, built from
   ADR-0015's real extraction-rate numbers, targeting long-tail
   developer-intent queries.** Impact 7, Confidence 4 (hypothesis — first
   content for this product, no prior data), Ease 7 (docs-as-marketing, no
   app code). Target queries: "FDA recall API", "drug recall lookup by NDC
   API", "GTIN recall check API", "openFDA structured data API". One pillar
   page per dataset, linking to `data.aroqon.com/recalls/docs`, with a real
   FAQPage/SoftwareApplication structured-data block once a page exists to
   attach it to.
2. **Submit the API to 2–3 developer-tool directories/aggregators (e.g. API
   marketplaces, "awesome" lists for compliance/regtech) with the real
   pricing ladder and no invented use-case claims.** Impact 5, Confidence 5,
   Ease 8. This is outbound/directory listing, not cold email — check each
   directory's own submission terms before listing (§7/§8 of the growth
   playbook: no fabricated claims, PO approval before anything is actually
   submitted since it's a form of publishing).
3. **Ask engineering whether an unauthenticated sample request exists; if
   not, embed 2–3 real example request/response pairs (using already-public
   ADR numbers, not live customer data) directly in the docs page** so a
   developer can evaluate the shape of the data before creating a Stripe
   session. Impact 6, Confidence 6, Ease 8.

Recommendation: do #1 first — it's the only one that produces something
indexable, and it's a prerequisite for #2 (a directory listing needs a page
to point to). #3 is cheap and can run in parallel once engineering confirms
whether a sample exists.

## Measurement

For play #1: once published and indexed (check via `site:data.aroqon.com`
search or Cloudflare/GSC once connected), predict at least 1 Evaluate ($0)
signup within 14 days of indexing, checked against Stripe
(`Aroqon Data`, live). Kill criterion: 0 signups of any tier within 30 days
of confirmed indexing — if so, the leak is more likely conversion (Checkout
friction) or targeting than discovery, and the next test should be #3, not
more content.

## Compliance notes specific to this product

- Every public claim traces to ADR-0015/0016's own measured numbers — do not
  round up or extrapolate to fields the ADRs don't cover.
- State plainly that Data Foundry is not FDA, CPSC or Health Canada and
  carries no government endorsement (FTC truth-in-advertising).
- Do not publish anything about North American Consumer Product Recalls as
  "available now" until the Product Owner's acceptance is recorded (see
  `messaging.md`).
