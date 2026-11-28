# Recalls widening, round 2: consumer-product-recalls-north-america (2026-10-04)

Task: screen at least one new member from a different publisher for the BUILDING dataset, measure linkage to the existing
members, and audit whether the recalls Worker acquires each member's full history and every field the rights allow, with
raw artifacts in R2. Transport Canada and NHTSA were screened on 2026-10-03 and are not repeated.
Scripts (this directory): `uk_collect.py`, `sg_collect.py`, `cpsc_collect.py`, `legacy_resolve.py`, `profeco_probe.py`,
`screen.py` (analysis, writes `results.json`). All fetches keyless with the scout User-Agent, at most about 2 requests a
second. Nothing in the repo outside this directory was edited.

## Headline

1. **Biggest finding is not a new publisher.** 834 CPSC recalls cite a legacy Health Canada URL
   (`healthycanadians.gc.ca/recall-alert-rappel-avis/hc-sc/YYYY/NNNNNr-eng.php`). Every one answered HTTP 200 and 831 of
   834 redirect to a `recalls-rappels.canada.ca/en/alert-recall/<slug>` URL that is a Consumer product safety notice in the
   open-data index we already ingest (99.6%; 0 of the 831 also cite a current URL, so none are already linked). The
   deployed dataset keeps 343 declared links, because the parser files these 834 as `HC-LEGACY` and drops them. Resolving
   them would take declared CPSC-to-Health-Canada links from 343 to about 1,174 (3.4 times), with no new source and no
   rights question. See "Linkage" and "Worker audit".
2. **New member screened, PARKED: Mexico's Red de Alerta Rapida (alertas.gob.mx, PROFECO).** Reachable, structured, and
   CPSC declares links to it, but the gob.mx terms say the portal's materials are for personal, non-commercial use, and
   alertas.gob.mx carries no licence of its own. Parked, not worked around.
3. **UK OPSS and EU Safety Gate** (already SCREENED members of `home-product-recalls-global`) were measured against CPSC and
   Health Canada. No declared citation exists in either direction. Exact check-digit-valid GTIN links UK to CPSC for 2
   notices (both correct). Brand-plus-product matching of Safety Gate to Health Canada is 16/20 correct and to CPSC 12/20.
   They stay members of the global dataset; they do not belong in a North American dataset (scope), so the
   `dataset_edit` adds the legacy-URL join only, and the UK and EU joins are offered for `home-product-recalls-global`.
4. **Worker gaps (no code edited):** CPSC's API answers some list queries with HTTP 200 and an error body, which the
   Worker treats as success; one CPSC recall (IKEA MALM repair program, 15190) is in the SaferProducts bulk export but not
   in the API list the Worker reads; Health Canada's 28,958 non-consumer notices and about 93 consumer-type notices filed
   under other organisation values are structured nowhere (they survive only inside whole-file R2 snapshots); the planned
   Transport Canada and NHTSA members have no acquisition code yet.

## 1. Mexico: Red de Alerta Rapida, alertas.gob.mx (NEW, PARKED, key `mx-red-alerta-rapida-alertas-gob-mx`)

- Reachability: `https://alertas.gob.mx/` HTTP 200; `alertas.php?site=RAR&filtro=PROFECO` 200, 67,380 bytes, 168 alerts on
  the page, newest 2026-09-22, ids up to 1291; `detallealerta.php?site=RAR&alerta=739` 200. `alertas.gob.mx/robots.txt`
  404. `alertas.profeco.gob.mx` (the host first guessed) fails at the proxy (CONNECT 502), `datos.gob.mx` is Akamai 403,
  and `www.gob.mx/profeco` has only press releases ("Comunicado"), not a recall list.
- Publisher and scope: a federal Red de Alerta Rapida run for COFEPRIS, PROFECO and SENASICA; this screen looked at the
  PROFECO consumer-product filter (vehicles, tyres, toys, appliances, electronics).
