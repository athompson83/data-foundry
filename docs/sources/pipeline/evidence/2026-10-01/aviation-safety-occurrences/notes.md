# aviation-safety-occurrences: screening notes (2026-10-01)

Entity: an aircraft accident/incident investigation record (with narrative), linked to the airframe by registration
(tail number) and to the operator. Category `transport-safety`. Scripts: `screen.py` (all numbers below);
raw output: `results.json`. Egress is this container; header `User-Agent: data-foundry-scout (data@mail.proviciency.com)`.

Verdict: PASSES screening. Three non-RED members from three different publishers and hosts (NTSB, UK AAIB,
Transport Canada), two free-text (NTSB narratives, AAIB report bodies) and one structured (CADORS), with a measured
registration link between NTSB and AAIB. FAA registry, NASA ASRS, BEA and TSB Canada are not members (see PARKED).

Disclosure: while probing I ran a plain GET on NTSB `avall.zip` (96.6 MB, the whole database) and it downloaded
completely before I noticed its size. That is over the 50 MB cap in the brief. I deleted it unread and did not use it;
every NTSB number below comes from 37 small 2026 weekly update files (21.6 MB in total). Consequence: the NTSB totals
are for the 2026 update files only, not the full history.

## NTSB aviation accident database (member, AMBER)

- Reachable: `https://data.ntsb.gov/avdata` HTTP 200 lists downloadable MDB files; update files download as HTTP 200
  (`DownloadFile?fileID=C:\avdata\up01OCT.zip`, 648 KB). The CAROL web query UI exists, but the documented route is the
  `GetCasesByDateRangeV2` API on the developer portal, which needs registration, so it was not used.
- Notice on the page: "On April 5, 2027, NTSB will transition the downloadable aviation dataset to the Enterprise API
  platform". The MDB download therefore has a dated end of life. Acquisition must plan for the API (keyed, so it needs
  owner review of key terms) before that date.
- Cadence: `avall.zip` rebuilt 2026-10-01 07:36; weekly update files `up01/08/15/22<MON>.zip`. 37 files from 2026
  held 2,557 distinct events, 2,633 aircraft rows (2,631 with a registration), 1,512 with narratives. Newest event
  2026-09-30. 13 rows carry impossible future event dates (a data-quality fact, handled in normalization).
  Update files include revised older events (oldest event date 2001), so they are deltas, not a clean window.
- Identifiers: `ev_id`, `ntsb_no` (e.g. `CEN26LA137`), `regis_no`, `acft_serial_no`, `oper_cert_num`, make/model.
- Free text: `narratives.narr_accp`, `narr_accf`, `narr_cause`, `narr_inc` (e.g. 2,181 characters for one PA-12
  accident). Operator name `oper_name` present on 1,172 of 2,633 aircraft rows.
- Foreign events: 831 of 2,633 aircraft rows have a non-US event country, because NTSB acts as accredited
  representative (`...WA...` case numbers). This is what makes the link to AAIB possible.
