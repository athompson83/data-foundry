# Rights record — CPSC consumer-product recalls (Recall API)

**Decision:** GREEN for acquisition, storage, normalization, derivation, free and paid direct API access, public pages, and redistribution of normalized data, with the exclusions below. Determined on 2026-09-27 under ADR-0013 and the Product Owner's standing instruction: "I fully approve any available dataset that you find as long as you logically identify that there are no restrictions." Next review: 2027-03-27, or immediately if CPSC's policy page or API documentation changes.

## Source

| | |
| --- | --- |
| Publisher | U.S. Consumer Product Safety Commission (CPSC) |
| Endpoint | `https://www.saferproducts.gov/RestWebServices/Recall?format=json` — CPSC's documented Recalls REST web service (no scraping) |
| Records | Full snapshot of 2026-09-27: 10,027 recalls, recall dates 1973-06-08 to 2026-09-24, SHA-256 `864f678cc1e34dcb60b41daaf9c4ca3614fdde6908d08dc5106a59066a69f9cf` (27,695,909 bytes), archived at `data-foundry-raw-artifacts/research/pipeline/2026-09-27-composites/cpsc_all.json` |
| Refresh | The Worker reads notices published or updated in the last 30 days every six hours (`LastPublishDateStart`) and the full list once a day |
| Policy | <https://www.cpsc.gov/About-CPSC/Policies-Statements-and-Directives/Privacy-Policy>, retrieved 2026-09-27 |
| API documentation | <https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information>, retrieved 2026-09-27 |

## Evidence, verbatim, retrieved 2026-09-27

From the CPSC policy page:

> Web page text, brochures, and posters presented on CPSC websites are public information. You may freely distribute, copy, or link to any of this information. However, the information may not be used in a way that states or implies CPSC endorsement. If you distribute, copy or link to any of this information, please credit CPSC. Images on this website may have been licensed for use by CPSC from a stock photography service or other copyright holder and the copyright holder may prohibit republication, retransmission, reproduction or other use of the images. You may freely copy and distribute recall notices, including photographs of recalled items, without permission.

From the API page:

> The information is publicly available to consumers and businesses as well as software and application developers. […] The API provides machine readable access to publicly available recall information visible on cpsc.gov.

## Reasoning — why no restriction applies

1. **Copyright.** Recall notices are written and published by CPSC, a US federal agency. They are US Government works under 17 U.S.C. §105. CPSC also states expressly that recall notices may be freely copied and distributed without permission.
2. **Commercial use.** Neither the policy page nor the API page limits commercial use. The API is offered to "software and application developers".
3. **Endorsement.** The only condition is not to state or imply endorsement, and to credit CPSC. Every page, API response (`attribution`) and the terms say Data Foundry is not affiliated with or endorsed by CPSC, and credit CPSC as the source.
4. **Images.** Recall photographs may be copied, but AGENTS.md rule 9 keeps images out of the product. The parser never reads `Images`, pages show none, and `include=raw` removes the field.
5. **Personal data.** `ConsumerContact` is firm contact text (phone numbers, email addresses), and some entries could name a person. It is never parsed or served, and `include=raw` removes it. `Manufacturers`, `Importers`, `Distributors` and `Retailers` name businesses.
6. **Access method.** The documented API, with an identifying User-Agent (`DataFoundryBot/1.0 (+https://data.aroqon.com/recalls; data@mail.proviciency.com)`). Steady state is one request per six-hour run: three windowed requests and one full-list request a day.

## Exact fields redistributed

| Group | Fields | Basis |
| --- | --- | --- |
| Notice | `RecallID`, `RecallNumber`, `RecallDate`, `LastPublishDate`, `Title`, `Description`, `URL` | CPSC recall notice text (US Government work) |
| Products | `Products[].Name`, `.Description`, `.Model`, `.Type`, `.CategoryID`, `.NumberOfUnits`; `ProductUPCs[].UPC` | Same |
| Hazard and remedy | `Hazards[]`, `Remedies[]`, `RemedyOptions[]`, `Injuries[]` | Same |
| Firms and origin | `Manufacturers[]`, `Importers[]`, `Distributors[]`, `Retailers[]`, `ManufacturerCountries[]` | Business names and countries published by CPSC |
| Cross-references | `Inconjunctions[].URL` | Links to other agencies' notices |
| Derived by Data Foundry | `title_firm`, `units`, `identifiers` (check-digit-valid GTINs, anchored model numbers), `hazard.classes`, `remedy.classes`, `trade_facets`, `cross_references`, linked notices, provenance | Deterministic derivation |

Not served: `ConsumerContact`, `Images` (and their captions), `SoldAtLabel`.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| SERVE_API_ACCESS, SELL_API_ACCESS, REDISTRIBUTE_NORMALIZED | DIRECT_CUSTOMER_API | ALLOW |
| Public web and indexing | — | ALLOW for notices with a substantive description and hazard statement (rule 8). Others are served `noindex` |
| RapidAPI, MCP, bulk export | — | Rights-permitted but **not enabled**; each needs its own product decision |

## Attribution carried

"U.S. Consumer Product Safety Commission recalls via the CPSC Recall API". This appears in the API `attribution` object, every notice page, the footer and the terms, together with the non-endorsement statement.

## Kill switch

Set `PRODUCT_RECALLS_KILL_SWITCH = "1"` on the `data-foundry-recalls` Worker. Acquisition stops, and every product-recall API route and page returns 503. The kill switch covers both CPSC and Health Canada.