- Fields on a detail page: Organismo notificador, Fecha, Marca, Modelo, Categoria, Riesgo, Descripcion (free text: units
  sold in Mexico, the US and worldwide, hazard, remedy, importer, country of manufacture), an attached PDF
  (`adicionales/info_1_<id>.pdf`) and a photo. Count of alerts: ids 1 to at least 1291 (not enumerated: the listing page is
  the only index and no archive route was probed because the source is parked).
- Linkage (declared, measured on the full CPSC list): CPSC recalls cite PROFECO in 40 `Inconjunctions[]` URLs (19
  `gob.mx`, 13 `profeco.gob.mx`, 8 `alertas.gob.mx`) and name PROFECO in the text of 25 records. Seven cite an
  `alertas.gob.mx/detallealerta.php?...&alerta=N` or `adicionales/info_1_N.pdf` URL; 6 detail pages resolved, and all 6
  name the same firm; 5 name the identical product (Fitbit Ionic, LG 86-inch TVs, True Manufacturing refrigerators, Cascade
  Designs/MSR pots, Tegu magnetic stackers) and 1 a sibling of it (Mattel's Dots & Spots Puppy Cradle 'n Swing against
  CPSC's Fisher-Price Snuga swings, same recall family, not confirmable): 5/6 hand-checked, 1 not confirmable. The other 33 URLs are
  index pages or `gob.mx/cms/...pdf` alert files. Health Canada's joint-recall text also names PROFECO in 9 notices
  (2022-2025). The parser already tags these URLs `PROFECO` but `product_recall_citation` stores only HC and CPSC.
- Terms (verbatim, fetched 2026-10-04):
  - https://www.gob.mx/terminos: "Se autoriza al Usuario a visualizar y descargar los materiales contenidos en el sitio
    solamente para su uso personal y no para un uso comercial."
  - same page: "La información del portal gob.mx es pública a menos que se indique lo contrario, en cuyo caso antes de
    reproducirla, deberás observar si tiene derechos reservados y respetarlos en términos de las normas relativas a derechos
    de autor y propiedad industrial."
  - `alertas.gob.mx` footer: "2012 Derechos Reservados - Gobierno Federal" and a privacy-policy link; `politicas.php`
    returned 404 and there is no licence page.
- Rights: **RED/UNKNOWN, PARKED.** The only readable terms restrict use to personal and non-commercial, and the site
  reserves rights. ADR-0018's presumption does not apply where terms expressly forbid commercial reuse. Not worked around.
  Unlock path (routine, not an owner decision): find a PROFECO or Secretaria de Economia open-data licence for the RAR
  dataset (Libre Uso MX) or a written confirmation; until then the parser keeps recording the cited URL only as a link.
- Scores: demand 3, rights 2, acquisition 4, structuring 4, freshness 5, onboarding 3, poor access 4.

## 2. UK OPSS product safety alerts, reports and recalls (existing key `uk-opss-product-safety-alerts`, measured)

- Reachability: GOV.UK search API `https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall` 200,
  total 3,746; each notice via `https://www.gov.uk/api/content/<path>` 200. All 3,746 fetched.
- Counts and fields: 1,570 product recalls, 2,167 product safety reports, 9 alerts; 2021-01-08 to 2026-10-02 (newest two
  days old). PSD notification number in 3,581 titles (for example `2609-0229`); a Barcode/GTIN/EAN/UPC table row in 876
  notices, a check-digit-valid GTIN anywhere in the body in 672; a Model row in 1,455. Metadata fields: product_alert_type,
  product_category, product_measure_type, product_recall_alert_date, product_risk_level. Free text: summary, hazard,
  corrective action, product information table.
- Terms (verbatim, re-fetched 2026-10-04): https://www.gov.uk/help/terms-conditions "Most content on GOV.UK is subject to
  Crown copyright protection and is published under the Open Government Licence ( OGL ), which also sets out which content
  is exempt."; https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/ "exploit the Information
  commercially and non-commercially for example, by combining it with other Information, or by including it in your own
  product or application."
- Rights: AMBER (OGL v3 attribution; keep the existing conditions: no product-image PDFs).
- Citations to our members: 0 notices cite CPSC, Health Canada, PROFECO or a Safety Gate case number (regex scan of all
  3,746 bodies; 1 mentions Safety Gate and 1 the ACCC, neither with an identifier). Zero declared citations.

## 3. EU Safety Gate weekly reports (existing key `eu-safety-gate-alerts`, measured)

- Reachability: list `https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en` 200 (470,976 bytes);
  newest 156 weekly reports fetched (the detail URL must keep its `search=WEB_REPORT|:|<id>,` parameter or the server returns
  a JavaScript shell with 732 bytes).
- Counts: 12,539 notifications, 2023-09-22 to 2026-10-02 (about 80 a week). Barcode field filled in 7,841, valid GTIN in
  6,968, type/model number in 8,136, `URLrecall` (company recall page) in 1,426 (top hosts: rappel.conso.gouv.fr 423, bmw.de
  65, m.shein.com 45). Other fields: caseNumber, category, brand, name, batchNumber, riskType, danger, measures, countries.
- Terms (verbatim, re-fetched 2026-10-04): https://commission.europa.eu/legal-notice_en "Unless otherwise indicated (e.g. in
  individual copyright notices), content owned by the EU on this website is licensed under the Creative Commons Attribution
  4.0 International (CC BY 4.0) licence." The weekly XML distribution is also declared CC0 in the data.europa.eu metadata
  (recorded in the existing candidate). Rights AMBER (credit, no pictures).
