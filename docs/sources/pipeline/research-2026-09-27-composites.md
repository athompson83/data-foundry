# Research round 3 — composite datasets — 2026-09-27

Product Owner direction (2026-09-27): "We need to make sure our datasets are
aggregates of several different sources of data. Find all related data
(including unstructured) and structure it for our purposes. Classify and
organize accordingly."

From this round on, a **dataset** is one entity type assembled from several
independent sources, linked by deterministic identifiers (exact or normalised
keys; never vector similarity), with every fact carrying its source. Single
sources in `candidates.yaml` are **feeds** into a dataset. The registry now has
a `datasets:` section, validated by `tooling/test/source-pipeline.test.ts`:
each dataset names at least two member sources from different hosts and at
least one join key measured between two of them.

Four tracks were researched in parallel on 2026-09-27 against live sources with
the declared User-Agent `DataFoundry/1.0 (data@mail.proviciency.com)`. They
build on the [service-trade round](research-2026-09-27-service-trades.md). Terms
are quoted verbatim with URLs; linkage is measured on real samples with a fixed
seed (20260927) and hand-checked; anything not measured is marked
[UNVERIFIED]. Our scripts and sample identifiers are in
[`evidence/2026-09-27-composites/`](evidence/2026-09-27-composites/); raw source
files, third-party documents and anything with personal data were not
committed.

## The four composite datasets

| Dataset | Entity | Members (feeds) | Score | What only the aggregate answers |
| --- | --- | --- | --- | --- |
| `home-product-recalls-global` | A regulator recall notice, linked to the products it names | CPSC (+ trade facets), Health Canada, EU Safety Gate, UK OPSS, ACCC, NZ MBIE, SaferProducts incidents, ENERGY STAR | 31 | "Is this model or GTIN recalled anywhere, did consumers report it first, and is it still certified?" |
| `home-equipment-model-registry` | An equipment model (or wildcard pattern / matched system) | ENERGY STAR (all categories + Model Index), WaterSense, CEC solar lists, AU GEMS, NRCan 2017, EPREL (key pending), Wikidata, CPSC recalls, EPA SNAP | 29 | "What is this nameplate, is it certified in which markets, which refrigerant, who makes it, and has it been recalled?" |
| `building-envelope-product-approvals` | A Miami-Dade NOA or Florida product approval | Miami-Dade NOAs, Florida Building Commission, FEMA BCAT, FEMA NRI, NWS zones, NCEI storm events | 27 | "Is this roof/window/door approved for this jurisdiction and code edition, and does it rely on an expired approval?" |
| `contractors-licensed-trade-businesses` | A licensed trade contractor **business** (never a person) | WA L&I, OR CCB + BCD, CO DORA, CT HIC, MN DLI, TX TDLR, EPA RRP firms, OpenStreetMap | 26 | "Is this business licensed for this trade here, bonded and insured, disciplined, lead-safe certified?" |

## Headline linkage measurements

| Join | Measured | Hand-checked |
| --- | --- | --- |
| Health Canada ↔ CPSC, "joint recall" marker + date + title tokens (review candidates) | 341 / 352 marked notices | 25 / 25 correct |
| Health Canada ↔ CPSC, title tokens without a marker | — | 6 / 15 correct: candidate only, never auto-linked |
| UK OPSS ↔ EU Safety Gate (home categories) | 79 / 697 by brand+model alone; **24 / 697 by a check-digit-valid GTIN** (29 before validation); 94 / 697 by either | 19 / 20 brand+model pairs correct (re-sampled after review; 1 uncertain) |
| SaferProducts incidents ↔ CPSC home recalls (brand + model) | 111 / 307 recalls (1,137 reports; 106–108 after the generic-model denylist); 50 had a report before the recall | 11 / 12 correct |
| CPSC recall ↔ current ENERGY STAR / WaterSense model | 18 / 10,027 recalls | 15 same product, 2 accessory, 1 false |
| ENERGY STAR ↔ Canada (markets flag) | 1,644,779 / 1,796,876 models | — |
| ENERGY STAR ↔ AU GEMS (same model) | 19 / 3,941 fridges; 0 / 6,036 AC | prefix matches rejected as sibling models |
| ENERGY STAR filer ↔ Wikidata parent | 7 correct of the top 50 filers | needs a curated mapping |
| Florida approval cites a Miami-Dade NOA (HVHZ roofing) | 8 / 22 text-extractable | 6 / 19 cited NOAs past their listed expiry |
| Miami-Dade ↔ Florida manufacturer names (normalised) | 242 / 636 applicants | 0 false in 30 (1 uncertain) |
| Oregon trade licence ↔ Oregon contractor registration (name + city) | 45 / 50 | — |
| Cross-state contractor (name + zip/city) | 45 / 2,000 | 10 / 10 correct; name-only ≈ 1 / 10 |

## GTIN re-measurement (after review)

The screening parser accepted any 8–14 digit string as a GTIN. Re-measured with
GS1 check-digit validation from the parsed international notices (archived in R2
as `research/pipeline/2026-09-27-composites/intl_recs.json`, 8,076,460 bytes,
SHA-256 `e7aaee0dcc9331495bdfca6c16bc81bd4c3ec48482bc77abfb0be2c5360b42db`;
script `evidence/2026-09-27-composites/recalls/gtin_validated.py`, output
`gtin_validated.txt`), the UK OPSS → EU Safety Gate GTIN join is **24 / 697**, not
29: five matched codes fail the check digit. `parse_all.py` now validates check
digits. This one join is replayable; the others below are not.

## Reproducibility

These are **screening** measurements. Every input still on hand after screening is now
archived in R2 with SHA-256 (`evidence/2026-09-27-composites/archive/`: three tarballs plus a
per-file hash list, 996 files, added after review), alongside the parsed international notices
and the CPSC and Health Canada downloads archived earlier.

Archived and replayable:
- Health Canada ↔ CPSC;
- UK ↔ EU rule sets, from the parsed notices;
- the Florida detail, evaluation-report and roofing samples, and the Miami-Dade NOA sample;
- the FEMA NRI/BCAT county pulls;
- AU GEMS and the NRCan 2017 extracts;
- the round-2 appliance and electrical files.

Some bulk snapshots had already been deleted and could not be archived, so the figures built on them
cannot be replayed exactly:
- the raw UK OPSS notice JSON;
- the EU Safety Gate weekly XML (one week kept);
- the French RappelConso dump;
- the SaferProducts incident extract;
- most ENERGY STAR category and Model Index files (only the matched-systems group file was kept);
- the WaterSense extract;
- the contractor registries.

The figures derived from them are labelled screening-grade or lower bounds in this record.
Before any member source advances to `EVIDENCED`, its joins are re-measured from inputs archived
in R2 with byte counts and SHA-256, under the same replay rules as round 1.

**UK ↔ EU rule sets and multi-code barcodes (added after review).** `xmatch.py` counted a notice as a
brand+model match when it matched by brand+model *or* by GTIN. `uk_eu_separate.py` re-measures the three rules
independently from the archived `intl_recs.json`: brand+model 79/697, model only 137/697 and validated GTIN 24/697.
Brand evidence is taken only from a real brand field: the screening parser gave a brandless UK notice the first
title word ("Fan", "Washing") as its brand, which alone accounted for 24 of an interim 103. A fresh hand-check of 20
pairs drawn from the 79 (seed 20260927) found 19 the same product and 1 uncertain (brand evidence only the word
"Li-ion"); the screening 18/20 had been drawn from the mixed set.
The screening parser also deleted every space between digits, so a field listing two barcodes became one long
number and neither was extracted. `parse_all.py` now splits on separators first, but the raw UK notices were not
archived, so 24/697 is a lower bound until the notices are re-fetched and re-parsed.

**Candidate outputs (added after review).** Health Canada ↔ CPSC was re-measured from inputs now archived in R2
(`recalls/hc_cpsc_inputs.txt`: sizes and SHA-256). It reproduces 352 / 341 / 337 and the 863 / 238 control
exactly. `hc_cpsc_links.json` and `hc_cpsc_control.json` now keep every candidate with its evidence: 62 notices
have more than one, and the 4 tied top candidates are HC 82207, 81761, 64528 and 77014. The committed
`equipment/link_cpsc_matches.json` and `recalls/spdb_cpsc_links.json` came from screening runs that kept at most
2 or 3 IDs per match, and their inputs were not archived. They are screening summaries, not review-queue inputs.
Two more screening rates were measured before a later script fix, and their inputs were not archived. SaferProducts
↔ CPSC 111/307 ran without the generic-model denylist: 3 of the 111 recalls match only on generic tokens such as
`PAR30`, and 2 more carry one, so the rate is 106-108/307. ENERGY STAR ↔ CPSC 6/230 treated wildcards as exactly one
character and did not parse `(A,B)` or `(X)` forms, so it is a lower bound under the documented grammar. `spdb_link.py` and `es_link.py` now
apply both rules. The same applies to `equipment/link_au_matches.json`, which predates the per-component output (its inputs were not
archived either). The scripts now keep every candidate, but these three files cannot be regenerated from the current archive
because some of their inputs were deleted before archiving. The missing inputs are:
- the ENERGY STAR Model Index file `mi_noncac.csv` (for `link_au.py`, `link_cpsc.py` and `link_nrcan.py`, which all call
  `es_mi()`) and `akti.json` (for `link_au.py` and `link_cpsc.py`). So `equipment/link_nrcan_matches.json` and the
  NRCan ↔ ENERGY STAR rates are screening summaries too, until `mi_noncac.csv` is re-acquired and archived;
- the SaferProducts extract `spdb_inc.pkl` (for `spdb_link.py`).

`link_cpsc.py`'s `cpsc-recalls/recalls.json` can be replaced by the archived `cpsc_all.json`, which comes from the same API.
The build must re-acquire and archive the missing inputs, with SHA-256, before it regenerates these files. Until
then the committed files remain screening summaries.

## Rules the measurements impose

- **Declared links beat inferred ones.** Identifiers that name the counterpart
  record (cited approval numbers, licence numbers, GTINs) link automatically.
  Health Canada's joint-recall marker says a CPSC counterpart exists but not
  which one (the target is chosen by date and title tokens; 4 of 341 were
  ambiguous), so it narrows candidates for review rather than auto-linking.
  Name or title similarity only proposes a candidate link, recorded with its
  evidence and never merged (AGENTS.md rules 3 and 7).
- **Brand alone is not a manufacturer.** At least 8 WaterSense and ENERGY STAR
  brands with the same name are different companies; key by brand plus filer.
- **Regions are partitions, not cross-checks.** US/Canada equipment overlaps;
  AU/NZ and EU largely do not. EU/UK recall alerts are a different market
  (mostly marketplace electricals), sold as such.
- **Personal data stays out.** Contractors are published as business entities
  only; SaferProducts victim, location and narrative fields and Florida
  engineers' names and emails are excluded.
- **Present facts, not verdicts.** "Cites an NOA whose listed expiry has passed",
  never "non-compliant".

## Incident

While looking for the CEE tier directory, one `curl -L` to `ceedirectory.org`
followed an HTTP 301 to `ahridirectory.org`, a prohibited domain. One GET of
its home page (2,700 bytes) was made; the body was deleted unread, and no
further request followed a redirect. `ceedirectory.org` and `mcscertified.com`
(whose terms prohibit commercial use) were added to the prohibited list in
PR #67; their candidates are not carried into `candidates.yaml`.

## Build order (active)

This replaces the service-trade build order. The weekly scout advances the
first eligible **member** of the first dataset:

1. **`home-product-recalls-global`**: `cpsc-recalls` (with trade facets) and the
   Health Canada open-data index first, then SaferProducts incident counts,
   ENERGY STAR enrichment, then EU Safety Gate and UK OPSS.
2. **`home-equipment-model-registry`**: ENERGY STAR (Model Index + category
   datasets) with the wildcard-pattern compiler, then WaterSense, CEC, AU GEMS.
3. **`building-envelope-product-approvals`**: Miami-Dade NOAs and Florida
   approvals with the cites-approval edge and expiry check, then FEMA context.
4. **`contractors-licensed-trade-businesses`**: Oregon registration × trade
   licence, then Washington ↔ Oregon, then Colorado, Minnesota, Connecticut.

## Owner-only items (optional, not blocking)

- A free EPREL API key (EU Login account) for EU equipment data.
- A free U.S. Department of Labor API key to measure the OSHA linkage.
- California CSLB licence data: its firewall rejected the download from here;
  retry from Cloudflare egress, or request the file from CSLB.


