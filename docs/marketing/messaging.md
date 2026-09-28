# Messaging — Recall data products

Drafted 2026-09-28 by the portfolio growth lead, for the Product Owner's review.
Nothing here has been published. Sources: `docs/decisions/ADR-0015-*.md`,
`docs/decisions/ADR-0016-*.md`, `docs/README.md` service descriptions as read
on 2026-09-28. Any number without a citation is `[NEEDS DATA]` — do not fill
it in from memory.

## Why now

FDA Recall Intelligence went live and sales-open on 2026-09-27 (ADR-0015).
North American Consumer Product Recalls (CPSC + Health Canada) deployed
2026-09-28 (ADR-0016); its Product Owner acceptance is still pending, so it is
not yet a claim this document makes publicly — treat it as "coming" until
accepted. As of this draft, Stripe shows zero active subscriptions on the
live Aroqon Data account and no product-repo marketing collateral exists
(`docs/marketing/` was empty before this file). The product can take a
payment today and nothing is pointing anyone at it.

## Category

Machine-readable recall data, delivered as a REST API (and human catalog
pages) for developers, compliance/QA tooling builders, and AI-agent builders
who need to check whether a product, lot, GTIN/NDC or device was recalled —
without parsing government PDF and HTML feeds themselves.

## One-line value proposition (FDA Recall Intelligence — live, sellable today)

**Query FDA food, drug and device recalls by lot, GTIN/NDC, UDI or serial —
structured, with the geography and quantity extracted from the prose, not
just the raw bulletin.**

Substantiation for every claim above, all from ADR-0015, measured over the
full 87,356-record set on 2026-09-26:
- distribution geography extracted for 92–98% of records
- a single-amount quantity for 70–84%
- lots for 31–51%
- GTIN/UPC/UDI for 31–37% of food and device records
- NDC for 51% of drug records
- source is openFDA, CC0 1.0, official API, no scraping
- deterministic parser, no model inference, zero parse errors on the
  measured set

Do not claim 100% extraction, real-time freshness beyond what's documented, or
coverage of drug/device fields the ADR doesn't state. The Cron re-reads a
recent window and one rolling history window every six hours (ADR-0015) —
that is the freshness claim, not "real-time."

## Three pillars

1. **Structured, not scraped.** Deterministic extraction of lots, GTIN/UPC/UDI
   and NDC from free-text `code_info` fields, each with per-field provenance.
   Proof: the extraction-rate numbers above, and the "no parse errors"
   result.
2. **Built for machines first.** REST API at `api.data.aroqon.com`, human
   catalog at `data.aroqon.com`, same canonical data. Every plan (including
   the $0 tier) issues a real API key through Stripe Checkout. Proof: the
   plan ladder below.
3. **Verifiable back to the source.** Every record carries a `raw_sha256` and
   a byte range into the original openFDA record; `include=raw` serves the
   original bytes after checking the digest. Proof: ADR-0015 §Decision.2.

## Pricing (quote exactly — do not round or re-derive)

Evaluate $0/mo (100 req) · Developer $49/mo (5,000 req) · Growth $149/mo
(25,000 req) · Scale $299/mo (75,000 req). Allowances are a hard stop, no
overage (ADR-0015). Every tier goes through Stripe Checkout. Confirm this
ladder against `packages/billing` / the live Stripe price objects before any
public page quotes it, since pricing can change after this draft is written.

## Objections and answers

- **"Why not just hit openFDA myself?"** You can, and openFDA's raw feed is
  free — the paid product is the structuring: lots, GTINs, NDCs and
  geography already extracted from prose, with provenance, at a documented
  extraction rate you can check before you build on it.
- **"Is this official FDA/CPSC data?"** It is sourced from openFDA and CPSC's
  public APIs and Health Canada's public index; Data Foundry is not FDA,
  CPSC, Health Canada or any government agency, and does not claim their
  endorsement. State this plainly on any public page.
- **"What if a record's fields are wrong?"** Every derived field carries
  provenance back to the original raw record (`raw_sha256`), so a customer
  can verify any field against source. Ambiguous extractions (e.g. state
  codes) list context rather than guessing.

## Words to avoid

- "real-time" (the sync cadence is six-hourly, per ADR-0015/0016)
- "complete" or "100% coverage" (extraction rates are 31–98% by field, not
  100%)
- "official," "certified by FDA/CPSC/Health Canada," or anything implying
  government endorsement
- any customer count, usage number, or testimonial — none exist yet
  (`[NEEDS DATA]`; Stripe shows 0 active subscriptions as of 2026-09-28)

## North American Consumer Product Recalls (ADR-0016) — do not publish claims yet

This dataset is deployed but Product Owner acceptance is explicitly pending.
Do not write public-facing copy claiming it is available for purchase until
that acceptance is recorded and `PRODUCT_RECALLS_OPEN` is confirmed serving.
Once accepted, its pillars mirror the FDA product: CPSC + Health Canada,
linked by declared citation (342 of 371 citing recalls resolve per ADR-0016),
GTIN check-digit validation, same plan ladder, same hostnames
(`/product-recalls`). MCP, RapidAPI and bulk export are rights-permitted for
it but not enabled — don't advertise channels that aren't live.