- Citations to our members: 0 notifications cite CPSC, Health Canada or PROFECO (in danger, measures, description or
  URLrecall). CPSC names Safety Gate or RAPEX in 14 records and PROFECO in 25, with no case number.

## 4. ACCC product recalls (existing key `au-accc-product-recalls`, re-checked, not extended)

RSS `https://www.productsafety.gov.au/rss/feed.xml/psa_recall` 200, still only the newest 100 (2026-05-15 to 2026-09-29;
7 with a valid GTIN); no recall names CPSC, Health Canada or Safety Gate. Title-token matches 13/100 to Health Canada and
23/100 to CPSC were not hand-checked. `data.gov.au` search for ACCC product recalls returned only unrelated NSW reports.
No complete listing route, so it is not a member candidate here.

## 5. Other sources tried and not usable

- USCG recreational boating recalls: `dco.uscg.mil` Akamai 403 and `uscgboating.org/recalls/` 404. Not measured; park.
- NZ MBIE/Consumer Protection: `consumerprotection.govt.nz/recalls` 404; `www.recalls.govt.nz` serves the Product Safety
  NZ listing (HTTP 200, 217,806 bytes); already a SCREENED member of the global dataset, not re-measured.
- Health Canada other categories: cosmetics are already in (Consumer product safety, category "Beauty and personal care",
  170 notices). Medical devices (8,666), drugs and health products (1,934), marketed health products (1,161),
  Communications and Public Affairs Branch (1,814), cannabis (99), HC (62), Transport Canada (9,904) and CFIA food (5,318) are
  the same open-data file under other organisation values: same publisher and same OGL licence, so they widen Health
  Canada's coverage rather than add a publisher (see candidate `ca-recalls-food-health-open-data`). Medical-device
  and drug recalls are a different entity (the FDA recall dataset is its US peer) and are out of scope for a
  consumer-product dataset; 93 notices with consumer-type categories sit under the Communications branch and cannabis
  organisations (21 Household items, 9 Chemicals, 5 Electronics, 5 Beauty and personal care, 3 Toys and games, 4 consumer
  products under Controlled substances; about 7 and 4 of these are drug or cannabis products) and are missed by the
  Worker's strict organisation filter.
