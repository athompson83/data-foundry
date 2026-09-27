# Research round 2 — service trades — 2026-09-27

Product Owner direction (2026-09-27): "The next 5 data sets should be something
nongovernmental. I was thinking service based. HVAC, Plumbing, Electric,
Roofing, and Appliance. We build those out." This round replaces the
government-dataset build order of [round 1](research-2026-09-27.md) as the
active build order. Round 1's candidates stay in the registry at their stages.

Five trades were researched in parallel on 2026-09-27 against live sources from
this egress, with the declared User-Agent `DataFoundry/1.0
(data@mail.proviciency.com)` at one request per second or slower. Terms are
quoted verbatim with URLs; counts are measured with numerator and denominator;
anything not measured is marked [UNVERIFIED]. Scores are judgements applied to
that evidence. Scripts and sample identifiers are in
[`evidence/2026-09-27-service-trades/`](evidence/2026-09-27-service-trades/).
Raw source files were not committed; bulky downloads, third-party PDFs and the
publishers' own site scripts were deliberately left out.

## Headline: "nongovernmental" and "no restrictions" do not overlap in these trades

Every nongovernmental source with rich trade data that we checked is RED for a
commercial data product: its terms prohibit commercial or automated reuse, sell
the data, or could not be read (a 403 on the terms is not permission).

| Trade | Nongovernmental sources found RED |
| --- | --- |
| HVAC | AHRI and NEEP (already prohibited), manufacturer warranties (Goodman), serial-decoder guides (Building Intelligence Center), HVI directory, UL Product iQ |
| Plumbing | IAPMO R&T, ASSE, NSF, USC backflow list, MaP toilet scores, CSA |
| Electrical | DesignLights Consortium QPL, UL Product iQ, Intertek, CSA, SunSpec |
| Roofing | Cool Roof Rating Council, ICC-ES, FM RoofNav, UL, GAF, TDI evaluations (Texas state, but its reports forbid commercial use) |
| Appliance | iFixit (CC BY-NC-SA), manufacturer error codes, PartSelect/RepairClinic cross-references, EPREL |

What *can* be structured and sold is data **about private-sector products,
filed by manufacturers, and hosted by a public programme**: ENERGY STAR,
WaterSense, CPSC recalls, the California solar equipment lists and Miami-Dade
product approvals. These are labelled `origin: governmental-host` in the trade
sections. The only nongovernmental sources that pass are CC0 Wikidata (brand
ownership; thin on its own) and manufacturer serial date-code *rules*, stored
as our own tables of facts (AMBER; not yet measured).

## Recommended first dataset per trade

| Trade | First dataset | Rights | Score | An agent can answer |
| --- | --- | --- | --- | --- |
| Appliance | `appliance-recall-model-index` (CPSC major-appliance recalls; model/serial ranges from free text) | GREEN | 32 | "Is the range model NE63T8511SS/AA in my rental under recall, and what is the remedy?" |
| HVAC | `hvac-energystar-matched-systems` (283,901 rated heat-pump systems; model-pattern matching) | AMBER | 29 | "Is my outdoor unit + coil a rated matched system, and what are its SEER2/HSPF2 and refrigerant?" |
| Plumbing | `plumbing-watersense-products` (50,688 products; 31.4% wildcard model patterns) | AMBER | 28 | "Is this faucet or toilet SKU WaterSense-labelled, and what is its certified gpm/gpf?" |
| Electrical | `electrical-cec-solar-equipment` (2,174 inverters, 22,186 PV modules, 1,142 battery inverters, 1,079 storage systems) | AMBER | 28 | "Is this inverter and firmware on California's grid-support list, and what is its rated output?" |
| Roofing | `roofing-miami-dade-noa` (1,860 current roofing approvals; assemblies and design pressures from PDFs) | AMBER | 26 | "Which approved metal roofs over 15/32\" plywood are rated to −150 psf, and are the approvals valid?" |

## Build order (active)

The weekly scout advances candidates in **this** order. It weighs reuse of the
live stack and time to revenue as well as score:

1. **`cpsc-recalls` with trade facets** (appliance, HVAC, plumbing/water
   heating, electrical). One GREEN source already in round 1's pipeline, on the
   live recall stack, covers four trades at once. `appliance-recall-model-index`
   is its first facet; `hvac-cpsc-recall-slice`,
   `plumbing-water-heating-recalls` and `electrical-cpsc-recalls-facet` are
   views of the same build, not separate datasets.
2. **`hvac-energystar-matched-systems`.** One ENERGY STAR (Socrata) acquisition
   and model-pattern compiler, then reused by `appliance-energy-star-registry`,
   `plumbing-energystar-water-heaters` and `electrical-energy-star-electrical`.
3. **`plumbing-watersense-products`.** The same wildcard model-pattern problem
   on a second EPA source.
4. **`roofing-miami-dade-noa`.** New structuring (PDF assemblies and design
   pressures). The case-law point behind its rights argument must be verified
   before RIGHTS_DETERMINED.
5. **`electrical-cec-solar-equipment`.** Its conditions-of-use sentence on
   commercial use is ambiguous; a written confirmation from the California
   Energy Commission would make it GREEN, and the rights record must resolve
   the reading before RIGHTS_DETERMINED.

Joins that make these more valuable than the sum: recalls ↔ ENERGY STAR models
(7 of 64 appliance recalls since 2015 name a model still certified), brand →
filer → parent (`hvac-brand-ownership-graph`), and Miami-Dade ↔ Florida product
approvals (5 of 26 sampled Florida applications cite a Miami-Dade NOA).

## Cross-trade corrections to earlier records

- DOE CCMS still returns 403 on every path, including `robots.txt`
  (HVAC, plumbing and appliance probes). It stays unusable.
- ENERGY STAR datasets carry `"License": "https://edg.epa.gov/EPA_Data_License.html"`
  in their own metadata, which the 2026-09-16 qualification did not record; the
  named-reviewer blocker there is superseded by ADR-0013. Values stay AMBER
  because manufacturers file them.
- California's MAEDbS appliance database is RED: its conditions of use prohibit
  "commercial or profit-making purposes", and the database sits behind a login.
- `goodmanmfg.com` (Daikin-owned) states "Duplication in part or in whole is
  strictly prohibited" and has been added to the prohibited-source list.


## Trade: Appliance
Trade: major household appliances (refrigerators, freezers, ranges, cooktops,
wall ovens, microwaves, dishwashers, clothes washers and dryers, dehumidifiers,
room, window and through-the-wall air conditioners).

Method: every source below was requested today from this egress with User-Agent
`DataFoundry/1.0 (data@mail.proviciency.com)`, at 1 request per second or slower.
A browser User-Agent was tried only to read terms pages that refused the
descriptive agent (PartSelect, RepairClinic, Whirlpool). It was refused too, and
no data was fetched with it. Raw downloads, scripts and sample-ID files are in
`evidence/2026-09-27-service-trades/appliance/`. Anything not measured is marked [UNVERIFIED].

The repository's prohibited list applies here. Daikin (`daikin.com`,
`daikincomfort.com`) and Carrier (`carrier.com`) appear as *recalling firms* in
CPSC text (for example CPSC 26734 and 02227). We use CPSC's own text only, and
never follow a firm link in the recall to a prohibited host.

### Candidate table

| # | Source | Origin | Rights | Access | Volume (measured today) | Free-text value | Score /35 |
|---|---|---|---|---|---|---|---|
| 1 | **CPSC recalls, major-appliance slice** (saferproducts.gov Recall API) | governmental-host (the recalling firm supplies the product and model facts) | **GREEN** | Documented REST API. One call returns all recalls | 186 appliance recalls out of 10,027 (95 since 2010; 6 in 2026 so far) | High. Structured `Model` is empty in 186 of 186; model numbers are in the prose | **32** |
| 2 | **ENERGY STAR certified appliances** (data.energystar.gov, 8 datasets) | governmental-host (manufacturer- and partner-filed) | **AMBER** | Documented Socrata SODA API and CSV | 8,667 models across 426 brands; all updated 2026-09-26 | Medium. 3,303 wildcard model patterns, 1,380 `additional_model_information` notes, 1,095 multi-UPC cells | **27** |
| 3 | Health Canada consumer-product recalls (recalls-rappels.canada.ca) | governmental-host | AMBER (open-data index); RED for the page text | OGL JSON/CSV index, plus one HTML page per recall | 88 appliance recalls out of 5,206 consumer recalls (34,131 recalls in all) | High in the pages (model numbers in 20 of 22), but the index has no product text | 23 |
| 4 | Wikidata brand → owner (CC0) | nongovernmental | GREEN | SPARQL endpoint and dumps | 20 of the top 40 ENERGY STAR brand labels have *some* owner claim; about 10 of 40 are the right appliance owner | Low. Its value is disambiguation, not text | 23 |
| 5 | Australian Energy Rating registered appliances (data.gov.au) | governmental-host (registrant-filed) | AMBER | CKAN CSVs, refreshed daily. `robots.txt` says `Disallow: /` | Refrigerators 3,941; dishwashers 1,411; washers 1,516 | Medium. `Family Name` wildcards and series (3,053 of 3,941 fridge rows filled) | 22 |
| 6 | OpenStreetMap `shop=appliance` | nongovernmental | AMBER (ODbL share-alike) | Overpass or planet extracts | 12,091 worldwide; US count [UNVERIFIED] (Overpass tunnel failed) | Low. Only 21 `craft=appliance_repair` worldwide | 18 |
| 7 | CPSC SaferProducts.gov incident reports | governmental-host (consumer-submitted) | UNKNOWN | No documented API; `/PublicSearch` redirects with 302 | [UNVERIFIED] | High, likely (free-text incident narratives with brand and model) | — (DISCOVERED) |
| 8 | Open Products Facts (ODbL) | nongovernmental | GREEN on licence | API | 46,250 products in all, but refrigerators 1, washing machines 5, dryers, ovens and microwaves 0 | None at this volume | 17 (PARKED) |
| 9 | DOE CCMS appliance classes | governmental-host | RED (unreachable) | 403 to the descriptive UA today on `products.html` and the refrigerator class page | — | — | PARKED |
| 10 | CEC MAEDbS | governmental-host | RED | Redirects to a login page that threatens criminal prosecution | — | — | PARKED |
| 11 | iFixit guides and error-code pages | nongovernmental | RED (non-commercial; no AI training) | — | — | — | PARKED |
| 12 | EU EPREL | governmental-host | RED (unverified) | The API returns `{"message":"Forbidden"}` without a key | — | — | PARKED |
| 13 | Appliance error and fault-code meanings (manufacturer manuals) | nongovernmental | RED | No openly licensed source found. GE's terms URL is 404; Whirlpool refused both user agents | — | — | PARKED |
| 14 | Parts cross-reference (PartSelect, RepairClinic) | nongovernmental | RED | Terms pages return 403 to both user agents | — | — | PARKED |

The trade-off the owner asked to see is stark in this trade. Every
**nongovernmental** source that carries rich appliance free text (iFixit,
manufacturer manuals and error codes, parts cross-references) is RED. Open
licences exist only in thin nongovernmental data (Wikidata, OSM, Open Products
Facts). The structurable, redistributable free text comes from regulator-hosted
records of private-sector products: CPSC, ENERGY STAR and Health Canada.

---

### 1. CPSC recalls, major-appliance slice (GREEN)

This is a vertical slice of the existing `cpsc-recalls` candidate (EVIDENCED in
round 1). This round adds the appliance classifier, appliance-specific extraction
rates, and the join to ENERGY STAR.

