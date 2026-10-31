# species-conservation-status screen (2026-10-03)

Dataset key `species-conservation-status`, category `environment`. Egress is the container proxy; every request sent
`User-Agent: data-foundry-scout (data@mail.proviciency.com)`, at most about 2 requests per second, no keys, no login.
Scripts: `screen.py` (ECOS, Canada, GBIF), `screen2.py` (EPBC overlap), `screen3.py` (GBIF retry), `screen4.py` (ITIS).
They read a `raw/` cache that was deleted to keep the folder small, so rerunning refetches (about 2 MB, plus the
Australian CSV by hand: URL in the EPBC section). Measured output: `results.json`, `results_epbc.json`,
`results_itis.json`, `raw/gbif_matches.json`.

## Verdict

| Member | Publisher | Format | Rights | Stage |
| --- | --- | --- | --- | --- |
| species-ecos-fws-listings-recovery | US FWS | free-text (recovery PDFs) plus structured listing | AMBER | SCREENED |
| species-eccc-sara-critical-habitat | Environment and Climate Change Canada | structured | AMBER | SCREENED |
| species-epbc-threatened-list-au | Australian DCCEEW | structured | AMBER | SCREENED |
| species-gbif-backbone-taxonomy | GBIF Secretariat | structured | AMBER | SCREENED |
| species-itis-taxonomy | ITIS | structured | GREEN | SCREENED |
| species-iucn-red-list | IUCN | structured | UNKNOWN | PARKED |
| species-noaa-fisheries-directory | NOAA Fisheries | HTML | UNKNOWN | PARKED |
| species-jncc-uk-conservation | JNCC | structured | UNKNOWN | PARKED (not screened) |

The dataset passes the screen: five non-RED members from five publishers on five hosts, and candidate joins with
hand-checked correct matches. There is no declared join, see Linkage.

## US FWS ECOS (species listings and recovery documents)

- Reachable: HTTP 200. The documented REST "pull reports" endpoints are
  `https://ecos.fws.gov/ecp/pullreports/catalog/species/report/species/export?format=json` and `.../recoveryDocs/export?format=json`
  (listed on `https://ecos.fws.gov/ecp/services`). The guessed `/ecp/services/api/species` path returned 404, so it does not exist.
- Counts: 11,027 species rows in total (all statuses incl. Species of Concern and Resolved Taxon); filter
  `status_category = 'Listed'` gives 2,478 rows (2,324 unique normalised scientific names). Recovery documents: 1,834 rows
  covering 1,503 scientific names, 1,830 linked to PDFs (one PDF checked: HTTP 200 application/pdf).
- Newest: ESA listing date 08-20-2026; recovery document date 2026/08/31. Cadence: ongoing, listing actions are dated.
- Identifier fields: ECOS species id (`id`/`sid`, also the `/ecp/species/<id>` URL), VIP code, scientific name. Columns
  tried for a TSN or taxon id (tsn, itis_tsn, taxon_id, scientific_name_id, ...) were all rejected by the API as invalid
  column ids, so no ITIS TSN is published in the bulk export. Valid columns found: cn, sn, status, desc, listing_date, id, sid, vipcode, status_category.