- SaferProducts.gov incident reports (CPSC publisher): `SPDB.zip` 200, 39.7 MB (fetched twice, under the 50 MB limit but
  not small; 110.7 MB unzipped). `IncidentReports.csv` has exactly 70,000 reports (Report Date 2011-03-11 to 2026-09-16,
  published to 2026-10-03), 15,857 with a UPC and 59,525 with a model; a round 70,000 may be a cap (unverified). It carries
  narratives and victim and location data (exclusions already recorded in `appliance-saferproducts-incidents`). No
  recall-number column, so incidents link to recalls only by UPC or model. Not re-screened as a member: it is an incident
  entity from the same publisher as CPSC.
- CPSC cites that are not Health Canada, Transport Canada or PROFECO: 4 `rsams.prod.cloud.openplus.ca`, 1 `cpsc.gov`, 1
  `ca.aiper.com` (a manufacturer page).

## Linkage (all measured 2026-10-04 on full snapshots: CPSC 10,027 recalls via the Recall API, Health Canada 5,210
consumer notices, UK 3,746, EU 12,539 notifications 2023-09 on)

| Join | Mode | Result |
| --- | --- | --- |
| CPSC `Inconjunctions[].URL` (legacy `healthycanadians.gc.ca/.../NNNNNr-eng.php`) to Health Canada notice, by following the redirect to `recalls-rappels.canada.ca` and matching the URL in the index | declared | 831/834 CPSC recalls resolve to an index notice (99.6%), 834/834 answered 200. Unresolved: 10029 (stays on legacy host), 13114 (resolves to a drug notice outside Consumer product safety), 15091 (stays on legacy host). None of the 831 also cite a current URL, so all are additional to the 342/371 already linked. 20-URL pre-check: 19/20 resolved. |
| CPSC cites alertas.gob.mx alert URL to the PROFECO alert | declared | 6/6 detail pages resolve and match the firm, 5/6 the identical product (7 cite an alertas.gob.mx URL, one is a PDF). Source is parked. |
| UK barcode to CPSC `ProductUPCs`/description GTIN, check digit valid, within 365 days | declared | 2 UK notices link to 2 CPSC recalls (11 GTIN pairs), 2/2 correct: Boxine tonies R-blocks (UK 2203-0518, CPSC 22736) and Make Believe Ideas Rainbow Road board books (UK 2309-0140, CPSC 23292). CPSC has a GTIN anywhere in 646 of 10,027 recalls (458 from `ProductUPCs`), so the ceiling is small. |
| UK to Health Canada GTIN | declared | 0: the Health Canada index fields contain no GTIN (0 of 5,210 in Title, Product or Issue). |
| EU Safety Gate GTIN to CPSC or Health Canada | declared | 0 pairs (6,968 EU notifications with a valid GTIN against 646 CPSC and 0 Health Canada GTIN carriers). |
| ACCC GTIN to CPSC or Health Canada | declared | 0 (7 ACCC notices with a GTIN). |
| UK title tokens (>=2 shared distinctive tokens, 90 days) to Health Canada | candidate | 231/3,746 matched; hand-checked 9/20 correct, 2 not confirmable from the fields. |
| UK title tokens to CPSC | candidate | 318/3,746 matched; 7/20 correct. |
| EU brand field as a whole word in the title plus one shared product token, 120 days, to Health Canada | candidate | 32/12,539 EU notifications matched; 16/20 correct, 1 not confirmable, 3 wrong (Petzl different models, Harley/Scorpion helmets, a generic "Fast" brand). |
| EU brand plus product token to CPSC | candidate | 43/12,539 matched; 12/20 correct, 4 not confirmable (Can-Am ATV, Rowenta, Acer, Mammut), 4 wrong (generic brand words, different Black Diamond product). |
| EU generic title tokens (no brand check) | rejected | to Health Canada 0/20 correct, to CPSC 3/20: generic nouns match unrelated products. |

Honest limits: the new declared links are small outside the Health Canada legacy URLs. Measured counts are floors (EU
history before 2023-09 and the Health Canada GTIN gap were not covered). The hand checks are one reviewer's reading of titles
and dates, listed per sample in `results.json` (`hand_verdicts`, c correct, i different, u not confirmable).

