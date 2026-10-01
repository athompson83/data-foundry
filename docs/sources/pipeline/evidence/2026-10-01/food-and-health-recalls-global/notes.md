# food-and-health-recalls-global: screening notes (2026-10-01)

Widens the LIVE `fda-recalls` feed (US FDA food/drug/device enforcement reports; not redefined here) with national
food, drug and health-product recall publishers. Scripts: `fetch.sh` (re-fetch inputs into `raw/`, ~26 MB, not
committed), `screen.py` (identifier census + firm/product candidate pairs), `detail.py` (Health Canada notice pages,
declared UPC join). Output: `results.json`, `link_stage1.json`, `detail_results.json`. All requests used the scout
User-Agent at <=2 req/s. Existing keys `fsis-recalls` (DISCOVERED, 403) and `health-canada-consumer-product-recalls`
(BUILDING, consumer slice only) were not redefined; new keys are used for the new members.

## uk-fsa-food-alerts (Food Standards Agency, UK)
- `https://data.food.gov.uk/food-alerts/id?_limit=5000`: HTTP 200 JSON, 1,359 items in one response (below the 5,000
  limit), `created` 2018-01-09 to 2026-09-25, newest alert 2026-09-25 (cadence: ~46 PRIN + AA + FAFA alerts a year).
  Full history is therefore one request (also .csv/.ttl/.rdf/.geojson variants advertised in `meta.hasFormat`).
- Types: AA 754 (allergy alerts), PRIN 589 (product recall information notices), FAFA 16. Updates are separate items
  (`FSA-PRIN-47-2026-update-1`), so the update chain must be keyed on the notation.
- Fields measured on all 1,359: `@id, title, notation, created, modified, type[], status, alertURL, problem[]`;
  partial: `productDetails` 1,355 (7,885 product names), `reportingBusiness.commonName` 1,299, `shortTitle` 781,
  `country` 536. Inside `problem[]`: `riskStatement` (prose), `allergen` (755 records), `pathogenRisk` (185).
  Fields a typical parser would drop and the raw artifact must keep: `modified` (revision time), `status`, `type[]`
  class URIs, `alertURL`, `country`, `allergen`, `pathogenRisk`, `shortTitle`, per-product `@id`.
- NOT in the API: pack size, batch/lot, best-before/use-by dates and barcodes; these live only on the HTML alert page
  (`alerts.food.gov.uk/...`), which returned 403 to our egress (5,596 bytes). Measured: 0 of 1,359 items contain a
  12-14 digit number, 0 mention FDA/US.
- Terms (OGL v3, `meta.license` field and `https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/`):
  "exploit the Information commercially and non-commercially for example, by combining it with other Information, or by including it in your own product or application."
  "acknowledge the source of the Information in your product or application by including or linking to any attribution statement specified by the Information Provider(s)"
  "This licence does not cover: personal data in the Information;"
- Rights: AMBER (attribution "Contains public sector information licensed under the Open Government Licence v3.0",
  no personal data, no implied endorsement). Commercial redistribution expressly permitted.
- Scores: demand 3, rights 4, acquisition 5, structuring 3, freshness 5, onboarding 4, poor access 3.

## ca-recalls-food-health-open-data (Health Canada recalls and safety alerts index, non-consumer slice)
- `https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json`: HTTP 200,
  15.7 MB, 34,140 rows (also CSV, French file SCRSAMDonneesOuvertes). The file is the same one behind the existing
  `health-canada-consumer-product-recalls` candidate (which keeps only Organization "Consumer product safety",
  5,207 rows). The distinct food/health slice measured here: CFIA 5,318 (food; 2011-01-04 to 2026-09-29), Medical
  devices 8,647 (2006-01-09 to 2026-09-28), Drugs and health products 1,934 (2010-01-18 to 2026-09-28), Marketed
  health products 1,161, Communications and Public Affairs Branch 1,814, Controlled substances and cannabis 99:
  18,973 rows. (TC 9,898 vehicle rows are out of scope.) Full history is one file. Newest "Last updated" 2026-09-29.
- Index fields (11): `NID, Title, URL, Organization, Product, Issue, What you should do, Category, Recall class,
  Last updated, Archived`. There is no recall/publication date in the index (only "Last updated"; a notice detail
  page carries "Original published date" and "Recall date"). Recall class set on 5,285/5,318 CFIA rows. Archived=1 on
  4,064 CFIA rows.