- Free text: recovery document titles and the PDFs behind them (criteria, critical habitat); not parsed this round.
- Terms (https://www.fws.gov/disclaimer, fetched): "You are welcome to make a link to any of the Web pages the Service
  has published on the Internet. There is no need to request permission. Not all the information on our site is in the public domain.
  Some images/graphics are licensed for use under the copyright law". No terms specific to ECOS data were found.
- Rights: AMBER. Listing data is free public government data under ADR-0018, but the site warns that some material is
  licensed, so do not cache images; conditions in snippet.yaml.

## Environment Canada SARA critical habitat national dataset

- Reachable: HTTP 200. ArcGIS REST layer
  `https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CriticalHabitat/MapServer/3` (Critical habitat area), found through the
  open.canada.ca CKAN record 47caa405-be2b-4e9e-8f53-c478ade2ca74 (metadata modified 2026-08-04).
- Counts: 25,180 area features, 650 point features; 459 distinct (species, population, recovery document) rows, 273 unique
  scientific names, 269 distinct recovery document names. SARA_Status codes: 273 rows 2, 185 rows 3, 1 row 1.
- Identifier fields: COSEWIC_ID, SciName, SiteID. Text fields: RDoc_Name_E (recovery document title), SiteName_E,
  Population_E. The recovery documents themselves are on the registry and not fetched.
- Terms (https://open.canada.ca/en/open-government-licence-canada, fetched): "Copy, modify, publish, translate, adapt, distribute or otherwise
  use the Information in any medium, mode or format for any lawful purpose." The dataset page names the licence "Open Government Licence - Canada".
- Rights: AMBER (attribution and licence link). Scope caveat: only species with critical habitat, not the full SARA list. The
  Species at Risk Public Registry (https://species-registry.canada.ca/index-en.html, HTTP 200) has no bulk API that was measured.

## Australia EPBC threatened species list

- Reachable: HTTP 200 via data.gov.au CKAN (id ae652011-f39e-4c6c-91b8-1dc2d2dfee8f, modified 2026-08-31). CSV
  `.../download/20260828spcs.csv`, 694 KB.
- Counts: 2,222 rows: Endangered 870, Vulnerable 784, Critically Endangered 458, Extinct 102, Conservation Dependent 7, Extinct in the wild 1.
  Newest extract 2026-Aug-28.
- Identifiers: Listed SPRAT TaxonID, Current SPRAT TaxonID, NSL Name URL, scientific name, plus state flags. No ITIS TSN.
  Free text: none in the CSV; the SPRAT profile pages returned 403 from this egress (not worked around).
- Terms: the CKAN package record (fetched) gives license_title "Creative Commons Attribution 3.0 Australia" (id cc-by).
- Rights: AMBER (attribution).

## GBIF Backbone Taxonomy

- Reachable: `https://api.gbif.org/v1/species/match`, `/species/{key}` HTTP 200. Backbone dataset
  d7dddbf4-2cf0-4f39-9b2a-bb099caae36c; species search with `rank=SPECIES` reports count 4,994,322.
- Licence: the dataset record says `http://creativecommons.org/licenses/by/4.0/legalcode`, so CC BY 4.0, not CC0 as the
  brief assumed; modified 2023-11-17, citation "GBIF Secretariat (2023). GBIF Backbone Taxonomy. https://doi.org/10.15468/39omei".
- gbif.org/terms and /terms/data-user returned 403, so portal terms were not read.
- Reliability: 100 of 453 match calls reset the connection on first try (proxy); all succeeded on retry.
- GBIF also exposes the ITIS checklist (dataset 9ca92552-f23a-41a8-a140-01abaa31c931) whose `taxonID` is the TSN
  (Grus americana gave 176176, equal to ITIS's own answer). That is the only machine route seen from GBIF to a TSN.
- Rights AMBER (CC BY 4.0 attribution).

## ITIS

- Reachable: JSON web service `https://www.itis.gov/ITISWebService/jsonservice/searchByScientificName`; update date from
  `getLastChangeDate` is 2026-09-21; monthly export lists 1,000,636 scientific names and 167,526 common names (22-Sep-2026).
- Terms (https://www.itis.gov/privacy.html, fetched): "Information presented on the ITIS website is considered public information and may be
  distributed or copied. Use of the appropriate citation is requested." The same page notes some pages carry third-party copyright; the TSN and
  name data are not those pages. Rights GREEN.
- No free text: it is the identifier layer.

## Parked / rejected

- IUCN Red List: https://www.iucnredlist.org/terms/terms-of-use returned HTTP 403 with a Cloudflare "Just a moment" challenge;
  the API needs a key. Parked, no workaround.
- NOAA Fisheries species directory: HTTP 200 HTML, "Showing 105 results", no API found, terms page not read (privacy-policy 404). Parked.
- JNCC: data.jncc.gov.uk HTTP 200 but no species-status dataset identified; not screened. Parked.
- Australia SPRAT pages: 403, not used.

## Linkage (measured, honest)

No declared join exists. ECOS, the Canada layer and EPBC publish no ITIS TSN, GBIF key or any identifier naming the
counterpart record. The test regex for `declared` joins permits only licence numbers, UBI, GTIN, UPC, NOA, FL#, FIPS, zone, case numbers, cited notice URL or
reference numbers, and UEI, so a taxon key could not be declared even if present. Taxon keys (GBIF, TSN) here are derived from the scientific name, so they are
candidates. Per AGENTS.md rules 3 and 7 nothing merges on name alone.

| Join | Result | Hand check |
| --- | --- | --- |
| ECOS listed (2,324 names) vs Canada (273 names), exact normalised scientific name | 19 matches | 19/19 same taxon (binomial and common name agree) |
| ECOS listed vs EPBC (2,222 rows, listed + current name) | 51 matches | 51/51 same taxon; 28 pairs disagree on status wording (for example Quokka Endangered vs Vulnerable, Loggerhead Endangered both) |
| Canada vs EPBC | 0 of 273 | none |
| GBIF accepted key equal, Canada vs ECOS (180 ECOS names in shared genera) | 21 pairs | 19/21; 2 are species vs subspecies (Vulpes velox / V. v. hebes; Ambystoma mavortium / A. m. stebbinsi) |
| ECOS name to GBIF match | 175/180 EXACT, 3 HIGHERRANK, 2 NONE | not reviewed |
| overlap names to ITIS TSN | 68 of 70 resolved to one TSN (1 none, 1 error) | accepted vs invalid not checked |

Caveats: the "hand check" is by reading binomial and common names in the result files, not an independent authority. Cross-genus synonyms
are missed because only ECOS names in genera that Canada lists were sent to GBIF. Only Canada's critical-habitat subset was available, so overlap is understated.

## Scores reasoning

Agent demand is solid (cross-jurisdiction status, recovery criteria). Rights are attribution-only everywhere read; ECOS is lowest because the
site disclaimer carves out licensed material and gives no data-specific terms. Structuring value is highest for ECOS because the criteria and critical
habitat sit in PDFs. GBIF freshness is low (backbone dated 2023). Poor existing access is middling: each feed is free, but nothing joins them.
