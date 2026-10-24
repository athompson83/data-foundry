# restaurant-health-inspections (food-safety) — screening notes, 2026-10-03

Scripts: `screen.py` (all live measurements, writes `results.json`), `osm_cambridge_fhrs_sample.json` (trimmed OSM sample).
All requests sent `User-Agent: data-foundry-scout (data@mail.proviciency.com)`, under 2 req/s, no keys, no login.

Target agent use: "is this establishment safe / what violations recurred". Establishment is the entity; inspections and
violations are facts hanging off it.

## Headline
- Jurisdictions do not overlap, so two city feeds never join each other (no shared establishment). The only measured
  cross-publisher declared join is **FSA FHRS <-> OpenStreetMap `fhrs:id`** (UK): 38/40 sampled OSM venues resolve to
  the FSA record (2 ids no longer exist in the FSA API), 38/38 postcodes equal, 22/38 names equal after normalisation.
- The strongest violation-text feeds (NYC DOHMH, Chicago) are PARKED: no readable, redistribution-granting terms.
- Violation-text member that is rights-clean: San Francisco LIVES (PDDL) but frozen at 2019-11-28.
- Verdict: dataset passes the screening gate technically (3 non-RED members, 1 declared join with matched>0) but is
  weak on freshness for the free-text member. Next action is to get NYC/Chicago terms readable.

## nyc-dohmh-restaurant-inspections — PARKED (UNKNOWN)
- `https://data.cityofnewyork.us/resource/43nn-pn8j.json` HTTP 200. 296,175 rows, 31,462 distinct `camis` (permit/record
  id). Newest `inspection_date` 2026-10-01; `record_date` 2026-10-02; dataset metadata "Update Frequency: Daily".
- Fields: camis, dba, boro, building, street, zipcode, phone, cuisine_description, inspection_date, action,
  violation_code, violation_description (free text), critical_flag, score, grade, inspection_type, lat/lon, bin, bbl.
  Sample of 200: violation_description filled 192/200, camis 200/200.