**Terms** (https://www.cpsc.gov/About-CPSC/Policies-Statements-and-Directives/Privacy-Policy, re-read 2026-09-27), verbatim:
> "Web page text, brochures, and posters presented on CPSC websites are public information. You may freely distribute, copy, or link to any of this information. However, the information may not be used in a way that states or implies CPSC endorsement. If you distribute, copy or link to any of this information, please credit CPSC. Images on this website may have been licensed for use by CPSC from a stock photography service or other copyright holder and the copyright holder may prohibit republication, retransmission, reproduction or other use of the images. You may freely copy and distribute recall notices, including photographs of recalled items, without permission."

`saferproducts.gov/robots.txt` returns 404 (there is no robots file). The API
answered `200`, 27.7 MB, with 10,027 recalls in one unauthenticated call. The
latest `RecallDate` is 2026-09-24.

**Classifier** (`appliance/classify.py`): a recall is kept if its product `Type` is
in a set of major-appliance types, or if its title matches an appliance keyword
and no exclusion keyword. Central-AC `Type` is excluded as HVAC, while
room, window, portable and through-the-wall units are kept. Exclusions cover hair
and hand dryers, pressure washers, toys, toasters, pans, gel packs, lunch boxes,
popcorn and camping stoves. The result is **186 recalls** (95 since 2010).
Classifier precision on the fixed 25-recall sample is 25 of 25 (one borderline
commercial ice machine). An earlier, looser version measured 22 of 25 and was
tightened. Classifier recall (missed recalls) is [UNVERIFIED]: `Type` is empty on
4,827 product rows across all CPSC recalls, so it cannot be measured from the
data alone.

**Measurements** (`appliance/cpsc_extract.py`, `appliance/cpsc_samples.json`):

| Signal | All 186 | Since 2010 (95) | Fixed sample (25) |
|---|---|---|---|
| Structured `Products[].Model` non-empty | **0/186** | 0/95 | 0/25 |
| Structured `Hazards[].HazardType` non-empty | 0/186 | 0/95 | 0/25 |
| Model-number tokens in `Description` (model context plus an alphanumeric token) | 136/186 | **79/95** | **21/25** |
| Total model-like tokens extracted | 2,130 | 1,587 | 258 |
| "serial number" mentioned | 134/186 | 68/95 | 19/25 |
| Strict serial *range* (`A … through/to/- … B`) | 51/186 | 30/95 | 9/25 matched; 6/9 correct on hand check |
| Units recalled (`NumberOfUnits` or "About N") | 172/186 | 95/95 (about 31.3M units summed) | 25/25 |
| Sale-date range in prose | 38/186 | 10/95 | 5/25 |
| Price in prose | 166/186 | 95/95 | 25/25 |
| `ProductUPCs` populated | 4/186 | 4/95 | 1/25 |

Fixed sample IDs (CPSC recall numbers): 26606, 26419, 24335, 24235, 24226,
24110, 23107, 23080, 23006, 22151, 22117, 22028, 16253, 16759, 15200, 14164,
13238, 13117, 12251, 12043, 11324, 11072, 11028, 10316, 10147.

**Hand-checked extraction notes:**
- **24335 (Samsung slide-in ranges):** 30 model numbers such as `NE58K9430SS/AA`,
  listed in free text. The structured `Model` field is empty. 1,120,905 units.
- **The model-versus-serial distinction is the real structuring work.** The token
  pass also catches serial bounds: `TR33500000`–`TR34899999` (16253, correct
  serial range), `C2020050100001`–`C2020123109000` (22151, correct),
  `1745627020001`–`1745627020009` (23006, correct).
- **The strict serial regex gave 3 false positives in 9:** 11324 (`xx` wildcards
  in the serial), 12251 (`00001 … 001KW`) and 11072 (a model `3FCA-68NFX` split
  on its hyphen).
- **A deterministic parser therefore needs these cases:**
  1. "Model Numbers" list blocks.
  2. Serial ranges, including `xx` wildcards and date-coded serials (13248
     describes "the first six numbers in the serial number range").
  3. Prefix rules, such as 26734 Amana TTW: "model number beginning with PB".
     The model table is on the web page, not in the API `Description`.
- **4 of 25 have no model tokens in `Description`:** 13238, 12043, 15200 and
  10147. Their model lists are in page tables, or described by prefix only. That
  is a known coverage gap: fetching the recall page (`URL`) is covered by the
  same CPSC terms.

**Cross-source join (measured):** we matched the model tokens from the 64 CPSC
appliance recalls since 2015 against the 8,667 ENERGY STAR model patterns, with
`*`, `#` and `?` treated as one-character wildcards.

- 67 of 1,271 tokens matched a current ENERGY STAR record.
- 7 of 64 recalls name at least one model that is still ENERGY STAR-certified:
  22117, 22143, 23080, 24110, 25320, 26649 and 26776.
- For example, 26776, the Friedrich KÜHL window AC recalled 2026-09-17, still
  lists `KCVS12B30A` as certified (`pd_id` 3999714, `5xn2-dv4h`).

So neither source says on its own that a certified model is under recall. The
join does (`appliance/join_result.txt`).

**Conditions:**
1. Credit CPSC, and imply no endorsement.
2. Do not republish images, except recall-notice photographs.
3. Exclude `ConsumerContact`, which carries firm phone numbers and emails. This is
   business contact data, excluded to follow round 1.
4. Never follow a firm link to a prohibited host.

**Agent use case:** an agent can answer "is my Samsung range, model
NE63T8511SS/AA, serial …, under recall, and what is the remedy?" from a model
and serial lookup. Today that answer sits in prose and page tables.

---

### 2. ENERGY STAR certified appliances (AMBER)

This builds on `energy-star-certified-products-qualification-20260916.md`, which
measured the HVAC datasets only. The appliance datasets are new here. The earlier
record's rights analysis still applies. **It is stale in one respect:** it records
freshness as "one observation, cadence unknown". Today the Socrata catalogue shows
all 90 datasets with `data_updated_at` 2026-09-26, the day before measurement.
That is consistent with daily refresh, though still only two observations.

**Terms:**
- `https://edg.epa.gov/EPA_Data_License.html` (fetched 2026-09-27, 200), verbatim:
  > "Unless otherwise specified, all data produced by the U.S EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105."
- Every appliance dataset's metadata (`https://data.energystar.gov/api/views/<id>.json`)
  carries `"License": "https://edg.epa.gov/EPA_Data_License.html"`.
- Dishwashers (`q8py-6w3f`) and Electric Cooking (`m6gi-ng33`) also carry
  `license: {"name": "Public Domain"}`.
- `https://data.energystar.gov/robots.txt` sets `Crawl-delay: 1` and disallows
  only `/browse` query variants, `/OData.svc/` and `/api/odata/`. The `/resource/`
  and `/api/views/` routes are not disallowed.

**Why AMBER, not GREEN:**
- The licence covers "data produced by the U.S EPA", but the model and brand
  fields are partner-submitted.
- "ENERGY STAR" is a registered certification mark.

**Conditions:**
- (a) Publish only factual fields: brand, model, UPC, capacities, kWh/yr, dates,
  and certification status.
- (b) Make no use of the ENERGY STAR mark or logo, and imply no EPA endorsement.
  Say "listed in EPA's ENERGY STAR certified-products data as of <date>".
- (c) Keep it current with a daily sync, and show the source date.
- (d) Position it as the voluntary, higher-efficiency subset, not the regulated
  population.
- (e) Write an ADR-0013 rights record addressing partner-submitted fields before
  RIGHTS_DETERMINED. The open question is carried over from the 2026-09-16
  record; this round adds no new rights evidence.

**Volume** (`appliance/es_assess.py`; row counts from `$select=count(*)`, full rows downloaded):

| Dataset | ID | Rows | Wildcard model | `additional_model_information` non-empty | UPC present |
|---|---|---|---|---|---|
| Residential Refrigerators | `p5st-her9` | 4,830 | 1,690 | 649 | 2,700 |
| Residential Freezers | `8t9c-g3tn` | 668 | 163 | 144 | 342 |
| Residential Dishwashers | `q8py-6w3f` | 756 | 381 | 187 | 626 |
| Residential Clothes Dryers | `t9u7-4d2j` | 674 | 540 | 87 | 498 |
| Residential Clothes Washers | `bghd-e2wd` | 412 | 285 | 62 | 330 |
| Dehumidifiers | `mgiu-hu4z` | 552 | 29 | 79 | 286 |
| Room Air Conditioners | `5xn2-dv4h` | 515 | 15 | 57 | 380 |
| Residential Electric Cooking | `m6gi-ng33` | 260 | 200 | 115 | 180 |
| **Total** | | **8,667** | **3,303 (38%)** | **1,380** | **5,342** |

Also measured:
- 1,095 UPC cells hold several `;`-joined UPCs.
- 372 notes explain the wildcard convention in prose. Example from q8py-6w3f
  `pd_id` 2508272: "Remark: * could be A-Z, a-z, 0-9, - or blank".
- There are 426 distinct brand strings, including case and sub-brand variants
  such as `GE` and `GE Profile`.

24 sample `pd_id`s are in `appliance/es_samples.json`, for example 2508272
(Midea `MDT24P5A**`), 2472841 (LG `LDF554#**`), 2348469 (Danby `DBC117A1*` with
its note `DBC117A1BSSDB-6`) and 2218138 (Whirlpool `WRT148FZD*` with 3 UPCs).

**Structuring opportunities:**
1. **Wildcard expansion to a matchable pattern.** The source uses a different
   convention per partner, so a pattern plus its per-record semantics is needed
   (3,303 of 8,667 rows).
2. **UPC splitting and UPC → model index** (5,342 of 8,667 rows; 1,095 hold more
   than one UPC).
3. **Brand → owner normalisation** (426 strings), with Wikidata QIDs where they
   resolve.

This is already a structured source, so its structuring value is lower than
CPSC's. Its value here is as the **model registry** that resolves the recall
tokens.

**Agent use case:** an agent can answer "which 24-inch dishwashers under 270
kWh/yr, with a UPC I can scan, are certified today, and is any of them under
recall?"

---

### 3. Health Canada consumer-product recalls (AMBER for the index, RED for page text)

**Terms:**
- The open-data package `d38de914-c94c-429b-8ab1-8776c31643e3` is licensed
  `ca-ogl-lgo` (Open Government Licence – Canada). From
  https://open.canada.ca/en/open-government-licence-canada, verbatim:
  > "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below. You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose. You must, where you do any of the above: Acknowledge the source of the Information by including any attribution statement specified by the Information Provider(s) and, where possible, provide a link to this licence."
- The recall **pages** link to https://www.canada.ca/en/transparency/terms.html,
  verbatim:
  > "Unless otherwise specified, you may not reproduce materials on this site, in whole or in part, for the purposes of commercial redistribution without prior written permission from the copyright administrator."

**Measurements:**
- `HCRSAMOpenData.json`: 200, 15.7 MB, 34,131 recalls, of which 5,206 are
  consumer product safety and 88 are appliance recalls by title keyword.
- The OGL file carries only title, category, issue, class and date. There is no
  product or model text.
- In 22 fetched appliance pages: model number in 20 of 22, "serial" in 14 of 22,
  units sold in Canada in 22 of 22, time period sold in 22 of 22.
- 14 of the 22 are joint recalls with the U.S. CPSC, so they mostly duplicate #1.

Sample NIDs: 64192, 64218, 64247, 72174, 72610, 74037, 74684, 74967, 74981,
75519, 75761, 75974, 76415, 76981, 77547, 81761, 81825, 81901, 82273, 82570,
82580, 82662.

**Conditions:**
- Use only OGL index fields verbatim.
- Extracting non-copyrightable facts (model numbers, Canadian unit counts) from
  the pages rests on a facts-not-expression argument, so AMBER at best. Do not
  republish page text.
- Attribute Health Canada and link the OGL.

Its unique value is Canadian units sold and Canada-only recalls (8 of 22).

---

### 4. Wikidata brand ownership (GREEN)

**Terms** (https://www.wikidata.org/wiki/Wikidata:Copyright), verbatim:
> "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0 License"

**Measured** (`appliance/wd_brands.json`): exact labels or alt-labels of the top
40 ENERGY STAR appliance brands, queried for `P749` (parent organization) or
`P127` (owned by).
- 20 of 40 return *some* claim, but label collisions are severe. `GE` resolves to
  the Canadian Medical Association and `Summit` to Celebrity Cruises.
- Hand-checked correct appliance ownership: Frigidaire → Electrolux, Whirlpool
  and KitchenAid and Maytag → Whirlpool Corp (Q1471346), Fisher & Paykel → Haier,
  Gaggenau → BSH, Insignia → Best Buy, Beko → Arçelik, Hotpoint → GE, Dacor →
  Samsung, Viking Range → Middleby, Speed Queen → Alliance Laundry. That is about
  10 of the top 40.
- `Thermador` (Q7783020) and `Amana` (Q453544) have no parent claim at all.

**Conclusion:** this is useful only as a curated QID crosswalk (brand string →
QID, hand-seeded) feeding the recall and registry datasets. It is not a dataset
of its own. Attribution is not required.

---

### 5. Australian Energy Rating (AMBER)

**Terms:** the data.gov.au package metadata `license_title` is "Creative Commons
Attribution 3.0 Australia", for both `energy-rating-for-household-appliances` and
`energy-rating-data-for-household-appliances-non-labelled-products`. The
package is at
https://data.gov.au/data/dataset/energy-rating-for-household-appliances.

**Conditions:**
- Attribute the source.
- `https://data.gov.au/robots.txt` is `User-agent: * / Disallow: /` (fetched
  2026-09-27). Automated download of the CSV resources needs a documented basis,
  such as the CKAN API documentation or a data.gov.au statement, before
  acquisition. This is the crawl restriction the 2026-09-08 review flagged; it
  is unchanged.

**Measured:**
- Files are refreshed daily (resource file names dated `2026_09_27`).
- Rows: `rf` 3,941, `dw` 1,411, `cw` 1,516.
- `Family Name` is filled in 3,053 of 3,941 fridge rows, with wildcard or series
  text such as `WHE6874**` and `HRF520B Series`.
- 368 fridge models carry wildcards.

Samples: 173654, 146685, 177994, 177658, 157688, 162936, 176349, 162565, 164509.

Its value is AU/NZ coverage and a second model-family convention. US agent demand
is low.

---

### 6–8. Weak or parked open sources

- **OpenStreetMap** (https://www.openstreetmap.org/copyright), verbatim:
  > "You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same license."

  Taginfo reports `shop=appliance` at 12,091 worldwide (93% named, 20% with a
  phone number), `craft=appliance_repair` at 21, and `service:appliance:repair`
  at 2. The US count is [UNVERIFIED] because the Overpass connection closed
  mid-exchange.

  It covers retailers, not repair technicians. Share-alike binds derived
  databases. Sole-trader phone numbers would have to be excluded. Low value.
- **Open Products Facts** (ODbL). Its terms page states "The Open Food Facts
  database is available under the Open Database License". There are too few
  appliance products (see table), so it is PARKED.
- **SaferProducts.gov incident reports.** These are consumer narratives, probably
  rich in brand, model and failure mode. There is no documented API: `/PublicSearch`
  answered a term query with a 302, and `/RestWebServices/` exposes only the
  Recall and Penalty services. Rights (consumer-submitted text) and personal data
  are [UNVERIFIED]. It stays DISCOVERED.

### RED (parked) — the evidence

- **DOE CCMS:** `https://www.regulations.doe.gov/certification-data/products.html`
  and the refrigerator class page both return **403** to the descriptive UA today,
  and `robots.txt` is also 403. This is unchanged from 2026-08 and 2026-09-16. No
  browser impersonation was attempted: the owner refused that route for production.
- **CEC MAEDbS:** `https://cacertappliances.energy.ca.gov/` redirects to
  `Login.aspx`, which says, verbatim:
  > "The Modernized Appliance Efficiency Database System (MAEDBS) is the property of the California Energy Commission (Commission) and may only be accessed by authorized users. Unauthorized access, use, disruption, modification, or destruction of this system is strictly prohibited and may be subject to criminal prosecution"

  The page shows build 3.0.31, deployed 09/23/2026, so it is current.
- **iFixit** (https://www.ifixit.com/Info/Licensing), verbatim:
  > "We license all content under the Creative Commons Attribution Noncommercial Share Alike license" … "Noncommercial — You may not use the material for commercial purposes." … "Training AI — Using our data to train a machine learning or AI model is a violation of our terms of use."
- **EPREL:** `https://eprel.ec.europa.eu/api/products/...` returns `403
  {"message":"Forbidden"}` without an API key. Its terms are unread
  [UNVERIFIED], and the 2026-08 note on a paid-redistribution restriction stands.
- **Error-code meanings:**
  - No openly licensed, non-NC source was found.
  - Manufacturer manuals are copyrighted works. `geappliances.com/terms` is 404,
    and `whirlpool.com/terms-of-use.html` returned 000 then 403.
  - iFixit is NC.
  - An agent-useful error-code table would need a licensed source or
    manufacturer permission.
- **Parts cross-reference:** `partselect.com/Terms-Of-Use.aspx` and
  `repairclinic.com/TermsOfUse` return 403 to both the descriptive and browser
  UA. The terms are unreadable, so RED.

### Recommendation

**First dataset: `appliance-recall-model-index`.** This is a structured
model-number and serial-range index of CPSC major-appliance recalls. It is
GREEN.

**Why it is first:**
- The source's structured `Model` field is empty in 186 of 186 recalls. Model
  tokens are in the prose for 79 of the 95 recalls since 2010: 1,587 tokens,
  about 31.3M units recalled.
- It reuses the live recall API, `parseCodes`/`parseQuantity`, D1, Stripe and the
  cpsc-recalls pipeline already queued first in the round-1 build order.
- It is the appliance-shaped first cut of that same build, not a new stack.

**Build it so that:**
- Model tokens are separated from serial bounds.
- Prefix rules are kept as patterns.
- Page tables are fetched for the about 16% of recalls with no in-text list.

An agent can answer: *"Is the Samsung range with model NE63T8511SS/AA in my
rental unit under recall, since when, how many units, and what is the remedy?"*

**Runner-up: `appliance-energy-star-registry` (AMBER).** It holds 8,667
certified appliance models with UPCs, refreshed daily. It serves as the model
registry the recall index joins to. The measured join finds 7 of 64 recent
recalls naming still-certified models.
- **Structuring work:** wildcard-pattern normalisation (3,303 rows) and UPC
  splitting (1,095 multi-UPC cells).
- **Before it goes past EVIDENCED:** it needs the ADR-0013 record for
  partner-submitted fields and the certification-mark conditions.

An agent can answer: *"Given this UPC, what model is it, what does it use per
year, and is it recalled?"*

**Top five numbers:**
1. 0/186: structured `Model` populated in CPSC appliance recalls.
2. 79/95 (21/25 in the fixed sample): model numbers present in the free text since
   2010.
3. 8,667: ENERGY STAR appliance models, 38% of them wildcard patterns.
4. 7/64: recent appliance recalls naming a still-certified ENERGY STAR model.
5. 6/9: strict serial-range precision, which shows the model/serial parser needs
   golden tests before it can make a precision claim.

## Trade: HVAC
Read-only research. No files in the repo were edited. Every request used the User-Agent
`DataFoundry/1.0 (data@mail.proviciency.com)`, at 1 request/second or slower. No browser
User-Agent was needed. Raw responses and scripts are in `evidence/2026-09-27-service-trades/hvac/`. Counts and quotes
were measured on 2026-09-27 unless marked otherwise.

**Prohibited publishers were not contacted:** AHRI, NEEP, Carrier, Trane, Lennox, York and
Daikin. Data *about* those companies' products, as filed with EPA or held in Wikidata, is
covered below. The publisher's own domains were not fetched. One exception is
`goodmanmfg.com`, a Daikin-owned brand site that is not on the domain denylist. Its footer was
read once to confirm the RED verdict, and it should be added to the denylist (see §9).

### What the earlier research got wrong or left out

Primary evidence from today overrides these HVAC documents:

| Document | Stale or missing point | Today |
| --- | --- | --- |
| `energy-star-certified-products-qualification-20260916.md` | It says "no new rights evidence was found" and calls terms `[UNVERIFIED]`. | Each dataset's own Socrata Common Core metadata has `"License": "https://edg.epa.gov/EPA_Data_License.html"`, the EPA Standard Open Data License (public domain; quoted in §1). That is new, dataset-specific rights evidence. |
| same | Heat Pumps 282,665 rows; Mini-Split HP 17,646; Furnaces 3,252; Central AC and Mini-Split AC 0 rows. | 283,901, 17,699 and 3,523. Central AC (`tyr2-hhgu`) and Mini-Split AC (`qj64-j3bn`) **still return 0 rows**, so AC coverage is still missing. `rowsUpdatedAt` is 2026-09-26 16:19 UTC. |
| `hvac-source-landscape-2026-08.md`, `hvac-source-review-20260908.md` | They require a "named human reviewer" and a signed packet. | That was superseded by ADR-0013 and the 2026-09-26/27 standing approval. The rights-matrix reasoning (free web ≠ paid API) still applies. |
| `doe-ccms-corroboration-assessment.md` | The main.js endpoint returned 403. | **Every** path now returns 403 to the descriptive UA, including `/robots.txt` and the landing page (118-byte body). CCMS stays PARKED. |

### Candidate table

Scores follow the pipeline README (1–5 per criterion, out of 35).

| # | Key | Source | Origin | Rights | Access | Volume | Free-text / structuring value | Score |
|--:|---|---|---|---|---|---|---|--:|
| 1 | `hvac-energystar-matched-systems` | EPA ENERGY STAR heat pumps, mini-splits and furnaces (data.energystar.gov) | governmental-host (manufacturer-filed) | **AMBER** | Documented SODA API + CSV | 283,901 HP systems; 17,699 mini-split; 3,523 furnaces; 147 partners; 282 brand strings | Model-number wildcard/alternation grammar, `+` composites, capacity code, brand normalisation, refrigerant-rule overlay | **29** |
| 2 | `hvac-brand-ownership-graph` | Wikidata (CC0), linked to the ENERGY STAR brand→filer pairs | **nongovernmental** (Wikidata) + governmental-host | **GREEN** (Wikidata) / AMBER (ES pairs) | Wikidata JSON dumps / SPARQL; SODA | 153 HVAC orgs in Wikidata; 347 ES brand–partner pairs | Brand→filer→parent linkage that exists in neither source alone | **27** |
| 3 | `hvac-refrigerant-transition-rules` | eCFR 40 CFR 84.54 (AIM Act Technology Transitions) | governmental-host | GREEN | Documented eCFR API | 1 section, 71 dated clauses, amended 2026-05-26 and 2026-07-27 | Date × sector × GWP-threshold obligations, joined to per-model refrigerant | 27 |
| 4 | `hvac-cpsc-recall-slice` | CPSC Recalls API, HVAC keyword slice | governmental-host | GREEN | Documented API | 55 of 10,027 recalls | Serial ranges → manufacture dates, model numbers, CO hazard | 27 |
| 5 | `hvac-tx-acr-contractor-licences` | Texas TDLR A/C contractor licences | governmental-host | AMBER (facts only; personal data) | Daily CSV + Socrata | 20,436 contractor + 60,809 technician licences | Licence class/endorsement code decoding; entity vs sole-trader split | 25 |
| 6 | `hvac-osm-contractors` | OpenStreetMap `craft=hvac` / `shop=hvac` | **nongovernmental** | AMBER (ODbL share-alike) | Overpass / planet extract | 2,734 US POIs | Little free text (7% have a description) | 17 |
| 7 | `hvac-serial-date-decoder-guides` | Building Intelligence Center (building-center.org) and similar decoder guides | **nongovernmental** | **RED** | Web pages; member login | [UNVERIFIED] | High (serial → date rules), but no reuse grant | 20 |
| 8 | `hvac-manufacturer-warranty-terms` | Manufacturer warranty PDFs (e.g. goodmanmfg.com) | **nongovernmental** | **RED** | PDFs | [UNVERIFIED] | High (term years, registration windows), but duplication prohibited | 19 |
| 9 | `hvac-hvi-certified-directory` | Home Ventilating Institute directory | **nongovernmental** | **RED** | Web directory | [UNVERIFIED] | Fan ratings | 16 |
| 10 | `hvac-ul-product-iq` | UL Product iQ listings | **nongovernmental** | **RED** | WAF-blocked (403 "You have been blocked") | [UNVERIFIED] | Listing / certification status | 13 |
| 11 | `hvac-doe-ccms` | DOE CCMS | governmental-host | RED (unreachable) | 403 on every path | — | — | 17 |
| — | AHRI Directory, NEEP, manufacturer catalogues | — | nongovernmental | **PROHIBITED in code** | not contacted | — | Matched-system data is the AHRI product; see #1 for the public-domain subset | — |

### 1. ENERGY STAR matched systems (AMBER) — recommended first dataset

**Terms, verbatim.**

- Dataset metadata, `https://data.energystar.gov/api/views/83eb-xbyy.json`, field
  `metadata.custom_fields["Common Core"]`: `"License": "https://edg.epa.gov/EPA_Data_License.html"`,
  `"Publisher": "U.S. Environmental Protection Agency"`, `provenance: "official"`. The mini-split
  and furnace views carry the same block.
- https://edg.epa.gov/EPA_Data_License.html: "Unless otherwise specified, all data produced by
  the U.S EPA is by default in the public domain and is not subject to domestic copyright
  protection under 17 U.S.C. § 105. More details on the U.S. Public Domain license are available
  here: http://www.usa.gov/publicdomain/label/1.0/"
- https://www.epa.gov/web-policies-and-procedures/epa-disclaimers: "Mention of or referral to
  commercial products or services, and/or links to non-EPA sites does not imply official EPA
  endorsement of or responsibility for the opinions, ideas, data, or products presented at those
  locations, or guarantee the validity of the information provided". The same page also says:
  "Referenced data from non-EPA sources are neither inherently verified nor independently tested
  by the Agency in all circumstances."
- robots.txt (https://data.energystar.gov/robots.txt): `Crawl-delay: 1`. Only `/browse?…`
  facets, `/OData.svc/`, `/api/odata/`, `/api/collocate*` and similar paths are disallowed.
  `/resource/` and `/api/views/` are allowed.

**Why AMBER and not GREEN.** The ratings are filed by partners (manufacturers). The licence says
"data produced by the U.S EPA". The argument is:

1. EPA attached this licence to these specific datasets.
2. The values are uncopyrightable facts: ratings, refrigerant, dates and model identifiers.
3. We acquire them through the documented API, respecting its crawl delay.

That is a facts argument layered on an explicit licence, so AMBER.

**Conditions:**

- Attribute EPA ENERGY STAR.
- Describe values as "manufacturer-reported to EPA ENERGY STAR". Do not call them verification.
- Imply no EPA endorsement.
- Do not use the ENERGY STAR mark or logo.
- Keep `ahri_reference_number` only as "reference number as reported to EPA", and never use it
  to query AHRI.
- Make no claim of complete market coverage. ENERGY STAR is a voluntary, above-minimum subset,
  and it currently has no central-AC rows.

**Volume and cadence.**

- Heat Pumps `83eb-xbyy`: 283,901 rows. 283,465 distinct AHRI reference numbers, 8,570 distinct
  outdoor `model_number` patterns (about 33 rated indoor/furnace combinations per outdoor
  pattern), 282 brand strings, 147 `energy_star_partner` filers.
- Mini-Split HP `akti-mt5s`: 17,699 rows. Furnaces `i97v-e8au`: 3,523 rows.
- `rowsUpdatedAt` is 2026-09-26. The 2026-09-16 observation was also same-day. That is two
  observations, so cadence looks like daily to weekly **[UNVERIFIED]**.
- No personal data in any column.

**Refrigerant phase-down per model is already structured.** `refrigerant_type` counts:
R-454B 228,006; R-410A 50,360; R-32 5,535. By certification year:

| Year | R-410A | R-454B | R-32 |
|---|---|---|---|
| 2024 | 110 | 453 | 20 |
| 2025 | 23,477 | 53,555 | 610 |
| 2026 | 26,499 | 173,998 | 4,903 |

So 26,499 R-410A systems were certified in 2026, after the 2025-01-01 manufacture cutoff. Why
is a question the rules overlay (#3) answers.

**Extraction measurements.** The window was 5,000 rows: `$order=pd_id`, offsets
0/70k/140k/210k/280k, 1,000 rows each. That is clustered, not random. The seeded 40-row
subsample (seed 20260927) is in `hvac/es_sample40.json`.

| Opportunity | 5,000-row window | Seeded 40 | Example `pd_id` |
|---|---|---|---|
| Outdoor `model_number` has `*` wildcard | 1,174/5,000 (23.5%) | 6/40 | 2407594 |
| Outdoor model has `(C,H,T)` alternation | 299/5,000 (6.0%) | 1/40 | 3719104 (`(C,H,T)5H0V36*K*AAA*`) |
| Indoor model is a `+` composite (coil + control/kit) | 1,950/5,000 (39.0%) | 14/40 | 4010353 (`ESH5X42M12A*+WALLCON`) |
| Indoor model has any wildcard/alternation | 1,560/5,000 (31.2%) | — | 2407516 |
| Furnace model present (three-part match) | 3,301/5,000 (66.0%) | — | 4009968 |
| Nominal-capacity token (09–60) in outdoor model | 3,462/5,000 (69.2%) | 29/40 | 2407503 |
| …token within ±20% of rated cooling capacity | 2,388/3,462 (69.0%) | 24/29 | 2407503 |
| Furnace model has `*` wildcard | 2,014/3,523 (57.2%) | — | 4517859 |

- The grammar was inferred, not documented. All 15,382 `+`-split model-pattern parts compiled
  to regex with 0 failures (`es_pattern.py`). Whether `*` stands for one character or several
  is **[UNVERIFIED]**; that is the precision gate for PROTOTYPED.
- Brand normalisation: 282 HP brand strings collapse to 277 after case/punctuation folding
  (`SEA BREEZE+`/`Sea Breeze`, `ECO AIR`/`ECO-AIR`, `Comfort Aire`/`Comfort-Aire`,
  `Perfect aire`/`PerfectAire`, `MULTIMFG`/`Multi MFG`). The furnace set uses different casing
  (`AIREASE` vs `AirEase`). HP + furnace give 355 raw strings and 285 keys.
- `additional_model_information` and `upc` are 0/5,000 filled, so there is no prose to mine.
  The unstructured part is the model-number mini-language.

**An agent can answer:** "My outdoor unit's nameplate says H5H0V36AKCAAA and the coil says
ESH5X42M12A1. Is that a rated matched system, and what are its SEER2, HSPF2 and refrigerant,
and is it tax-credit eligible?" Today that needs the AHRI directory, which cannot be reused, or
hand-reading wildcard patterns. The same data answers "which brands are made by the same filer
as my Tempstar?"

### 2. Brand ownership graph (Wikidata CC0 + ES brand→filer) — runner-up

**Terms, verbatim.**

- https://www.wikidata.org/wiki/Wikidata:Copyright: "All structured data from the main,
  Property, Lexeme, and EntitySchema namespaces is available under the Creative Commons CC0
  License".
- https://query.wikidata.org/robots.txt: `Disallow: /sparql`. The endpoint is for API clients,
  not crawlers. Production should use the weekly JSON dumps
  (https://dumps.wikimedia.org/wikidatawiki/entities/). The four SPARQL calls here were
  measurement queries.
- Wikimedia API rate limits hit today. From this shared egress, `api.php` returned "You are
  making too many requests to the API" and 429s. The Wikipedia-prose measurement (ownership
  sentences in brand articles) was therefore abandoned after 4 pages **[UNVERIFIED]**.
  Wikipedia prose is CC BY-SA, not CC0, and is out of scope here.

**Measurements.**

- Wikidata HVAC organisations (industry = HVAC `Q1798773` or its subclasses, or product =
  air conditioner / heat pump): **153 orgs**. Of those, 18 have P749 (parent), 20 have P127
  (owned by) and 128 have a country (`q1.json`).
- Staleness and noise:
  - Carrier Corporation `Q731912` and UTC Climate `Q25818939` still carry parent =
    United Technologies, which is stale after the 2020 spin-off.
  - Goodman Global `Q5583460` has no parent (Daikin is missing).
  - Three items list private individuals under P127: `Q139894405`, `Q140174178` and
    `Q138375034`. These are personal data and must be excluded (drop any target that is an
    instance of human, Q5).
- Test set: 26 US residential brands (`q3.json`). Wikidata gives a correct HVAC brand→HVAC
  manufacturer edge for **1/26** (Heil `Q127733459` → Carrier Corporation).
  - Coleman resolves to the camping brand `Q430230` (owner Newell).
  - Frigidaire and Maytag resolve to the appliance brands (Electrolux/Whirlpool). The HVAC
    licensee (Nortek Global HVAC) is absent.
  - Amana `Q2904929` has no owner.
  - Bryant resolves to a grinding-machine maker.
- The ENERGY STAR `energy_star_partner` field for the same 26 brands names the filing
  manufacturer for **25/26** (Janitrol is absent). Examples:
  - Goodman/Amana → Daikin Comfort Technologies Manufacturing, L.P.
  - Bryant/Payne/Heil/Tempstar/Comfortmaker → Carrier Corporation
  - American Standard/Ameristar/RunTru → Trane and American Standard
  - Frigidaire/Maytag/Gibson/Broan → Nortek Global HVAC
  - Luxaire/Coleman → Johnson Controls, Inc.
  - York → Johnson Controls **and** Qingdao Hisense Hitachi (a two-filer brand)

  42 of 282 brands have more than one filer (`es_pairs.json`, 347 brand–partner rows).
- ES partner → Wikidata organisation by exact or normalised label: **20/147** resolved
  (`q4.json`), with some false positives such as "White Inc.". Linking the rest is the
  structuring work.
- Ground truth for recent deals is **[UNVERIFIED]** here. For example, whether York/Coleman/
  Luxaire now sit under Bosch after the 2025 Johnson Controls residential-HVAC sale must come
  from a cited source. Rule 3 applies: no inferred ownership edge without evidence.

**Conditions:** CC0 needs no attribution, but we cite Wikidata QIDs as provenance anyway.
Exclude human owners. The ES-derived edges carry the §1 conditions. Label an edge "filed with
EPA by", not "owned by", unless Wikidata or another cited source states ownership.

**An agent can answer:** "Who actually makes Tempstar, what other brands share that
manufacturer and parts supply, and who is the ultimate parent today?"

### 3. Refrigerant transition rules, 40 CFR 84.54 (GREEN)

- **Terms:** https://www.govinfo.gov/about/policies: "Copyright protection under this title is
  not available for any work of the United States Government". This is the same basis as the
  existing `federal-register-obligations` candidate.
- **Access:** `https://www.ecfr.gov/api/versioner/v1/full/2026-08-24/title-40.xml?part=84&section=84.54`
  returns 200 and requires `Accept-Encoding` compression. Part 84 has 122 section versions;
  §84.54 was amended 2025-08-26, 2025-09-25, **2026-05-26 and 2026-07-27**, so it is still
  moving.
- **Measured:** the §84.54 text (25,542 characters) has 71 dated clauses. For example,
  §84.54(c)(1): "Effective January 1, 2025, residential or light commercial air-conditioning or
  heat pump systems using a regulated substance … with a global warming potential of 700 or
  greater, except for variable refrigerant flow … may continue to be installed where all
  specified components of that system are manufactured or imported prior to January 1, 2025."
- **Value is in the join.** An ES model's refrigerant (R-410A GWP 2088) plus the rule plus the
  component manufacture date (the serial number) tells an agent whether the system can still
  be installed.
- Build this as an HVAC overlay of `federal-register-obligations`, not as a separate pipeline.

### 4. CPSC recall slice (GREEN, fold into `cpsc-recalls`)

- **Terms:** as in round 1 (CPSC Privacy Policy page: "You may freely copy and distribute
  recall notices, including photographs of recalled items, without permission.").
- **Volume:** one call returned 10,027 recalls (27.7 MB). An HVAC keyword match on title or
  product name gave **55**. Only 12 are dated 2016 or later, so volume is low.
- **Hit rates:**
  - model number 40/55
  - serial-number range 17/55
  - manufacture date/year 16/55
  - CO hazard 10/55
  - refrigerant 0/55
  - seeded sample of 30 (`cpsc_hvac_sample30.json`): model 23/30, serial range 9/30,
    manufacture date 7/30
- **Serial-to-date evidence.** Recall 25441 (CX combi boilers) says "manufactured between April
  2023 and April 2024" and gives serial ranges `ICGFSW1-0199-230400064` to
  `ICGFSW1-0199-240300821`. The serial encodes YYMM.
- Public-domain recalls are the only rights-clean evidence found for serial → manufacture date
  decoding. It is sparse and per brand.

### 5. Texas TDLR A/C contractor licences (AMBER, facts only)

- **Terms** (https://www.tdlr.texas.gov/disclaimer.htm):
  - "Texas Government Code, Chapter 552, gives you the right to access government records …
    All government information is presumed to be available to the public."
  - The link policy says "all agency content is protected by federal copyright laws".
  - No open licence is stated. Socrata mirror `7358-krk7`: `license: null`.
- The licensing-files page (https://www.tdlr.texas.gov/LicenseSearch/licfile.asp) says: "The
  files are updated everyday and saved in CSV (Comma delimited) format." Airconditioning
  Contractors is 3.66 MB.
- **Volume:** A/C Contractor 20,436, A/C Technician 60,809, CE providers 80.
- **Personal data:**
  - `owner_name` is an individual in the samples (e.g. licence 10001, "HICKS, OLEN L").
  - `business_name` is entity-like in 35/40, but some embed a personal name
    ("OLEN HICKS AIR CONDITIONING COMPANY").
  - Technician licences are individuals, so they are RED.
- **Sample** (40 contractor licences, `tx_acr40.json`): 10001, 100015, 100051, … 100367.
- **Structuring:** decode `license_subtype` (AC, AE, AR, BC, BE, AEBR = class A/B ×
  endorsements) **[UNVERIFIED decoding]**.
- **Conditions:** publish only licence number, class/endorsement, status/expiry and county, plus
  the business name when it is not a natural person's name. Drop owner, phone and mailing
  address. This is a facts-based argument, so AMBER at best, rights_clarity 2.
- Only one state; each of the other states differs.

### 6. OpenStreetMap HVAC contractors (AMBER, weak)

- **Terms** (https://www.openstreetmap.org/copyright): "You are free to copy, distribute,
  transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If
  you alter or build upon our data, you may distribute the result only under the same
  license."
- **Measured** (Overpass mirror `overpass.private.coffee`; main instance 504; mirror data as of
  2026-06-01): **2,734** US `craft|shop=hvac`.
  - name 92%, phone 45%, website 44%, street address 67%, description 7%, email 9%
  - brand:wikidata 2 (0%)
  - seeded 25-sample (IDs in the script output, e.g. n11405286492, w663837668): website
    10/25, phone 11/25, description 1/25
- **Problems:** coverage is tiny next to the real US contractor count, the share-alike clause
  applies to a derived database, and sole-trader names and phones are personal data. Low
  score; park.

### 7–11. RED / PARKED

- **Serial-number decoder guides.** Building Intelligence Center,
  https://www.building-center.org/terms-of-use/: "This web site should not be relied upon for
  commercial use or interpretations." The footer says "ALL Content ©2024", with member login
  and paid e-books, and there is no reuse grant.
  - InspectAPedia has no copyright page (404) and no licence found.
  - Preston's Guide returned Cloudflare 525.
  - hvacdecoder.com had a TLS failure.
  - Decoding rules are facts, but every compiled source found is proprietary, so RED. The
    rights-clean route is recall-derived rules (#4) and, later, manufacturer-filed evidence.
- **Warranty terms.** https://www.goodmanmfg.com/terms-of-use footer: "Copyright © 2022 Daikin
  Comfort Technologies North America, Inc. Duplication in part or in whole is strictly
  prohibited." rheem.com/terms-of-use and mitsubishicomfort.com/terms-of-use returned 404.
  Manufacturer warranty documents have no reuse grant, so RED. Recommend adding
  `goodmanmfg.com` and `amana-hac.com` to the prohibited list (Daikin-owned) **[owner of
  amana-hac.com UNVERIFIED]**.
- **HVI directory.** https://www.hvi.org/terms-of-use/ is disclaimer-only: "All content is
  provided \"as is.\" … HVI AND ANY PARTY PROVIDING A RESPONSE AT THE DIRECTION OF HVI
  EXPRESSLY DISCLAIM ANY WARRANTIES". There is no reuse grant for the directory, and
  robots.txt has `Crawl-Delay: 5`. RED.
- **UL Product iQ.** productiq.ulprospector.com returns 403, "You have been blocked", to the
  descriptive UA, so the terms are unreadable. RED.
- **DOE CCMS.** 403 on every path (see the stale-docs table). PARKED.

### Recommendation

1. **First dataset: `hvac-energystar-matched-systems` (29/35, AMBER).** The approach:
   - Parse the model-number mini-language (wildcards, alternations and `+` composites in
     23.5% / 6.0% / 39.0% of rows).
   - Normalise brands (282 → 277 strings, cross-dataset casing).
   - Attach capacity decoding and the refrigerant-rule overlay.

   The result is a nameplate → rated-matched-system lookup over 283,901 systems.

   **An agent can answer:** "Is my outdoor unit + coil (+ furnace) a rated match, and what
   are its SEER2/HSPF2/refrigerant and credit eligibility?"

   It reuses the Socrata/D1 path already proven for other datasets. It is labelled
   governmental-host, but its content is manufacturer-filed and privately made.
2. **Runner-up: `hvac-brand-ownership-graph` (27/35; Wikidata part GREEN).** The measured case:
   - Wikidata alone gives a correct HVAC-brand ownership edge for 1/26 brands.
   - ES filings map 25/26 brands to a filer.
   - Joining them yields "brand → filer → corporate parent", which neither source has.

   This is the nongovernmental core the owner asked for. It is also cheap to reuse for the
   Appliance and Plumbing (water heater) trades.
3. Overlays, not standalone: refrigerant rules (#3, within `federal-register-obligations`) and
   the CPSC HVAC recall slice (#4, within `cpsc-recalls`).

## Trade: Plumbing
Read-only research for the Product Owner's service-trade direction (HVAC, Plumbing,
Electric, Roofing, Appliance). All requests were made on 2026-09-27 from this egress
with `User-Agent: DataFoundry/1.0 (data@mail.proviciency.com)` at 1 request per second or slower,
unless noted. Raw downloads are under `evidence/2026-09-27-service-trades/plumbing/`. Scores are judgements
applied to the evidence. They are not measurements. Anything not measured is marked
**[UNVERIFIED]**.

### Summary finding

Every **nongovernmental** plumbing listing body checked (IAPMO R&T, ASSE, NSF, the USC
backflow list, MaP toilet testing, CSA) is **RED**. Each is either "all rights reserved"
with no reuse grant, sold, or has terms we could not read. The plumbing data that can
legally be structured and resold sits on **government hosts but is manufacturer-filed**:
EPA WaterSense, ENERGY STAR water heaters, and CPSC recalls. The one nongovernmental
AMBER is manufacturer-published water-heater **serial date-code rules**. We would store
those as rules, which are uncopyrightable facts and methods, and we would not copy the
manufacturers' text. The owner should see this trade-off: in plumbing, "nongovernmental"
and "no restrictions" do not overlap today.

### Candidates

| # | Key | Source | Origin | Rights | Access | Volume (measured) | Free-text / structuring value | Score /35 |
|---|---|---|---|---|---|---|---|---|
| 1 | `plumbing-watersense-products` | EPA WaterSense labelled products | governmental-host (certifier/manufacturer-filed) | **AMBER** | Daily bulk ZIP (9 CSVs) + documented api.epa.gov JSON API (api.data.gov key) | 50,688 products, 756 brand strings | Wildcard model patterns in 15,934 of 50,688 (31.4%); 756 brand strings collapse to 634; 1,819 multi-UPC cells | **28** |
| 2 | `plumbing-water-heating-recalls` | CPSC recalls, plumbing/water-heating slice | governmental-host | **GREEN** | Unauthenticated JSON API (same as `cpsc-recalls`) | 101 plumbing recalls, 79 water-heater/boiler recalls | Structured `Model` empty 101/101; serial ranges in prose 33/79 | 31 (slice of `cpsc-recalls`) |
| 3 | `plumbing-water-heater-serial-date-codes` | Manufacturer-published serial date-code rules | **nongovernmental** | **AMBER** (facts/method argument) | None. Manual per-manufacturer collection | ~10–15 brand rule sets [UNVERIFIED] | Serial → manufacture month/year; joins to #2 | 26 |
| 4 | `plumbing-watersense-rebates` | WaterSense Rebate Finder | governmental-host listing → third-party utility pages | AMBER (listing); amounts [UNVERIFIED] | api.epa.gov JSON | 207 rebate entries | Rebate amounts and eligibility live only on the linked utility pages | 25 |
| 5 | `plumbing-energystar-water-heaters` | ENERGY STAR Certified Water Heaters (`pbpq-swnu`) | governmental-host (partner-filed) | **AMBER** | Socrata SODA JSON/CSV | 1,252 rows, 74 brands | Mostly structured already; wildcards 587/1,252; `additional_model_information` 58/1,252 | 24 |
| 6 | `plumbing-iapmo-rt-listings` | IAPMO R&T Product Listing Directory (pld.iapmo.org) | nongovernmental | **RED** | JS single-page app, no documented bulk access | not measured | High (listing file numbers, standards, lead-free) | — |
| 7 | `plumbing-asse-listings` | ASSE seal listings (asse-plumbing.org) | nongovernmental (IAPMO group) | **RED** | none found (`/listed-products` 404) | not measured | High (backflow and valve standards) | — |
| 8 | `plumbing-nsf-listings` | NSF/ANSI 61 & 372 listings (info.nsf.org) | nongovernmental | **RED** | HTML search form | not measured | High (lead-free, drinking-water components) | — |
| 9 | `plumbing-usc-backflow-list` | USC FCCCHR approved backflow assemblies | nongovernmental | **RED** | Excel/PDF download, book sold | not measured | High | — |
| 10 | `plumbing-map-toilet-scores` | MaP toilet flush-performance scores | nongovernmental | **RED** | Web app only | not measured | Medium | — |
| 11 | `plumbing-cec-maedbs` | California Energy Commission MAEDbS (fittings, toilets, water heaters) | governmental-host | **RED** | ASP.NET postback search; root redirects to login | not measured | Medium | — |
| 12 | `plumbing-doe-ccms-water-heaters` | DOE CCMS water heaters | governmental-host | **RED** (unreadable) | 403 | — | — | — |
| 13 | `plumbing-csa-listings` | CSA Group certified-product directory | nongovernmental | **RED** (unreadable) | 403 on robots.txt | — | — | — |
| 14 | `plumbing-wikidata-brand-owners` | Wikidata brand → owner / private-label links | nongovernmental (CC0) | GREEN (CC0) | SPARQL/API | **[UNVERIFIED]**: 429 from this egress | Normalizes brands for #1 and #5 | not scored |

### RED determinations (verbatim)

- **IAPMO R&T / ASSE.** Both sites carry the same IAPMO terms: https://iapmo.org/terms-of-use/ (200) and https://asse-plumbing.org/terms-of-use (200). They say: "All contents of the IAPMO Web Site are copyright by IAPMO and/or its suppliers. All rights reserved." … "Any rights not expressly granted herein are reserved." … "You may not obtain or attempt to obtain any materials or information through any means not intentionally made available or provided for through the IAPMO Web site." There is no reuse grant, and the directory is a JavaScript app with no documented export.
- **NSF.** https://www.nsf.org/terms-of-use, /terms-and-conditions and /legal-notices return 403, both to the declared UA and to a browser UA (tried only to read the terms). The listing search page https://info.nsf.org/Certified/PwsComponents/ (200) says "©2012 NSF International. All rights reserved." We cannot read the terms, so the verdict is RED.
- **USC FCCCHR.** https://fccchr.usc.edu/list.html (200): "The USC Foundation's List of Approved Backflow Prevention Assemblies is copyrighted." The book is sold, and the previously approved list is members-only.
- **MaP.** https://map-testing.com/ (200): "Copyright © 2010-2022 MaP . All rights reserved." `/terms-of-use/` is 404, so there is no reuse grant. The scores are measured facts, but we could get them only by scraping a web app with no grant. RED; reopen by asking for a licence.
- **CEC MAEDbS.** https://www.energy.ca.gov/conditions-of-use (200): "Most of these materials and information … are free for public use consistent with the Public Records Act …, provided the Energy Commission is credited" and then "Use or modification of these materials or information for commercial or profit-making purposes is prohibited and may violate the copyrights or other proprietary rights or both of the Energy Commission or third parties." The terms name commercial use as excluded.
- **DOE CCMS.** https://www.regulations.doe.gov/certification-data/, the water-heater page and robots.txt all return 403 to the declared UA today. This is unchanged from `docs/sources/doe-ccms-corroboration-assessment.md` and the 2026-09-16 ENERGY STAR record, so that earlier finding is still current.
- **CSA Group.** https://www.csagroup.org/robots.txt returns 403, so the terms were not read. RED as unverified.
- **UL Product iQ** (not scored): https://productiq.ulprospector.com/robots.txt returns 403 and redirects to a login app.

### 1. EPA WaterSense labelled products — AMBER (recommended first)

**Terms.** `data.energystar.gov`'s EPA datasets point to https://edg.epa.gov/EPA_Data_License.html (200). It says, verbatim: "Unless otherwise specified, all data produced by the U.S EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105." EPA disclaimers, https://www.epa.gov/web-policies-and-procedures/epa-disclaimers (200): "Mention of or referral to commercial products or services … does not imply official EPA endorsement". The same page says its disclaimers "do not necessarily apply to any particular work … unless the Agency has explicitly stated so". The WaterSense label page, https://www.epa.gov/watersense/watersense-label (200), points to separate "guidelines on the use of WaterSense labels and program marks", so the mark is controlled.

**Why AMBER, not GREEN:** the product rows are filed by licensed certifying bodies for manufacturers, so "data produced by the U.S EPA" does not cleanly cover them. This is the same open question recorded in `energy-star-air-source-heat-pumps-review-packet.md` §4. That packet needed a named human reviewer; ADR-0013 now replaces that requirement, so its blocker is stale. The fields we would publish (brand, model, flow rate, flush volume, UPC) are non-copyrightable facts. We get them from a documented, publisher-provided download without breaching any term.

**Conditions:**
1. Do not reproduce the WaterSense label, logo or program marks.
2. Do not state or imply EPA endorsement.
3. Credit "EPA WaterSense" and show the export date.
4. Publish facts only. Word them as "certified as reported to EPA WaterSense".
5. Sync daily so products removed from the list drop out.

**Access (measured):** The public page https://lookforwatersense.epa.gov/ calls `GET https://api.epa.gov/watersense/downloadLinks`. That returned a ZIP at `…s3-us-gov-west-1.amazonaws.com/exports/1790492400/WaterSense-Products.zip`. The path timestamp is 2026-09-27 07:00 UTC. The ZIP is 412,059 bytes, SHA-256 `3800ecbc…c7f629`, with 9 CSVs. The paged JSON API `/products/{toilets|faucets|showerheads|…}/?offset=&limit=(10|15|25|50)` returns `count` plus rows, and each row carries a stable Salesforce-style `id`. `DEMO_KEY` works at 10 requests per hour. Production needs a free api.data.gov key. The key the site embeds in `/api/environment` must not be used. Cadence: the export path timestamp suggests a daily export. That is one observation, so **[UNVERIFIED]**.

**Volume:** 50,688 products:
- 21,657 lavatory faucets
- 18,559 showerheads
- 6,795 tank toilets
- 1,730 flushometer toilets
- 849 urinals
- 627 spray-sprinkler bodies
- 464 weather-based irrigation controllers
- 3 reverse-osmosis systems
- 4 soil-moisture controllers

API counts match the CSVs: toilets 6,795, faucets 21,657 and showerheads 18,559.

**Samples (30 live API rows):**
- toilets: `a07SJ00000p91jeYAA`, `…p91jdYAA`, `…p91jbYAA`, `…p91jcYAA`, `…p91jaYAA`, `a07t000000fwJ7lAAE`, `…J7nAAE`, `a07SJ0000001Tx3YAE`, `a07t000000fwJ7kAAE`, `…J7mAAE`;
- faucets: `a07t000000VeUZbAAN`, `…UZeAAN`, `…UZfAAN`, `…UZgAAN`, `a073d0000097zE2AAI`, `a07t000000VeUZhAAN`, `…UZiAAN`, `a071T00000j6zv0QAA`, `a07t000000VeUZqAAN`, `a073800000V7kohAAB`;
- showerheads: `a073800000StxzSAAR`, `…xzTAAR`, `…xz5AAB`, `…xz6AAB`, `…xzKAAR`, `…xzMAAR`, `…xzJAAR`, `…xzLAAR`, `…xzNAAR`, `…xzDAAR`.

The seeded wildcard sample (seed 20260927, 20 rows) is in `plumbing/ws_wild_sample.json`.

**Structuring opportunities measured** (`plumbing/ws_measure.py`):

| Opportunity | Result |
|---|---|
| Model numbers written as wildcard patterns (`*`/`#`) that must be compiled to matchers before a retailer SKU such as `K-23938-G-BN` can be checked | **15,934 / 50,688 (31.4%)**. Examples: `K-23938-G-**`, `T3589LF*WL*`, `8186-0.125*******`, `11014-***FL08*`. A broader notation set (`*`, `#`, `(G)` options, `XX`, `A/B` alternates) covers 25,467 / 50,688 (50.2%), but this includes some false positives |
| Wildcard patterns that also match a separately listed concrete model of the same brand (overlaps to resolve) | 52 / 15,934 |
| Brand strings that need normalization (e.g. `PROFLO®,`, `PROFLO™`, `ProFlo`; `TOTO USA, Inc.`, `Toto`) | 756 raw strings → 634 after case/suffix/symbol normalization; 99 groups with variants |
| UPC cells holding more than one GTIN, to split | 1,819 / 3,631 UPC cells; 10,989 tokens, of which 10,961 pass the GS1 check digit and 28 fail |
| UPC coverage | only 3,631 / 50,688 rows (7.2%) carry a UPC, so pattern matching is the main identity route |
| Duplicate brand+model keys across categories/rows | 2,719 |
| Same model number under more than one brand string (private label/OEM) | 756 model numbers |

**Agent use case:** "Is this faucet, showerhead or toilet (by SKU or UPC) WaterSense-labelled, and what are its rated gpm/gpf? Does it qualify for my utility's rebate or meet my state's efficiency code?" Answering that today means a person using EPA's search UI, and it fails on finish-coded SKUs because EPA lists `K-23938-G-**`, not `K-23938-G-BN`.

**Scores:** agent_demand 4, rights_clarity 4, acquisition_ease 5, structuring_value 3, freshness 4, low_onboarding_cost 4, poor_existing_access 4 = **28**.

### 2. CPSC plumbing and water-heating recalls — GREEN (runner-up, with #3)

**Terms:** these are the same as the existing `cpsc-recalls` entry, re-read in round 1. https://www.cpsc.gov/About-CPSC/Policies-Statements-and-Directives/Privacy-Policy: "You may freely copy and distribute recall notices, including photographs of recalled items, without permission." Conditions: credit CPSC, imply no endorsement, and exclude ConsumerContact.

**Access/volume:** `GET https://www.saferproducts.gov/RestWebServices/Recall?format=json` returned 200, 10,027 recalls and 27.7 MB. A title keyword filter selects 102 recalls; after removing one false positive ("Toilet Lighters"), 101 are plumbing recalls. Of those, 79 are water heaters/boilers (43 boilers, 26 water heaters, 7 tankless). Recent volume is low: 9 in 2025 and 3 in 2024. This is a **slice** of `cpsc-recalls`, not a separate build.

**Measured** (IDs in `plumbing/cpsc_samples.json`):

| Signal | Rate |
|---|---|
| Structured `Products[].Model` non-empty | **0 / 101** |
| Model language in prose | 87 / 101 |
| "serial number" in prose | 45 / 101 (water heating: 42 / 79) |
| Serial **range** stated in prose | 34 / 101 (water heating: 33 / 79), e.g. 25441 `ICGFSW1-0199-230400064 … -240300821`; 25325 `242770000111-242850000104`; 25326 |
| Manufacture date window in prose | 19 / 101 |
| UPC | 6 / 101 |

Water-heating serial-range recall IDs: 25441, 25325, 25326, 25157, 24018, 23243, 22176, 20157, 20141, 19111, 19057, 19030, 19029, 16177, 16729, 15155, 15107, 14203, 14077, 14076, 08397, 08566, 08567, 08241, 07020, 06252, 06527, 06002, 03156, 02553, 02152, 02020, 92016.

**Agent use case:** "My water heater or boiler is model X, serial Y. Is it under recall?" This needs the serial-range parsing that CPSC's structured fields lack.

**Scores:** agent_demand 5, rights_clarity 5, acquisition_ease 5, structuring_value 5, freshness 3, low_onboarding_cost 5, poor_existing_access 3 = **31**. This beats #1 on raw score, but it is a 79–101-record **slice of an existing candidate** (`cpsc-recalls`, build order #1), not a new dataset. The score does not capture volume, so it ranks as the runner-up and is delivered inside the CPSC build.

### 3. Water-heater serial date-code rules — AMBER (nongovernmental)

**Terms.** Bradford White's FAQ, https://www.bradfordwhite.com/bw-faq/how-to-read-the-serial-number-date-code-reference-chart/ (200), says verbatim: "The first two characters of the serial number represent the year and month of manufacture. The remainder of the serial is a sequential production number, seven digits in length before December 2007 (DM), and eight digits in length after." The page footer says: "©2026, Bradford White Corporation, USA. All rights reserved." `/terms-of-use/` is 404. robots.txt (200) is `Disallow:` with nothing blocked. rheem.com/robots.txt (200) allows everything except the blog paths. A.O. Smith support URLs that were tried returned 404, so the A.O. Smith rule is **[UNVERIFIED]**.

**Rights argument (AMBER at best):** a date-encoding scheme is a system or method of operation, and 17 U.S.C. § 102(b) excludes those from copyright. We would store the rule as our own code and table (letter→year cycle, month letters, week/year digit positions). We would not copy chart images or page text. Conditions:
1. No verbatim charts or text.
2. Cite each manufacturer's public page as provenance.
3. Label results "decoded per manufacturer-published scheme".
4. Report cycle ambiguity: Bradford White letters repeat on a ~20-year cycle, so return candidate years.
5. No personal data.

**Measurement:** no public corpus of real serials was found that is rights-clean, so decode hit rates are **[UNVERIFIED]**. The linkage with #2 is measured: 33 of 79 CPSC water-heating recalls state serial ranges, from brands including A.O. Smith/State/Reliance/Kenmore (06002, 19029, 04128), Bradford White (02553), Rheem (16177), Lochinvar (20141, 24018) and Navien (19057). Third-party decoder pages (fastwaterheater.com, waterheaterhub.com, a home-inspector PDF) were found by search. They are copyrighted compilations and must **not** be used as sources.

**Scores:** agent_demand 5, rights_clarity 3, acquisition_ease 2, structuring_value 5, freshness 2, low_onboarding_cost 4, poor_existing_access 5 = **26**.

### 4. WaterSense Rebate Finder — AMBER (listing only)

`GET https://api.epa.gov/watersense/rebates/?offset=0&limit=50` returned 200 and `count` 207. Each row has `partnerName`, `state`, `rebateType` and `buildingType`, plus `rebateWebsite` as an HTML anchor. Rebate **amounts and conditions are not in the data**; they are on each utility's page. Those pages are third-party, have their own terms, and are unmeasured **[UNVERIFIED]**. Terms and conditions for the listing are the same as for #1.

**Scores:** 4, 3, 4, 4, 3, 3, 4 = **25**. Next step: sample 20 linked utility pages and check their terms and whether the amount can be extracted.

### 5. ENERGY STAR Certified Water Heaters — AMBER

**Terms:** https://data.energystar.gov/api/views/pbpq-swnu.json carries `custom_fields."Common Core".License` = `https://edg.epa.gov/EPA_Data_License.html` (quoted in #1) and `rights: ["read"]`. As the earlier packet notes, that field is a site permission, not a licence. The earlier packet's partner-submitted question applies here too. Under ADR-0013 the same facts-only argument and conditions as #1 apply, plus: do not use the ENERGY STAR mark.

**Measured:** 1,252 rows (`count(*)`) across 74 brands. `rowsUpdatedAt` is 2026-09-26 13:24 UTC and the newest `date_certified` is 2026-09-16. Types: 592 heat pump, 463 gas tankless, 71 gas storage, 71 residential-duty commercial, 55 solar. The earlier record's 1,260 rows is now slightly stale.
- wildcard model numbers: 587 / 1,252;
- UPC: 82 / 1,252;
- free-text `additional_model_information`: 58 / 1,252;
- 17 model numbers listed under more than one brand, 40 rows in all (e.g. `ACIQ-50G-HP-WH` sold as 1HVAC, ACIQ, DIYCOOL, PolarWave and STEALTH), giving a private-label linkage;
- `tax_credit_eligible` is null in all 1,252 rows.

Sample `pd_id`s: 3626848, 3626849, 3626854, 3626855, 3626846, 3626847, 3626850, 3626851, 3626852, 3626853, 2408406, 2407897, 2407988, 2408013, 2408012, 2407946, 2407986, 2408014, 2408811, 2408810.

**Scores:** 4, 3, 5, 2, 4, 4, 2 = **24**. The data is already structured and the ENERGY STAR finder serves it, so structuring value is low. It is worth folding into #1 or the HVAC/appliance datasets as an extra product family, not building alone.

### Recommendation

- **First plumbing dataset: `plumbing-watersense-products` (AMBER, 28/35).** An agent can answer: "Is this exact faucet, showerhead or toilet SKU or UPC WaterSense-labelled, and what is its certified flow or flush rating?" Finish-coded SKUs are resolved against EPA's 15,934 wildcard model patterns. The data comes from a documented daily bulk export with a public-domain licence pointer, and it has 50,688 records. The deterministic work is building pattern matchers, splitting and validating GTINs, and canonicalizing brands. Next action: write the ADR-0013 rights record (conditions 1–5 above), register an api.data.gov key, and prototype the wildcard compiler over the full snapshot.
- **Runner-up: water-heater and boiler "recall + age" lookup (`plumbing-water-heating-recalls` GREEN + `plumbing-water-heater-serial-date-codes` AMBER).** An agent can answer: "How old is my water heater (serial Y), and is it under recall?" Build it as a filter and serial-range parser inside the `cpsc-recalls` build (build order #1). That build already covers the recall half at almost no extra cost. The serial-date rules follow once each manufacturer's published scheme has been recorded.
- The nongovernmental listing bodies (IAPMO/ASSE/NSF/USC/CSA/MaP) should stay PARKED unless a licence is negotiated. They hold the highest-value plumbing facts (lead-free, NSF 61 and backflow approvals), so a licensing request is the only route to them.

## Trade: Roofing
Trade: roofing. Every fetch was made on 2026-09-27 from this egress with
`User-Agent: DataFoundry/1.0 (data@mail.proviciency.com)`. The one exception is
the GAF terms page, where a browser UA was tried after a 403; it also returned
403, so those terms stay unread. Requests ran at 1 request/second or slower.
Raw samples, scripts and measurement JSON are under `evidence/2026-09-27-service-trades/roofing/`, with
the sample IDs in `samples.json`. The large Florida DBPR file (742 MB) was
counted and then deleted.

Prior repository work has **nothing on roofing**. The HVAC landscape, source
review, ENERGY STAR and DOE CCMS documents do not cover it. The one overlap is
the `cpsc-recalls` candidate, which already covers roofing-product recalls
(nail guns, ladders, roof vents), so no separate recall candidate is proposed
here. The ENERGY STAR roof-products idea is stale. The data.energystar.gov
metadata API lists 90 datasets and none has "roof" in its name; the program
ended in 2022 (from memory, [UNVERIFIED]).

### Headline

No **nongovernmental** roofing source passes the rights gate. CRRC, ICC-ES,
FM Approvals RoofNav, UL Product iQ and the manufacturers (GAF) are all RED:
their terms bar commercial reuse, they need a login, or their terms cannot be
read. The best roofing data is **manufacturer-filed product approval data
hosted by Florida governments**, labelled `origin: governmental-host`. It is
exactly "unstructured to structured": each approval is a PDF, and the tested
roof assemblies, deck types, fastening patterns and maximum design pressures
are locked inside it.

### Candidates

| # | Source | Origin | Rights | Access | Volume (measured) | Free-text value | Score /35 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Miami-Dade County Product Control NOAs, roofing** | governmental-host (manufacturer-filed) | **AMBER** | 1 GET returns the full index table; one text PDF per NOA; no API | **1,860** current HVHZ roofing NOAs, 372 applicants, all with PDF links | Very high: deck type, MDP, fastener spacing, product trade names, test standards all sit in PDF prose/tables | **26** |
| 2 | **Florida Building Commission product approvals (floridabuilding.org), roofing** | governmental-host (manufacturer-filed) | **AMBER** | ASP.NET postback search (97 pages), GET detail pages, PDF uploads | **1,105** approved roofing applications (2023 FBC) | Very high: the approval says "design pressure relates to one assembly, see evaluation report"; assembly tables sit in PDFs (up to 1,600 MDP rows in one) | 24 |
| 3 | NOAA NCEI Storm Events (hail and wind narratives) | governmental | GREEN | Bulk CSV.gz per year | 72,360 events in 2025; 31,012 hail and thunderstorm-wind | Medium: roof damage type and structure type in narratives | 25 |
| 4 | OpenStreetMap `roof:material` / `roof:shape` | nongovernmental (ODbL) | AMBER (share-alike) | Planet/Overpass (Overpass timed out from here) | roof:material on 2,370,445 objects; building on 709,708,935 (0.33%) | Low: already tagged values | 18 |
| 5 | TDI windstorm product evaluations (Texas) | governmental-host | **RED** | Undocumented JSON (`ajaxGetPublicTDIProductEvals`) + PDFs | 262 TDI roof-covering reports; 503 third-party roof links | High (design pressure / fastening tables) | — |
| 6 | Cool Roof Rating Council Rated Products Directory | nongovernmental (nonprofit) | **RED** | HTML directory | not measured | Low (already tabular SR/TE values) | — |
| 7 | ICC-ES Evaluation Reports (ESRs) | nongovernmental | **RED** | HTML/PDF | not measured | High | — |
| 8 | FM Approvals RoofNav | nongovernmental | **RED** | 403 from here; redirects to `roofnav.app.fmglobal.com` (login app) | — | High | — |
| 9 | UL Product iQ (roof fire/wind listings) | nongovernmental | **RED** | 403; login product | — | High | — |
| 10 | Manufacturer warranty / spec documents (GAF, Owens Corning, CertainTeed …) | nongovernmental | **RED** | gaf.com terms 403 even with a browser UA | — | High | — |
| 11 | NOAA SPC storm reports (daily CSV) | governmental | **RED for automated collection** | CSV reachable, but robots.txt `User-agent: * Disallow: /` | ~15–25 hail rows/day sampled | Medium | — |
| 12 | Florida DBPR roofing contractor licences (CCC) | governmental-host | **RED** (personal data) | Bulk CSV | 10,597 distinct CCC roofing licensees | Low | — |

### 1. Miami-Dade County Product Control NOAs: roofing (AMBER, recommended first)

**Terms and legal basis**
- https://www.miamidade.gov/global/disclaimer/disclaimer.page (Liability
  Disclaimer and User Agreement), verbatim: "Government personnel and the general
  public may use this system to review and retrieve publicly available government
  information. User agrees to use this website as permitted by applicable local,
  state, and federal laws." It also says: "taking action which results in
  blocking access to this website by other users will be deemed an unauthorized
  use." The site footer reads "© 2025 Miami-Dade County. All rights reserved."
- Florida Statutes §119.01(1)
  (https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0119/Sections/0119.01.html),
  verbatim: "It is the policy of this state that all state, county, and municipal
  records are open for personal inspection and copying by any person." §119.01(2)(a):
  "Automation of public records must not erode the right of access to those
  records."
- Operative text inside every NOA (24/24 samples; e.g.
  https://www.miamidade.gov/building/library/productcontrol/noa/25092605.pdf), verbatim: "Misuse of this NOA
  as an endorsement of any product, for sales, advertising or any other purposes
  shall automatically terminate this NOA." And: "ADVERTISEMENT: The NOA number
  preceded by the words Miami-Dade County, Florida, and followed by the expiration
  date may be displayed in advertising literature. If any portion of the NOA is
  displayed, then it shall be done in its entirety." These clauses bind the
  **applicant**, the manufacturer advertising its product. They are not a licence
  term on the reader, but the product must not look like manufacturer advertising
  or a partial official NOA.
- `https://www.miamidade.gov/robots.txt` returns 404, so no robots rules apply.
- 0/24 sampled NOA PDFs carry a copyright notice. They are county-authored
  acceptance documents.

**Why AMBER and not GREEN:**
- The generic footer "All rights reserved" conflicts with the Florida public
  records policy.
- The GREEN argument is twofold. First, Florida public records are open to
  copying, and a Florida agency cannot claim copyright without statutory
  authority. That rests on *Microdecisions, Inc. v. Skinner*, 889 So. 2d 871
  (Fla. 2d DCA 2004), cited from memory, [UNVERIFIED]. Second, the extracted
  values are non-copyrightable facts: MDP, deck type, fastener spacing,
  expiration.
- Under the brief this reliance caps the verdict at AMBER.

**Measurements**
- Index: one GET, `pc-result_app.asp?Classification=1,High velocity hurricane
  zone,1&categorylist=13&…` (1.10 MB HTML). It returned **1,860** roofing NOAs,
  all 1,860 with a PDF link (`library/productcontrol/noa/<id>.pdf`), from **372
  applicants**. Index fields are NOA, applicant, category, subcategory, material,
  description, impact, MDP+, MDP−, class and expiry.
- Subcategories: Non-Structural Metal Roofing 875, Single Ply 165,
  Cements-Adhesives-Coatings 145, Underlayments 118, Modified Bitumen 109,
  Roofing Tiles 71, Ventilation 69, Waterproofing 62, Asphalt Shingles 31, and
  others.
- A Non-HVHZ roofing query returned 0. Categories 25 "Roof" and 31 "Roofing
  Fastener Listing" were not queried, so they may add records [UNVERIFIED].
- Freshness: NOA numbers begin with the year. The set holds 288 NOAs from 2026
  (through September) and 551 from 2025, so about 30 new or revised NOAs a
  month. Expiry years run 2026–2032, with 91 expiring in 2026, so status needs
  a sync at least weekly.
- Bulk size: mean PDF 0.40 MB, median 5 pages, so all 1,860 come to about
  0.75 GB.
- The index MDP− is non-zero for 1,164 of 1,860 (62.6%). The structured index
  carries a single number, which is the maximum across all assemblies.

**Extraction over 24 random NOA PDFs** (seed 2709)

Sample IDs: 21-1027.07, 21-1108.05, 22-0103.06, 22-0331.08, 22-0413.02,
22-0614.12, 22-1104.06, 22-1117.06, 23-0215.07, 23-0801.15, 24-0227.02,
24-0313.01, 24-0318.10, 24-0716.10, 25-0402.03, 25-0602.02, 25-0604.12,
25-0630.10, 25-0715.04, 25-0804.01, 25-0926.05, 25-1007.16, 25-1009.03,
25-1216.08.

- Text-extractable: 24/24 (no OCR needed).
- Expiration date in the header: 24/24.
- `Deck Type:` labelled field: 19/24. A deck substrate is named anywhere in
  21/24: plywood, OSB, wood plank, structural concrete, LWIC, gypsum,
  cementitious wood fiber, steel deck, purlins.
- An MDP value in psf is stated in text for 18/24. For the 17 NOAs with a
  non-zero index MDP−, the first extracted MDP equals the index value in
  **15/17**. The other two, 22-0614.12 and 21-1027.07, state a lower value first,
  a table-order effect.
- Fastener spacing ("6" o.c.", "12-inch o.c."): 18/24.
- Test standards (TAS 100/110/114/117/125, ASTM, FM 44xx, UL): 24/24.
- A "TRADE NAMES OF PRODUCTS" table (component product names, test spec,
  dimensions): 21/24.
- Most metal-roof NOAs carry **more than one** MDP. For example, 25-0715.04
  gives −56 / −95.50 / −116.00 / −144.25 psf across fastener spacings. The index
  keeps only the maximum. The pressure-by-spacing-by-deck matrix exists only in
  the PDF.

**Agent use case.** An agent can answer: *"Which Miami-Dade-approved (HVHZ)
standing-seam metal roof systems over 15/32" plywood are rated to at least −150
psf, at what fastener spacing, and are their NOAs still valid on the
permit date?"* Today that means opening dozens of PDFs.

**Conditions**
1. Publish extracted facts: NOA ID, applicant (company), subcategory, material,
   deck type, per-assembly MDP, fastener spacing, test standards, component trade
   names, approval and expiry dates. Link each record to the official PDF. Do not
   republish the PDFs, and do not present a partial NOA as the NOA.
2. Show "Source: Miami-Dade County RER Product Control Section", the fetch date,
   and a notice that this is not an official NOA and implies no county
   endorsement.
3. Show the expiry prominently and flag expired records. Re-sync the index at
   least weekly.
4. Exclude natural-person data: engineer names, P.E. seals and signatures, and
   individual contacts inside the PDFs. Keep company names.
5. Polite acquisition: 1 request/second, with an off-peak bulk backfill so the
   site is not blocked for others.

### 2. Florida Building Commission product approvals: roofing (AMBER, runner-up)

**Terms and legal basis**
- floridabuilding.org has no robots.txt (404). The footer says "Copyright
  2007-2013 State of Florida." Its linked `myflorida.com/myflorida/copyright.html`
  is now 404, and the replacement DMS terms page
  (https://www.dms.myflorida.com/terms_and_conditions) only disclaims warranties
  and licensed clipart. Verbatim: "Various clipart and image collections
  appearing on this site are used under license by the department or its web
  managers for this site. These images are for viewing purposes only."
- Florida Statutes §119.01(1), as quoted above.
- **Third-party copyright inside the uploaded evaluation reports.** In 7 of 23
  sampled reports the text carries "©NEMO ETC, LLC … All rights reserved" or
  "Copyright © 2023 ICC Evaluation Service, LLC. All rights reserved"
  (FL18727-R6, FL32657-R4, FL42102, FL47122-R2, FL477-R15, FL5293-R73, FL854-R4).
  So the prose and layout are copyrighted by the evaluator. Only facts may be
  extracted, such as the assembly ID, deck, components and MDP. A whole
  1,600-row assembly table reproduced verbatim could itself be a protected
  compilation, so derive normalized facts per assembly, cite the report, and do
  not mirror the tables.
- Application detail pages contain **personal data**. 26/26 sampled pages include
  named individuals with emails and phones (authorized signer, QA
  representative, validating engineer). These fields must be excluded.

**Measurements**
- Search: POST `pr_app_srch.aspx` with category=ROOFING, code=2023 and
  status=Approved gives 97 result pages and **1,105 unique FL application IDs**,
  all 97 pages walked. Other statuses (Revoked, Suspended, Pending) and earlier
  code versions exist; not counted.
- Detail pages are GET (`pr_app_dtl.aspx?param=…`). Uploaded PDFs are GET under
  `/upload/PR_Tech_Docs/`, `/PR_Instl_Docs/` and `/PR_Independence/`.
- Structured "Design Pressure" field over 26 sampled applications: "N/A" 15
  times; the rest a single value like "+N/A/-300". The "Other" free-text field
  says, verbatim (FL477-R15): "The Design Pressure listed in this application
  relates to one specific assembly. Refer to Section 4.3 for all assemblies and
  max design pressures."
- Freshness: FL298-R11 shows "Date Revised 09/23/2026", and approvals carry
  QA-contract expiration dates.
- Evaluation-report PDFs, 23 downloaded from 26 sampled applications (3 had
  none; mean 1.24 MB):

  Sample IDs: FL18386-R4, FL18579-R3, FL18727-R6, FL19040-R3, FL32385-R2,
  FL32387-R5, FL32657-R4, FL33548-R1, FL33569-R2, FL42051-R1, FL42059-R1,
  FL42097-R1, FL42101-R1, FL42102, FL42103-R1, FL42142-R2, FL42144-R1, FL47077,
  FL47082, FL47122-R2, FL477-R15, FL5293-R73, FL854-R4.

  - Text-extractable: 20/23. FL32385-R2, FL32387-R5 and FL42097-R1 are scanned
    and would need OCR.
  - Deck type named: 18/23.
  - Test standard named: 19/23.
  - A psf or MDP value stated: 11/23.
  - Assembly-table rows ending in an MDP value: 6/23 reports. FL5293-R73 has
    1,600 rows over 238 pages, FL18727-R6 634, FL477-R15 167, FL854-R4 24,
    FL47122-R2 16 and FL32657-R4 14. Example row: `C-VB-14. Matrix 307 Premium
    Asphalt Primer … Hot asphalt applied LRF-XF, 12-inch o.c. -262.5`.
- Cross-link to Miami-Dade: 5/26 sampled applications cite Miami-Dade NOA
  numbers (e.g. FL5293-R73 cites 23-0316.03), so the two datasets join.

**Agent use case.** An agent can answer: *"For a GAF TPO system on a structural
concrete deck outside the HVHZ, which assemblies reach −120 psf and what
insulation and adhesive do they require?"*

**Conditions** (in addition to 1, 3 and 5 of the NOA conditions)
- Facts only from third-party evaluation reports, with a citation and link.
  Never mirror report text or tables verbatim.
- Exclude every individual's name, email and phone.
- Credit "Florida Building Commission / DBPR BCIS" and claim no state
  endorsement.

**Why runner-up:**
- Acquisition is harder (ASP.NET viewstate postbacks, encrypted `param` links).
- Report formats are more heterogeneous (NEMO PEER/NER, ICC-ES ESR, CCRR,
  engineer letters, scans).
- The evaluator copyright carve-out narrows what can be shown.
- It is the natural second source for the same `roofing-product-approvals`
  schema, because it adds non-HVHZ Florida and many products that have only an
  FL number.

### 3. NOAA NCEI Storm Events: hail and wind (GREEN, governmental; storm-claim context)

**Terms**
- https://www.weather.gov/disclaimer, verbatim: "The information on National
  Weather Service (NWS) Web pages are in the public domain, unless specifically
  noted otherwise, and may be used without charge for any lawful purpose so long
  as you do not: 1) claim it is your own (e.g., by claiming copyright for NWS
  information -- see below), 2) use it in a manner that implies an endorsement or
  affiliation with NOAA/NWS, or 3) modify its content and then present it as
  official government material."
- The same page also says: "As required by 17 U.S.C. § 403, third parties
  producing copyrighted works consisting predominantly of the material appearing
  in NWS Web pages must provide notice …"
- robots.txt for ncei.noaa.gov disallows `/data*` and `/orders*`. The bulk path
  `/pub/data/swdi/stormevents/csvfiles/` is not disallowed.

**Measurements**
- `StormEvents_details-ftp_v1.0_d2025_c20260819.csv.gz` is 12.6 MB and holds
  72,360 events. Of those, 31,012 are Hail or Thunderstorm Wind.
- The 2026 file is `c20260918`, which shows about monthly refreshes.
- `DAMAGE_PROPERTY` is empty or zero in 20,848 of 31,012 (67%).
- The narrative mentions "roof" in 950/31,012.
- In 25 sampled roof narratives:
  - roof-damage type (shingles, metal roof, roof blown off): 15/25;
  - structure type: 20/25;
  - structure counts: 1/25.
- Sample EVENT_IDs: 1276110, 1251838, 1258991, 1245672, 1238038, 1251429,
  1246477, 1246480, 1246835, 1304450, 1244509, 1263602, 1247873, 1265100,
  1305602, 1297370, 1267516, 1246158, 1245572, 1293564, 1248942, 1253604,
  1297834, 1244189, 1283543.
- Narratives sometimes name streets, e.g. 1258991 "a home on James Wallace
  Road". Publish at county/lat-lon precision and do not echo street-level text.

**Assessment.** Legally clean and easy. But this is weather data, not roofing
product data. It is widely resold (hail-map vendors), and the NCEI search is
free, so existing access is only moderately poor. It is a good *join* for a
roofing-claims agent ("was there ≥1.75" hail within 5 km of this address on
2025-05-20?"), not the first roofing product.

### 4. OpenStreetMap roof tags (AMBER, low value)

- Licence: ODbL. A derived database that is publicly used must be offered under
  ODbL (share-alike) with attribution. The licence page was not re-fetched
  today, so the quote is [UNVERIFIED]; the ODbL itself is well known.
- taginfo (data until 2026-09-27T00:59Z):
  - `roof:material` on 2,370,445 objects;
  - `roof:shape` on 9,712,195;
  - `building` on 709,708,935 (0.33% and 1.4% coverage).
- An Overpass city count timed out (overpass-api.de reset the connection;
  kumi.systems timed out after 120 s) [UNVERIFIED locally].
- The values are already tagged, so there is little structuring to add, and
  share-alike conflicts with paid bulk. Not recommended.

### RED candidates (terms quoted)

**TDI windstorm product evaluations.** Every TDI report (22/22 sampled, RC-174 …
RC-86; e.g. https://appscenter.tdi.texas.gov/windstorm/p/productReport/RC-602/) states, verbatim: "The Texas Department of Insurance has not authorized
the use of any information contained in the product evaluation for advertising,
or other commercial or promotional purpose."
- That is an express commercial-use reservation, so the verdict is RED.
- Its 503 third-party roof links point mostly to floridabuilding.org (362) and
  miamidade.gov (132), which are covered above.
- Measured in passing: deck/purlin named 22/22, fastener spacing 22/22, a
  negative psf value in text 10/22.
- Index endpoint: `https://appscenter.tdi.texas.gov/windstorm/p/ajaxGetPublicTDIProductEvals`
  (634 rows).

**Cool Roof Rating Council**
(https://coolroofs.org/terms, "Last updated: January 10, 2024"), verbatim:
- "Under no circumstance shall CRRC Materials, including but not limited to CRRC
  Member Directories or CRRC Materials be used for commercial purposes without
  explicit written authorization from CRRC."
- "you do not download quantities of the CRRC Materials to a database that can
  be used to avoid future downloads from the CRRC Website."

robots.txt carries Cloudflare content-signal language, with an EU
DSM-Directive Art. 4 reservation.

**ICC-ES** (https://icc-es.org/legal/website-user-agreement/), verbatim: "no
portion of the Site or Site Information may be reprinted, republished, modified,
or distributed in any form without Our express written permission. You may not,
and this Agreement does not give You permission to, reproduce, reverse engineer,
decompile, disassemble, modify, transmit, sell, distribute, license or create
derivative works with respect to the Site or any of the Site Information."
ESRs attached to FBC approvals also carry "Copyright © 2023 ICC Evaluation
Service, LLC. All rights reserved" (FL42102).

**FM Approvals RoofNav.** `https://www.roofnav.com/` redirects to
`https://roofnav.app.fmglobal.com/`, which returns HTTP 403. It is an
account-based application. Terms not read [UNVERIFIED]. RED on the access
barrier.

**UL Product iQ.** `https://productiq.ulprospector.com/` returns HTTP 403; it is
a login product. Terms not read [UNVERIFIED]. RED.

**Manufacturers (GAF).** `https://www.gaf.com/en-us/terms-of-use` returns 403,
with both the descriptive UA and a browser UA. The terms are unreadable, so the
verdict is RED. The HVAC-style prohibition logic probably applies to roofing
manufacturer manuals and warranties too (copyrighted documents, no reuse
grant) [UNVERIFIED].

**NOAA SPC storm reports.** `https://www.spc.noaa.gov/robots.txt`: "User-agent: *
Crawl-delay: 10 Disallow: /". The content is public domain, but automated
collection is refused by robots. Use NCEI Storm Events, which ingests the same
reports after QC.

**Florida DBPR roofing contractor licences.** `cilb_certified.csv` (742 MB,
continuing-education rows) has 10,597 distinct `CCC` roofing licensees. Rows are
individual names with street addresses (e.g. "AARON, DAVID TYLER", a St.
Petersburg address). This is personal data, and a licence-verification product
cannot remove the name without losing its point. RED under the brief.

### Scores (1–5)

| Candidate | demand | rights | acquisition | structuring | freshness | onboarding | poor access | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| roofing-miami-dade-noa | 4 | 3 | 3 | 5 | 4 | 3 | 4 | **26** |
| roofing-florida-product-approvals | 4 | 3 | 2 | 5 | 4 | 2 | 4 | 24 |
| roofing-ncei-storm-events | 3 | 5 | 5 | 3 | 3 | 4 | 2 | 25 |
| roofing-osm-roof-tags | 2 | 3 | 3 | 1 | 4 | 3 | 2 | 18 |

NCEI outscores the Florida approvals on raw total because it is easy and
GREEN. It still ranks below them as a *roofing* dataset: it is governmental
weather data with existing resellers, while the approvals are the unique
unstructured-to-structured roofing asset.

### Recommendation

1. **First: `roofing-miami-dade-noa`.** Structured HVHZ roofing approvals:
   per-assembly deck type × fastening × MDP, component trade names, test
   standards and validity dates, parsed from 1,860 county NOA PDFs. All 1,860
   are reachable from one index GET, and 24/24 are text PDFs with no copyright
   notice. The first extracted MDP matches the index in 15/17.
2. **Runner-up: `roofing-florida-product-approvals`.** It shares the same schema.
   It adds 1,105 statewide approvals and deep assembly tables, but with
   evaluator-copyright and personal-data carve-outs and harder acquisition.
3. Keep `roofing-ncei-storm-events` as a GREEN join for claims and insurance
   agents, not as the lead roofing product.

**Next step for #1:**
- Pull the whole index plus all 1,860 PDFs to R2 (~0.75 GB, ~35 min at
  1 rps).
- Write the ADR-0013 rights record using the conditions above.
- Build three deterministic parsers: the header (NOA, dates), the labelled
  "Category / Deck Type / Maximum Design Pressure" block, and the metal-roof
  "MAXIMUM DESIGN PRESSURES" spacing tables.
- Golden-test the parsers against the 24 samples.

## Trade: Electrical
This was read-only research. Requests came from this egress with the User-Agent
`DataFoundry/1.0 (data@mail.proviciency.com)` at no more than 1 request per second. A
browser User-Agent was used only to try to **read** terms pages that refused the
descriptive UA. Each place this happened is noted below. Raw downloads, scripts and
sample IDs are in `evidence/2026-09-27-service-trades/electrical/`: `cec_measure.py`, `cec_measure2.py`, `m3.py`,
`cpsc_elec.py`, `cec_inv_sample.json`, `cec_other_samples.json`,
`cpsc_elec_sample_ids.json` and the five CEC `.xlsx` snapshots. The 27 MB CPSC dump was
deleted after measurement, and the `.xlsx` files total about 9 MB. Anything not measured
is marked [UNVERIFIED]. The verdicts are an AI assessment, not legal advice.

### Summary table

| # | Candidate | Origin | Rights | Access | Volume | Free-text value | Score /35 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **CEC Solar Equipment Lists** (grid-support inverters, PV modules, ESS, batteries, meters) | governmental-host (manufacturer-filed) | **AMBER** | Documented bulk `.xlsx`, one GET per list | 2,174 solar inv + 1,142 battery inv + 22,186 modules + 1,079 ESS + 28 batteries + 802 meters | High: firmware lists, `{variant}` suffixes, module descriptions (bifacial/half-cut/max-V/backsheet not in columns), cross-manufacturer model duplicates | **28** |
| 2 | CPSC recalls, electrical slice (breakers, GFCI/AFCI, cords, power strips, generators, power stations, LED fixtures, EV chargers) | governmental-host | GREEN | API, one call | 322 of 10,027 recalls match the keyword+hazard filter (66 since 2020) | High: model numbers in prose, structured `Model` empty | 28 (**a view of the existing `cpsc-recalls` candidate, not a new dataset**) |
| 3 | TDLR Texas electrical contractor licences (data.texas.gov `7358-krk7`) | governmental-host (private-sector licensees) | AMBER (personal-data exclusion) | Socrata SODA API / CSV | 14,019 Electrical Contractor rows (plus 346k individual electrician rows, excluded) | Low | 25 |
| 4 | ENERGY STAR electrical: EVSE AC/DC, ceiling fans, downlights, UPS | governmental-host (partner-submitted) | AMBER (per the existing 2026-09-16 record) | Socrata SODA API | 475 + 323 + 1,447 + 4,559 + 923 | Low: already columnar. **UPC** present, joins to CPSC | 24 |
| 5 | Open Charge Map | **nongovernmental** (non-profit) | AMBER (CC BY 4.0 for user data; imported data keeps its provider's licence) | API, key required | [UNVERIFIED] (key needed) | Possibly high: free-text `UsageCost` [UNVERIFIED] | 21 |
| 6 | OpenStreetMap power infrastructure (`power=substation/plant/line`) | **nongovernmental** (ODbL) | AMBER (share-alike) | Overpass / Geofabrik, **unreachable from this egress** | [UNVERIFIED] | Medium: `voltage` multi-value strings, operator name normalisation [UNVERIFIED] | 19 |
| 7 | CEC MAEDbS (Title 20 appliances: LED lamps, battery chargers, etc.) | governmental-host (manufacturer-filed) | AMBER (same CEC terms as #1) | ASP.NET postback UI only; no documented bulk file found | [UNVERIFIED] | [UNVERIFIED] | 17 |
| 8 | NREL/DOE AFDC EV station data | governmental-host | UNKNOWN | `developer.nrel.gov` and `www.nrel.gov`: **proxy CONNECT 502** from this egress | [UNVERIFIED] | Thesis: free-text `ev_pricing` [UNVERIFIED] | n/a (DISCOVERED) |
| — | DesignLights Consortium QPL | nongovernmental (non-profit) | **RED** | — | — | — | — |
| — | UL Product iQ / UL Solutions | nongovernmental | **RED** | — | — | — | — |
| — | Intertek ETL Directory | nongovernmental | **RED** (unreadable) | — | — | — | — |
| — | CSA Group certified-product directory | nongovernmental | **RED** (unreadable) | — | — | — | — |
| — | SunSpec Alliance certified products | nongovernmental (non-profit) | **RED** (unreadable) | — | — | — | — |

**The nongovernmental trade-off, stated plainly.** Every nongovernmental electrical
listing or certification body checked is RED:

- **DLC** and **UL** expressly forbid commercial use and redistribution.
- **Intertek**, **CSA** and **SunSpec** refuse or challenge both our UA and a browser UA,
  so their terms could not be read.

The only nongovernmental sources that are not RED are open-licence community projects,
Open Charge Map and OpenStreetMap, and both carry attribution and share-alike or
mixed-licence conditions. The strongest electrical dataset is regulator-hosted. Its
content is manufacturer-filed data about private-sector products, which fits the brief's
"regulator-hosted, manufacturer-filed" allowance.

### RED sources (verbatim terms)

#### DesignLights Consortium QPL: RED
https://designlights.org/terms-of-use/ (Last Modified: February 15, 2022; read 2026-09-27
with the descriptive UA). robots.txt allows `/` and disallows only `/dlc-documentation`,
`/wp-admin/`, `/assets/`, `/tag/` and `/author/`. robots.txt is not permission.

> "You may access and use the Data solely for your own internal, non-commercial business purposes; You shall not (i) access or use the Data for any commercial purpose, (ii) represent to any third party that any Data is your property (proprietary or otherwise), or (iii) make available any Data to any third party unless expressly permitted herein"

> "Use any Data to develop, market, or distribute, directly or indirectly, any software, service, database, data, other information or other offering that is similar to, derivative of, or a substitute or alternative for, any Data"

The terms name exactly our use case as excluded. The only route in is a separate written
data-use agreement with DLC (info@designlights.org).

#### UL Product iQ / UL Solutions: RED
`productiq.ulprospector.com` returned 403 ("You have been blocked") to both UAs. The UL
Solutions terms at https://www.ul.com/resources/online-policies/terms-of-use returned 200:

> "The Site is provided for your personal information and non-commercial use. The commercial use, reproduction, transmission or distribution of any information, software or other material made available through the Site without the prior written consent of UL Solutions is strictly prohibited."

> "You specifically agree not to access (or attempt to access), or systematically retrieve data from, any part of the Site through any automated means (including use of scripts, bots or web crawlers). Gathering data from the Site through harvesting or automated means is strictly prohibited."

#### Intertek ETL Directory: RED (unreadable)
- `bpdirectory.intertek.com/` returned 403 to the descriptive UA.
- `/pages/DLP_Search.aspx` returned 503 to a browser UA.
- `www.intertek.com/terms/` returned 403 to both UAs.

The terms could not be read, so the source is RED. It is very likely restricted anyway,
because it is a certification-body directory [UNVERIFIED].

#### CSA Group directory: RED (unreadable)
- `directories.csa-international.org`: the egress proxy returned CONNECT 502.
- `www.csagroup.org/legal/`: 403 to both UAs.

#### SunSpec Alliance certified products: RED (unreadable)
`sunspec.org/certified-products/`, `/terms-of-use/` and `/robots.txt` returned 403, and a
browser UA got a Cloudflare JavaScript challenge ("Just a moment..."). Our acquisition
policy does not defeat challenges.

### 1. CEC Solar Equipment Lists: AMBER (recommended first dataset)

**Origin.** governmental-host (California Energy Commission). The content is
manufacturer-submitted equipment data. CEC's own page says: "manufacturers' self-reported
information is not confirmed."

**Terms.** https://www.energy.ca.gov/conditions-of-use (reached via the list app's footer
link `http://www.energy.ca.gov/conditions.html`, read 2026-09-27). Verbatim:

> "No material or information from this site may be copied, reproduced, republished, uploaded, posted, transmitted, or distributed except as authorized in these terms of use, expressly authorized on the information or materials themselves, or approved in writing by the Energy Commission."

> "Materials and information in this site are provided as a public service. Most of these materials and information were generated, compiled, or assembled at public expense and are free for public use consistent with the Public Records Act (California Government Code Section 6250 et. seq.), provided the Energy Commission is credited when using these materials and information. Some of the materials and information in this site, such as the third-party materials addressed below and select materials bearing a copyright notice, may not be used for any purpose. Use or modification of these materials or information for commercial or profit-making purposes is prohibited and may violate the copyrights or other proprietary rights or both of the Energy Commission or third parties."

> "Go Solar California TM is a trademark of the Energy Commission. The Energy Commission reserves all rights in the use of this trademark."

> "The Energy Commission seal and logo may not be used without permission."

> "Reference in this site to any specific commercial product, process, or service by trade name, trademark, manufacturer, or otherwise does not constitute or imply an endorsement, recommendation, or approval by the Energy Commission."

**Why AMBER and not GREEN.**

1. The grant is "free for public use … provided the Energy Commission is credited".
2. The commercial prohibition reads "these materials or information". Its nearest
   antecedent is "Some of the materials … such as the third-party materials … and select
   materials bearing a copyright notice".
3. **Measured:** none of the five `.xlsx` lists contains the string "copyright" or "©".
   I unzipped each file and grepped every XML part: 0 hits.
4. The records are non-copyrightable facts: model numbers, ratings, certificate dates and
   firmware identifiers.
5. The lists exist to support utility interconnection (Rule 21) and public incentive
   programs.
6. California case law holds that CPRA records cannot be copyright-restricted absent
   statutory authority (*County of Santa Clara v. Superior Court*, 2009). This is from
   memory and [UNVERIFIED] here.

The sentence is still ambiguous: a reader could apply the commercial clause to the whole
site. So the verdict is **AMBER at best**, relying on the scoping reading plus the
non-copyrightable-facts argument.

**Conditions.**

- Credit the California Energy Commission.
- Imply no CEC endorsement.
- Do not use the CEC seal or logo or the "Go Solar California" mark.
- Redistribute facts only. Do not republish the list notes prose verbatim as our own
  content.
- Show "manufacturer self-reported; not confirmed by CEC", and carry the list's "Data has
  not changed since …" date.
- Before `RIGHTS_DETERMINED`, the agent may email SolarEquipment@energy.ca.gov to ask
  whether commercial redistribution of the lists is permitted. A written yes would upgrade
  the verdict to GREEN. This is agent work, not owner work.

**Access.** robots.txt returned 404 on `solarequipment.energy.ca.gov`, and there is no
auth. The documented download links on each list page are
`https://solarequipment.energy.ca.gov/Home/DownloadtoExcel?filename=<List>`. Measured:

| File | HTTP | Bytes |
| --- | --- | --- |
| `InvertersList` | 200 | 1,622,184 |
| `PVModuleList` | 200 | 5,890,334 |
| `EnergyStorage` | 200 | 1,362,967 |
| `BatteryList` | 200 | 117,946 |
| `MeterList` | 200 | 70,602 |

`InverterSolarList` and `InverterBatteryList` returned 0 bytes. They are sheets inside
`InvertersList`, not separate files.

**Cadence.** "updated three times a month, typically on the 1st, 11th, and 21st"
(https://www.energy.ca.gov/programs-and-topics/programs/solar-equipment-lists). Each file
states "Data has not changed since September 21, 2026" (meters: September 1, 2026).

**Volume (measured, data rows).**

| List | Rows |
| --- | --- |
| Solar inverters | 2,174 (1,549 distinct base models) |
| Battery inverters | 1,142 |
| PV modules | 22,186 (21,819 base models) |
| Energy storage systems | 1,079 |
| Batteries | 28 |
| Meters | 802 |

**Free text and extraction opportunities (full population, `cec_measure*.py`, `m3.py`).**

1. **Firmware versions tested (UL 1741 SA).** This answers "is firmware X on my inverter
   Rule 21 certified?"
   - 1,605 of 2,174 solar-inverter rows carry a firmware cell.
   - Parsed 1,605 of 1,605 into **3,803 version tokens**.
   - 288 of 2,174 rows list several versions.
   - The cells are inconsistent: `;` or `,` separators, and mixed `[..]` and `{..]`
     brackets. For example, Enphase `IQ8P-72-M-US {240V}` is `[V8.14.02];{10.31.01]`.
   - Seeded sample of 25: several-version lists in 4 of 25.
2. **Model variant suffixes.** CEC appends a `{variant}` that is not part of the
   manufacturer's model number.
   - Solar inverters: 2,167 of 2,174. Sample: 25 of 25.
   - ESS: 410 of 1,079 (sample 8 of 25). ESS suffixes pack voltage, kW and kWh, e.g.
     `Echo 2.0 4T {208V, 18kW, 42kWh}`.
   - Splitting the suffix gives the canonical manufacturer model plus typed options.
3. **Module description attributes with no structured column.** Of 22,186 descriptions:

   | Attribute | Rows |
   | --- | --- |
   | Max system voltage (e.g. `1500V max system Vdc`) | 15,195 |
   | Half-cut cell | 10,895 |
   | Backsheet colour | 10,605 |
   | Cell count | 5,372 |
   | Bifacial | 3,913 |
   | Double-glass | 3,121 |

   In the seeded 25: watts 25/25, technology 25/25, half-cut 15/25, cell count 7/25,
   bifacial 5/25.
4. **Inverter description, compared with the structured rating.**
   - The description states kW in 1,593 of 2,174 rows and Vac in 2,120.
   - Phase is stated in 268, micro-inverter in 577, arc-fault/detector in 194 and rapid
     shutdown in 44.
   - The description's kW equals the "Maximum Continuous Output Power at Unity PF" column
     in only **949 of 1,593** rows. The remainder are the marketing class rating against
     the voltage-specific rating. For example, `UNO-DM-3.8-TL-PLUS-US-SB-RA {208V}` says
     "3.8 kW" while the column says 3.3.
   - That difference is a real agent question: "what will this inverter actually deliver
     at 208 V?"
   - ESS agreement is high: description kWh equals the column in 1,058 of 1,078 rows.
5. **Entity resolution: the same model under different manufacturers** (private label /
   OEM).
   - Inverters: 17 base models. For example, Growatt `MIN 3800TL-XH-US` is also listed
     under Base Power, Inc.
   - Modules: 175 base models. For example, `CHSM72M(DG)/F-BH-520` is under both
     Astronergy and Chint.
   - CEC flags these only with blue text, which is lost in any CSV.
6. **Spreadsheet hygiene.** In 21,946 of 22,186 module rows, PTC is an Excel **formula
   string** (`=IF(E18="",...)`), not a value. A naive CSV load loses it, so we compute it
   deterministically.
7. **Cross-link to recalls.** 12 of 404 CEC manufacturer names also appear as a
   manufacturer, importer or distributor in CPSC recalls: Anker, Delta, GAF Energy,
   Generac, Kohler, LG, Lite-On, Mitsubishi, Panasonic, Schneider, Siemens and Suntech.

**Sample IDs.**

- 25 inverters (seed 20260927) are in `cec_inv_sample.json`, e.g.
  `Hoymiles|MIS-350-1A-NA {240V}`, `Enphase|IQ7XS-96-ACM-US {240V}`,
  `CSI Solar|CSI-185K-T600GL03-U {600V}` and `Generac|XVT114G03 {208V}`.
- 25 modules and 25 ESS are in `cec_other_samples.json`, e.g.
  `Jinko|JKM340N-60H-MBB-V`, `Tesla Inc.|1707000-XX-Y {5kW}` and
  `SunFusion|Echo 2.0 4T {208V, 18kW, 42kWh}`.

**Scores.**

| Criterion | Score | Reason |
| --- | --- | --- |
| agent_demand | 4 | Installers, permit reviewers, utilities, homeowners |
| rights_clarity | 3 | |
| acquisition_ease | 5 | |
| structuring_value | 3 | |
| freshness | 5 | |
| low_onboarding_cost | 4 | Small; one GET per list; D1-sized |
| poor_existing_access | 4 | Only formula-laden Excel. Solar design tools embed it, but there is no API/MCP [UNVERIFIED for competitors] |
| **Total** | **28** | |

**Agent use case.** An agent can answer: "Is the Enphase IQ8P on firmware V8.14.02, or
this 11.4 kW Generac hybrid at 208 V, on California's Rule 21 / UL 1741-SB grid-support
list, and what is its real continuous output and CEC-weighted efficiency at my service
voltage?"

### 2. CPSC recalls, electrical slice: GREEN (runner-up, as a view of `cpsc-recalls`)

**Terms.** Already quoted verbatim in `research-2026-09-27.md` §2
(https://www.cpsc.gov/About-CPSC/Policies-Statements-and-Directives/Privacy-Policy): "You
may freely copy and distribute recall notices, including photographs of recalled items,
without permission." Credit CPSC, imply no endorsement, and exclude `ConsumerContact`.

**Measured today** (one call, 10,027 recalls, `cpsc_elec.py`):

- A keyword filter on title and product (breaker, GFCI/AFCI, receptacle/outlet,
  extension/power cord, power strip, surge protector, panel, EV charger, ceiling fan,
  light fixture/LED, generator, inverter, power station, charger), combined with a
  shock/electrocution/fire/burn/overheat/arc hazard, matched **322 recalls**.
- 66 of them are from 2020 onwards. By year: 2019 15, 2020 10, 2021 6, 2022 7, 2023 6,
  2024 9, 2025 7, 2026 21.
- Since 2020 (66):
  - model/SKU/part marker in the prose: 44 of 66;
  - date-code, serial or lot: 17 of 66;
  - voltage or amp rating: 8 of 66;
  - UPC: 3 of 66;
  - structured `Products[].Model` non-empty: **0 of 66**.
- Seeded sample of 25 (`cpsc_elec_sample_ids.json`): model 17/25, date-code 7/25, rating
  3/25.
- Filter precision is imperfect. By inspection, about 3 of 25 are off-trade:
  26650 (popcorn containers), 26601 (grill brushes) and 23206 (mini-fridge).
- Sample recall numbers include 25058, 26599, 26278 (LED high-bay fixtures), 23059, 26194
  (surge/power strips), 20185, 21760, 26407, 23251 (generators), 24350, 26010 (power
  stations) and 20112 (Leviton connection devices).

**Conditions and decision.** Build it as a trade facet over the planned `cpsc-recalls`
build, not as a separate dataset. It adds an electrical category classifier and
amp/voltage/model parsing. **UPC joins:** ENERGY STAR downlights and ceiling fans carry
`upc`, so a recall can be matched to a certified product.

Scores: demand 4, rights 5, acquisition 4, structuring 4, freshness 4, onboarding 5, poor
access 2. **28.**

### 3. TDLR Texas electrical contractor licences: AMBER

- **Host:** https://data.texas.gov/resource/7358-krk7.json (Socrata).
- **Dataset metadata:** `license: null`, attribution "Texas Department of Licensing and
  Regulation", `rowsUpdatedAt` 1789851091 (2026-09-19 UTC).
- **Freshness:** the TDLR search page says "Data last updated: 9/27/2026 06:01".
- **Terms:** no data licence was found. The TDLR policy page
  (https://www.tdlr.texas.gov/disclaimer.htm) reserves only its logos:

  > "The Texas Department of Licensing and Regulation has intellectual property rights in its logos. No one may use any TDLR logo without permission from the agency."

  The texas.gov footer "Copyright © 2026 State of Texas. All rights reserved." is a site
  footer, not a data licence. The rights basis is public information under the Texas
  Public Information Act plus non-copyrightable facts, so **AMBER at best**.

**Volume.** Electrical Contractor 14,019. Individual licences, all excluded as personal
data: Apprentice 274,391, Journeyman 45,315, Master 19,927 and others.

**Personal data.**

- In all 14,019 rows, `owner_name` equals `business_name`.
- Only **9,543 of 14,019** business names carry an entity-form token (LLC, INC, CORP,
  CO, LTD, LP and similar). Seeded 25: 18 of 25.
- The remaining ~4,476 may be sole traders.
- Condition: publish only entity-form businesses. Show licence number, business name,
  county, city and expiry. Exclude telephones, street and mailing addresses, and every
  individual-licence type.

**Structuring value is low.** The data are already columnar. The value is licence
verification ("is this contractor licensed and current?"), and cross-state licensing
normalisation if more states follow.

Scores: demand 4, rights 3, acquisition 5, structuring 1, freshness 5, onboarding 4, poor
access 3. **25.**

### 4. ENERGY STAR electrical categories: AMBER (inherits the existing record)

The rights and access position is already recorded in
`docs/sources/energy-star-certified-products-qualification-20260916.md`:

- EPA Common Core `License: https://edg.epa.gov/EPA_Data_License.html`.
- Re-read today: "Unless otherwise specified, all data produced by the U.S EPA is by
  default in the public domain and is not subject to domestic copyright protection under
  17 U.S.C. § 105".
- The licence is scoped to EPA-produced data, while the fields are partner-submitted.
- ENERGY STAR is a certification mark.

That record is not stale on rights. Measured today (`$select=count(*)`, `rowsUpdatedAt`
2026-09-26):

| Category | Dataset | Rows |
| --- | --- | --- |
| EVSE AC-output | `5jwe-c8xm` | 475 |
| EVSE DC-output | `t3a6-mkxz` | 323 |
| Ceiling fans | `2te3-nmxp` | 1,447 |
| Downlights | `ej6d-wb4c` | 4,559 |
| UPS | `ifxy-2uty` | 923 |

**No lamps (bulbs) dataset exists in the 53-dataset catalog.** The lamps specification
appears to have been retired [UNVERIFIED reason].

Fields are already typed: for EVSE, amps, kW, cord gauge and network protocol. Free text
is limited to comma-lists such as `special_features`,
`correlated_color_temperature_kelvin` = "4000k,5000k,2700k,3500k,3000k" and
`network_protocol_with_wake_capability`. Structuring value is low. The linkage value is
the UPC join to CPSC.

Scores: demand 3, rights 4, acquisition 5, structuring 2, freshness 4, onboarding 4, poor
access 2. **24.**

### 5. Open Charge Map: AMBER (nongovernmental), not measured

**Terms.** https://openchargemap.org/about/terms ("updated 01/04/2022"). The `/site/...`
paths redirected to a login page for our UA. Verbatim:

> "Data contributed to us by our users which we then redistribute is licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0)."

> "Data imported from 3rd party Data Providers is copyright the original Data Provider in each case and is not provided under the same terms as the user-contributed data detailed above."

> "Use of our API or data in an application or service requires that the appropriate Data Provider attribution (including license terms) be provided in a way which is visible the end user."

The terms also state that editor and submitter identities are part of the public data set.

**Access.** `api.openchargemap.io/v3/poi` returned 403: "You must specify an API key". A
key needs free registration. Counts are [UNVERIFIED], and so is the thesis that
`UsageCost` is free text worth parsing into $/kWh, $/min and session fees.

**Conditions.** Filter to CC BY 4.0 records, or to providers whose licence permits
commercial redistribution. Show per-provider attribution to end users. Strip
user/contributor identities.

Scores: demand 3, rights 2, acquisition 3, structuring 4 [UNVERIFIED], freshness 4,
onboarding 3, poor access 2. **21.**

### 6. OpenStreetMap power infrastructure: AMBER (nongovernmental), unreachable

**Terms.** https://www.openstreetmap.org/copyright (200):

> "You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same license."

**Access.** Nothing could be downloaded from this egress:

- `overpass-api.de`: connection reset.
- `overpass.kumi.systems`: timeout.
- `overpass.private.coffee`: 504.
- `download.geofabrik.de`: connection reset.

**Condition.** ODbL share-alike applies to any derived database we distribute. Keep an
OSM-derived layer as a separate ODbL database, and credit it. Scores (judgement,
unmeasured): 2/2/2/3/4/3/3 = 19.

### 7. CEC MAEDbS: AMBER terms, no bulk access

The same CEC conditions of use apply. `cacertappliances.energy.ca.gov/` redirects to
`Login.aspx`, and search runs on ASP.NET `__doPostBack`. The AdvancedSearch URL looped
past 50 redirects. No documented bulk download was found, via the site or a web search.
It covers Title 20 LED lamps, battery chargers and similar [UNVERIFIED counts].

Next step: look for a documented export in MAEDbS help, or ask
Appliances@energy.ca.gov. Scores: 3/3/1/2/4/2/2 = 17.

### 8. NREL / DOE AFDC EV stations: DISCOVERED

`afdc.energy.gov/data_download` returned 200, but the data download needs a
`developer.nrel.gov` API key. `developer.nrel.gov` and `www.nrel.gov` got **proxy CONNECT
502** from this egress, so the terms and data are unread (rights UNKNOWN). The free-text
`ev_pricing` field is a structuring thesis [UNVERIFIED]. Retry from Cloudflare Worker
egress.

### Recommendation

- **First dataset: CEC Solar Equipment Lists (AMBER, 28/35).**
  - It is documented bulk data: 5 GETs, about 9 MB, updated 3 times a month.
  - It is manufacturer-filed product data, and there is deterministic structure to add:
    firmware arrays (3,803 versions from 1,605 cells), variant-suffix splitting
    (2,167 of 2,174 inverters), and module attributes found only in prose (bifacial 3,913,
    half-cut 10,895, max system V 15,195). It also resolves OEM/private-label duplicates
    (17 inverter and 175 module base models), and fixes PTC values stored as formulas
    (21,946 rows).
  - Unlike every nongovernmental listing body, its terms do not prohibit this use in the
    reading we rely on, and the files carry no copyright notice.
  - An agent can answer: "Is this inverter/firmware on California's grid-support
    (Rule 21 / UL 1741-SB) list, and what is its real output and efficiency at my
    voltage?"
- **Runner-up: CPSC electrical recalls (GREEN, 28/35)**, delivered as an electrical facet
  of the existing `cpsc-recalls` build rather than a new dataset.
  - 322 electrical recalls; model markers in 44 of 66 since 2020, with the structured
    `Model` field empty in all 66.
  - It joins by UPC to ENERGY STAR downlights and ceiling fans.
  - An agent can answer: "Is the breaker, GFCI, power strip or generator in this photo
    recalled, and which model or date codes are affected?"
- **Nongovernmental options:**
  - Open Charge Map (AMBER, needs an API key) and OSM power (AMBER, ODbL, unreachable)
    are the only non-RED ones.
  - Neither is measurable today, and both carry attribution or share-alike obligations.
- **RED, never acquire:** DLC, UL Product iQ/UL Solutions, Intertek ETL, CSA and SunSpec.
  Consider adding `designlights.org` and `productiq.ulprospector.com` to the prohibited
  list; both have express no-commercial/no-derivative terms.
