# Rights record — openFDA enforcement reports (food, drug, device)

**Decision:** GREEN for acquisition, storage, normalization, derivation, free and paid direct API, and redistribution of normalized data. Approved 2026-09-26 under the Product Owner's standing instruction: "I fully approve any available dataset that you find as long as you logically identify that there are no restrictions." Next review: 2027-03-26, or immediately if the openFDA terms change.

## Source

| | |
| --- | --- |
| Publisher | U.S. Food and Drug Administration |
| Endpoints | `https://api.fda.gov/{food,drug,device}/enforcement.json` (the official machine API; no scraping) |
| Records | 29,414 food, 17,974 drug, 39,968 device (87,356 distinct recall numbers), 2004 to 2026-09-16; openFDA `last_updated` 2026-09-16 |
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
