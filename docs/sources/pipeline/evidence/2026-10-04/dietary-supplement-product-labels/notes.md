# dietary-supplement-product-labels (screened 2026-10-04)

Entity: dietary supplement / natural health product. Script: `screen.py`; output: `results.json`. All requests carried the
scout User-Agent, at most about 2 req/s, no keys, no login. The large LNHPD `productlicence` table was pulled once with gzip
(15,155,957 bytes transferred, 148 MB JSON, below the 50 MB transfer cap) and kept outside the repo (`/tmp/dsp`).
Process note: before I added gzip I pulled the uncompressed `productlicence`, `productdose` and `nonmedicinalingredient`
page-1 responses (148 MB, 75 MB, 46 MB), because those endpoints ignore paging and return the whole table. That exceeded the
brief's 50 MB guidance once; I deleted them and did not repeat it.

Verdict: dataset PASSES screening (4 non-RED members from 4 publishers, two declared joins with matched>0). 1 member PARKED.

## 1. NIH ODS DSLD (`dsp-nih-dsld-labels`) - GREEN
- Reachable: HTTP 200 on `https://api.ods.od.nih.gov/dsld/v9/` (keyless Swagger-documented API; occasional empty/5xx replies, retry fixed).
- Records: 214,780 labels (`search-filter?q=*` stats.count). Newest `entryDate` 2025-09-25; index `dsldnxt_labels-2025-09-25n`,
  API 9.5.0 (May 2026). Cadence is slow: the newest label is about a year old, so freshness 2.
- Identifiers: `id`, `upcSku` (free text with spaces, e.g. `0 32811 00014 6`), `productVersionCode`, `nhanesId`, ingredient `uniiCode`,
  LanguaL `physicalState`/`productType` codes. Free text: `statements[]` (directions, precautions, claims, "General Statements"), `claims[]`.
- Sample: 48 full labels fetched at random ids (`label/{id}`). 40/48 have a UPC; 37/48 pass the GTIN check digit; 48/48 have statements,
  claims and ingredient rows; 100/227 sampled ingredient rows carry a non-empty UNII; 22/48 are off-market (history is kept).
- Terms (api.ods.od.nih.gov/dsld/v9/ Swagger page license block): "CC0 1.0 Universal (CC0 1.0) https://creativecommons.org/publicdomain/zero/1.0/".
  The nih.gov copyright page returned 403 to us, so the CC0 declaration on the API spec is the only terms evidence.
- Rights: GREEN (CC0). Keep to data fields; the label PDFs and thumbnails belong to manufacturers, never cache or republish them (rule 9).

## 2. Health Canada LNHPD (`dsp-health-canada-lnhpd`) - AMBER
- Reachable: HTTP 200 at `https://health-products.canada.ca/api/natural-licences/`. Endpoints: productlicence, medicinalingredient, productpurpose,
  productrisk, productdose, nonmedicinalingredient, productroute. `productlicence` is unpaged: 307,002 rows (one per product name),
  153,370 distinct licence numbers (NPN / DIN-HM), 153,389 `lnhpd_id`. Other tables: medicinalingredient 829,863 rows (paged, 100 per page),
  productpurpose 162,954, productrisk 262,897.
- Freshness: newest `licence_date` 2026-10-02, newest `revised_date` 2026-10-02; 4,811 licences issued in 2026; 2,797 rows revised since
  2026-09-01. Health Canada's page says "the data is updated nightly".
- Identifiers: `licence_number` (8-digit NPN), `lnhpd_id`, `company_id`. No UPC/GTIN field exists (checked all 17 columns). Free text: product
  `purpose` (approved claim), `risk_text` (cautions and warnings), ingredient `source_material`.