- Detail pages (one per `URL`, HTTP 200, ~48 KB) carry what the index lacks: "Affected products" table (brand,
  product, size, UPC, codes/best-before), recalling firm, distribution, recall class, recall date, "Identification
  number RA-nnnnn", CFIA investigation id. Measured on 29 fetched notices: affected-products table 29/29; check-digit-
  valid UPC on 21/29 (6/9 hand-correct set, 15/20 recent CFIA). So the raw artifact to preserve is the index file
  plus the detail HTML per notice; lots/UPCs need a detail-page extractor (free text in a table).
- Index text mentions FDA/US/USDA in 12/18,973 rows; 0 cite an FDA recall number (F-, D-, H-, Z-nnnn-yyyy). A separate check of the 9 hand-correct notices' detail pages found no FDA number in their text.
- Terms (`https://open.canada.ca/en/open-government-licence-canada`):
  "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below."
  "This licence does not grant you any right to use: Personal Information; third party rights the Information Provider is not authorized to license; the names, crests, logos, or other official symbols of the Information Provider; and Information subject to other intellectual property rights, including patents, trade-marks and official marks."
  Dataset page `https://open.canada.ca/data/api/action/package_show?id=d38de914-c94c-429b-8ab1-8776c31643e3`:
  license_title "Open Government Licence - Canada", frequency "continual".
- Rights: AMBER (attribution, no Personal Information, no endorsement). Conditions carried from the consumer-slice
  rights record: do not republish "What you should do" contact details. Detail pages are canada.ca page text: use only the
  open-data resource unless a rights record extends to them (open question for the orchestrator; the UPC/lot join
  needs them).
- The legacy `healthycanadians.gc.ca` API stays PARKED (existing key ca-healthycanadians-recall-api). The CFIA CKAN
  record "Class I Recalls with Public Warnings listing Recalling Firm (2018-2021)" is a dated CSV subset of this
  index and is not a separate member.
- Scores: demand 4, rights 4, acquisition 5, structuring 4, freshness 5, onboarding 5, poor access 3.

## au-nz-fsanz-food-recalls (Food Standards Australia New Zealand)
- `https://www.foodstandards.gov.au/food-recalls-rss.xml`: HTTP 200, only the latest 10 items (2026-08-05 to
  2026-09-30). Full history is only through the HTML listing `/food-recalls/recall-alert?page=N` (12 per page; pager
  ends at page 18; page=16 shows 30 April 2024, page=100 returns none): roughly 220 recalls back to early 2024
  by listing, older recalls need the archive. There is no API or bulk file.
- Fields in an item (prose): recalling firm and product in title, "Date Marking" (best before), "Problem", "Food
  safety hazard", "What to do", distribution states, PDF notice attachment link, firm phone and email, FSANZ recall id
  in the PDF name (e.g. FSANZ202656), image. No GTIN or lot in the sampled item. Free-text member.
- Terms (`https://www.foodstandards.gov.au/copyright`):
  "Unless expressly noted otherwise, material presented on this website is provided under a Creative Commons Attribution 4.0 Australia (CC BY 4.0) licence, except for: the Food Standards Australia New Zealand logo; and third party material."
  "You may copy, distribute, transmit and adapt the material covered by the CC BY 4.0 licence for commercial and non-commercial purposes; but you must attribute the work in the following manner: Food Standards Australia New Zealand."
- Rights: AMBER (CC BY 4.0, attribute "Food Standards Australia New Zealand", third-party material such as images and the
  PDF notices excluded, firm contact details are personal/third-party data, do not republish). Acquisition is HTML
  crawling of a listing with no API: governed crawler adapter, ~2 req per 12 recalls.
- Not linked to FDA: no declared identifier; no candidate pair was computed (no US firms in a 10-item sample; the
  FSANZ listing was not matched, so zero is "not measured").
- Scores: demand 2, rights 4, acquisition 2, structuring 4, freshness 4, onboarding 2, poor access 4.
- ACCC (productsafety.gov.au RSS, 200) is already candidate `au-accc-product-recalls`; it covers consumer goods, food
  is FSANZ's remit, so it is not re-screened here.