- Terms: the Socrata view carries no licence (`licenseId` null). The only fetched terms page, https://www.nyc.gov/home/terms-of-use.page,
  says "All other design, information, text, graphics, images, pages, interfaces, links, software, and other items and
  materials contained in or displayed on NYC.gov, and the selection and arrangements thereof, are the property of the City of New York."
  and "To request permission to use City intellectual property located on NYC.gov, please visit the". That is the nyc.gov
  website and does not state open-data terms; the NYC Open Data terms/law pages fetched
  (https://opendata.cityofnewyork.us/terms-of-use/, /open-data-law/, /faq/) render as script shells with no readable terms text.
- Rights: UNKNOWN. Parked, not worked around. Retry from a browser-capable egress (Cloudflare Browser Run) to read the
  NYC Open Data terms; ADR-0018 free-public-data presumption may then apply (no login/paywall), pending a human-readable quote.

## chicago-food-inspections — PARKED (UNKNOWN)
- `https://data.cityofchicago.org/resource/4ijn-s7e5.json` HTTP 200. 316,703 inspections, 49,179 distinct `license_`.
  Oldest 2010-01-04, newest 2026-10-02; "Updated daily" (metadata). Fields: inspection_id, dba_name, aka_name,
  license_ (Chicago business licence number), facility_type, risk, address, zip, inspection_date, inspection_type, results,
  violations (pipe-delimited free text with inspector comments), lat/lon. Sample 200: violations filled 130/200 (passes
  have none), license_ 200/200.
- Terms: Socrata `licenseId` = SEE_TERMS_OF_USE. The terms page https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html
  returns HTTP 403 to us (also on cityofchicago.org). Not worked around. The dataset description (fetched from
  https://data.cityofchicago.org/api/views/4ijn-s7e5.json) only carries a data-quality disclaimer: "Disclaimer: Attempts have been made to minimize any and all duplicate inspection reports." — no grant.
- Rights: UNKNOWN. Parked. Retry terms from another egress.
- Note: `license_` is a declared pointer to Chicago's Business Licenses dataset (same publisher, same host) — useful
  inside the data type later, but not an independent-publisher join.

## sf-health-inspection-scores — SCREENED (GREEN, stale)
- `https://data.sfgov.org/resource/pyih-qa8i.json` HTTP 200. 53,973 rows, 6,253 distinct `business_id`; 2016-10-04 to
  2019-11-28; no longer updated ("As of 2021, the LIVES standard is no longer being used" per dataset description; newer data lives on a vendor site, not screened).
- Fields: business_id, business_name, address, postal code, phone, lat/lon, inspection_id, inspection_date,
  inspection_score, inspection_type, violation_id, violation_description (free text), risk_category. Sample 200:
  violation_description filled 168/200.
- Terms: Socrata metadata `licenseId` PDDL ("Open Data Commons Public Domain Dedication and License"). Licence text fetched
  at https://opendatacommons.org/licenses/pddl/1.0/: "The Open Data Commons – Public Domain Dedication and Licence is a document intended to allow you to freely share, modify, and use this work for any purpose and without any restrictions."
- Rights: GREEN (express public-domain dedication via PDDL). Freshness 1 (frozen). Use as historical text corpus and the
  free-text proof member.

## austin-food-inspection-scores — SCREENED (AMBER)
- `https://data.austintexas.gov/resource/ecmv-9xxi.json` HTTP 200. 20,504 rows, 6,485 `facility_id`; 2023-10-02 to
  2026-09-10 (rolling 3-year window); scores only (score, process_description, no violation text).
- Terms: Socrata metadata licence "Public Domain" but no terms page could be fetched and quoted (probed
  austintexas.gov/page/open-data-terms-use etc., all 404). AMBER until a terms page is quoted. Not a dataset member
  (no free text, no join).

## dallas-food-inspections — PARKED (UNKNOWN)
- `https://www.dallasopendata.com/resource/dri5-wcct.json` HTTP 200. 78,984 rows, 2016-10-03 to 2024-02-29; sunset
  ("will not be updating any more"). Free text in violation1..N_text (185/200 filled). No licence in metadata, no
  identifier. Parked: no rights statement, no key, stale.

## king-county-food-inspections — PARKED (inaccessible)
- `https://data.kingcounty.gov/resource/f29f-zza5.json` HTTP 403: "You must be logged in to access this resource".
  The related public view (sgr5-u9rw, PUBLIC_DOMAIN) lists businesses only (business_id, name, address, grade) with no
  violations. Brief forbids login; parked.

## uk-fsa-food-hygiene-ratings — SCREENED (AMBER, OGL v3)
- `https://api.ratings.food.gov.uk/` (header `x-api-version: 2`) HTTP 200 for /Authorities and filtered /Establishments;
  an unfiltered /Establishments query returns 403 ("CPU intensive query: please use one of the documented filters"),
  so acquisition must page per local authority (363 authorities) or use the per-authority XML files.
- 614,067 establishments across 363 authorities (England, Wales, Northern Ireland, Scotland); authority files last
  published between 2026-04-23 and 2026-10-02; newest rating date in sample 2026-09-18.
- Identifier: `FHRSID` (stable), `LocalAuthorityBusinessID`. Fields: BusinessName, BusinessType, address, PostCode, geocode,
  RatingValue/RatingKey, RatingDate, scores{Hygiene, Structural, ConfidenceInManagement}, RightToReply (free text, business reply),
  NewRatingPending. No inspector narrative; RightToReply was empty in 200/200 of the sampled Cambridge page (all rated 5), so the free-text
  yield is low and unmeasured elsewhere.
- Terms (fetched https://www.food.gov.uk/terms-and-conditions): "Use of proprietary food hygiene ratings information and services is subject to the terms of the Open Government Licence (OGL)"
  OGL v3 (fetched https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/): "exploit the Information commercially and non-commercially for example, by combining it with other Information, or by including it in your own product or application."
- Rights: AMBER. Conditions: attribute FSA and link OGL; do not present an invalid or inaccurate rating (the terms page
  warns that displaying an inaccurate rating "may constitute a criminal offence"), so refresh ratings and show rating date; exclude FSA logos.

## osm-fhrs-tagged-venues — SCREENED (AMBER, ODbL)
- OpenStreetMap objects carrying `fhrs:id` (the FSA establishment id): taginfo (https://taginfo.openstreetmap.org/api/4/key/stats?key=fhrs:id,
  HTTP 200) reports 194,338 objects (97,477 nodes, 95,731 ways, 1,130 relations). Overpass endpoints reset/timed out from
  this egress, so one small `api.openstreetmap.org/api/0.6/map.json` bbox in Cambridge was pulled (12,291 elements, 86 with fhrs:id).
- Adds geometry, cuisine/opening-hours style tags and a declared pointer to the FSA record. No violation text.
- Terms (fetched https://www.openstreetmap.org/copyright): "You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors."
  and "If you alter or build upon our data, you may distribute the result only under the same license."
- Rights: AMBER. Conditions: ODbL attribution; share-alike applies to a derived database that includes OSM data, so
  keep OSM-derived fields in a separable layer and decide per-channel (bulk export vs API) before shipping.

## Linkage (measured)
- FSA <-> OSM by `fhrs:id` (declared; OSM tag names the FSA record): 40 OSM venues sampled from the Cambridge bbox,
  38 resolved via `GET /Establishments/{FHRSID}` (95%), 2 returned no record (stale ids). On the 38: postcode equal 38/38,
  business name equal after lowercase-alphanumeric normalisation 22/38 (the rest are trade-name vs registered-name variants,
  which is why name equality must never be the link). Rows in `results.json`.
- SF <-> FSA/OSM: no shared jurisdiction; zero links possible. City feeds (NYC, Chicago, SF, Austin) are each one
  jurisdiction's permit universe; the dataset is therefore a per-jurisdiction union keyed on each authority's own id,
  with `fhrs:id` the only cross-publisher key found. Name+address candidate matching to OSM for US cities was not run.
- Within-publisher declared pointers noted but not independent: Chicago `license_` -> Chicago Business Licenses; NYC `bbl`/`bin` -> NYC building data.

## Scores reasoning
- Agent demand 4: safety/violation lookups are a natural agent question. Rights clarity is capped by parked NYC/Chicago.
- Freshness is 4 for FSA/OSM/Austin (days to weeks), 1 for SF/Dallas (frozen).
- Poor existing access 3: city portals expose raw rows, but there is no cross-jurisdiction normalised violation taxonomy.

## Next actions
1. Read NYC Open Data and Chicago terms from a browser-capable egress; if free-public-data presumption applies (ADR-0018) promote both (they hold the live violation text).
2. Check the vendor site that replaced SF LIVES for a feed and terms.
3. Measure a US name+address candidate link to OSM with hand check.

## Candidate key mapping (snippet.yaml)
Headings above use short names; registry keys are prefixed `food-safety-`: `food-safety-uk-fsa-hygiene-ratings`, `food-safety-osm-fhrs-venues`,
`food-safety-sf-lives-inspections`, `food-safety-austin-inspection-scores`, `food-safety-nyc-dohmh-inspections`,
`food-safety-chicago-food-inspections`, `food-safety-dallas-inspections`, `food-safety-king-county-inspections`.