- Sample: last 25 productlicence rows, plus real ingredient/purpose/risk responses for sample ids.
- Terms: dataset record `https://open.canada.ca/data/en/dataset/ef546c83-43a8-4404-943e-ab324164eeb3` shows "Licence: Open Government Licence - Canada".
  OGL-Canada (https://open.canada.ca/en/open-government-licence-canada): "The Information Provider grants you a worldwide, royalty-free,
  perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below." The canada.ca terms page says commercial
  reproduction needs permission "Unless otherwise specified"; the OGL record is that specification.
- Rights: AMBER. Conditions: the attribution statement "Contains information licensed under the Open Government Licence - Canada", no personal
  information or third-party rights, no endorsement claim. The 148 MB full-table pull must use gzip.

## 3. FDA Health Fraud Product Database (`dsp-fda-health-fraud-database`) - GREEN
- Reachable: HTTP 200 (the old accessdata tainted-supplement URL redirects to this page). One HTML table, 2,202 rows. Newest row 2026-09-15.
  Actions: Public Notification 821, Warning Letter 553, Recall 535, Online Advisory Letter 131, others. Subject is free text: 1,293 rows start
  "Undeclared ..." (hidden drug, e.g. sibutramine, sildenafil, tadalafil). Fields: date, product, firm, firm address, source/URL, subject, action, program area,
  link to the notification page (fetched 5; about 4,100 characters of prose each, with hidden-ingredient narrative).
- Identifiers: none usable for a declared join (no UPC, NPN or lot): product name and firm only.
- Terms (https://www.fda.gov/about-fda/about-website/website-policies): "Unless otherwise noted, the contents of the FDA website (www.fda.gov) - both text and graphics - are
  not copyrighted. They are in the public domain and may be republished, reprinted and otherwise used freely by anyone without the need to obtain permission from FDA." (the
  em dashes are in the source). Rights: GREEN. Product photos on the pages may be third-party: do not republish them.

## 4. Open Food Facts supplements (`dsp-open-food-facts-supplements`) - AMBER
- Reachable: API v2 search HTTP 200 (one category page returned 503 earlier, an unrelated retry). `categories_tags_en=dietary-supplements`: 32,230 products,
  newest `last_modified_t` 1791122919 (2026-10-04). Identifiers: `code` (GTIN). Mostly food-adjacent items (bars, powders).
- Terms (https://world.openfoodfacts.org/terms-of-use): "The Open Food Facts database is available under the Open Database License" and "have to mention the licence and to attribute
  the authorship to Open Food Facts with a link to https://openfoodfacts.org". ODbL is share-alike for derived databases; images are CC BY-SA.
- Rights: AMBER with the share-alike and no-image conditions in `snippet.yaml`. Optional enrichment member only.

## 5. TGA ARTG listed medicines (`dsp-tga-artg-listed-medicines`) - PARKED (UNKNOWN)
`www.tga.gov.au` fails from our egress (HTTP/2 INTERNAL_ERROR, empty reply on HTTP/1.1, three URLs tried), so neither terms nor a data path could be read.
`compliance.health.gov.au/artg/` answers 200 but is a search UI with no measured export. Not worked around.

## Rejected / not built
- FDA warning letters as a separate member: they are already in the Health Fraud table (553 rows) and the registry has `fda-warning-letters`.
- Open Food Facts as a primary member: kept only as AMBER enrichment.
- Ingredient-name join DSLD to LNHPD (UNII on one side, free-text names on the other): not measured, candidate only.

## Linkage (measured)
1. DSLD to LNHPD, declared on the NPN cited in label text. DSLD `search-filter q=NPN` matches 334 of 214,780 labels (0.16%). I fetched the first 120 hits in full and extracted
   `NPN ... (8 digits)` from `statements` and `productVersionCode`: all 120 labels have an NPN, and 120/120 labels have at least one NPN that is an LNHPD
   licence number (93 of 123 distinct label-NPN pairs resolve; the other 30 are probably cancelled or non-current licences). The sample is selected on "mentions NPN", so
   it measures link correctness, not coverage. Hand check of 12 labels (printed label, brand, LNHPD product names and licence holder): 11/12 same product or product
   line and company; 1 mismatch in product name (Blonyx "Beta Alanine" cites NPN 80039957, which LNHPD lists as "HMB+ Creatine" for the same company). So the NPN names the
   licence, and it links a label to a licence, not always to one formulation.
2. DSLD to Open Food Facts, declared on UPC/GTIN. 37 of 48 random DSLD labels had a check-digit-valid UPC; I looked up the first 37 by GTIN-13: 3 found (8%), all 3 the same
   product by name and brand; 1 of them sits in the OFF supplements category. Low coverage: OFF holds few US supplements.
3. FDA Health Fraud to DSLD, candidate by exact product name. 40 random Public Notification product names searched in DSLD: 1 exact name match (Arize). DSLD "Arize" (herbal
   men's performance, entered 2024-05-23) vs FDA 2024-01-30 "Arize" nortadalafil: same name and category, but the firms differ in the listings, so I cannot confirm it
   is the same record. Reported as measured 1/40, no hand-check credit. The rest are products FDA tainted-listed that DSLD never ingested.
4. LNHPD to FDA and LNHPD to OFF: no shared identifier (LNHPD has no UPC); not measured.

## Scores (agent_demand, rights, acquisition, structuring, freshness, onboarding, poor access)
DSLD 4,5,5,4,2,4,3: rich structure, CC0, but a year stale. LNHPD 4,4,4,3,5,4,3: nightly, AMBER attribution, big unpaged pull. FDA HFPD 4,5,3,4,4,3,3: free-text
hidden-ingredient events need extraction, nothing to key on. OFF 3,3,4,2,5,4,2: share-alike and thin supplement coverage. Dataset 4,4,4,4,4,4,3.
The dataset's central weakness: the declared joins are narrow (NPN in 0.16% of DSLD labels, GTIN overlap with OFF 8%), so the US-to-Canada and enforcement links
will mostly be reviewed candidates. Re-measure on random samples before EVIDENCED.