## us-fsis-recall-api-2026 (USDA FSIS) PARKED
- `https://www.fsis.usda.gov/fsis/api/recall/v/1`: HTTP 403 "Access Denied" (Akamai, reference id in body) from this
  egress, with the scout User-Agent. Same block as the existing `fsis-recalls` (DISCOVERED) entry. Terms unread
  (not fetched), so rights UNKNOWN; per the brief it is parked and not worked around. Reopen from a Cloudflare Worker
  egress. Expected value once reachable: FSIS recall number, establishment number (EST), product codes, which would give
  establishment-number joins to FDA; unmeasured.

## eu-rasff-notifications (EU RASFF) PARKED
- The RASFF Window search (`https://webgate.ec.europa.eu/rasff-window/screen/search`) returns 200 HTML, but the
  guessed backend path answered 405 and the official machine route listed on data.europa.eu is an API at
  `developer.datalake.sante.service.ec.europa.eu`, which needs a subscription key. Keys are out of scope. A pre-2021
  xlsx (`RASFF notifications pre-2021 public information.xlsx`, 8.2 MB) is reachable but is history only and the
  notifications are border/market alerts, not lot-level recall notices. Terms were not read: UNKNOWN, PARKED.

## Linkage (measured; fda-recalls is the structured anchor)
FDA sample: 4,000 enforcement rows (2,000 food + 2,000 drug, newest first), report_date 2024-01-03 to 2026-09-23.
Device enforcement was not matched (large; not pulled to stay polite). 609 FDA rows carry a check-digit-valid
12-14 digit UPC/GTIN in `code_info`/`product_description`, 1,583 distinct GTINs.

| Pair | Join | Result |
| --- | --- | --- |
| FDA x UK FSA | declared: cited FDA recall number / valid GTIN | 0 of 1,359 FSA items contain either; zero declared matches |
| FDA x UK FSA | candidate: distinctive firm token + shared product token, created within 120 days | 11 pairs / 7 distinct FSA notices; hand check 0 correct (Lidl US Trading is a different legal entity than Lidl NI and the products differ; the rest are shared generic words) |
| FDA x HC (food/health slice) | declared: recall number in index text | 0 cited (0 of 18,973); 12 mention FDA/US |
| FDA x HC | declared: check-digit-valid UPC from the notice detail page vs FDA code_info | 5 matches in 29 fetched notices (4 of the 9 hand-correct set; 1 of 20 random recent CFIA: So Delicious cashew dessert = FDA H-0398-2026). 6 of the 9 hand-correct notices carry a UPC, so 4/6 matched on UPC; the 2 others (Gerber 0 55000 40314 6, McCain) have different UPCs in the FDA record |
| FDA x HC | candidate: distinctive firm token + shared product token (no date window; HC has no recall date) on 2,364 HC notices updated since 2023-12 | 117 pairs / 80 distinct HC notices; hand check 9 correct of 80 checked (same firm, same hazard, within ~6 weeks): Heinz mayonnaise (undeclared mustard), Blackstone seasoning (Salmonella), Gerber arrowroot biscuits (plastic, downstream recall), Tom Bumble candy, McCain potato products (plastic), Celebration Herbals senna tea (Salmonella), ByHeart infant formula (C. botulinum), Peeters sliced mushrooms (Listeria), Honeywell Eyesaline (CGMP). The other 71 were generic-word collisions (e.g. "frozen", "system", "plant based"). Precision 11% as a raw candidate generator, confirming candidate joins must never auto-link |
| FDA x FSANZ, FSA x HC, FSA x FSANZ | not measured | |

Conclusions: (1) a GTIN/UPC with a valid check digit is the one declared join between FDA and a national feed, but it
exists only on Health Canada notice detail pages (and potentially FSIS); at the level of a GTIN it links a notice to a
product, never merges two recall events (README linking rules); (2) the UK FSA API carries no barcode, lot or FDA
reference, so it links to FDA only by reviewed candidate (0 correct in 7 checked here: UK and US recalls rarely share
a product); (3) matching on names alone is 9/80, i.e. useful only as a review queue.

## Dataset verdict
Passes screening: three non-RED members from different publishers/hosts (US FDA, UK FSA, Health Canada, FSANZ) plus the
LIVE `fda-recalls`; declared join measured 5/29 and candidate join reviewed 9/80 between independent members (FDA and
Health Canada). Free-text member: FSANZ (HTML prose) plus Health Canada detail pages. PARKED: FSIS (403), RASFF (key).