## Worker audit: does the recalls Worker acquire full history and every permitted field with raw in R2?

Source read: `apps/recalls-worker/src/product-sync.ts`, `product-store.ts`, `index.ts` (cron), `wrangler.toml`,
`packages/product-recall-structuring/src/{cpsc,hc,links,types}.ts`. Runtime: `https://api.data.aroqon.com/v1/product-recalls/stats`
on 2026-10-04 reports CPSC 10,027 notices (latest 2026-09-24), HC 5,210 (latest 2026-10-01), 343 declared links, both agencies'
`last_successful_sync` 2026-10-04T12:17Z. Cron `17 */6 * * *`; the full CPSC pass runs on the first run of each UTC day.

### CPSC (deployed member)

- History: complete. Windows 1900-1989, 1990-1999 and one per year, daily; I collected the same list independently and got
  10,027 recalls (1973-06-08 to 2026-09-24), identical to the Worker's count.
- Raw in R2: yes, three layers. The whole response bytes under `product-recalls/source/cpsc/sha256-<hash>.json`, then per
  changed record NDJSON bundles under `product-recalls/cpsc/<date>/run-<id>-<offset>.ndjson` with `raw_ref` byte ranges.
  The stored record is the full API JSON, so `Images`, `ConsumerContact` and `SoldAtLabel` are preserved in R2 even though
  they are not served (rule 9 and personal-data exclusion; `include=raw` redacts `ConsumerContact` and `Images`).
- Fields the parser reads: Title, Description, URL, Products (Name, Description, Model, Type, NumberOfUnits), ProductUPCs,
  Hazards, Remedies, RemedyOptions, Injuries, Manufacturers, Importers, Distributors, Retailers, ManufacturerCountries,
  Inconjunctions. Not read: Images, ConsumerContact, SoldAtLabel (all intentional).
- **Gap 1 (error body treated as success).** The Recall API answers some list queries with HTTP 200 and the body
  `[{"RecallID":0,"RecallNumber":null,...,"Title":"Error retrieving Recalls: The underlying provider failed on Open."...}]`
  (442 bytes, about 15 s). On 2026-10-04 my windowed pull needed 29 failed attempts and splitting before it completed: the
  windows 1990-1999, 2000, 2001, 2002, 2005, 2006, 2009 and 2026 failed three times each as year windows. `fetchSource`
  retries only on 429 and 5xx, so it archives the error body to R2 as a source artifact, `isUsableCpscRecord` drops the
  record, and the run is recorded `SUCCEEDED` with `fetched` 1. Effects: (a) in the incremental 30-day call,
  `last_successful_sync` can advance on a failed read; (b) in the daily full pass, one failed year window silently skips that
  year's refresh (the largest window is 459 recalls, the floor is `MIN_FULL_CPSC` 9,000 of 10,027, so a single window never
  trips it). Nothing is deleted, so this is stale-update risk, not data loss. Fix: treat a first record with
  `RecallID === 0` and a `Title` starting "Error retrieving" as a failed fetch, retry, and split the window.
- **Gap 2 (one recall absent from the API list).** The SaferProducts bulk export `Recalls.csv` has 10,029 rows (a stray header
  row, plus repair number `15190`, the 2015 IKEA MALM chest repair program, 27 million units) while the API list has 10,027.
  The Worker does not read the bulk file, so 15190 is missing. Fix: add the export as a reconciliation source or fetch
  `RecallNumber=15190` once.
- **Gap 3 (citations dropped).** `citations()` writes only `HC` and `CPSC` agencies to `product_recall_citation`;
  `TC` (82 CPSC recalls), `PROFECO` (40 URLs), `HC-LEGACY` (836 URLs, 834 recalls) and `ACCC` stay in the structured JSON
  `cross_references` only. Unlinked HC-LEGACY URLs are the 831 resolvable declared links above.