- Terms (https://www.ntsb.gov/about/Pages/Website-Policies.aspx), verbatim:
  - "Content appearing on NTSB Web pages, in reports, recommendation, and public dockets, unless otherwise noted, was prepared by employees of the United States Government as part of their official duties and, therefore, is not subject to copyright."
  - "This material may be freely copied and, at your discretion, credited to the NTSB with a "Courtesy: National Transportation Safety Board" notation."
- Verdict AMBER (nearly GREEN: public domain by the agency's own statement). Conditions: personal-data exclusion
  (the MDB carries `owner_acft`, `owner_street`, `owner_city`, `oper_individual_name` and the whole Flight_Crew
  table; do not publish owner or crew personal data, keep raw in R2 only); the policy excepts copyrighted third-party
  text and images; accuracy request ("accurate and complete"); the MDB source ends 2027-04-05.
- Score reasoning: demand 4 (agents ask for incident history by tail number); rights 4; acquisition 3 (Access MDB,
  needs mdbtools, API migration pending); structuring 5 (narratives to causes, phase of flight, damage, operator);
  freshness 5 (weekly); onboarding 3 (MDB parse is new); poor access 3 (CAROL UI is usable by humans, weak for agents).

## UK AAIB investigation reports (member, AMBER)

- Reachable: GOV.UK search API `https://www.gov.uk/api/search.json?filter_format=aaib_report` HTTP 200 and content API
  `https://www.gov.uk/api/content/aaib-reports/<slug>` HTTP 200, no key.
- Count: 11,356 `aaib_report` documents (all fetched, metadata only), 11,301 with a `registration` field; 8,856
  distinct registrations of which 1,163 are non-`G-` (foreign aircraft in UK occurrences) and 360 are US N-numbers.
  Oldest `date_of_occurrence` 1958-02-06. Newest publication 2026-10-01 09:00; 5 reports published since 2026-09-01.
  Cadence is modest (about weekly batches) but current.
- Identifiers: `registration`, `date_of_occurrence`, `aircraft_type`, `location`, `report_type`,
  `aircraft_category`, `link` (stable slug).
- Free text: content API `details.body` (HTML summary, 452 to 2,825 characters across the first 20) plus a PDF
  attachment with the full report (19 of the first 20 have two PDFs, one has one). Full report text lives in the PDFs.
  All 20 sampled reports fetched.
- Terms (https://www.gov.uk/help/terms-conditions), verbatim: "Most content on GOV.UK is subject to Crown copyright protection and is published under the Open Government Licence ( OGL ), which also sets out which content is exempt."
  Not retrieved verbatim here: the text of OGL v3 itself (the Canadian licence below is the one fetched).
- Verdict AMBER: OGL v3 allows commercial use with attribution; exemptions for personal data, third-party rights and
  logos/crests. Conditions: attribution statement "Contains public sector information licensed under the Open
  Government Licence v3.0"; exclude personal data and any third-party images in the PDFs; no endorsement claim.
- Score reasoning: demand 4; rights 4; acquisition 5 (documented JSON API); structuring 4 (HTML summary/PDF to
  cause, phase, injuries); freshness 3; onboarding 4 (same host/licence family as an existing candidate, gov.uk);
  poor access 3.

## Transport Canada CADORS (member, AMBER)

- Reachable: open.canada.ca package `a348c1d1-2392-4595-b5e2-c6a244a7e87f` (frequency P1D). Five CSVs at
  `https://opendatatc.tc.canada.ca/CADORS_*.csv`, HTTP 200, `Accept-Ranges: bytes`, last modified 2026-10-01 09:08.
  Only Range samples were pulled (6 MB each of the 91 MB aircraft and 98 MB occurrence files): 22,036 aircraft rows
  and 24,411 occurrence rows sampled. Estimated totals from average row size (an estimate, not a count): about
  334,000 aircraft rows and 400,000 occurrences. Sample dates 1970-11-15 to 2026-07-21; rows are not sorted by date.
- Identifiers: `cadorsnumber`, `tsboccurrencenumber` (2,361 of 24,411 sampled occurrences, links to the TSB),
  `aircraftregistration` (Canadian, 9,149 sampled rows), `foreignaircraftregistration` (1,207 sampled rows, includes
  N-numbers), make, model, `operator`, `owner`.
- Free text: none found. The five published CSVs carry controlled vocabularies (event names, occurrence category) and
  no narrative column; narratives are not in the open data. So CADORS is the structured member.
- Terms (https://open.canada.ca/en/open-government-licence-canada), verbatim: "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below." and "This licence does not grant you any right to use: Personal Information; third party rights the Information Provider is not authorized to license;"
- Verdict AMBER: attribution "Contains information licensed under the Open Government Licence – Canada";
  exclude `owner` (may name individuals) and any personal information; CADORS data are initial, unverified reports.
- Score reasoning: demand 3; rights 4; acquisition 3 (large CSVs, no API, Range requests work); structuring 3
  (already coded, adds registration normalization and taxonomy mapping); freshness 5 (daily); onboarding 3;
  poor access 3.

## Linkage (aircraft identity by exact registration; operator by name is only a candidate)

Registration is normalised (upper case, punctuation removed). Registration names the airframe, not the event, so the
event link also needs the occurrence date within 3 days.

| Pair | Measured | Hand check |
| --- | --- | --- |
| NTSB (2026 update files, 2,602 distinct registrations) x AAIB (8,856 distinct) | 21 normalized registrations in both, of which 1 is a false match (see below) and 20 are real airframes; 11 distinct registrations (15 report pairs) also match on date within 3 days | 11 of 11 same occurrence: same registration, make/model consistent, dates equal or within 1 day. Examples: G-DHLS Boeing 767 2025-10-09 (`DCA26WA011`), N4698W Rockwell 112 2024-12-23 (`GAA25WA049`), EI-ICU S-92 2023-02-05, G-OATW A321 (NTSB 2023-10-05, AAIB 2023-10-04) |
| NTSB x CADORS (6 MB Range sample) | 6 registrations in both (G-VDIA, HB-JMF, N250NN, N27290, N3013M, N903AR) | 6 of 6 same airframe (make/model agree); none is the same occurrence, dates differ by months or years |
| AAIB x CADORS (6 MB Range sample) | 30 registrations in both | 25 checked: 22 same airframe, 1 contradicted (ET-AOP: AAIB Boeing 787-8, CADORS 737-800), 2 undecidable (AAIB title lists several aircraft). Aircraft-level only, not same occurrence |

The one false NTSB-AAIB match: a registration of `N` produced by normalizing "(UAS registration n/a)" in an AAIB title
against an NTSB placeholder. It was excluded and shows that the matcher must reject placeholder tokens
(`N`, `unknown`, `none`, `n/a`) and validate against the registration grammar of each state of registry.
The 20 versus 11 gap is the same airframe in a different occurrence (an aircraft appears in several records),
which a registration-only link would wrongly merge into one event.

Join-mode judgement: registration is an identifier that names the counterpart airframe, so it is `declared` at the
aircraft level. The test regex in `tooling/test/source-pipeline.test.ts` lists identifiers allowed to be `declared` and does not
yet include "registration number"; to stay valid with the unchanged test, the snippet records the event-level join as
`candidate` with the hand check. The orchestrator may add `registration number` to that regex and set the aircraft-level
join to `declared`.
Operator names (`oper_name`, CADORS `operator`) were not matched; they are candidate-only (rule 3, rule 7).

## PARKED / not members

- FAA aircraft registry (`faa-aircraft-registry`, existing key, SCREENED UNKNOWN): `registry.faa.gov` and the
  `faa.gov` download page both returned HTTP 403 (Akamai "Access Denied") from this egress, so terms and files were
  unreadable. Not duplicated; referenced only as the future authoritative source of registration, make/model and owner
  type to enrich the airframe. Rule: a 403 is not permission.
- NASA ASRS: `asrs.arc.nasa.gov` home and DBOL pages return 200 on GET (500 on HEAD); the database is a query
  wizard on `dbol1-prod.arc.nasa.gov` (redirect loop from this egress), the page says the export is "limited to 10,000
  incident records per download" and the site posts maintenance notices. Reports are de-identified ("All personal and
  organizational names are removed"), so there is no tail number or operator to link on. No licence text found. PARKED,
  UNKNOWN, and structurally a poor member for this entity.
- BEA (France) https://bea.aero/en/legal-notice/: the legal notice says "Les informations ne peuvent être utilisées à des fins commerciales ou promotionnelles sans l'autorisation expresse et l'obtention d'une licence de réutilisation des informations publiques." It defines commercial reuse as building "un produit ou un service destiné à être mis à disposition de tiers, à titre gratuit ou onéreux". PARKED, RED.
- TSB Canada air occurrence CSVs (`tsb.gc.ca/sites/default/files/stats/ASISdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv`, listed on
  open.canada.ca under OGL-Canada): HTTP 403 from this egress. Parked UNKNOWN; reopen if reachable, it would add the
  TSB investigation record that `tsboccurrencenumber` in CADORS points to (a declared join).
- Not screened: ATSB (Australia), Aviation Safety Network (commercial site, would be RED), other national AIBs.
  ATSB `atsb.gov.au` returned a transport error from this egress. Candidates for a later round.

## What next (for the orchestrator)

1. Merge `snippet.yaml`. Copy the research file as `docs/sources/pipeline/research-2026-10-01.md` (this notes.md
   content, with the verbatim quotes, is what the terms test searches).
2. Next action is an EVIDENCED round: pull the full NTSB history through the keyed API (owner review of the API key
   terms, because the MDB retires 2027-04-05), parse AAIB PDFs, build the registration normalizer with placeholder
   rejection, and re-measure the NTSB x AAIB link over complete data.
