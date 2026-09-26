# Rights record — openFDA enforcement reports (food, drug, device)

**Decision:** GREEN for acquisition, storage, normalization, derivation, free and paid direct API, and redistribution of normalized data. Approved 2026-09-26 under the Product Owner's standing instruction: "I fully approve any available dataset that you find as long as you logically identify that there are no restrictions." Next review: 2027-03-26, or immediately if the openFDA terms change.

## Source

| | |
| --- | --- |
| Publisher | U.S. Food and Drug Administration |
| Endpoints | `https://api.fda.gov/{food,drug,device}/enforcement.json` (the official machine API; no scraping) |
| Records | Snapshot of 2026-09-26: 29,415 food, 17,975 drug and 39,969 device reports, with report dates from 2012-06-20 to 2026-09-16 (openFDA `last_updated` 2026-09-16). Loaded: 87,354 recalls. Held as evidence only, with no stable identity: 2 reports with the placeholder recall number `N/A` and 3 with none |
| Refresh | openFDA's own cadence is not verified here (its `last_updated` was 2026-09-16 when checked on 2026-09-26); the Worker polls every 6 hours, so it picks up changes whenever openFDA publishes |
| Terms | <https://open.fda.gov/terms/>, retrieved 2026-09-26 |
| License | <https://open.fda.gov/license/> (CC0 1.0 Universal) |

## Evidence, verbatim from the terms page, retrieved 2026-09-26

> Unless otherwise noted, the content, data, documentation, code, and related materials on openFDA is public domain and made available with a Creative Commons CC0 1.0 Universal dedication. […] You can copy, modify, distribute, and perform the work, even for commercial purposes, all without asking permission.

> Some data on openFDA may not be public domain, such as copies of copyrightable works made available to the FDA by private entities. […] Works where CC0 do not apply will be clearly marked by a warning in the relevant documentation.

> While not required, when using content […] from openFDA in your own work, we ask that proper credit be given.

## Reasoning — why no restriction applies

1. **Copyright.** The enforcement-report fields are FDA-authored regulatory records: recall number, classification, firm, reason, distribution pattern, quantity and code information. They are US Government works under 17 U.S.C. §105 and are also expressly CC0. They are not "copies of copyrightable works made available to the FDA by private entities" (that carve-out covers things like submitted labels and documents). No enforcement documentation carries the non-CC0 warning.
2. **Commercial use and redistribution.** CC0 expressly permits both. Selling API access to a derived, normalized form is within "copy, modify, distribute […] even for commercial purposes".
3. **Access method.** The official API is the sanctioned machine interface. openFDA's keyless rate limits were not re-read in this session; commonly documented as 240 requests per minute and 1,000 per day per IP `[UNVERIFIED]`. The initial load used about 180 requests. Steady state is 6 small windowed queries every 6 hours, at most ~30 requests a day. The User-Agent identifies Data Foundry and the contact address. `api.fda.gov/robots.txt` returns 404, so it imposes no crawl restriction.
4. **Endorsement and trademark.** Pages, docs, terms and every API response state that Data Foundry is not affiliated with or endorsed by FDA. No FDA logo or seal is used.
5. **Personal data.** The records identify recalling firms, not individuals. Firm addresses are business addresses published by FDA.
6. **Images.** None are acquired or served (rule 9).
7. **Medical-use limitation.** openFDA's disclaimer ("Do not rely on openFDA to make decisions regarding medical care") is carried through in the API attribution, docs and terms. It is a limitation on use, not on redistribution.

## Exact fields redistributed

Every field below was measured present in the 2026-09-26 snapshot. All of them are served, verbatim under `raw` (`include=raw`), and the listed ones also in structured form.

| Group | Fields | Rights basis |
| --- | --- | --- |
| FDA enforcement report | `recall_number`, `event_id`, `status`, `classification`, `product_type`, `voluntary_mandated`, `initial_firm_notification`, `recall_initiation_date`, `center_classification_date`, `report_date`, `termination_date`, `reason_for_recall`, `distribution_pattern`, `product_description`, `product_quantity`, `code_info`, `more_code_info` | FDA regulatory records: a US Government work and expressly CC0. No non-CC0 warning appears in the enforcement documentation. |
| Recalling firm | `recalling_firm`, `address_1`, `address_2`, `city`, `state`, `postal_code`, `country` | Business name and business address as published by FDA. These identify firms, not individuals. The structured `firm` object omits the street lines, which are still present in `raw`. |
| openFDA harmonization (`openfda.*`) | `application_number`, `brand_name`, `generic_name`, `manufacturer_name`, `product_ndc`, `package_ndc`, `original_packager_product_ndc`, `is_original_packager`, `product_type`, `route`, `substance_name`, `unii`, `rxcui`, `spl_id`, `spl_set_id`, `nui`, `pharm_class_epc`, `pharm_class_moa`, `pharm_class_pe`, `pharm_class_cs`, `upc` | Factual identifiers and names that openFDA joins from FDA systems (NDC Directory, SPL index, UNII, RxNorm links). They are covered by the same CC0 dedication, and they are facts, not creative expression. No label text or images are included. |
| Derived by Data Foundry | `distribution` (states, countries, flags), `quantity`, `codes` (GTIN, NDC, lots, serials, models, expiry dates), `reason` (classes, allergens, pathogens), `provenance` | Data Foundry's own deterministic derivation from the CC0 fields above. |

Not acquired or served: product images, label PDFs, SPL document text, or any field from outside the enforcement endpoints.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE | — | ALLOW (official API, within published limits) |
| STORE | — | ALLOW |
| CACHE | — | ALLOW |
| NORMALIZE | — | ALLOW |
| DERIVE | — | ALLOW |
| SERVE_API_ACCESS | DIRECT_CUSTOMER_API | ALLOW |
| SELL_API_ACCESS | DIRECT_CUSTOMER_API | ALLOW |
| REDISTRIBUTE_NORMALIZED | DIRECT_CUSTOMER_API | ALLOW |
| API_FREE surface | DIRECT_CUSTOMER_API | ALLOW (Evaluate tier) |
| Public web and indexing | — | ALLOW for product, docs and policy pages. Per-recall pages are **not** published: they would be thin pages (rule 8) |
| RapidAPI, MCP, bulk export | — | Rights-permitted by CC0 but **not enabled**; each needs its own product decision |

## Attribution carried

"U.S. Food and Drug Administration enforcement reports via openFDA (https://open.fda.gov), CC0 1.0." This appears in the API `attribution` object, the page footer and the terms.

## Kill switch

Set `SOURCE_KILL_SWITCH = "1"` on the `data-foundry-recalls` Worker, then redeploy or edit the variable in the dashboard. Acquisition throws and every data endpoint returns 503.