- Deleted or withdrawn notices are never detected (rows are only touched, never tombstoned); fine today, relevant for freshness claims.

### Health Canada (deployed member)

- History: complete for the open-data index: the full file (34,168 records, last updated 1995-01-01 to 2026-10-02) is fetched
  every run and archived whole in R2 (`product-recalls/source/hc/sha256-<hash>.json`, 15.7 MB, content-addressed). The live
  count of 5,210 equals the index's Consumer product safety count, archived ones included (3,094 flagged `Archived`).
- Raw in R2: whole file every run plus per-record NDJSON for new or changed in-scope notices. All 11 index fields are kept.
  `What you should do` (contact text; OGL excludes personal information) is not served and is redacted from `include=raw`.
- Fields available in the index and used: Title, URL, Product, Issue, Category, Recall class, Last updated, Archived.
  Fields that exist only on the canada.ca notice pages (publication date, units sold, affected product lists, images) are not
  in the open-data resource and are outside the rights record, which allows the open-data resource only. `published_on` for
  Health Canada comes from `Last updated`, not a publication date.
- **Gap 4 (non-consumer organisations structured nowhere).** The filter is `Organization === "Consumer product safety"`; the
  other 28,958 index records (Transport Canada 9,904, Medical devices 8,666, CFIA 5,318, Communications and Public Affairs
  Branch 1,814, Drugs and health products 1,934, Marketed health products 1,161, cannabis 99, HC 62) are preserved only
  inside the whole-file snapshots. The standing direction is to capture every permitted field; they are same-licence data.
  Transport Canada's 9,904 notices in the index are also covered, more completely (17,978 recalls), by the VRDB CSV.
- **Gap 5 (consumer-type notices under other organisation values)**, about 93 by category as listed above, of which perhaps 60
  are genuine consumer products. Fix: filter on the category set rather than only the organisation, or ingest all
  organisations with an `organisation` facet.
- Floor `MIN_FULL_HC_CONSUMER` 4,500 against 5,210 is fine; the whole 15.7 MB body is held and parsed in one isolate (works
  today; growth headroom is the Worker memory limit).

### Planned members (Transport Canada VRDB, NHTSA)

Not in Worker code: `ProductAgency` is `'CPSC' | 'HC'`, `Agency` likewise, and `scheduledProductSync` fetches two endpoints.
NHTSA's source declaration (`verticals/vehicles/sources/nhtsa-recalls.yaml`) is still `UNDER_REVIEW`, rights `UNREVIEWED`,
not in `acquisition.yaml` (fail-closed). Both need a streaming ingest for large files (207 MB CSV; two NHTSA zips of 22 MB,
311 MB uncompressed) which the current load-everything-into-the-isolate pattern cannot do; `wrangler.toml` sets `cpu_ms` 300000
but memory is fixed. So full history for these two is a build task, not a gap in running code.

## Scope and merge advice

- Dataset stage gate (unchanged from 10-03): `dataset_edit` for a BUILDING dataset may not add a member that is not
  BUILDING; the new join in `snippet.yaml` is between two members that already are, so it can be applied now. The
  UK/EU/PROFECO joins are given separately and are not for this dataset (PROFECO is parked, UK and EU belong to the global
  dataset).
- Recommended build work, ordered by value: (1) resolve legacy Health Canada URLs at ingest (one HEAD request per cited
  legacy URL, cached forever, 834 requests once) and store them as declared `HC` links: +831 links for 0 new sources;
  (2) fix the CPSC error-body handling (Gap 1); (3) widen the Health Canada filter or ingest the other organisations;
  (4) persist `TC`, `PROFECO` and `ACCC` citations in `product_recall_citation`.
- Caveat on resolving legacy URLs: the redirect is served by `healthycanadians.gc.ca`, a host whose old terms page forbids
  commercial redistribution of its page text (existing PARKED candidate `ca-healthycanadians-recall-api`). Following a
  redirect to learn the target URL copies no page content; record the target URL only and keep the conclusion in the ADR-0013
  record.
