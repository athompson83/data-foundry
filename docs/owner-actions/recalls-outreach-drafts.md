# Recall API outreach drafts (not sent)

**Status: drafts only. Nothing here has been sent.** Send only after authenticated acceptance of both recall datasets passes ([record](../evidence/recalls-release-20260928.md)) and after the Product Owner approves the recipient list. Claims below are limited to what is verified live: coverage, freshness and provenance. Do not add customer, usage or revenue claims.

## 1. Developer / product-safety tooling (short email)

Subject: Recall lookups by NDC, UDI, lot, model or UPC, as one API

> Hi {first name},
>
> {Company} works with {product data / compliance / marketplace listings}, so recall checks are probably on your list somewhere.
>
> We run a read-only API over FDA food, drug and device recalls (about 87,000 since 2012) and CPSC and Health Canada consumer-product recalls (about 15,000). You can look records up by NDC, UDI, lot, model number or UPC. Every record carries its source URL and a SHA-256 of the original agency record, and data refreshes every six hours.
>
> There is a free tier of 100 requests a month, with no card needed for Evaluate: https://data.aroqon.com/docs
>
> If a recall match against your catalog would be useful, I'm happy to run one sample for you.
>
> {name}, Aroqon Data

## 2. Marketplace / e-commerce compliance (short email)

Subject: Flag recalled products in your catalog by model number and UPC

> Hi {first name},
>
> Listing a product that has been recalled is a compliance and trust problem for marketplaces. Our API matches model numbers and UPCs against CPSC and Health Canada recall notices, and cross-links a US and Canadian notice only where the agency itself cites the other. It also covers FDA recalls for food, drug and device listings.
>
> Docs and the free tier: https://data.aroqon.com/docs. Paid plans start at $49 a month for 5,000 requests.
>
> {name}, Aroqon Data

## 3. Developer community post (plain text)

> We published structured FDA, CPSC and Health Canada recall data as a JSON API: lookup by NDC, UDI, lot, model or UPC; filters for hazard, remedy and trade facet; `changed_since` sync; and per-record provenance (source URL plus the SHA-256 of the agency record). The free tier is 100 requests a month. https://data.aroqon.com/docs