## Composite: Product recalls
Date: 2026-09-27. Machine-readable part: [`recalls.yaml`](recalls.yaml). The raw downloads and scripts
are in `evidence/2026-09-27-composites/recalls/`; the large files were deleted at the end (see [Reproduction](#reproduction)).

This round builds on round 2
(`docs/sources/pipeline/research-2026-09-27-service-trades.md`).
Round 2 already covered the CPSC recall API, the appliance, HVAC, plumbing and electrical slices, Health
Canada (OGL index versus page text), ENERGY STAR and Wikidata. None of that is repeated here. It is cited
where used.

### Method

- Every request used the User-Agent `DataFoundry/1.0 (data@mail.proviciency.com)`, at about 1 request per second.
- A browser User-Agent was tried once, only to read the OECD terms page. It was refused as well (403).
- No prohibited domain was fetched.
- Where a CPSC recall names Daikin/Amana (26734) or another prohibited firm, only CPSC's own text was used.

### Summary

The dataset to sell is `home-product-recalls-global`. It holds one record per regulator notice from six
agencies:

- **CPSC** (US)
- **Health Canada** (CA)
- **EU Safety Gate**
- **UK OPSS** (GB)
- **ACCC** (AU)
- **MBIE** (NZ)

Each notice is linked to the products it affects (brand, model or model pattern, serial range, GTIN,
lot). Each is enriched with two things:

- the ENERGY STAR-listed model it names;
- counts of SaferProducts.gov consumer incident reports on the same brand and model, before and after the recall.

It extends the LIVE `fda-recalls` StructuredRecall pipeline and the `cpsc-recalls` build, which is first
in the build order.

**What the measurements show:**

1. **For US home equipment, the cross-agency link is US to Canada, flagged by a marker.**
   - The OGL Health Canada index carries a "Joint recall with Health Canada, the United States Consumer
     Product Safety Commission" sentence in its `What you should do` field.
   - It appears in 352 consumer notices. With a date window and title tokens it proposes a CPSC recall for
     341 of them (337 unambiguously), and the hand check found 25 of 25 correct. The marker does not name
     the CPSC notice, so these are review candidates, never automatic links (revised after review).
   - This covers 43 of the 138 CPSC home-equipment recalls since 2022 (31%).
   - Without the marker, title matching is only 6 of 15 correct, so it must never auto-link.
2. **US home equipment almost never appears in EU, UK or Australian notices.**
   - Brand plus model matched 0 of 88 (EU), 0 of 119 (UK) and 0 of 9 (AU) CPSC home-equipment recalls.
   - Those regulators' electrical notices are a different population: 79% of EU home-category alerts have
     China as the country of origin, and most are online-marketplace goods.
   - Across all CPSC products, the overlap is still small: 11 of 861 (EU) and 14 of 1,126 (UK). It is
     mostly globally sold power banks and chargers (Belkin, Anker, ESR, IKEA, Yamaha).
3. **The EU, UK and France cluster links strongly.**
   - 94 of 697 UK OPSS home-category notices match an EU Safety Gate alert: 79 by brand+model alone (real brand fields only) and 24 by a check-digit-valid GTIN (9 by both). Re-measured after review as independent rule sets (`uk_eu_separate.py`); screening reported 118, mixing an unvalidated GTIN branch and title-word brands into the brand+model count.
     A seeded hand-check of 20 brand+model pairs found 19 the same product and 1 uncertain (the screening 18/20
     was drawn from the earlier mixed set and is superseded).
   - France's RappelConso cites Safety Gate case numbers directly: 102 of 109 are found in the EU XML.
4. **The incident signal is new.**
   - SaferProducts.gov publishes a bulk export (`SPDB.zip`) with 70,000 incident reports. Round 2 found no route to them.
   - 111 of 307 CPSC home-equipment recalls with model tokens have at least one incident report on the same
     brand and model (1,137 reports in all).
   - **50 of 111 had a report dated before the recall.** 11 of 12 links were correct on hand check.
5. **Recall to ENERGY STAR stays a narrow, model-only join.**
   - 6 of 230 home-equipment recalls since 2015 (7 of 230 without the brand check) name a model that is
     still certified. One of them is a water heater: 26026, dataset `pbpq-swnu`.
   - **GTIN/UPC joins to ENERGY STAR matched 0**: 0 of 87 CPSC UPCs, 0 of 8,399 EU GTINs, 0 of 93 UK GTINs.

**A correction to round 2.** Round 2 said the Health Canada OGL index "carries only title, category,
issue, class and date." Today it also carries `Product` (a product name) and `What you should do`, which
is populated in 1,299 of 5,206 consumer notices. That field holds the joint-recall marker, which proposes
CA↔US candidate links under the OGL alone, with no page text needed. The marker names no CPSC notice, so each
proposed link is reviewed before publication.

### Source inventory

| # | Source (candidate key) | Publisher | Origin | Jurisdiction | Rights | Access | Volume (measured today) | Free-text value |
|---|---|---|---|---|---|---|---|---|
| 1 | CPSC recalls API (`cpsc-recalls` + 4 trade slices), existing | US CPSC | governmental-host (firm-supplied facts) | US | GREEN (round 2) | One JSON call | 10,027 recalls; 901 home-equipment by our facet classifier (298 since 2015) | High: `Products.Model` is empty, and models, serials and units sit in `Description` |
| 2 | Health Canada OGL index (`appliance-health-canada-recalls`), existing, **corrected** | Health Canada | governmental-host | CA | AMBER (index GREEN-like under the OGL; page text RED, round 2) | JSON/CSV, 15.7 MB | 34,131 notices; 5,206 consumer; 141 in the Appliances categories | `What you should do`: remedy text plus the joint-recall marker (352) plus a mention of the OECD portal (1,219) |
| 3 | **EU Safety Gate weekly XML** (`eu-safety-gate-alerts`), NEW | European Commission, DG JUST | governmental-host (notified by member states) | EU/EEA | AMBER (CC0 distribution plus CC BY 4.0 site; images excluded) | One XML per week, with a list of 1,117 reports since 2005 | 14,777 alerts in 191 reports (2023-01 to 2026-09); 2,771 in home categories | Structured `brand`, `type_numberOfModel`, `barcode`, `batchNumber`; free-text `danger`, `measures`, `description` |
| 4 | **UK OPSS alerts, reports and recalls** (`uk-opss-product-safety-alerts`), NEW | Office for Product Safety and Standards | governmental-host | GB | AMBER (OGL v3) | GOV.UK search API plus content API | 3,730 notices (2022-03 to 2026-09); 1,252 in home categories fetched | HTML "Product information" table (Brand 589/1,252, Model 986, Barcode 312); PSD number |
| 5 | **ACCC recalls** (`au-accc-product-recalls`), NEW | ACCC | governmental-host (supplier-run recalls) | AU | AMBER (CC BY 4.0, third-party carve-out) | RSS feed of the latest 100; Drupal detail pages | 100 (15 May to 25 Sep 2026); full count [UNVERIFIED], but the pager shows about 330 pages | Structured fields: PRA number, brand (78/97), model (29), SKU (26), GTIN (8), sale dates |
| 6 | **NZ MBIE recalls** (`nz-mbie-product-recalls`), NEW | MBIE Trading Standards | governmental-host | NZ | AMBER (CC BY 4.0, no imagery) | Sitemap plus pages | 1,619 recall URLs; seeded sample of 150 (147 parsed) | Free-text "Product Identifiers" (model tokens 66/147) |
| 7 | SaferProducts.gov incident export (`appliance-saferproducts-incidents`), existing, **new route** | US CPSC | governmental-host (consumer-submitted) | US | AMBER (structured product fields only; narratives and personal data excluded) | `https://www.SaferProducts.gov/SPDB.zip` (39.7 MB, updated 2026-09-26) | 70,000 reports (2011-03-11 to 2026-09-09); 32,190 in home sub-categories | Brand 67,969; Model 59,581; Serial 39,062; UPC 15,774; narrative `Incident Description` |
| 8 | ENERGY STAR appliances and water heaters (`appliance-energy-star-registry`, `plumbing-energystar-water-heaters`), existing | US EPA | governmental-host (partner-filed) | US | AMBER (round 2) | SODA | 9,919 models (8,667 appliance plus 1,252 water heater); 3,822 wildcard patterns | Model wildcard grammar |
| 9 | **France RappelConso V2** (`fr-rappelconso-v2`), NEW | DGCCRF | governmental-host | FR | **RED today** (licence text unreadable; metadata says Licence Ouverte 2.0) | Opendatasoft API | 18,699 notices; 875 non-food home (2018-04 to 2026-09) | `modeles_ou_references`, GTIN list; `numero_fiche` = Safety Gate case number for 109 since 2023 |
| 10 | **OECD GlobalRecalls** (`oecd-globalrecalls-portal`), NEW | OECD | aggregator | multi | RED | `robots.txt` is `Disallow: /`; terms page 403 | not measured | n/a |
| 11 | **Legacy Health Canada API** (`ca-healthycanadians-recall-api`), NEW | Health Canada | governmental-host | CA | RED/PARKED | JSON | Newest items are from October 2021 (stale) | n/a |
| 12 | FDA enforcement (`fda-recalls`, LIVE) | FDA | governmental-host | US | GREEN | openFDA | 0 hits for microwave oven, water heater, air purifier and space heater; "humidifier" hits are medical respiratory devices | The value is schema and infrastructure reuse, not records |
| 13 | NHTSA (`nhtsa-recalls`), USDA FSIS (`fsis-recalls`), existing | — | — | US | — | — | Out of scope for home equipment (vehicles, tyres, child seats; food). FSIS is still blocked (round 1) | — |

### Verbatim terms for the new sources (read 2026-09-27)

**EU Safety Gate.**

- The data.europa.eu record `rapex-rapid-alert-system-non-food`, distribution "4. Weekly Reports - XML
  format" (https://data.europa.eu/api/hub/search/datasets/rapex-rapid-alert-system-non-food):
  `"resource": "https://creativecommons.org/publicdomain/zero/1.0/", "description": "Creative Commons CC0 1.0 Universal"`.
  The same record lists other distributions under the "European Commission reuse notice" (Decision 2011/833/EU).
- https://commission.europa.eu/legal-notice_en:
  > "Unless otherwise indicated (e.g. in individual copyright notices), content owned by the EU on this
  > website is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence. This
  > means that reuse is allowed, provided appropriate credit is given and changes are indicated."

  > "Software or documents covered by industrial property rights, such as patents, trade marks,
  > registered designs, logos and names, are excluded from the Commission's reuse policy and are not
  > licensed to you."
- The Safety Gate disclaimer page is a JavaScript app and returned no readable text. The `ec.europa.eu`
  robots.txt does not disallow `/safety-gate-alerts/`.
- **Verdict: AMBER.** Apply CC BY 4.0 attribution (the stricter label) and indicate changes. Exclude the
  pictures. Use brand names only as factual identifiers.

**UK OPSS (GOV.UK).**

- https://www.gov.uk/help/terms-conditions:
  > "Most content on GOV.UK is subject to Crown copyright protection and is published under the Open
  > Government Licence ( OGL ), which also sets out which content is exempt."

  The page footer reads: "All content is available under the Open Government Licence v3.0, except where
  otherwise stated".
- https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/:
  > "You are free to: copy , publish, distribute and transmit the Information ; adapt the Information ;
  > exploit the Information commercially and non-commercially for example, by combining it with other
  > Information, or by including it in your own product or application."
- The GOV.UK robots.txt does not disallow `/api/`.
- **Verdict: AMBER.** Attribute under the OGL. Exclude the attached image PDFs.

**ACCC.**

- https://www.productsafety.gov.au/about-us/using-our-website/disclaimer-and-copyright:
  > "All information presented on this website is provided under a Creative Commons Attribution 4.0
  > International licence (or CC BY 4.0 licence), except for: the Commonwealth Coat of Arms … all logos
  > used by the ACCC … content supplied by third parties material where it is expressly stated otherwise."

  > "Where a third party holds copyright in information presented on this website, the copyright remains
  > with that party."
- robots.txt disallows only admin, search and facet URLs.
- **Verdict: AMBER.** Take facts only (PRA number, brand, model, SKU, GTIN, dates). Take no supplier
  photographs, recall advertisement PDFs or supplier prose, and no contact details.

**NZ MBIE.**

- https://www.productsafety.govt.nz/about-us/copyright:
  > "this copyright material is licensed for re-use under a Creative Commons Attribution 4.0 International
  > Licence. In essence, you are free to copy, distribute and adapt the material, as long as you attribute
  > it to the Ministry of Business, Innovation and Employment and abide by other licence terms. Please note
  > that this licence does not apply to any logos, emblems and trademarks on the website or to the
  > website's design elements or to any photography and imagery."
- **Verdict: AMBER.**

**SaferProducts.gov export.**

- The terms are CPSC's (round 2: "Web page text … presented on CPSC websites are public information. You
  may freely distribute, copy…").
- `Disclaimer.txt` inside the zip:
  > "CPSC does not guarantee the accuracy, completeness, or adequacy of the contents of the Publicly
  > Available Consumer Product Safety Information Database on SaferProducts.gov, particularly with respect
  > to information submitted by people outside of CPSC."
- The export also contains personal and quasi-personal fields: City, State, ZIP, victim sex, age and
  relation, and the narrative.
- **Verdict: AMBER.** Publish only these:
  - the report number and dates;
  - brand, manufacturer, model, serial, UPC and date code;
  - the product category;
  - severity;
  - counts linked to a recall.

  Exclude location and victim fields, and do not republish `Incident Description` or `Company Comments`.
  Copyright in the consumer narratives is [UNVERIFIED].

**France RappelConso.**

- Only the metadata could be read: `"license": "Licence Ouverte v2.0 (Etalab)"`.
- `www.etalab.gouv.fr` and `www.data.gouv.fr` reset the connection from this egress, so the licence text
  was unreadable. **Verdict: RED (PARKED)**, to be re-read.

**OECD GlobalRecalls.**

- `https://globalrecalls.oecd.org/robots.txt` is `User-agent: * / Disallow: /`.
- `oecd.org/en/about/terms-conditions.html` returned 403 to both the descriptive and a browser user agent.
- **Verdict: RED.** The portal only aggregates the national data we take directly.

### Linkage matrix (measured)

**Normalisation** (`common.py`):

- **Model:**
  - NFKD fold, then upper-case, then keep only `[A-Z0-9]`.
  - Keep a token only if it is at least 5 characters and has both a letter and a digit.
  - Drop unit-like tokens and CPSC date tokens (`01JAN2014`).
  - Drop a denylist of generic "models" found to cause false matches: `CR2032`, `CR2025`, `PAR30`, `GU10`,
    `R410A`, …
- **Brand:** folded, upper-case alphanumeric words, minus legal-form and generic words (`INC`, `LLC`,
  `GROUP`, `ELECTRIC`, `LIGHTS`, `BATTERIES`, …).
- **CPSC brand:** taken from the firm segment of the title before "Recalls", plus the
  manufacturer/importer/distributor names, plus the first word of the product name.
- **GTIN:** digits only, then the 12/13/14-digit form zero-padded to 13.
- **Match rule:**
  - shared normalised model and brand-token overlap and dates within 365 days, **or**
  - exact GTIN-13.
  - This is the screening rule behind the table below. It did not check GS1 check digits; the build keeps
    the two branches apart and auto-links only on a check-digit-valid GTIN (see "GTIN re-measurement").
- **"Model only"** is the same rule without the brand check. It is the false-match control.

| Pair (A → B) | Denominator (A records with model/GTIN, inside B's date window) | Matched (strict) | Via GTIN | Model-only control | Hand check | Sample IDs (A → B) |
|---|---|---|---|---|---|---|
| **HC joint-marker → CPSC** (±45 d, ≥2 shared distinctive title tokens) | 352 HC notices with "Joint recall … CPSC" | **341** (337 unambiguous) | — | — | **25/25** | 82580→26734 (Amana TTW), 82570→26756 (AGA ranges), 75519→24235 (Frigidaire ranges), 77374→25255 (Delta gas valves), 75828→24371 (Caframo heater) |
| HC without the marker → CPSC (control) | 863 consumer notices since 2022 | 238 | — | — | **6/15** (so never auto-link) | 82288→26595 true; 77277→25354 false |
| CPSC home → HC (joint) | 138 home recalls since 2022 | **43** (hvac 20, appliance 14, plumbing/water heating 9, building 8, electrical 6) | — | — | from the 25/25 above | 26734, 26756, 24235, 25255 |
| **CPSC home → EU Safety Gate** | 88 (2023-01 to 2026-09) | **0** | 0 | 0 | — | — |
| **CPSC home → UK OPSS** | 119 (2021-01 to 2026-09) | **0** | 0 | 0 | — | — |
| CPSC home → ACCC | 9 (May to Sep 2026) | 0 | 0 | 0 | — | — |
| CPSC (all products) → EU | 861 | 11 | 0 | 13 | 2/2 checked (IKEA VARMFRONT 24344; Acer scooter 26453) | 24344, 26453, 26749, 26514 |
| CPSC (all) → UK (home categories) | 1,126 | 14 | 0 | 14 | **8/8** | 26090 (Belkin), 26011 (ESR), 25254 (Yamaha PA-300C), 23205 (PowerXL), 23147 (Anker) |
| ACCC → CPSC | 36 | 4 | 0 | 4 | 3/4 confirmed | 2026/21017→26798, 2026/20921→26444, 2026/20925→26568 |
| NZ sample → CPSC | 75 of 147 | 5 | 0 | 7 | **5/5** | Öhlins forks→19040; BMC SLR01→20042; Toshiba adapters→24122. Screening took NZ brand evidence from the Supplier Contact line and ACCC's from the supplier when the brand field was empty; `parse_all.py` now uses real brand fields only and drops the contact line, so on replay the brand-agreement counts in this row and the ACCC row can fall. The hand-checked confirmations stand as reviewed candidates |
| **UK home → EU Safety Gate** | 697 | **118** (brand+model alone, real brands only, 79; either rule with validated GTINs 94) | **29** (24 check-digit-valid) | 149 (137 without the GTIN branch) | **19/20** on the brand+model set (1 uncertain; `uk_eu_separate.txt`). Superseded screening sample: 18/20 (false: "6000-6500K" colour temperature read as a model; one uncertain) | 2511-0162→SR/04279/25, 2606-0201→SR/02105/26, Bosch TAT8611GB→2023-09-22 alert, Morco EUP11 water heater |
| ACCC → EU / ACCC → UK | 38 / 36 | 0 / 0 | — | 0 / 0 | — | — |
| FR RappelConso → EU (declared case number) | 109 notices with `sr/…` or `a12/…` | **102** | — | — | 5/5 | sr/03749/25, sr/01532/26, sr/00012/26 |
| FR RappelConso → EU (brand+model/GTIN) | 487 | 87 | 71 | 89 | 11/12 (false: 8-digit "58089005" read as a GTIN) | Gifi 3491955986094; BlendJet2; NALK&REY NRHD220023 |
| **CPSC home → SaferProducts incidents** | 307 recalls since 2011-03 with model tokens | **111** (135 model-only) | — | 135 | **11/12** (1 generic `PAR30`, now in the denylist) | 18022 (Kidde FA110G, 26 reports, 3 before the recall), 19047 (Emerson 1F86U-42WF), 21151 (Cove DW2450), 25036 (Govee H7130) |
| … with ≥1 report dated before the recall | 111 | **50** | — | — | — | 23006, 25036, 19189 |
| SaferProducts home-category reports → CPSC home recall | 32,190 reports (30,358 with a model) | 987 | — | — | — | — |
| **CPSC home → ENERGY STAR** (model plus wildcard expansion plus brand) | 230 since 2015 | **6** (7 model-only) | **0** (0/87 UPCs) | 7 | 6/6 (same product family) | 26776 (Friedrich KCVS12B30A), 26649 (GLR76TBEER), 26026 (water heater VTP-150, `pbpq-swnu`), 25320 (Midea MAW08V1QWT), 24110, 22143 |
| EU/UK/AU/NZ GTINs → ENERGY STAR UPC | 8,399 / 93 / 17 / 16 | **0** | — | — | — | — |

**How to read this for the owner:**

- The aggregate's multi-country value for US home equipment comes from **Canada**. It is exact and legally
  clean: OGL index fields only.
- The **EU, UK and FR** sources are a second, largely disjoint population of marketplace electricals
  (heaters, chargers, extension leads, air fryers). They link tightly with each other by GTIN, model and
  declared case number.
- They answer "is this plug-in heater I bought on Amazon UK flagged anywhere?" rather than "is my
  US-market range recalled in Europe?".
- **SaferProducts** turns each recall into a timeline: incident reports before the recall, and after it
  (evidence that the remedy is not reaching owners).

**Classifier note.** The home-equipment facets reuse round 2's appliance classifier verbatim, plus HVAC,
plumbing, electrical and building-product keyword sets (`cpsc_home.py`). It finds 901 recalls:

| Facet | Recalls |
|---|---|
| hvac | 306 |
| electrical | 225 |
| appliance | 201 |
| building-products | 179 |
| plumbing/water heating | 126 |

- Precision on a seeded sample of 30 (seed 20260927) was 27/30. The false positives were:
  - 01102, toilet-bowl cleaner;
  - 22777, bunk-bed ladder;
  - 15044, laptop power cords.
- The HVAC facet here includes portable space heaters, fans and air purifiers, which is broader than round
  2's 55.
- Recall of the classifier (missed recalls) is [UNVERIFIED].

### Proposed canonical schema

**`recall_notice`** has one row per agency notice. Its primary key is `notice_id` = `<agency>:<native id>`,
for example:

- `us-cpsc:26776`
- `ca-hc:82580`
- `eu-sg:SR/02546/26`
- `gb-opss:2608-0025`
- `au-accc:2026/20970`
- `nz-mbie:<slug>`

| Field | Type | Supplied by | Notes |
|---|---|---|---|
| agency, jurisdiction, notifying_country | enum | all; `notifyingCountry` (EU) | |
| notice_type | enum | OPSS `product_alert_type`, EU `measures`, HC title ("warns"), CPSC "(Recall Alert)" | |
| published_date, last_updated | date | CPSC `RecallDate`; HC `Last updated`; EU report date; OPSS `product_recall_alert_date`; ACCC `published-date` | |
| title | text | CPSC, EU, OPSS, HC (OGL index field), ACCC/NZ title | Verbatim only where the licence allows |
| trade_facet[], product_category | enum | our classifier plus a crosswalk of each agency's category | |
| hazard[] / risk_level | enum | CPSC `Hazards`, HC `Issue`, EU `riskType`/`level`, OPSS `product_risk_level` | The source scale is kept too |
| remedy[] | enum | CPSC `RemedyOptions`/`Remedies`, EU `measures`, OPSS `product_measure_type`, HC `What you should do` (parsed) | |
| units_affected | {value, jurisdiction} | CPSC `NumberOfUnits`; HC page (RED, so excluded) | **Never summed across jurisdictions without a label** |
| sale_period | {from, to} | CPSC prose, ACCC `sale-dates`, OPSS "Sales period" | |
| firms[] | {role, name} | CPSC Manufacturers/Importers/Retailers, ACCC traders, EU `onlineTrader` | Exclude contact phone and email |
| country_of_origin | ISO | EU `countryOfOrigin`, OPSS table, CPSC `ManufacturerCountries` | |
| provenance per field | {source_key, url, retrieved_at, licence, method: structured_field\|rule_id, raw_span_ref} | pipeline | |

**`affected_product`** has 1..n rows per notice. Its fields:

- `brand_raw` and `brand_key`, with an optional Wikidata QID from `appliance-brand-ownership`;
- `model_raw`, `model_key`, `model_base_key` (the market suffix after `/` stripped), and `model_pattern`
  (wildcards);
- `serial_range {from, to, pattern}`;
- `date_code`;
- `gtin13[]`, `batch_lot[]`, `sku[]`, `asin[]`.

Each field carries the rule ID that extracted it.

**`notice_link`** is the cross-agency and enrichment layer. Its fields are `from_notice`,
`to_notice | es_model_id | spdb_report_no`, `link_type`, `keys_matched`, `date_delta_days` and `rule_version`.

- Only declared links are published automatically: `declared-case-number` (a cited Safety Gate case number), which merges notices into one `recall_event`, and a check-digit-valid `gtin`, which links a notice to the affected product but never merges events (one product can be recalled twice for different defects; notices sharing only a GTIN are a reviewed event candidate). *Revised after review.* `joint-marker` narrows candidates (the marker does not name the CPSC counterpart; 4 of 341 were ambiguous), so it is reviewed before publication.
- `brand-model` and `candidate-title` links are review candidates: stored with their evidence and shown only after review confirms them (rule 3: no silent merges). The measured precision (15/18 CPSC → certified model, 11/12 CPSC → incident, with host-device and brand-collision errors) is too low for automatic publication.
- *Revised 2026-09-27 after review; the original draft also auto-published `brand-model`.*
- Links are reversible, because notices are never merged. A `recall_event` cluster is a derived view over
  the published links.

**Conflict rule.** When agencies disagree on hazard, risk level, remedy or units, keep each value with its
notice. The cluster view shows them per jurisdiction. Nothing is averaged. The earliest `published_date`
is labelled "first notice".

### Join keys, in order of precedence

Only steps 1 and 2 link automatically; steps 3 to 6 only enqueue review candidates (revised after review).

1. **A declared cross-reference that names the counterpart notice:** a Safety Gate case number cited by a
   national notice (FR 102/109).
2. **Exact GTIN on both sides with a valid GS1 check digit.** A product link, not an event merge. UK↔EU 24/697 (re-measured; 29 exact strings
   before validation, 5 of which fail the check digit). FR↔EU was screened as 71 exact strings without
   validation and must be re-measured with the check digit before it counts. It never joins to ENERGY
   STAR: 0 matches.
3. **The HC `What you should do` "Joint recall … CPSC" marker**, plus a date within 45 days and at least 2
   distinctive title tokens (341/352; 25/25). A review candidate: the marker says a CPSC counterpart
   exists but does not name it, and 4 of the 341 matches were ambiguous.
4. **Normalised model plus brand-token overlap within 365 days.** UK↔EU 79/697; CPSC↔SaferProducts
   111/307.
5. **Model-pattern expansion** (ENERGY STAR `*`, `#`, `?` as one-character wildcards) plus brand, for
   enrichment only (6/230).
6. **Title-token similarity without the joint marker.** A candidate only (6/15), and never published.

### Classification taxonomy

The full enum lists are in the YAML. In outline:

- jurisdiction and agency;
- notice_type;
- trade_facet: appliance, hvac, plumbing-water-heating, electrical, building-products, other-consumer;
- a product-category crosswalk (CPSC `Type` ↔ HC `Category` ↔ Safety Gate `category` ↔ OPSS
  `product_category` ↔ ACCC topics);
- hazard (13 values);
- risk_level (normalised, with the source scale kept);
- remedy (10 values);
- link_type.

### Agent questions only the aggregate answers

- "Is model KCVS12B30A / GTIN 5060138820289 under recall in the US, Canada, EU, UK or Australia, and what
  is the remedy in each?"
- "Was this CPSC recall also issued in Canada, and under which Health Canada notice?" (341
  reviewed candidate links.)
- "Which models still listed as ENERGY STAR certified are named in a recall?" (6, including a water
  heater.)
- "Were there consumer incident reports on this brand and model before the recall, and are reports still
  arriving after it?" (50 of 111 recalls had reports before the recall.)
- "Which products that UK OPSS flagged were also notified to EU Safety Gate, and at what risk level?"
  (94/697: 79 by brand+model, 24 by GTIN.)
- "Every recall of Rheem/Rinnai/A. O. Smith water heaters, with serial ranges and sale periods, across
  agencies."

### Score (composite `home-product-recalls-global`)

| agent_demand | rights_clarity | acquisition_ease | structuring_value | freshness | low_onboarding_cost | poor_existing_access | Total |
|---|---|---|---|---|---|---|---|
| 5 | 4 | 4 | 5 | 5 | 4 | 4 | **31/35** |

### Recommendation

**Build it as the `cpsc-recalls` build, in phases:**

1. **CPSC plus the HC OGL index.** CPSC is GREEN and HC is OGL. The joint-recall marker proposes
   US↔CA candidate links today (341, reviewed before publication), with no page text needed.
2. **Add SaferProducts incident counts** from `SPDB.zip`, restricted to structured product fields and
   aggregates, which answers the "reports before the recall" question.
3. **Add ENERGY STAR model matches** as an enrichment.
4. **Add EU Safety Gate XML and UK OPSS.** Both are AMBER, with bulk or API access. They form a
   marketplace-electricals population and link to each other by GTIN and model.
5. **Add ACCC and NZ** after a complete listing route is found.
6. **Re-read the Licence Ouverte** for France's RappelConso.

Keep OECD GlobalRecalls parked.

**Existing candidate updates to make when this is merged into `candidates.yaml`:**

- `appliance-health-canada-recalls`: correct "no product text". Record the joint-recall marker, which
  proposes 341 candidate links for review.
- `appliance-saferproducts-incidents`: DISCOVERED → SCREENED. The route is
  `https://www.SaferProducts.gov/SPDB.zip`, with 70,000 reports.
  - That row count is exactly 70,000, which may be a cap. Whether the export is complete is [UNVERIFIED].
  - Rights are AMBER, with location, victim and narrative fields excluded.

### Reproduction

The scripts are in `evidence/2026-09-27-composites/recalls/`:

| Script | Purpose |
|---|---|
| `common.py` | Normalisers |
| `cpsc_home.py` | Facet classifier |
| `parse_all.py` | UK, EU, AU, NZ and FR parsers |
| `xmatch.py` | Cross-agency matrix |
| `hc_cpsc.py` | Joint marker and control |
| `spdb_link.py` | Incident linkage |
| `es_link.py` | ENERGY STAR |

The outputs are:

- `xmatch_result.json` and `xmatch_out.txt`;
- `hc_cpsc_links.json` and `hc_cpsc_control.json`;
- `spdb_cpsc_links.json`;
- `cpsc_home.json`;
- `intl_recs.json`, with the sample IDs for every source.

The NZ sample list is `nz_sample_urls.txt` (seed 20260927). The ACCC URLs are in `accc_urls.txt`.

These large raw files were deleted after measurement: the CPSC JSON, the HC JSON, `SPDB.zip` and its
CSVs, and the Safety Gate and GOV.UK raw folders. All can be re-fetched from the URLs above.

## Composite: Home equipment models
Entity: **one home-equipment MODEL** (HVAC heat pumps, furnaces, boilers, central/room/mini-split AC,
water heaters, plumbing fixtures, major appliances, EV chargers, solar inverters/modules/batteries,
lighting and fans) with its brand, filing manufacturer, corporate parent, certifications/listings,
efficiency ratings, refrigerant, market and links to recalls.

Read-only research. Nothing in the repository was edited. Every request used
`User-Agent: DataFoundry/1.0 (data@mail.proviciency.com)` at about 1 request per second, except
where noted. It builds on round 2
(`docs/sources/pipeline/research-2026-09-27-service-trades.md`,
cited below as "R2") and does not repeat its terms quotes for ENERGY STAR, WaterSense, CEC, CPSC,
Wikidata, eCFR or data.gov.au. Scripts, match outputs and sample IDs are in
`evidence/2026-09-27-composites/equipment/` (`scripts/*.py`, `link_*_matches.json`, `samples.json`, seed 20260927).
Anything not measured is marked [UNVERIFIED]. The verdicts are an AI assessment, not legal advice.

**One incident to report.** While looking for the Consortium for Energy Efficiency (CEE) tier
directory, a single `curl -L` to `https://www.ceedirectory.org/` followed an HTTP 301 to
**`ahridirectory.org`, a prohibited domain**. One GET of its home page (2,700 bytes) was made; the
body was deleted unread, and no further requests were sent. Every later request in this track was
made without `-L`. **Recommendation:** add `ceedirectory.org` to
`packages/source-registry/src/prohibited-sources.ts` (AHRI operates it). That confirms the rule the
repo already enforces: follow no redirect before the gate has seen the target host.

### Summary

- **The aggregate works on a North American core and adds real value through links that no single
  source has.** The links are model to recall, brand to filer to parent, model to refrigerant rule,
  and model to Canadian market. Measured:
  - **18 CPSC recalls** name a model that is still listed today in ENERGY STAR or WaterSense
    (**15 of 18** hand-checked as the same product).
  - ENERGY STAR itself marks **1,644,779 of 1,796,876** listed models (91.5%) as sold in Canada.
  - ENERGY STAR filers resolve to a Wikidata organisation by exact label for only **154 of 1,198**
    (12.9%), so the parent graph must be curated.
- **Cross-region model identity is close to nil.** ENERGY STAR (US) matches AU/NZ GEMS
  registrations for only **19 of 3,941** fridges, **0 of 1,411** dishwashers, **1 of 1,516**
  washers, **0 of 1,490** water heaters and **0 of 6,036** AC indoor+outdoor systems. The
  manufacturers sell region-specific SKUs. AU/NZ and EPREL are therefore **separate regional
  partitions of the same schema**, not corroborating sources for US models. They should be built
  after the US/Canada core.
- **New sources found and assessed:**
  - The **ENERGY STAR Model Index** (`8wj2-sec8`) holds 1,796,876 rows across 48 categories,
    including **1,491,897 central-AC split-system rows**. That closes R2's "Central AC returns 0
    rows" gap for identity, but not for ratings.
  - The **ENERGY STAR UPC Codes** dataset (`8edu-y555`) has 38,941 rows.
  - NRCan EnerGuide 2017 snapshot (OGL).
  - AU GEMS air conditioners and water heaters.
  - The **EPREL API terms**. They are now readable. The API allows commercial use with added value
    but forbids selling the data "per se", so the verdict is AMBER.
  - EPA SNAP rules: 129 Federal Register rules (GREEN).
  - The IRS 25C/25D pages. **Both credits ended for property placed in service after 2025-12-31**,
    so the "tax-credit eligibility" overlay is historical only.
  - RED: UK MCS product directory, UK PCDB, CEE directory (redirects to AHRI).
  - Unreachable: NRCan's live Searchable Product List (403 and connection reset), ECCC CREED (TLS
    failure) and DOE CCMS (still 403).

### Source inventory

"R2" means the source was assessed in round 2 and is only re-used here. **Bold** keys are new in
this round.

| Source | Publisher | Origin | Jurisdiction | Rights | Access | Volume (measured today) | Free-text / structuring value |
|---|---|---|---|---|---|---|---|
| ENERGY STAR category datasets (HP `83eb-xbyy`, mini-split `akti-mt5s`, furnaces, appliances, water heaters, EVSE, fans, downlights…) | US EPA (partner-filed) | governmental-host | US (+CA market flag) | AMBER (R2) | SODA API | e.g. akti 17,699; 8 appliance sets 8,667; water heaters 1,252 | wildcard grammar, `+` composites, refrigerant strings |
| **ENERGY STAR Model Index `8wj2-sec8`** | US EPA | governmental-host | US/CA/JP/TW/CH/EU market flags | AMBER (same licence block) | SODA API/CSV, `$group` works | **1,796,876** rows, 48 categories; CAC split 1,491,897 → 3,253 brand×filer×outdoor-pattern groups; non-CAC 304,979 | 186,665 of 304,979 non-CAC model cells are wildcard patterns; 19,691 `+`; 6,279 `(A,B)` alternations; 3,232 `/`; 9,415 `additional_model_information` |
| **ENERGY STAR UPC Codes `8edu-y555`** | US EPA | governmental-host | US | AMBER | SODA | 38,941 rows (one UPC per row) | UPC ↔ pd_id index |
| EPA WaterSense products | US EPA (certifier-filed) | governmental-host | US | AMBER (R2) | daily ZIP | 50,688 | 31.4% wildcard (R2) |
| CEC Solar Equipment Lists | California Energy Commission | governmental-host | US-CA | AMBER (R2) | xlsx | 27,439 rows across lists (R2) | firmware, `{variant}` (R2) |
| CPSC Recalls API | US CPSC | governmental-host | US | GREEN (R2) | REST | 10,027 recalls | model tokens in prose; `Model` empty |
| Wikidata | Wikimedia | nongovernmental | global | GREEN (R2) | dumps / SPARQL | 1,198 ES filers looked up | parent/owner edges |
| eCFR 40 CFR 84.54 | GPO/EPA | governmental-host | US | GREEN (R2) | eCFR API | 71 dated clauses (R2) | obligation timeline |
| **EPA SNAP rules (Federal Register, 40 CFR 82 subpart G / part 84)** | EPA via FR | governmental-host | US | GREEN (as `federal-register-obligations`) | FR API | **129** EPA RULE documents matching "Significant New Alternatives Policy" | substitute × end-use × condition tables in rule text |
| **NRCan EnerGuide appliance data (2017 snapshot)** | Natural Resources Canada | governmental-host | CA | AMBER (OGL, attribution) | ZIP/CSV via open.canada.ca pkg `fbfdf946-…` | 5,868 rows, 6 files, data change date **2017-02-01** | wildcards (`PCKS433ET#**`), bilingual labels |
| **NRCan Searchable Product List (live ENERGY STAR Canada / EnerGuide)** | NRCan | governmental-host | CA | **RED (unreachable)** | `oee.nrcan.gc.ca` 403 (robots.txt too) and connection reset | — | — |
| **ECCC CREED / EER templates** | Environment and Climate Change Canada | governmental-host | CA | UNKNOWN | open.canada.ca packages hold only **blank reporting templates**; CREED portal: TLS failure | — | — |
| AU/NZ GEMS: fridges, dishwashers, washers | DCCEEW | governmental-host | AU/NZ | AMBER (R2) | CKAN CSV | 3,941 / 1,411 / 1,516 | Family Name wildcards |
| **AU/NZ GEMS: air conditioners and electric water heaters** | DCCEEW | governmental-host | AU/NZ | AMBER | CKAN CSV (daily file names `_2026_09_27`) | **AC 6,036; HW 1,490** | `Model_No` "indoor / outdoor" pairs; `Refrigerant` (R32 4,018, R410A 1,497, R290 461); HW model text packs capacity/kW |
| **EU EPREL public API** | European Commission | governmental-host | EU | **AMBER (terms now read)** | API key required (403 without) | [UNVERIFIED] | [UNVERIFIED] |
| **IRS 25C/25D criteria pages** | IRS | governmental-host | US | GREEN (17 USC 105) | HTML | 2 pages | rules reference CEE tiers; **expired 2025-12-31** |
| **CEE directory (ceedirectory.org)** | CEE/AHRI | nongovernmental | US | **RED: redirects to prohibited AHRI** | — | — | — |
| **UK MCS product directory** | MCS Service Company Ltd | nongovernmental | UK | **RED** | — | — | — |
| **UK PCDB (SAP Product Characteristics Database)** | BRE for DESNZ | nongovernmental operator | UK | **RED (no reuse grant found)** | — | — | — |
| DOE CCMS | DOE | governmental-host | US | RED (unreachable; re-checked) | 403 on `products.html`, `robots.txt`, `/ccms/` (118-byte body) | — | — |

### Verbatim terms for new sources (read 2026-09-27)

**ENERGY STAR Model Index and UPC Codes.** `https://data.energystar.gov/api/views/8wj2-sec8.json` →
`metadata.custom_fields["Common Core"]`: `"License": "https://edg.epa.gov/EPA_Data_License.html"`,
`"Publisher": "U.S. Environmental Protection Agency"`. The description says "a simplified list of all
currently certified ENERGY STAR models … including ENERGY STAR Unique IDs, ENERGY STAR partners,
model names and numbers, and brand names". The licence text and the partner-filed caveat are as
in R2, so the verdict is the same AMBER with the same conditions.

**NRCan EnerGuide data (open.canada.ca package `fbfdf946-8dd1-4830-a5c9-f8a72d8fabda`).**
`license_id: ca-ogl-lgo`. OGL text, https://open.canada.ca/en/open-government-licence-canada (200
today): "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive
licence to use the Information, including for commercial purposes, subject to the terms below."
Attribution is required. It is AMBER only for that condition and for the data's age. The resource URLs
redirect from `www.nrcan.gc.ca` to `natural-resources.canada.ca` (a same-publisher host).

**NRCan Searchable Product List.** `https://oee.nrcan.gc.ca/robots.txt` → 403 "You don't have
permission to access this resource". `/pml-lmp/…` → 403 or connection reset to the descriptive UA.
The Greener Homes open.canada.ca packages (for example `4717f11d-…`) say, verbatim: "The dataset
documents available on this page have been replaced by an application that gives you the possibility
to search online for eligible products." That application is the same unreachable host. The terms are
unread, so the verdict is RED. No browser UA was used for data.

**AU/NZ GEMS AC and water heaters.** data.gov.au CKAN `package_show`:
`"license_title": "Creative Commons Attribution 3.0 Australia"`, `"license_url":
"http://creativecommons.org/licenses/by/3.0/au/"`. The package notes say, verbatim: "The data is
collected from suppliers when they register appliances that are going to be sold in Australia and New
Zealand." The site footer says: "© Commonwealth of Australia. With the exception of the Commonwealth
Coat of Arms and where otherwise noted, this work is licensed under the CC BY 4.0 license." The
data.gov.au footer links "Developers / CKAN Documentation", which is the documented-API basis R2
asked for. `data.gov.au/robots.txt` and `reg.energyrating.gov.au/robots.txt` are both
`User-agent: * / Disallow: /`. `www.energyrating.gov.au` returned 403 to the descriptive UA. A browser
UA was used **only** to try its `/copyright` and `/disclaimer` pages, and both timed out or failed
(HTTP/2 INTERNAL_ERROR).

**EU EPREL.** "EPREL Application Programming Interface ('API') to access registered products public
data — TERMS AND CONDITIONS", in force 3 June 2024,
https://ec.europa.eu/assets/move-ener/eprel/EPREL%20Public/Public%20API%20Term%20and%20Conditions/API_TERMS_AND_CONDITIONS_EN.pdf
(200, 226,256 bytes). Verbatim:

> "i. to reproduce, share and distribute the Data for commercial and non-commercial purposes in your aggregated purposes, to add value in your services and benefit from the use of data , but not commercialize or sell the data per se; ii. to create a derivative work;"

> "a. sell the data on their own to gain benefit from the data themselves without adding value with your service, you can use and aggregate data in your processes, but not sell those data as it is, even when complementary parameters are associated to each record;"

> "d. use the Data in any way that may impair and/or jeopardize the purpose of EPREL and/or the accuracy of the information contained therein, including but not limited to modifying, transforming, remixing, aggregating, decompiling, disassembling and/or anonymizing the Data or reproducing it in any way whatsoever that could mislead or cause confusion and/or error;"

> "f. when the Data is stored locally, fail t o ensure that the Data is kept up to date and corrections, restrictions or deletion of the Data are reflected and implemented in the data resulting from Your use of the API;"

The terms also say: "§ 3. To the extent that you are permitted under 4 §1 to publish the data, you
must preserve all credit and attribution to the European Commission services …", and "The
Commission services … are entitled, at any time, without grounds and without costs, to terminate your
access". **Verdict: AMBER.** The conditions are:

- EPREL data only as part of a value-added linked product, never as a bulk resale of EPREL records;
- keep the data current and propagate deletions;
- attribute;
- imply no endorsement;
- keep the fields unaltered, so no transformed values are presented as EPREL's.

Clause (d)'s "aggregating" is ambiguous, so do not "aggregate" EPREL values into composite figures.
The key request goes through `eprel.ec.europa.eu/screen/requestpublicapikey`, which leads to an EU
Login. Measurement is [UNVERIFIED] until a key is issued. This supersedes R2's "terms unread"
position for `appliance-eprel`.

**EPA SNAP.** Federal Register API returned `count: 129` EPA RULE documents. The latest are
2026-10387 (2026-05-26, part 84 reconsideration) and 2024-28307 (SNAP Determination 39). The rights
are as in `federal-register-obligations`: GREEN, "Copyright protection under this title is not
available for any work of the United States Government" (govinfo policies).

**IRS 25C/25D.** From https://www.irs.gov/credits-deductions/energy-efficient-home-improvement-credit
(last updated 28-Apr-2026), verbatim: "The credit is allowed for qualifying property placed in service
on or after Jan. 1, 2023, and before December 31, 2025." and "Heat pumps that meet or exceed the CEE
highest efficiency tier, not including any advanced tier, in effect at the beginning of the year when
the property is installed … qualify for a credit up to $2,000 per year". It also says: "In 2025, for
each item of qualifying property placed in service, no credit will be allowed unless the item was
produced by a qualified manufacturer and the taxpayer reports the Qualified Manufacturer
Identification Number (QMID)".

From https://www.irs.gov/credits-deductions/residential-clean-energy-credit (04-Jul-2026): "The credit
is not available for any property placed in service after December 31, 2025." The ENERGY STAR
"Tax Credit Eligible" views `tzuf-wwcc` and `bfxp-wkhy` now return **0 rows**. That is consistent:
the criteria still depend on CEE tiers, which sit behind RED/AHRI.

**UK MCS.** https://mcscertified.com/terms-conditions/ (200), verbatim: "Any copying, distribution,
storing or transmission of any kind, or any sort of commercial use of the Content is strictly
prohibited without the MCS Service Company Ltd's prior written permission." **RED.**

**UK PCDB.** https://www.ncm-pcdb.org.uk/sap/page.jsp?id=10 (200) has disclaimers only, for
example: "BRE and the Department for Energy Security & Net Zero (DESNZ) do not warrant the accuracy of
data held within this website". There is no reuse grant, so **RED** (no grant is not permission).

**CEE directory.** `https://www.ceedirectory.org/` → `301` to `ahridirectory.org` (prohibited).
**RED**, never acquire.

### Linkage matrix (the key measurement)

Normalisation used everywhere (`scripts/norm.py`):

- **Brand key:** lowercase; drop ®™©; `&` becomes "and"; strip punctuation and repeated corporate
  suffixes (inc, llc, corp, co, ltd, usa, mfg, …); remove spaces.
- **Model key:** uppercase alphanumerics only.
- **Pattern compile:** `*`/`#`/`?` become one optional alphanumeric (`opt1`), and `(A,B,C)` becomes
  an alternation. Matching is brand-scoped unless stated otherwise.

| # | Pair | Join key | Measured | Notes / hand-check | Sample IDs |
|---|---|---|---|---|---|
| 1 | ENERGY STAR → Canada market (the NRCan/ENERGY STAR Canada link) | ES `markets` field | **1,644,779 / 1,796,876** ES rows list Canada | This is ES's own statement. The live NRCan list that would corroborate it is unreachable (403) | `akti` pd_id 2448560 "United States, Canada" |
| 2 | NRCan EnerGuide 2017 → ES current | brand key + model key or pattern | **330 / 5,868** (5.6%) brand-scoped. Methods: pattern=pattern 184, exact 116, NRCan-pattern~ES-exact 16, ES-pattern~NRCan-exact 14. Plus **15** model-only, cross-brand | By file: fridges 245/3,021; washers 31/414; dryers 25/298; freezers 23/425; dishwashers 6/600; **room AC 0/1,110**. Seeded 25 hand-checked: **25/25** same product (identical brand and model/pattern string). Cross-brand 15: OEM/sub-brand, e.g. Beko↔"Beko & Blomberg" `K60340N`, Arctic King↔Midea `WHS-109FW1`, Epic/Stirling↔Marathon `MAR32BLS`, DCS↔Fisher & Paykel `RS36W(X)`; 3 of 15 unverified ownership. The low rate is age (2017 list vs 2026 list), not a key problem: NRCan and ES use **the same wildcard strings** (184 pattern=pattern) | NRCan REC_REF_KEY 10017283 → ES 2218139 (`KBFN502EPA**`); 6382837 → 2219300 |
| 3 | AU/NZ GEMS → ES | brand + model/pattern (AU `Family Name` also tried) | fridges **19/3,941**; dishwashers **0/1,411**; washers **1/1,516**; water heaters **0/1,490**; AC component **1/6,036**; AC full indoor+outdoor system **0/6,036** | 24 AC brands shared (Daikin, Mitsubishi Electric, Fujitsu, LG, Gree, Midea, Samsung, Panasonic…). A 6-character stem match gives 87/3,452 same-brand rows, but a hand-check of 15 shows **different models** (e.g. AU `MUZ-GS25VFD` vs US `MUZ-GS24NA`; Gree `-K6DNA1A` vs `-D6DNA1A` regional suffix families). **Rejected as a join.** Matches are Miele and Dometic global SKUs (`KF 2981 Vi`, `C40G2`) | AU Submit_ID 152781 → ES 2333205; 155459 LG `ARUB060GSS4` |
| 4 | EPREL → ES | brand + model | **[UNVERIFIED]**: needs an API key | Expected low like #3 (EU SKUs) [UNVERIFIED] | — |
| 5 | WaterSense ↔ ES (brands) | brand key | **36 / 623** WS brand keys equal an ES brand key (covering 7,872 / 50,688 WS rows); 9 WS keys equal an ES *filer* key; product-level model overlap 0 (disjoint categories) | By judgement, **at least 8 are collisions** (same string, different company): `americanstandard` (LIXIL plumbing vs Trane HVAC), `delta` (Delta Faucet vs Delta Electronics), `hunter` (Hunter Industries vs Hunter Fan), `peerless`, `sterling`, `crane`, `pioneer`, `msi`. 1 is an artefact (`na` from "N/A"). About 11 are same-owner private labels (Amazon, Ferguson, Glacier Bay, Project Source, Mainstays, Homewerks, Maintenance Warehouse, IKEA, Miseno, Kohler, Anzzi). **A brand string is not an identity key**; key brands by (brand, filer) | `ws_*` row ids in `link_cpsc_matches.json` |
| 6 | ES filer → Wikidata org → parent | exact label / alt-label (plus a suffix-stripped variant), org-typed P31 | any label hit **185 / 1,198**; org-typed **154 / 1,198**; with P749/P127 parent **57 / 1,198**; ambiguous (>1 org item) 29; human-owner bindings dropped 33 | Top 50 filers by rows (98.4% of rows): 12 org hits, of which 7 are correct and unique (Carrier Q731912, Johnson Controls Q667865, LG Q162345, Gree Q1544535, Samsung Q20718, Lenovo Q14799, A.O. Smith Q4648219), 4 ambiguous (Ferguson, HP, Dell, Panasonic) and **1 wrong** (Whirlpool → Q11254284, not Q1471346). Carrier's P749 is still the stale United Technologies. Lennox, Rheem, Trane, Daikin Comfort, Allied Air, GE Appliances, Fujitsu General, Midea and Bosch have no label hit. **A curated crosswalk is required** (rule 3) | `wd_partners.json`, `samples.json` |
| 7 | CPSC recall → ES/WaterSense model | recall text tokens (plus `/`-suffix stripped) vs ES Model Index + CAC groups + WaterSense, brand must appear in recall text | **18 / 10,027** recalls (all 18 since 2015; 3,690 recalls since 2015); **14 / 160** recalls since 2015 with an equipment keyword in the title and a model token; token hits 152 / 23,954 | Hand-check of all 18: **15 true identity** (e.g. 26776 Friedrich `KCVS12B30A`→ES 3999714; 25320 Midea U window AC `MAW08V1QWT-S`; 20141/24018 Lochinvar boilers via `(N,L)` alternation; 23218 Armstrong furnaces via `-**`; 24286 Daikin/Amana HP; 17709 Trane/American Standard furnaces; 24094 ceiling fan where the *recall* uses `XXX` wildcards). **2 host-device** (17056/18186: power supplies *for* a listed Zebra printer). **1 false** (18181 scuba regulator vs Delta faucet `500-S*`, a brand collision). Precision 15/18 | all 18 in `samples.json` |
| 8 | CPSC UPC → ES/WS UPC | GTIN digits, leading zeros stripped | **0 / 1,462** CPSC UPCs (458 recalls) found among 38,899 ES+WS UPCs | UPC is not a practical recall join for this entity | — |
| 9 | CEC solar/storage ↔ ES | manufacturer brand key | **13 / 260** CEC manufacturer keys equal an ES brand key; 24 equal an ES filer key | Tesla, SolarEdge, Eaton, Schneider, Siemens, Generac-like OEMs. Supports a shared manufacturer node, not a model join | — |
| 10 | Model → refrigerant → rule | per-model refrigerant field → normalised ASHRAE designation → 40 CFR 84.54 / SNAP | refrigerant filled: mini-split **17,699/17,699**; room AC **515/515**; dehumidifiers 539/552; fridges 1,570/4,830; freezers 161/668; water heaters 592/1,252; dryers 32/674; AU AC 6,036/6,036 | Needs synonym folding: `HFC-32`/`R-32`/`R32`; `R290`/`R-290`; multi-values `R-600a,R600a/20g(0.705 ounces)` | — |

**Wildcard sensitivity** (`WMODE`):

| Mode | NRCan→ES (brand-scoped) | CPSC recalls matched |
|---|---|---|
| `*` = exactly one char | 314 | 15 |
| `*` = zero or one char (opt1) | 330 | 17 (18 with suffix strip) |
| `*` = any run | 342 | 18 |

The two recalls lost under one-char mode (e.g. 23218 `A96UH1E045B12S` vs `A96UH1E045B12-**`) show
that `*` can be blank. That matches the partner note quoted in R2 ("* could be A-Z, a-z, 0-9, - or
blank"). The any-run mode's only extra recall (23080 Samsung) is recovered in opt1 once regional
suffixes `/US`, `/AA` are stripped. So: **opt1 plus suffix stripping, never any-run.**

#### Pattern handling a matcher needs (all observed today)

1. `*`, `#` and `?` mean zero or one character, from `[A-Z0-9-]` or blank.
   - 186,665 of 304,979 non-CAC Model Index rows.
   - NRCan uses the same convention.
   - AU `Family Name` and WaterSense use it too (31.4%, R2).
2. `(A,B,C)` alternation: 6,279 rows, for example Lochinvar `EPC110(N,L)`.
3. `(X)` with a single option is an optional literal, for example `RS36W(X)`. A comma-only
   alternation parser misses it. `equipment/norm.py` now compiles it as optional; the round-3 model
   match rates were measured before that change, so they are lower bounds for rows using this form.
4. `+` composites mean indoor + accessory or control: 19,691 rows. Split them, then match each part.
5. `/` has three meanings, and it is ambiguous. Resolve it by source, never globally:
   - an indoor/outdoor pair: AU `FDMA71AV1A / RZAV71CV1`, Gree `…/O` `…/I`;
   - a regional suffix: Samsung `/AA`, `/US`;
   - part of the model: WaterSense `FV126.07/87`.
6. Runs of `XX` or `XXX` stand for wildcards in recall prose (24094 `3MGMR60XXX`). This is
   source-specific: in ES, a literal `X` must stay literal (179 cells contain `XX`).
7. CEC `{variant}` suffixes (R2) and CPSC serial ranges (R2) are separate grammars.
8. Compound brand strings (`Beko & Blomberg`) and sub-brands (`GE Profile`, `Danby Designer`) need
   splitting to a brand list, not one key.
9. A pattern-vs-pattern comparison only works by identical canonical pattern. It is exact on the
   184 NRCan cases. General pattern intersection is out of scope and not needed.

### Proposed canonical schema (entity `equipment_model`)

Rule for every fact: **keep each source's value with its provenance and never average.** A
disagreement is exposed as two facts. Identity is asserted automatically only by join keys 1–2 below; the other keys propose reviewed candidates. Any
cross-brand or cross-region candidate is stored as a `same_model_candidate` relationship for audit,
not merged (rule 3).

| Field | Type | Supplied by | Conflict rule |
|---|---|---|---|
| `model_id` | our stable ID (hash of source + source record ID for listings; cluster ID after resolution) | derived | Clusters form automatically only on join keys 1–2 (source ID, check-digit-valid GTIN); keys 3–6 join a cluster only after review |
| `source_listings[]` | {source, source_record_id (ES `pd_id`, `energy_star_model_identifier`, WS `id`, CEC row, GEMS `Submit_ID`/`Registration Number`, NRCan `REC_REF_KEY`, EPREL registration no.), listed_from, listed_to, as_of} | each registry | one row per source |
| `brand_raw`, `brand_key`, `brand_id` | string, string, QID or our brand ID | all registries; Wikidata | brand_id only via the curated crosswalk |
| `filer` / `manufacturer` | {name_raw, key, org_id} | ES `energy_star_partner`, CEC manufacturer, GEMS supplier [UNVERIFIED field] | the label says "filed with EPA by", never "made by" |
| `parent_org[]` | {org_id, relation P749/P127, valid_from/to, source} | Wikidata (+ cited filings) | end-date from evidence; drop humans (Q5) |
| `model_number_raw` | string | each source | keep all |
| `model_pattern` | {canonical, regex, grammar_version, semantics note} | ES, WS, NRCan, GEMS Family Name | per-source grammar |
| `components[]` | {role outdoor/indoor/furnace/coil/control, model_pattern} | ES HP/mini-split `+` and pairs, GEMS `/` pairs | — |
| `category` | taxonomy code (below) | mapped from each source's category | mapping table, versioned |
| `ratings[]` | {metric (SEER2, EER2, HSPF2, COP@5F, UEF, kWh/yr, gpm, gpf, CEC-weighted eff, IEF, star rating…), value, unit, test_standard, source, as_of} | ES, WS, CEC, NRCan, GEMS, EPREL | keep per source and test standard; never convert across test standards |
| `refrigerant` | {designation normalised (R-32, R-454B…), gwp, charge, source} | ES, GEMS | per source |
| `refrigerant_rule_status[]` | {rule citation, sector, gwp_threshold, effective_date, status_for_this_model, basis} | computed from eCFR 84.54 / SNAP + refrigerant | derived fact with provenance to both |
| `markets[]` | {country, source} | ES `markets`, GEMS `Sold_in`, EPREL | union with provenance |
| `certifications[]` | {program (ENERGY STAR listing, WaterSense, CEC Rule 21, GEMS registration, EPREL), status, date_certified, most_efficient flag, source} | each | per program |
| `gtins[]` | {gtin, gs1_check_ok, source} | ES UPC dataset, WS, ES category UPC | union; flag check-digit failures |
| `recall_links[]` | {recall_id, source (CPSC/Health Canada), match_method (exact/pattern/serial-range), matched_token, confidence class, reviewed} | CPSC and HC recall extraction | host-device links are typed separately (`accessory_of`) |
| `firmware_versions[]` | tokens | CEC (R2) | — |
| `tax_incentive[]` | {program 25C/25D, tier basis, eligible_window, source} | IRS pages (historical: ended 2025-12-31) | historical only |

#### Join keys, in precedence order

Only keys 1 and 2 link automatically. Keys 3 to 6 only enqueue review candidates, with their evidence;
nothing is merged on them (revised after review: the CPSC measurement found non-identities).

1. `source_record_id` within a source (exact).
2. GTIN with a valid check digit (exact, cross-source). Measured 0 hits to CPSC today, but it stays
   first-rank where it exists.
3. `brand_key` + `model_key` (exact) within one jurisdiction family (US/CA). Candidate.
4. `brand_key` + ES/WS/NRCan pattern (opt1) matched against a concrete model, or identical canonical
   pattern. Candidate.
5. Component-set match for systems: indoor + outdoor (+ furnace) all match. Candidate.
6. `model_key` alone across brands: recorded **only** as a `same_model_candidate`. It is never
   merged.
7. Cross-region stem or series: rejected (see pair #3).

Brand identity is `brand_key` + filer key, mapped through the curated QID crosswalk. A brand string
alone is ambiguous (pair #5).

#### Classification taxonomy

- `trade`: hvac | plumbing | electrical | appliance | energy (solar/storage/EV).
- `category` → `subcategory`, for example:
  - hvac/heat-pump/{split, mini-multi-split, single-package, geothermal};
  - hvac/air-conditioner/{central-split, mini-split, room-window, portable, ptac};
  - hvac/furnace/{gas, oil, electric};
  - hvac/boiler/{gas, oil};
  - hvac/ventilation/{erv-hrv, bath-fan};
  - plumbing/water-heater/{heat-pump, gas-storage, gas-tankless, electric, solar};
  - plumbing/fixture/{toilet-tank, toilet-flushometer, urinal, faucet-lav, showerhead};
  - plumbing/irrigation/{controller, spray-body};
  - appliance/{refrigerator, freezer, dishwasher, clothes-washer, clothes-dryer, washer-dryer, cooking, dehumidifier, air-cleaner, microwave};
  - electrical/{evse-ac, evse-dc, ceiling-fan, downlight, ups, smart-thermostat};
  - energy/{pv-inverter, battery-inverter, pv-module, ess, battery, meter}.
- `fuel`: electric | gas | propane | oil | solar.
- `refrigerant_class`: HFC-high-GWP (≥700) | HFC/HFO-lower-GWP | natural (R-290, R-600a, R-744).
- `hazard` (from linked recalls): fire | CO | shock | injury | mold | other.
- `listing_status`: listed | delisted | recalled-while-listed.
- `jurisdiction_partition`: US-CA | AU-NZ | EU.

#### Agent questions only the aggregate answers

1. "The nameplate says Friedrich KCVS12B30A. Is this window AC under a CPSC recall, and is it still
   ENERGY STAR-listed? What refrigerant does it use?" This needs CPSC, ES and the rule overlay.
2. "Who actually made the Amana/Daikin heat pump in recall 24286, what other brands does that filer
   list, and who is the parent company today?" This needs CPSC, the ES filer and curated Wikidata.
3. "Is this R-410A mini-split, certified in 2026, still installable under 40 CFR 84.54, given when its
   components were made?" This needs ES refrigerant and dates, eCFR, and a serial date from a recall.
4. "Is this model sold and listed in Canada, and does it carry the same wildcard family as the US
   listing?" This needs the ES `markets` field and NRCan.
5. "Which appliance models are sold under different brand names (Beko/Blomberg, Midea/Arctic King),
   and do recalls on one brand affect the other?" This needs cross-brand candidates and recalls.
6. "Give me SKU-level efficiency (SEER2/UEF/gpm) and recall status for a UPC." This needs the ES UPC
   index, WaterSense and CPSC.
7. "Is this inverter on firmware X Rule 21-listed, and is its manufacturer the same corporate group
   as my battery?" This needs CEC and the manufacturer graph.

### Scores (composite `home-equipment-model-registry`)

| Criterion | Score | Why |
|---|---|---|
| agent_demand | 5 | Nameplate → recall, efficiency, refrigerant and parent questions from installers, inspectors, insurers, property managers and homeowners |
| rights_clarity | 3 | Core sources are AMBER on partner-filed facts; CPSC, eCFR and Wikidata are GREEN |
| acquisition_ease | 4 | Documented SODA/ZIP/xlsx/REST; the Model Index is 1.8M rows but `$group` collapses CAC to 3,253 groups |
| structuring_value | 5 | Pattern grammar, component systems, recall-token linking, brand→filer→parent, and a refrigerant-rule overlay that exists in no single source |
| freshness | 5 | ES and WS daily, CEC 3 times a month, CPSC weekly |
| low_onboarding_cost | 3 | Large, pattern-matching engine and curated crosswalk needed |
| poor_existing_access | 4 | Only AHRI (prohibited) and per-program UIs; no linked API/MCP |
| **Total** | **29** | |

### Recommendation

- **Build `home-equipment-model-registry` as a US/Canada composite first.** It combines:
  - ES (category datasets + Model Index + UPC Codes);
  - WaterSense;
  - CEC;
  - the CPSC recall link (the `cpsc-recalls` build already first in order);
  - a curated Wikidata filer/parent crosswalk;
  - the eCFR/SNAP refrigerant overlay.

  AU/NZ GEMS and EPREL follow later as regional partitions of the same schema. They are not
  corroborators: measured US↔AU identity is ≤0.5% per category.
- **Before PROTOTYPED:**
  - Freeze the opt1 wildcard grammar plus the source-specific `/` and `XX` rules with golden tests,
    built from the 25 NRCan and 15 CPSC hand-checked matches.
  - Hand-seed QIDs for the top 50 filers, which cover 98.4% of rows (top 150: 99.2%). Exact-label matching
    gets 7 of 50 correct.
- **Tell the owner:**
  1. 25C/25D ended on 2025-12-31, so "tax-credit eligible" is not a selling point for new installs.
  2. NRCan's live list and ECCC CREED are unreachable from this egress. The Canadian link today is
     ES's own `markets` flag plus a 2017 OGL snapshot.
  3. Add `ceedirectory.org`, `mcscertified.com` and `ncm-pcdb.org.uk` to the prohibited list; the
     CEE directory redirects to AHRI.
  4. An EPREL API key (free, needs an EU Login identity) is the only credential needed to measure
     the EU partition. This is agent work if an EU Login can be created without the owner's legal
     identity [UNVERIFIED].

## Composite: Building-envelope product approvals
**Entity.** One *product approval*: a roof covering, underlayment, roof-system component, window, door, shutter or skylight approved for wind or impact use. Each approval carries:
- its applicant or manufacturer;
- its tested assemblies, design pressures and test standards;
- its validity dates;
- the jurisdictions where it may be used (HVHZ, the rest of Florida, and the code edition in force);
- hazard context for those jurisdictions.

**Builds on.** Round 2 (`docs/sources/pipeline/research-2026-09-27-service-trades.md`, "Trade: Roofing") screened these. This round does **not** repeat them:
- `roofing-miami-dade-noa` (AMBER)
- `roofing-florida-product-approvals` (AMBER)
- `roofing-ncei-storm-events` (GREEN)
- TDI, CRRC, ICC-ES, FM RoofNav, UL and the GAF manufacturer site (all RED)

This round widens both Florida sources from roofing to the whole wind envelope and measures their linkage at scale. It also evaluates new jurisdiction, hazard and code sources.

**Method.** Every request used `User-Agent: DataFoundry/1.0 (data@mail.proviciency.com)` at about 1 request/second. No browser UA was needed, except a failed read of FEMA's own site, which returned 403 to both UAs. Raw data, scripts and JSON outputs are in `evidence/2026-09-27-composites/building-products/`:
- scripts: `fbc_walk.py`, `fbc_detail.py`, `fbc_pdf_sample.py`, `fbc_roof_noa.py`, `md_sample.py`, `pull_counties.py`, `norm.py`
- terms pages: `terms/`

Random seeds were 2027 (the FBC detail sample, the FBC evaluation-PDF sample and the NOA sample), 2028 (the roofing PDF sample), and 7 and 11 (the name-match hand-check samples). Personal data was removed from the saved samples (engineer names, emails).

#### Summary

- **The composite is real, but the join is mostly *component-level*, not "same product, two approvals".**
  - Miami-Dade NOAs never cite Florida (FL#) numbers: **0/77** text-extractable NOA PDFs (3 of the 80 sampled are image-only scans and are excluded; corrected after review).
  - FL approval *detail pages* almost never cite an NOA: **1/200**.
  - FL *evaluation reports* do cite NOAs:
    - **8/22 (36%)** of sampled HVHZ roofing applications with a text-extractable evaluation report (re-measured after review over every evaluation report of each approval: unchanged);
    - **0/14** such non-HVHZ roofing applications (corrected after review: of the 40 sampled, 3 evaluation reports are image-only scans and 1 approval has no evaluation report, so 36 were testable; screening had reported 8/24 and 0/16);
    - **8/63 (13%)** of a mixed windows/doors/roofing/skylight sample, after hand-removing one false positive (a test-report number shaped like an NOA). Re-measured after review over *every* evaluation report of each approval, counting an approval only when every report yields text: screening read at most two reports per approval (20 of the 70 have more, up to 14) and reported 7/70, then 7/64. 7 of the 70 are excluded because a report is image-only; FL15209-R6 cites an NOA only in a report beyond the first two.
  - The NOAs cited are mostly the *components* inside an assembly: fasteners, insulation boards, adhesives, PVB interlayers and anchors. Many of them belong to other manufacturers.
  - Assembly tables that list the same component with both an FL# and an NOA# gave **30 FL#↔NOA# pairs**. Of the 17 where both IDs resolve in the current indexes, **15/17 have the same manufacturer after normalisation**. The other 2 are true alias pairs (USG Corporation ↔ United States Gypsum Company; Elevate ↔ Amrize Building Envelope LLC). So the pairs are also a deterministic, evidence-backed **alias source** for manufacturer names.
- **Deterministic staleness detection is the killer join.**
  - Every cited NOA number resolves by URL rule to the county PDF: **21/21**.
  - Expiry could be parsed from page 1 for **19/21**.
  - **6/19** cited NOAs are **past their expiration date** (as of 2026-09-27).
  - **5 of the 7 citing FL approvals** in the mixed sample rely on at least one such NOA: FL14087-R11, FL21837-R12, FL23956-R2, FL48095 and FL2534-R22.
  - No single source can surface this.
  - Caveat: a lapsed number may have been renewed under a new NOA number. The product must say "cites an NOA whose listed expiry has passed", never "non-compliant".
- **Manufacturer-name linkage between the two sources, at full scale.** Miami-Dade HVHZ index: 2,891 NOAs, 636 applicants. FBC 2023-code approved list: 4,645 applications, 1,090 manufacturer strings. Applicant strings matched:
  - raw exact: **74/636**;
  - case and whitespace folded: **86/636**;
  - legal suffixes and punctuation stripped: **220/636**;
  - plus parenthetical plant codes, "a div. of" and "/" split: **242/636** applicants, covering **1,380/2,891 NOAs and 1,077/4,645 FL applications**.
  - Hand-checks: **0/40** false at L2; **0/14** among the new L3 keys; **0 certain false, 1 uncertain (Storm Smart, Inc. ↔ Storm Smart Industries) in 30** at L3.
  - The rest do not overlap because the two systems approve different firm sets. Many FBC filers are fenestration makers with no current HVHZ NOA.
- **New sources.**
  - **FEMA BCAT** (building-code adoption by jurisdiction): **GREEN**, CC0-marked item. It links approvals to code editions and jurisdictions.
  - **FEMA National Risk Index** (county hail, hurricane and strong-wind risk): **AMBER**, FEMA T&C with citation, no-endorsement and "planning purposes" conditions. It gives hazard context by county FIPS.
  - **NWS zone–county correlation** (public domain): fixes the 15% of NCEI wind events that are zone-coded.
  - **IBHS FORTIFIED incentives**: AMBER, attribution-only reuse. The value is state incentive text.
  - RED, or PARKED as not a real source: other state product-approval systems (none exist in NC, LA, SC or AL), CCMC Canada, EOTA ETAs, CodeMark AU, ASCE Hazard Tool, ATC Hazards, fenestration manufacturer sites, and ENERGY STAR roof products (sunset 2022-06-01; no dataset left).
- **Recommendation.**
  - Build **`building-envelope-product-approvals`** as the composite:
    - Miami-Dade NOAs (all envelope categories);
    - FBC product approvals (Roofing, Windows, Exterior Doors, Shutters, Skylights, Impact Protective Systems);
    - FEMA BCAT (jurisdiction ↔ code edition);
    - FEMA NRI and NCEI Storm Events (hazard context);
    - Wikidata (parent and alias only).
  - Lead with the FL→NOA component graph and validity checking. That is the part that exists nowhere else.

#### Source inventory

| # | Source | Publisher | Origin | Jurisdiction | Rights | Access | Volume (measured today) | Free-text value |
|---|---|---|---|---|---|---|---|---|
| A | Miami-Dade Product Control NOAs, **all envelope categories** (scope extension of `roofing-miami-dade-noa`) | Miami-Dade County RER | governmental-host (manufacturer-filed) | HVHZ (Miami-Dade, Broward) | AMBER (round 2) | GET `pc-result_app.asp` per category. **Requires the ASP session cookie** from `pc-search_app.asp`; without it the result is an error page. | 2,891 current HVHZ NOAs, 636 applicants: Roofing 1,860, Doors 370, Windows 194, Vents 170, Cladding 125, Roof 69, Panels 59, Shutters 25, other 19. Also Materials 62 and Fasteners 37. | Very high. Assemblies, MDP, anchors and glazing in PDFs. 929 NOAs carry an impact rating in the index. |
| B | FBC product approvals, **all envelope categories** (scope extension of `roofing-florida-product-approvals`) | Florida Building Commission / DBPR | governmental-host (manufacturer-filed) | Florida statewide; HVHZ flag per product | AMBER (round 2) | ASP.NET postback list, GET detail, GET PDF | 4,645 approved on the 2023 code: Windows 1,845, Ext. Doors 1,459, Roofing 1,105, Shutters 125, Skylights 56, IPS 55. 1,090 manufacturer strings. | Very high. Per-product "Limits of Use", DP, an "Other" free-text field, and evaluation-report PDFs. |
| C | **FEMA Building Code Adoption Tracking (BCAT)** | FEMA (hosted by contractor Stantec on ArcGIS Online) | governmental | US: 50 states, DC, 5 territories | **GREEN** (CC0-marked item) / AMBER for the unmarked 2024-Q4 layer | ArcGIS REST FeatureServer, JSON, no key | Jurisdictions: 79,130 rows (CC0 layer, currency 2024-04..07). 2024-Q4 layer: 39,565 rows (currency 2024-09-30). Counties: 3,242 (currency 2023-03-31). | Medium. `Adoption_Notes` (56 distinct texts) give edition, effective date and predecessor. `Hurricane_Wind_Notes` (7 texts) cite code sections. |
| D | **FEMA National Risk Index (NRI), counties** | FEMA | governmental | US counties | **AMBER** | ArcGIS REST FeatureServer (`FEMA_NationalRiskIndex`) | 3,232 counties, 467 fields, version "December 2025 (1.20.0)" | Low. Already numeric (HAIL/HRCN/SWND frequency, EAL, rating). |
| E | NOAA NCEI Storm Events (existing `roofing-ncei-storm-events`) | NOAA | governmental | US | GREEN (round 2) | Bulk CSV.gz | 2025: 38,332 wind, hail and tornado events | Medium (narratives) |
| F | **NWS County–Public Forecast Zone correlation** (`bp16ap26.dbx`) | NOAA NWS | governmental | US | **GREEN** | One pipe-delimited file, updated about twice a year | 350 KB | None. It is a crosswalk. |
| G | **IBHS FORTIFIED incentives and standards pages** | Insurance Institute for Business & Home Safety | nongovernmental (nonprofit, insurer-funded) | US states | **AMBER** (attribution) | HTML pages; robots allow (`Crawl-delay: 10`) | 1 incentives page, about 20 states | Medium. State → incentive type (discount, grant, tax credit) → amount, all in prose. |
| H | Wikidata manufacturer items | Wikimedia | nongovernmental | global | GREEN (CC0) | API/SPARQL (**429 rate-limited from this egress today**) | 3/31 queried top applicants have an exact-label item; 19/50 queries were refused with 429 | Low |
| I | ENERGY STAR Roof Products (historical) | EPA | governmental | US | n/a | **No dataset exists.** The Socrata catalog has 0 roof datasets; `/products/roof_products` returns 404. | Sunset 2022-06-01 (memo verified) | — |
| J | CCMC Registry of Product Assessments (Canada) | National Research Council Canada | governmental | Canada | **RED** | JSON API (`published_evaluations.html`) | 463 assessments | High, but commercial redistribution needs permission |
| K | EOTA ETA database (EU) | EOTA (non-profit) | nongovernmental | EU/EEA | **RED** | HTML search | not measured | — |
| L | CodeMark Australia register (JAS-ANZ) | ABCB / JAS-ANZ | governmental-host | AU/NZ | **RED** (terms unreadable) | www.jas-anz.org TLS certificate mismatch | — | — |
| M | ASCE 7 Hazard Tool / ATC Hazards by Location (design wind and hail) | ASCE / ATC | nongovernmental | US | **RED** | ASCE `/legal` 404; ATC site "Website Suspended" | — | — |
| N | NC OSFM (NC DOI) informal code interpretations | State of North Carolina | governmental | NC | **RED** (non-commercial only) | PDF per interpretation | not counted | Medium |
| O | Fenestration manufacturer sites (PGT/MITER; Owens Corning roofing) | manufacturers | nongovernmental | — | **RED** | — | — | — |
| — | Other state or county product-approval systems (NC, LA, SC, AL, other hurricane states) | — | — | — | **none exist** | Web search today found only grant programs (SC Safe Home, Louisiana Fortify Homes) and NC OSFM interpretations. Texas (TDI) is the only other state registry and is RED (round 2). Broward County relies on Miami-Dade NOAs. | — | — |

#### Verbatim terms for new sources (read 2026-09-27)

**C. FEMA BCAT.** ArcGIS item `ded22c2eac5b4a7694f3152c98147436` ("FEMA Building Code Adoption Tracking", accessInformation "FEMA") and item `62b587b2caff4b16ae800f4cc0a4a684` ("FEMA Building Code Adoption Tracking Jurisdictions"). `https://www.arcgis.com/sharing/rest/content/items/62b587b2caff4b16ae800f4cc0a4a684?f=json`, `licenseInfo`: **"This work is marked with CC0 1.0"**. Description: "FEMA tracks current building code adoption status for state, local, tribal and territorial governments (SLTTs), reaching approximately 22,000 jurisdictions across the nation."
- The newer `2024_Q4_Government_Jurisdictions_for_Portal` item (`03932e9f47fc4be1b3db4f2baf511485`) has **empty** licenseInfo and accessInformation.
- A contractor-produced layer is not automatically a US-government work, so that layer is AMBER until its provenance is confirmed. Prefer the CC0-marked layer.
- `Contact_Email` is the generic `FEMA-Buildingsciencehelp@fema.dhs.gov` on all 39,565 rows, so there is no personal data.
- www.fema.gov returned 403 to both our UA and a browser UA, so the fema.gov BCAT page itself is unread.

**D. FEMA NRI.** `https://www.arcgis.com/sharing/rest/content/items/39485e8035d446a5bff03259508ae355?f=json`, `licenseInfo` (FEMA Terms & Conditions):
- "Data accessed through the National Risk Index dataset API or downloadable datasets do not include controls over its end use. The National Risk Index data are meant for planning purposes only."
- "Users must clearly state that “This product uses the Federal Emergency Management Agency’s National Risk Index dataset API or downloadable datasets but is not endorsed by FEMA. The Federal Government or FEMA cannot vouch for the data or analyses derived from these data after the data have been retrieved from the Agency's website(s).”"
- "you agree not to reverse engineer, decompile, or attempt to access or derive the underlying datasets"
- "FEMA may rescind your use of the data if FEMA believes that it does not serve the public interest. You agree you will cease using the data and destroy any copy you may have if requested by FEMA."

AMBER. There is no commercial-use bar. Conditions:
- carry the mandated citation, the dataset version and the retrieval time;
- no FEMA or DHS logos;
- present NRI values as county planning-level context, not site risk;
- no reverse-engineering of NRI inputs;
- keep a kill-switch honouring a rescission request.

`hazards.fema.gov/nri/data-resources` now redirects to a fema.gov RAPT page (403 here). The ArcGIS layer is the live access path.

**F. NWS zone–county.** https://www.weather.gov/disclaimer: "The information on National Weather Service (NWS) Web pages are in the public domain, unless specifically noted otherwise, and may be used without charge for any lawful purpose so long as you do not: 1) claim it is your own …". File listing at https://www.weather.gov/gis/ZoneCounty ("16 April 2026 … bp16ap26.dbx").

**G. IBHS FORTIFIED.** https://fortifiedhome.org/legal/:
- "Any reproduction, retransmission, or republication of all or part of any graphic images, materials or documents found on the Site is allowed with proper attribution to IBHS. Other use is prohibited unless the copyright owner of the material has expressly granted its prior written consent"
- "The names, trademarks, service marks and logos appearing on this site may not be used in any advertising or publicity, or otherwise to indicate IBHS’s sponsorship"

AMBER. Conditions: attribution to IBHS, no FORTIFIED mark or logo, no implied endorsement. `ibhs.org/terms-of-use/` and `fortifiedhome.org/terms-of-use/` return 404, so `/legal/` is the operative page.

**H. Wikidata.** https://www.wikidata.org/wiki/Wikidata:Licensing: "All structured data (i.e. the main, Property, Lexeme, and EntitySchema namespaces) is released into the public domain under Creative Commons Zero."

**I. ENERGY STAR roof sunset.** https://www.energystar.gov/sites/default/files/ENERGY%20STAR%20Roof%20Products%20Sunset%20Decision%20Memo.pdf (dated May 28, 2019): "EPA is finalizing the sunset of the ENERGY STAR specification for roof products effective June 1, 2022." And: "Brand owners must stop using the ENERGY STAR name and ENERGY STAR mark in association with all roof products on and after June 1, 2022." This confirms round 2's [UNVERIFIED] "ended 2022".

**J. CCMC (Canada).** The registry page links only https://www.canada.ca/en/transparency/terms.html: "Commercial reproduction Unless otherwise specified, you may not reproduce materials on this site, in whole or in part, for the purposes of commercial redistribution without prior written permission from the copyright administrator." A search of open.canada.ca for "CCMC" returned 0 datasets, so the Open Government Licence does not apply. RED.

**K. EOTA.** https://www.eota.eu/disclaimer-privacy-copyright-intranet:
- "The publication of bibliographic information about ETA’s is a service EOTA provides to its Members and the manufacturers according to the rules agreed upon within EOTA. All such rights are reserved."
- "It is prohibited to reproduce, modify, distribute or use in any commercial way the Protected Content of this Website."

RED.

**L. CodeMark.** https://www.abcb.gov.au/copyright offers a CC-BY-NC-ND or CC-BY-ND licence per resource ("All material presented on this website is provided under a Creative Commons (CC) Attribution 4.0 Australia Licensing model, with the exception of … content supplied by third parties"). The register itself is on JAS-ANZ: `curl: (60) SSL: no alternative certificate subject name matches target host name 'www.jas-anz.org'`. The terms are unreadable, so RED.

**M. ASCE / ATC.**
- https://ascehazardtool.org/legal: "404 - File or directory not found."
- https://hazards.atcouncil.org/: "Website Suspended Temporary under construction."

Terms are unreadable, so RED. Use NRI and NCEI instead.

**N. NC.** https://www.nc.gov/disclaimer-terms-use: "the State of North Carolina grants permission to copy and distribute non-image files, documents, and information for non-commercial use, provided they are copied and distributed without alteration". RED for a commercial product.

**O. PGT / MITER Brands.** https://www.pgtwindows.com/content/terms-use: "This excludes resale or commercial use, collecting product listings, creating derivative works, and data mining or similar extraction methods." Owens Corning's `/en-us/terms-of-use` renders no text without JavaScript, so it is unreadable and RED.

#### Linkage matrix (measured)

| Pair | Join key | Measured | Normalisation / notes | Sample IDs |
|---|---|---|---|---|
| FBC eval report → Miami-Dade NOA (roofing, HVHZ) | NOA number `\d{2}-\d{4}\.\d{2}` in report text | **8/22** HVHZ; **0/14** non-HVHZ; 36/40 text-extractable (the 4 untestable approvals are excluded from both denominators) | Round 2 found 5/26. 2 of the 8 upload the NOA itself as the evaluation document (FL3794-R12 → 25-0313.01; FL47448 → 25-0131.01), which is a same-product link. The other 6 are component tables. | FL15545-R11, FL10264-R23, FL48146, FL3794-R12, FL48090, FL47448, FL46297-R7, FL48189 |
| FBC eval report → NOA (mixed windows/doors/roof/skylight) | same | **8/63** (13%) with every evaluation report extractable, after hand-check; the raw regex gave 9 (7 of 70 excluded because a report is image-only; re-measured over all reports after review) | 1 false positive: FL48212 "Report: 26-0024.01-ACT-001" is a test-lab report ID. Require an `NOA`, `Miami-Dade` or `FBC NOA` column context, or a 2-digit-year check. | FL2534-R22, FL15209-R6, FL20873-R5, FL17454-R5, FL14087-R11, FL48095, FL23956-R2, FL21837-R12 |
| FBC detail page → NOA | same | **1/200** (FL14087-R11); 9/200 mention "NOA"/"Miami-Dade" | Detail pages are not where the link lives | fbc_detail_sample.json |
| Miami-Dade NOA → FL# | `FL\s?#?\d+(-R\d+)?` | **0/77** text-extractable (3/80 image-only excluded) | Every "FL 33xxx" hit was a ZIP code. The link is one-directional. | md_sample.json (80 IDs, e.g. 21-1001.01, 22-0203.06 …) |
| Cited NOA# → county PDF | URL rule `noa/<digits>.pdf` | **21/21** resolve (HTTP 200) | Only 11/21 appear in the current per-category HVHZ index. The rest are in other categories (e.g. 23-0713.20, PVB interlayer, valid to 2028) or expired, so resolution must use the PDF rule, not the index. | cited_noa_resolution.json |
| Cited NOA → expiry | "Expiration Date:" on page 1 | **19/21** parsed; **6/19 expired** before 2026-09-27 | Formats "August 31, 2026" and "06/08/27" | 21-0201.06, 21-0216.01, 23-0713.18, 23-0718.06, 24-0102.06, 24-0215.03 |
| FL# ↔ NOA# component pairs | same table row in an assembly table | **30** distinct pairs from 4 reports. **17** have both IDs in current indexes. Manufacturer agrees **15/17** (0 false; 2 true aliases). | Yields an alias table with evidence, e.g. FL20311 ↔ 22-0913.02 (SFS Group USA); FL4264 ↔ 25-1017.02 (United States Gypsum Company ↔ USG Corporation) | fl_noa_pairs.json |
| Miami-Dade applicant ↔ FBC manufacturer (full sets) | normalised company name | raw 74/636; fold 86/636; L2 220/636; **L3 242/636 applicants = 1,380/2,891 NOAs; 253/1,090 FBC strings = 1,077/4,645 apps** | L2 strips legal suffixes (inc, llc, corp, co, industries, products, manufacturing …) and punctuation. L3 also drops parentheticals ("(OH)", "(C)", "(Hialeah)"), splits at "a div. of", "div. of", "/" and "dba". Hand-checks: 0/40 false (L2), 0/14 new L3 keys, 0/30 false plus 1 uncertain (L3). | name_match_sample.json, name_match_L3.json, name_match_L3_sample30.json |
| Within FBC: duplicate manufacturer spellings | L2 key | 9 keys with more than 1 spelling (early count); for example, "Intertape Polymer Inc." vs "Intertape Polymer, Inc." | Keep every raw string. Link through a reviewed `organization_alias`. Never overwrite. | — |
| FBC approval → HVHZ jurisdictions | per-product "Approved for use in HVHZ: Yes" × BCAT jurisdictions in Miami-Dade and Broward | 113/200 applications (195/606 products) are HVHZ-approved. BCAT has **67** jurisdictions in the two HVHZ counties. | HVHZ = Miami-Dade + Broward (FBC definition). This is a rule, not a fuzzy match. | fbc_detail_sample.json |
| Code edition ↔ approval | FBC "Code Version 2023" ↔ BCAT FL `Adoption_Notes` "8th Edition … effective 12/31/2023" | **477/477** FL BCAT jurisdictions carry the 8th-Edition note; `Building_Code` = "2021 IBC" on 477/477 | Nationally, `Building_Code` parses as "YYYY IBC" in 27,907/39,565 rows (9,681 "No Data", 1,828 "No Building Code"). An edition is named in the notes for 34,294/39,565; an effective date for 3,528. | bcat_juris_2024q4.json |
| BCAT county ↔ NRI county | county FIPS | **3,122/3,232** exact | Needs a FIPS crosswalk: BCAT uses legacy **12025** for Miami-Dade (NRI uses 12086, the post-1997 code), old Connecticut counties 09001–09015 against the new planning regions 091xx, and Alaska borough changes | bcat_counties.json, nri_counties.json |
| NCEI Storm Events → NRI county | STATE_FIPS+CZ_FIPS (CZ_TYPE=C) | **32,431/32,604** (99.5%) of 2025 county-coded hail, thunderstorm-wind and tornado events | — | se2025 (c20260819) |
| NCEI zone-coded wind → county | NWS zone-county file | **5,279/5,728** resolve to ≥1 NRI county; **4,489** to exactly one | Zone to county is one-to-many. Store it as a multi-county relation and never pick one county. | bp16ap26.dbx |
| Miami-Dade applicant → Wikidata | normalised exact label | **3/31** answered (19/50 refused with HTTP 429) | Tecnoglass Q132305374, Siplast Q126882874, Overhead Door Q113461816. Low coverage [UNVERIFIED at scale]. | wikidata_top50.json |

#### Proposed canonical schema (`building_product_approval`)

| Field | Type | Supplied by | Conflict rule |
|---|---|---|---|
| `approval_id` | string, e.g. `mdc:NOA:25-0715.04`, `fl:FL5293-R73`, `fl:FL5293.1` (product) | A, B | Namespaced; never merged across issuers |
| `issuer` | enum `miami-dade-rer`, `fl-building-commission` | A, B | — |
| `status`, `valid_from`, `expires_on` | enum, date | A (index expiry + PDF), B (status, QA-contract expiry, dates) | Keep both issuers' dates. `expired` is computed against the fetch date. |
| `applicant_raw`, `organization_id` | string, FK | A, B, alias pairs (FL↔NOA), Wikidata | Raw string always kept. `organization_id` is assigned automatically only by an evidence-backed identifier pair (an FL#↔NOA# row naming both). An exact L3 key only proposes a candidate for review (revised after review). Every merge is logged and reversible (rule 3). |
| `category`, `subcategory`, `material` | taxonomy codes | A, B | Map both vocabularies to the taxonomy below; keep the source labels |
| `hvhz_approved`, `non_hvhz_approved`, `impact_rating` | bool, enum (Large/Small Missile, Level E) | A (index), B (per product) | Per issuer |
| `design_pressure_pos_psf`, `design_pressure_neg_psf` | number per assembly | A (index max + PDF tables), B (DP field + report tables) | Per assembly and issuer. Never averaged. The index max is flagged `summary_max`. |
| `assembly[]` | {deck, fastener_spacing, components[], mdp} | A and B PDFs (facts only) | Each assembly cites its document and page |
| `test_standards[]` | {standard, year} | A (text), B (Referenced Standard table: 159/200 applications) | Union with provenance |
| `cites_approval[]` | edge → another `approval_id` (component or same-product) | B eval reports | Edge type `component_of` or `same_product_as` (the second only when the NOA itself is uploaded). Evidence snippet required. |
| `cited_approval_expired` | derived bool | edge + A expiry | Derived; shows the cited expiry date |
| `jurisdictions[]` | {fips, place, code_edition, effective} | BCAT (C) + HVHZ rule | Code edition from BCAT, with its as-of date |
| `hazard_context` | {county_fips, nri_hail/hrcn/swnd rating + version, storm_events_last_n_years} | D, E, F | Planning-level only, cited with its version |
| `provenance[]` | {source_key, url, fetched_at, doc, page} | all | Every fact carries one |

**Join-key precedence.**
1. Exact approval ID: NOA#, or FL# plus revision.
2. The NOA# or FL# pair stated in the same assembly-table row. Evidence required.
3. The NOA uploaded as an FBC evaluation document, giving `same_product_as`.
4. Normalised organization key L3, which creates only an organization *candidate*, even on exact key equality (revised after review). An alias is accepted automatically only from a (2) pair, which states both identifiers.
5. County FIPS, through a crosswalk table for legacy codes.
6. NWS zone → county, one-to-many.

Never use vector or semantic similarity for product identity. Model-name overlap between FBC "Model, Number or Name" and the NOA description was **not** used.

**Taxonomy.**
- `trade`: roofing | fenestration | opening-protection | ventilation | cladding.
- `category`: roof-covering (asphalt-shingle, metal-panel, tile, single-ply, modified-bitumen, BUR, spray-foam, coating) | underlayment | roof-deck-insulation-board | roof-fastener-adhesive | window (single-hung, casement, fixed, slider, awning) | door (swinging, sliding, garage/overhead, rolling) | shutter (accordion, roll-down, panel, fabric) | skylight | vent | wall-panel.
- `hazard`: hurricane-wind | wind-borne-debris-impact | hail | fire (ASTM E108/UL 790).
- `approval_regime`: miami-dade-hvhz | florida-statewide | florida-hvhz.
- `evidence_type`: index-field | pdf-text | pdf-table | derived.

#### Agent questions only the aggregate answers

1. "This Florida approval FL14087-R11: are the Miami-Dade NOAs it relies on still unexpired today?" This needs B's report text, A's PDFs and the date. Measured: 5 of 7 citing approvals had at least one lapsed cited NOA.
2. "Which HVHZ-approved roof assemblies use SFS/Dekfast fasteners (FL20311 / NOA 22-0913.02), and which approvals would be affected if that NOA lapses?" This is the reverse component graph.
3. "List impact-rated garage doors approved for HVHZ by both Miami-Dade and Florida, with each issuer's design pressure and expiry." This needs A + B joined on organization and category.
4. "What code edition governs a permit in Coral Gables today, is it HVHZ, and which roof-covering approvals are valid there?" This needs C + the HVHZ rule + A/B.
5. "For Lee County (NRI hurricane 'Very High', 2025 thunderstorm-wind events), which shutter approvals are rated for large-missile impact outside the HVHZ?" This needs D/E + B.
6. "Which manufacturer names are the same firm across the Miami-Dade and Florida systems (e.g. Tremco CPG Inc. (OH) = Tremco CPG Inc.), and which are distributors filing on behalf of manufacturers (Beacon, SRS, Home Depot c/o Owens Corning)?"

#### Scores (composite `building-envelope-product-approvals`)

| demand | rights | acquisition | structuring | freshness | onboarding | poor access | Total |
|---|---|---|---|---|---|---|---|
| 4 | 3 | 3 | 5 | 4 | 3 | 5 | **27** |

- Rights stay at 3: the two cores are AMBER (Florida public-records reliance plus evaluator copyright carve-outs).
- Poor existing access is 5: the cross-issuer component-validity graph is not offered by either issuer or by the RED commercial directories.

#### Recommendation and next actions

1. Extend `roofing-miami-dade-noa` and `roofing-florida-product-approvals` to all envelope categories (measured counts above). Do not create duplicate candidates. Record the session-cookie requirement and the FBC list-row shift: 979/4,645 rows have no History link, so the columns shift by one.
2. Prototype the FL→NOA edge extractor:
   - regex plus an `NOA`/`Miami-Dade` column context;
   - the URL rule to resolve each cited number;
   - page-1 expiry parsing;
   - golden-test on the 15 citing applications listed above.
3. Add a FIPS crosswalk (12025→12086, CT planning regions) before any county join.
4. Add BCAT (CC0 layer) and the NRI county layer as reference tables. Keep NRI's mandated citation and "planning purposes only" wording on every hazard fact.
5. [UNVERIFIED] Miami-Dade window and shutter counts look low (194 windows, 25 shutters). Confirm with per-applicant queries that the advanced search is not dropping records before claiming coverage.

## Composite: Licensed trade contractors
Entity: a licensed trade contractor **business** (HVAC/mechanical, plumbing, electrical, roofing,
appliance installation/repair). Never an individual. Builds on round 2
(`docs/sources/pipeline/research-2026-09-27-service-trades.md`):
Texas TDLR A/C (`hvac-tx-acr-contractor-licences`) and electrical (`electrical-tx-tdlr-contractors`)
were AMBER (business facts only); Florida DBPR (`roofing-fl-dbpr-contractor-licences`) RED
(personal data); OSM HVAC (`hvac-osm-contractors`) parked; OSM appliance (`appliance-osm-shops`)
DISCOVERED. Those findings are not redone here; TDLR was re-pulled only to measure linkage.

All requests used `User-Agent: DataFoundry/1.0 (data@mail.proviciency.com)` at ≤1 req/s, except
where noted (a browser UA was tried **only** to read two terms pages that refused the descriptive
UA; both still refused). No prohibited domain was contacted. Fixed seed **20260927**; sample IDs are
in `evidence/2026-09-27-composites/contractors/samples.json`; scripts `norm.py`, `trade.py` (normalisers) in the same
folder. Raw downloads were deleted at the end (see "Housekeeping").

### Summary

- **A sellable composite exists, but it is a state-regulator composite.** Five state regulators
  publish trade-contractor licence data as daily bulk open data with an explicit public-domain
  licence or statement: **Washington L&I** (PDDL), **Oregon CCB + Oregon BCD** (dataset licence
  "Public Domain"), **Colorado DORA** (Public Domain + a mandatory disclaimer), **Connecticut DCP**
  (Public Domain), **Minnesota DLI** ("All of the information … are in the public domain"). Together
  with Texas TDLR (AMBER from round 2) and EPA's lead-safe (RRP) certified-firm list, they cover
  ~58k active entity-form trade credentials (WA 8,841; OR BCD 4,822; CO 5,872; MN 20,345 business
  rows incl. residential; TX A/C 9,237 + electrical 8,856 + appliance 498) plus ~57k entity-form
  general-contractor registrations (OR CCB 37,593; CT HIC 19,602 active LLC/corp/partnership), with bond, insurance, status,
  suspension and disciplinary facets that no single source has.
- **The linkage that works is normalised and address-anchored, and reviewed before it links.** Same-state agency↔agency joins
  are strong (Oregon trade licence → CCB registration **45/50**); cross-state joins work only with
  name + (zip|city|phone) (hand-checked precision **10/10**) — name-only is **~1/10** precise and
  must never auto-link. Washington's **UBI** is the only true business identifier in any source.
- **The trade dimension comes from combining sources.** Oregon CCB (the registration everyone needs)
  has no trade field; Oregon BCD (plumbing/electrical/HVAC-R licences) has the trade but not bond or
  insurance. Joined, they give "licensed Oregon plumbing contractor with bond X and insurance Y".
  EPA RRP adds a "lead-safe certified" attribute, but joins general-contractor registries (28–31/50),
  not trade licences (TX 0/50, CO 3/50).
- **Personal data is the dominant constraint.** In CT, CO (individual types), NYC and TX A/C the trade
  licence is legally held by a natural person; in WA/OR/MN there is a business-vs-person flag that
  makes exclusion deterministic. Principal/RMI/owner names, personal phones and emails must never be
  published. Washington's RCW 42.56.070(8) forbids agencies to provide "lists of individuals … for
  commercial purposes" — a strong signal to publish only non-individual business types.
- **Blocked/unmeasured:** California CSLB master file (WAF "Request Rejected" to our POST — highest
  value source, classification codes C-20/C-36/C-10/C-39); OSHA inspections (DOL API needs a
  registered key; osha.gov CloudFront 403); SAM.gov (account + API key; D&B restrictions). All
  OSHA/SAM linkage numbers are **[UNVERIFIED]**.

### Source inventory

Volumes are measured today unless marked. "Entity rows" = business (non-individual) records.

| # | Source | Publisher | Origin | Juris. | Rights | Access | Volume (measured) | Free-text / structuring value |
|---|---|---|---|---|---|---|---|---|
| 1 | L&I Contractor License Data – General (`m8qx-ubtq`) + Bond (`bzff-4fmt`) + Insurance (`ciwg-agsx`) | WA Dept of Labor & Industries | governmental | WA | **AMBER** (PDDL; exclude individuals/principals) | Socrata SODA/CSV, updated 3×/day | 161,677 licences (149,781 UBIs); trade rows 17,281 (electrical 9,243, plumbing 4,606, HVAC 2,548, roofing 1,557, appliance 348); active non-individual trade 8,841; bond 177,250 rows (290 "impaired"); insurance 77,212 | Specialty descriptions are inconsistent free text ("HVAC/RFRG", "Heating/Vent/Air-Conditioning and Refrig (HVAC/R) ") → taxonomy; status (10 values) → normalised; suspend dates |
| 1b | L&I Contractor License – Principal Data (`4xk5-x9j6`) | WA L&I | governmental | WA | **RED** (personal names) | Socrata | 251,343 | Principal (owner) names — never published |
| 2 | CCB Active Licenses (`g77e-6bhs`) | Oregon Construction Contractors Board | governmental | OR | **AMBER** | Socrata, daily | 56,341 rows / 45,619 licences (37,593 entity-form names); LBPR lead-renovation endorsements 4,385 | No trade field; endorsement text; bond + insurance carrier/amount/expiry; `rmi_name` = personal (exclude) |
| 3 | BCD Active Contractor/Individual Licenses (`vhbr-cuaq`) | Oregon DCBS Building Codes Division | governmental | OR | **AMBER** | Socrata, monthly | 47,959; trade contractor types 5,167 (PB 1,826, C 1,396, LHR 474, CLE 392, LMS 366, BB 280, CRE 229, CPI 204); entity-form 4,822 | `lictype` "PB-Plumbing Contractor" etc. → taxonomy; dba field |
| 4 | Professional and Occupational Licenses in Colorado (`7s5z-vewr`), types EC/PC/WC | Colorado DORA | governmental | CO | **AMBER** (Public Domain + required disclaimer; revocable) | Socrata, daily | EC 12,526, PC 5,427, WC 20; active 7,990 (5,872 entity-form); 945 rows with discipline | `programaction` discipline text ("CLS Stipulation", "CLS Letter of Admonition", "CLS Revocation" …) → action taxonomy; type table (`349y-twqi`) flags Business vs Individual |
| 5 | Home Improvement Contractor Licenses (`5r9m-qgni`) / State Licenses and Credentials (`ngch-56tr`) | Connecticut DCP | governmental | CT | **AMBER** for HIC business types; **RED** for trade credentials (individual-held) | Socrata, daily | HIC 135,358 (active 25,048: LLC 16,567, CORP 2,904, INDIVIDUAL 5,442); trade credentials: Electrical Unlimited 13,879 of which INDIVIDUAL 13,863 | Credential/sub-category codes; statusreason text |
| 6 | DLI licence/registration exports (Electrical, Plumbing, Mechanical Contractor Bond, Residential Contractors) | Minnesota DLI | governmental | MN | **AMBER** (public-domain statement; attribution request; exclude `Bus_Pers=Personal`) | Nightly CSV at secure.doli.state.mn.us | 211,259 rows in 4 files; Business rows 36,745 (Issued 20,345; 18,792 entity-form); Class A Electrical Contractor active 2,652; Mechanical Contractor Bond active 2,548; Residential Roofer Contractor 224; enforcement flag set on 3,631 rows | `Enforcement_Action` flag; licence subtypes → taxonomy |
| 7 | TDLR All Licenses (`7358-krk7`): A/C Contractor, Electrical Contractor, Appliance Installation Contractor | Texas TDLR | governmental | TX | AMBER (round 2) | Socrata / daily CSV | A/C 20,436 (entity-form 9,237; **no phone/address in the Socrata A/C rows, county only**); Electrical 14,019 (8,856 entity-form); Appliance Installation Contractor 830 (498 entity-form) — new in this round | A/C `license_subtype` codes AC/AE/AR/BC/BE/BR/AEBR/ARBE [decoding UNVERIFIED] |
| 8 | EPA RRP lead-safe certified firms (firm-location-search API behind `cdxocsppapps.epa.gov/ocspp-oppt-lead`) | US EPA OCSPP | governmental-host | US | **AMBER** | JSON POST per state (the public locator's own endpoint; needs its XSRF cookie) | TX 2,612, CO 1,272, CT 1,227, NY 8,524, CA 5,826, OR 90, WA 229 (OR/WA run their own programmes) | Firm names embed personal names ("Building Busters/ Paul Russell"); only 1,431/2,612 TX names entity-form; certification number `NAT-F…` + expiry |
| 8b | EPA list of entities whose lead certification was suspended/revoked/modified/reinstated | US EPA | governmental | US | AMBER | One PDF (59 KB) "August 2021", page updated 2026-06-25 | [UNVERIFIED count] | Unstructured PDF → enforcement events; stale (2021) |
| 9 | OSHA inspection / violation / related-activity | US DOL OSHA | governmental | US | **GREEN** on rights ("may be used, reproduced and distributed without permission") — personal data in accident/injury tables excluded | DOL API v4 (`apiprod.dol.gov`) **requires a registered API key** (401 without); osha.gov CloudFront 403 to our UA | [UNVERIFIED] (daily per DOL catalogue) | NAICS 2382xx (plumbing/HVAC 238220, electrical 238210, roofing 238160) filters; violation standards; free-text accident abstracts (exclude persons) |
| 10 | SAM.gov Entity Management (public) | GSA | governmental | US | **AMBER** (public API only; D&B Open Data not in bulk; POC names personal) | Account + API key required | [UNVERIFIED] | UEI, NAICS; home-service coverage expected low [UNVERIFIED] |
| 11 | OpenStreetMap `craft=hvac/plumber/electrician/roofer/appliance_repair`, `shop=hvac/appliance` | OSM contributors | nongovernmental | global | AMBER (ODbL share-alike) — existing keys | Overpass (unstable: 504/timeouts) | CO 311, WA bbox 455 (211 WA-addressed), TX 105 (mirror result, likely incomplete [UNVERIFIED]) | Few fields; value = "advertised trade + website" signal |
| 12 | CSLB Public Data Portal: License Master / Workers' Comp / Personnel | California CSLB | governmental | CA | AMBER on terms (ca.gov "considered in the public domain"); Personnel file **RED** | ASP.NET download form: **POST rejected by WAF** ("The requested URL was rejected") from this egress | [UNVERIFIED] | Classification codes C-20/C-38/C-43/C-4/C-36/C-42/C-55/C-10/C-7/C-46/C-45/C-39 → taxonomy; bond, workers' comp |
| 13 | DOB License Info (`t8hj-ruu2`) | NYC Department of Buildings | governmental | NYC | **RED** (terms unreadable: NYC Admin Code page 403 to both UAs; dataset licence null; first/last names + `business_email`) | Socrata | 103,234 (Electrical Firm 5,544; Master Plumber 3,007; Oil Burner Installer 413) | — |
| 14 | Arizona ROC posting list | AZ Registrar of Contractors | governmental | AZ | **RED** (unreadable: 403 to descriptive and browser UA) | — | [UNVERIFIED] | — |
| 15 | Virginia DPOR, North Carolina electrical/plumbing boards, Utah DOPL | state boards | governmental | VA/NC/UT | not assessed beyond landing pages; no bulk file linked (Utah: "Request a List of Licensees", a paid request) [UNVERIFIED] | per-record lookup only | — | — |

### Verbatim terms for new sources (fetched 2026-09-27)

**Washington L&I (sources 1, 1b).** Dataset metadata `license`: `{"name": "Open Data Commons Public
Domain Dedication and License", "termsLink": "http://opendatacommons.org/licenses/pddl/1.0/"}` on
`m8qx-ubtq` and `4xk5-x9j6`; `ciwg-agsx` says `"Public Domain"`; `bzff-4fmt` has `license: null`.
https://opendatacommons.org/licenses/pddl/1-0/ :
> "Recipients may use this work commercially, use technical protection measures, combine this data or database with other databases or data, and share their changes and additions or keep them secret."

The data.wa.gov portal Terms asset (`/dataset/Terms-of-Service/wt8r-5xui`) redirects to a login
page — **unreadable**, so the operative grant is the dataset-level licence above.
RCW 42.56.070(8), https://app.leg.wa.gov/RCW/default.aspx?cite=42.56.070 :
> "This chapter shall not be construed as giving authority to any agency, the office of the secretary of the senate, or the office of the chief clerk of the house of representatives to give, sell or provide access to lists of individuals requested for commercial purposes, and agencies, the office of the secretary of the senate, and the office of the chief clerk of the house of representatives shall not do so unless specifically authorized or directed by law"

It binds agencies, not us, but it is the legislature's stated line: we publish no list of individuals.
The bond table (`bzff-4fmt`, licence null) is used only for bond facts (surety, amount, dates,
impaired flag), which are non-copyrightable facts released on the same portal.

**Oregon CCB and BCD (2, 3).** https://data.oregon.gov/api/views/g77e-6bhs.json metadata, verbatim:
`"license" : { "name" : "Public Domain U.S. Government", "termsLink" : "https://www.usa.gov/government-works" }` (the link now redirects to
`/government-copyright`); https://data.oregon.gov/api/views/vhbr-cuaq.json: licence `{"name": "Public Domain"}` and description:
> "Building Codes division provides this list of all active license holders as required by Oregon Revised Statute Chapter 192. License types include inspector code certifications and electrical, plumbing, boiler, elevator, prefab and manufactured dwelling contractor licenses for individuals and businesses."

The portal's own terms link points to the platform vendor (tylertech.com/terms), not a data licence.

**Colorado DORA (4).** Dataset licence `Public Domain`. https://data.colorado.gov/terms :
> "Applications using data supplied by this site must include the following disclaimers on their sites: "The data made available here has been modified for use from its original source, which is the State of Colorado. THE STATE OF COLORADO MAKES NO REPRESENTATIONS OR WARRANTY AS TO THE COMPLETENESS, ACCURACY, TIMELINESS, OR CONTENT OF ANY DATA MADE AVAILABLE THROUGH THIS SITE. …""
> "The State of Colorado reserves the right to modify and/or discontinue providing any or all of the data feeds at any time and to require the termination of any and all displaying, distributing or otherwise using any or all of the data for any reason"

**Connecticut DCP (5).** Dataset licence `Public Domain`. https://data.ct.gov/terms :
> "Publishable data made available on the Connecticut Open Data Portal shall be provided as a public service on an “as is” basis."

**Minnesota DLI (6).** https://www.dli.mn.gov/about-department/about-dli/disclaimer :
> "All of the information and documents on the DLI website are in the public domain. Any website can link to our website. … If you link to DLI's site, we request that you do not pull text from the DLI's site or its publications without proper source attribution."

Download page https://www.dli.mn.gov/license-and-registration-lookup :
> "Download a spreadsheet of all licensed businesses and individuals. This export file includes all licenses, bonds, certifications and registrations that are issued by the Construction Codes and Licensing Division of DLI. The file is updated nightly"

**EPA RRP (8, 8b).** https://www.epa.gov/web-policies-and-procedures/epa-disclaimers :
> "Unless otherwise specified, geospatial data produced by the EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105."
> "Mention of or referral to commercial products or services, and/or links to non-EPA sites does not imply official EPA endorsement"

The round-2 EPA Standard Open Data licence, https://edg.epa.gov/EPA_Data_License.html :
> "Unless otherwise specified, all data produced by the U.S EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105."

It applies to EPA-compiled records; the
firm fields are submitted by firms, so AMBER on the facts argument, like ENERGY STAR in round 2.
Caveat: the endpoint is the locator app's own JSON API (not a documented bulk service); it needed
the XSRF cookie the app sets. That is using the public tool as designed, one state per request, but
a documented bulk route should be requested before production.

**US DOL / OSHA (9).** https://www.dol.gov/general/aboutdol/copyright :
> "Materials created by the federal government are generally part of the public domain and may be used, reproduced and distributed without permission. … However, such materials may not be used in a manner that implies any affiliation or endorsement by the DOL of your company, website or publication."

API: `curl https://apiprod.dol.gov/v4/get/OSHA/inspection/json` → 401 "The API key is either
incorrect or missing from your query." The dataset catalogue (`/v4/datasets`, no key) lists OSHA
`inspection`, `violation`, `related_activity`, `accident*` as "Daily".

**SAM.gov (10).** https://sam.gov/about/terms-of-use :
> "If you want to share data publicly, only share data from public versions of APIs."
> "You may not share D&B Open Data in bulk (that is, enough records that someone could use them as an original data source or a substitute for getting data from D&B)."
> "Automated data gathering, web scraping tools are prohibited"

https://open.gsa.gov/api/entity-api/ : public data "such as name, UEI, registration details,
physical and mailing addresses, business types, PSC, NAICS and points of contact name and address";
"To access Public data: Users must have a non-Federal/Federal Individual (Personal) account and the
respective API Key".

**California CSLB (12).** Portal https://www.cslb.ca.gov/OnlineServices/DataPortal/ : "You may
access publicly disclosable contractor's license information"; master-list page: "LICENSE MASTER:
Provides information for all licenses that are currently renewed, or *expired but renewable … license
number, business name, address, telephone number, license status, issue/expiration dates,
classification(s), bond information, and workers' compensation information." "PERSONNEL: … personnel
names, titles" (RED). "Fee There is no charge for this service." Conditions of Use,
https://www.ca.gov/legal/conditions-of-use/ :
> "In general, information presented on this website, unless otherwise indicated, is considered in the public domain. It may be distributed or copied as permitted by law. However, the State does make use of copyrighted data (e.g., photographs) which may require additional permissions prior to your use."

The download POST (`ContractorList`, `ddlStatus=M`) returned an F5 "Request Rejected" page twice,
with and without Referer/Origin. Not retried further.

**NYC DOB (13), Arizona ROC (14).** NYC Open Data terms point to NYC Admin Code
(codelibrary.amlegal.com) — **403** to both UAs; the nyc.gov terms page has no data clause; dataset
licence null. roc.az.gov/posting-list — **403** to both UAs. Unreadable → RED.

### Linkage matrix (measured)

Normalisation (`norm.py`): upper-case; `&`→AND; strip punctuation; drop legal-form/stop tokens
(LLC, INC, CORP, CO, COMPANY, LTD, LP, LLP, PLLC, PC, THE, DBA …); require ≥6 characters; phone →
last 10 digits; zip → 5 digits. "Confirmed" = normalised name **and** (zip5 or city or phone) agree.
Samples: seed 20260927, IDs in `samples.json`.

| Pair (A → B) | Join key | Sample result | Population result | Hand check / notes |
|---|---|---|---|---|
| WA licence → WA bond table | licence number (exact) | **49/50** have bond rows | 8,611/8,841 | exact key, no ambiguity |
| WA licence → WA insurance table | licence number | 20/50 | 3,885/8,841 | EL/PL contractor types are largely absent from the insurance table (coverage gap, not a join failure) |
| WA licence ↔ WA licence (same business, successive licences) | UBI | — | 161,674 rows → 149,781 UBIs | UBI is the only true business identifier found in any source |
| OR BCD trade-contractor licence (entity) → OR CCB registration | name (incl. dba) + city | **45/50** (48/50 name) | 4,314/4,822 (4,594 name) | 3 name-only: PRO ELECTRIC NW LLC Portland↔Hillsboro, BATHTUB SOLUTIONS INC Portland↔Wilmington, INTERSTATE ELECTRIC INC Salem↔Keizer — all plausible same firm (branch/HQ address) |
| WA active trade business (entity) → OR CCB | name+phone | **11/50** | 740/8,841 | 11/11 correct |
|  | name only | 14/50 | 1,191/8,841 | 2/3 name-only correct (ARCON GC LLC, BRAIN POWER INC); 1 false (MILL CREEK PLUMBING Bothell WA ↔ The Dalles OR, different phone) |
|  | phone only | 14/50 | 1,154/8,841 | 3 phone-not-name: 2 true (BGIS abbreviation; TOTAL ENERGY MANAGEMENT ↔ "…& HVAC SERVICES INC"), 1 different business (ADVANCED ELECTRICAL TECHNLGIES ↔ PACIFIC NORTHERN ENVIRONMENTAL LLC) |
| OR CCB (2,000 sampled) → WA | name / confirmed / name+phone | — | 457 / 337 / 290 of 2,000 | adjacent states share many firms |
| CO EC/PC (2,000 sampled) → TX electrical | name / confirmed | — | 264 / **45** of 2,000 | hand check 10 confirmed: **10/10 same firm** (e.g. EC8082 Feyen-Zylstra Holdings ↔ TX 34643, both Grand Rapids MI 49544); 10 name-only: **~1/10** same (TriSMART Solar), 9 different (e.g. "Moonlight Electric" Durango CO vs Greenville TX) |
| CO → WA / OR / CT; TX EC → WA; CT HIC → WA/OR/TX | confirmed of 2,000 | — | CO→WA 34, CO→OR 30, CO→CT 7, TX→WA 25 (23 by phone), CT→WA 4, CT→OR 5, CT→TX 0 | name-only counts 5–10× larger and mostly collisions |
| MN active Class A Electrical Contractor → WA / TX / CO | confirmed | 1/50, 0/50, 0/50 | 81, 117, 107 of 2,652 | multi-state firms (HQ address carried in every state) |
| TX A/C contractor (entity) → TX electrical contractor (same business, 2 trades) | name (+county) | 3/50 (2 same county) | 559/9,237 (455 same county) | county mismatches mostly multi-branch firms (TDINDUSTRIES INC Nueces↔Dallas); 1/8 checked was false ("AIR CO LTD" ↔ "AIR", suffix-stripping collision) |
| MN Mechanical Contractor Bond (HVAC) → MN plumbing / electrical | name | — | 1,119/2,548 plumbing; 259/2,548 electrical | cross-trade profile of one business |
| EPA RRP firm → state registry, **general-contractor** registries | name+(phone|zip) | CT HIC **31/50**, WA **30/50**, OR CCB **28/50** | — | e.g. NAT-F237951-1 General Painting and Decorating LLC ↔ CT HIC; WA/OR lists are tiny (state-run RRP) |
| EPA RRP firm → **trade** licences | name+(phone|zip) | TX (A/C+EC+appliance) **0/50** (1 name-only), CO EC/PC **3/50** | — | RRP firms are renovators/painters; RRP is an attribute of general contractors, rarely of trade licensees |
| OSM trade POI → WA licences | name+(city|phone) | **23/50** (27 name, 12 phone, 8 name+phone) | — | 0 matched to Individual business type; exposes expired licences (Henco Plumbing Services LLC, MM Comfort Systems: EXPIRED); 1 shared phone (Pioneer Plumbing ↔ Loyal Mechanical) shows phone alone is ambiguous |
| OSM electrician/plumber POIs → CO EC/PC | name+(city|zip) | — | **36/114** (59 name) | CO does not license HVAC/roofing at state level, so only electrician/plumber POIs are linkable |
| OSM trade POI → TX licences | name+(county|phone) | 2/50 confirmed, 6/50 name | — | TX A/C Socrata rows have no address/phone, so confirmation is structurally impossible; TX OSM extract likely incomplete [UNVERIFIED] |
| Licence ↔ OSHA establishment | name+address, NAICS 2381xx/2382xx | **[UNVERIFIED]** | — | blocked: DOL API key required |
| Licence ↔ SAM.gov entity | UEI / name+address | **[UNVERIFIED]** | — | blocked: SAM account + key |
| CSLB ↔ anything | licence no. / name+address | **[UNVERIFIED]** | — | blocked: CSLB WAF |

Normalisation lessons: (1) stripping legal forms is required (LLC vs ", LLC" vs "L.L.C.") but the
legal form must then be compared separately — "SK ELECTRIC LLC" (CO) vs "SK ELECTRIC INC" (TX) are
different entities; (2) WA truncates/abbreviates names (e.g. "BGIS INTGRTD TECH SERVS US LLC",
"ADVANCED ELECTRICAL TECHNLGIES"), so an abbreviation table is needed before name joins with WA;
(3) OR CCB repeats a licence once per endorsement/row (56,341 rows, 45,619 licences) — dedupe on
licence number; (4) short/generic names (<6 chars after stripping, "AIR", "DELTA ELECTRIC") must not
link on name.

### Personal-data risks (rigorous)

| Source | Risk | Rule |
|---|---|---|
| WA L&I | `primaryprincipalname` (natural person) on every row; Principal dataset 251,343 names; 32,946 licences with business type `Individual` (2,124 among trade rows); sole-prop phone/address are personal | Drop principal fields/dataset; publish only business types LLC/Corporation/Partnership/LLP/JV/Association/Trust; phone/address only for those |
| OR CCB | `rmi_name` (responsible managing individual); no entity-type field | Drop `rmi_name`; publish only entity-form names (37,593/45,619); phone only for entity-form |
| OR BCD | `full_name` is a person for 345 of 5,167 contractor licences (219 with a dba); all journeyman/supervising licences are individuals | Only entity-form `full_name`; never publish a person name even with dba |
| CO DORA | Individual types (ME, JW, MP, JP …) carry names; EC/PC are Business types but 2,118/7,990 active names are not entity-form | Only EC/PC/WC; entity-form names only; discipline events only on business licences |
| CT | Trade contractor credentials (ELC/PLM/HTG) are **individual** licences (e.g. 13,863/13,879 Electrical Unlimited); HIC Individual 5,442 active (3,685 with a DBA) | Trade credentials RED; HIC only for LLC/Corporation/Partnership types |
| MN | `Bus_Pers=Personal` rows include home addresses and `Email_Address` | Business rows only; Email column dropped (0 business rows have it) |
| TX TDLR | A/C licence is held by an individual (`owner_name` is a person on the rows where it differs from the business name) | Round-2 conditions stand; publish licence facts only when the business name is entity-form |
| EPA RRP | Firm names embed people ("Building Busters/ Paul Russell"); 1,181/2,612 TX names not entity-form; phone/address of sole traders | Entity-form names only; no phone for non-entity |
| OSHA | Accident/injury tables describe injured workers | Use inspection/violation facts only; never accident abstracts [UNVERIFIED design] |
| SAM | Points-of-contact names | Never ingest POC fields |
| CSLB | Personnel file; sole-owner licences | Personnel RED; License Master entity-form only |
| NYC DOB | first/last name, `business_email` | RED |

A sole proprietor with a DBA is excluded by default: no source lets us verify that the DBA is a
registered assumed name, and the licence record itself identifies the person.

### Proposed canonical schema (`ContractorBusiness`)

Every fact carries `{source_key, source_record_id, fetched_at, source_updated_at}`. When sources
disagree, keep both values with provenance; never average or overwrite. Status is per credential,
never merged across jurisdictions.

| Field | Type | Supplied by | Conflict rule |
|---|---|---|---|
| `business_id` | stable surrogate (ours) | resolver | minted per resolved cluster; clusters form automatically only on declared identifiers (licence number, UBI) and otherwise only after review; auditable, reversible link sets |
| `identifiers` | list `{scheme, value}`: `wa_ubi`, `state_licence:{ST}:{issuer}`, `epa_rrp_cert`, `osm_id`, `sam_uei`[UNVERIFIED], `osha_activity_nr`[UNVERIFIED] | all | union; an identifier belongs to exactly one cluster (a collision blocks auto-link) |
| `legal_name` / `names[]` | string / list `{name, kind: legal|dba|as_listed, source}` | all | keep every as-listed spelling |
| `entity_form` | enum llc/corporation/partnership/llp/… | WA biztype, CT type, suffix parse elsewhere | explicit field beats suffix parse; mismatch = no auto-link |
| `locations[]` | `{address, city, region, postal, county, lat/lon}` business addresses only | WA, OR, CO(city/zip), CT(city/zip), MN, TX EC, RRP, OSM | keep all with provenance |
| `phones[]` | E.164, entity-form only | WA, OR, MN, TX EC, RRP, OSM | keep all |
| `trades[]` | taxonomy codes (below) | derived from credentials + OSM craft | union, each with the credential/tag that implies it |
| `credentials[]` | `{jurisdiction, issuer, number, type_raw, taxonomy_code, class, scope(residential/commercial), status_raw, status, issued, expires, suspended_on}` | WA, OR CCB, OR BCD, CO, CT HIC, MN, TX, CSLB[UNVERIFIED] | never merged |
| `bonds[]` | `{surety, amount, effective, expires, cancelled, impaired, impaired_on}` | WA bond, OR CCB, MN mech bond, CSLB[UNVERIFIED] | keep all |
| `insurance[]` | `{carrier, amount, policy_no?, effective, expires}` (policy number optional; review) | WA insurance, OR CCB, CSLB workers' comp[UNVERIFIED] | keep all |
| `disciplinary_actions[]` | `{jurisdiction, case_number, action (normalised), action_raw, effective, completed}` | CO `programaction`/`casenumber`, MN `Enforcement_Action` flag, WA suspensions, EPA RRP enforcement PDF | keep all |
| `certifications[]` | `{program: epa_rrp|or_lbpr, number, expires, disciplines}` | EPA RRP, OR CCB LBPR | keep all |
| `web_presence` | `{osm_id, website}` | OSM | ODbL-scoped |
| `osha_inspections[]` | `{activity_nr, open_date, naics, violations, penalties}` | OSHA [UNVERIFIED] | keep all |

#### Join keys, in precedence order

Only keys 1–2 (declared identifiers) link automatically. Keys 3–5 are review candidates: names and
phones are not identifiers, can be shared across branches, and a shared-phone false match was
observed. *Revised 2026-09-27 after review; the original draft auto-linked keys 3–4.*

1. **Source-native identifiers** (licence number within one agency; WA licence ↔ bond/insurance) — exact.
2. **WA UBI** — exact; clusters successive WA licences of one business.
3. **Normalised name + legal form + (zip5 | city)** — candidate: within-state across agencies (OR BCD→CCB
   45/50) and across states (precision 10/10 hand-checked).
4. **Normalised name + phone10** — candidate: WA→OR 11/50, precision 11/11.
5. **Phone alone** or **name alone** — candidates for review only, never auto-links (name-only
   cross-state precision ~1/10; phone-only 2/3 with a proven shared-phone false match).
6. Future: SAM UEI and OSHA establishment name+address [UNVERIFIED].

#### Classification taxonomy

`trade` → `subcategory` (the crosswalk is configuration, per the no-vertical-fork rule):

- **hvac**: `hvac.air_conditioning_refrigeration` (TX ACR AC/AR/BR…, CA C-20/C-38 [UNVERIFIED access],
  WA "HVAC/RFRG" + "Heating/Vent/Air-Conditioning and Refrig (HVAC/R)", OR BCD LHR, MN Mechanical
  Contractor Bond, CT HTG [individual, RED]); `hvac.boiler_steam` (WA BOILER/STEAM FIT, OR BB,
  CA C-4); `hvac.sheet_metal` (CA C-43, CT SM).
- **plumbing**: `plumbing.general` (WA PL, OR PB, CO PC, MN Plumbing Contractor, CA C-36);
  `plumbing.backflow` (WA BACKFLOW SPECIALTY); `plumbing.drain_sewer` (WA Drain Cleaning, Side
  sewers; CA C-42); `plumbing.water_conditioning` (CO WC, MN, CA C-55); `plumbing.pump`
  (WA PUMP & IRRIGATION / Domestic Pump, OR CPI).
- **electrical**: `electrical.general` (WA EL, OR C, CO EC, TX EC, MN Class A EC, CA C-10);
  `electrical.limited_energy` (WA LIMITED ENERGY, OR CLE/CRE, MN Technology Systems, CA C-7);
  `electrical.sign` (TX Electrical Sign Contractor, MN Sign Contractor Bond, CA C-45);
  `electrical.solar` (CA C-46).
- **roofing**: `roofing.general` (WA ROOFING, MN Residential Roofer Contractor, CA C-39);
  `roofing.gutters` (WA GUTTERS/DOWNSPOUTS).
- **appliance**: `appliance.installation` (TX Appliance Installation Contractor RAIC);
  `appliance.repair` (WA APPLIANCE REPAIR, APPLIANCES/EQUIPMENT; OSM appliance_repair).
- **general** (context, not a target trade): OR CCB RGC/CGC/RSC…, CT HIC, MN Residential Building
  Contractor, WA GENERAL.

Cross-cutting facets: `credential_status` ∈ {active, expired, suspended, revoked, surrendered,
inactive, out_of_business, deceased→excluded}; `scope` ∈ {residential, commercial, both};
`class` (A/B, Level 1/2); `holder_form` ∈ {entity, individual→excluded};
`discipline_action` ∈ {admonition, citation, stipulation, cease_and_desist, final_order,
revocation, surrender, probation, other} (from CO `programaction` strings, measured values above);
`lead_safe` (EPA RRP / OR LBPR).

### Agent questions only the aggregate answers

1. "Is *Tradesmen Electric Inc* licensed to do electrical work in both Washington and Oregon today,
   and are its WA bond and OR insurance current?" (WA EL licence + WA bond + OR CCB + OR BCD C).
2. "Which Oregon plumbing contractors are CCB-registered with a current bond and ≥$1M insurance?"
   (BCD trade + CCB bond/insurance: neither source alone).
3. "This HVAC company on the map (OSM) — does it hold an active licence, and in which trades?"
   (OSM 23/50 WA confirmed; exposes expired licences.)
4. "Has this Colorado electrical contractor had a disciplinary action, and does it also hold
   licences in Texas or Minnesota?" (CO discipline + cross-state confirmed links.)
5. "Which Minnesota mechanical (HVAC) contractors also hold a plumbing contractor licence?"
   (1,119/2,548.)
6. "Is this renovation firm EPA lead-safe certified and also a registered home-improvement
   contractor?" (RRP ↔ CT HIC 31/50, WA 30/50, OR 28/50.)
7. "Normalise these licence codes: CA C-20, TX ACR BE, OR LHR, WA HVAC/RFRG — are they the same trade?"
8. [UNVERIFIED] "Has this contractor had OSHA inspections with serious violations?"

### Scores (1–5) and recommendation

Composite `contractors-licensed-trade-businesses`: agent_demand 4, rights_clarity 3,
acquisition_ease 4, structuring_value 4, freshness 5, low_onboarding_cost 3, poor_existing_access 3
= **26/35**.

Component scores (new sources): WA L&I 4/4/5/3/5/4/3 = 28; OR CCB 3/4/5/2/5/4/3 = 26;
OR BCD 3/4/5/3/4/4/3 = 26; CO DORA 3/3/5/3/5/4/3 = 26; CT HIC 3/4/5/2/5/4/2 = 25; MN DLI 4/4/5/3/5/4/3 = 28;
EPA RRP 3/3/3/3/4/3/3 = 22; OSHA 4/5/2/4/5/3/3 = 26 (blocked on key); SAM 2/2/2/2/4/2/2 = 16;
CSLB 5/3/1/4/5/3/3 = 24 (blocked); NYC DOB RED; AZ ROC RED; CT trade credentials RED; WA principals RED.

**Recommendation.** Build the composite as a multi-state *business-entity licence* dataset, starting
with the four cleanest sources — **WA L&I (+bond/insurance), OR CCB + OR BCD, MN DLI, CO DORA** —
plus the existing TX TDLR entity rows and EPA RRP as an attribute. Resolve with the precedence above
(auto-link only on keys 1–2, the declared identifiers; keys 3–5 go to a review queue; no silent merges). The first
deliverable is the Oregon CCB×BCD trade join (45/50) and WA↔OR cross-registration (11/50 strict),
which demonstrably produce facts no single source has. Next actions that need a credential or
account (owner-visible blockers): **a free DOL API key** (OSHA linkage) and, optionally, a SAM.gov
account; CSLB needs a retry from Cloudflare Worker egress or an emailed copy of the master file.
Write ADR-0013 rights records per state (PDDL for WA; public-domain statements for OR/CT/MN; CO's
mandatory disclaimer and revocation clause as conditions).

### Housekeeping

Raw downloads (~280 MB: WA/OR/CO/CT/NYC/MN/TX CSVs, EPA RRP JSON, OSM extracts, terms HTML) were
deleted at the end of the session; `samples.json`, `norm.py`, `trade.py` are kept under
`evidence/2026-09-27-composites/contractors/`. Nothing in the repository was modified.
