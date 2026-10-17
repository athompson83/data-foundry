# water-system-compliance (2026-10-04 screen)

Dataset: one **public water system** (PWS) with its violations, enforcement actions and regulator orders/notices, assembled from the
US EPA SDWIS federal copy, California's State Water Board SAFER risk file and Ontario's drinking-water enforcement open data.
Everything below was measured from this container on 2026-10-04 with `screen.py` (output in `results.json`). Caches: `/tmp/wsc`.

## Candidate 1: US EPA SDWIS via Envirofacts (`water-epa-sdwis-violations-enforcement`)
- Reachable: `https://data.epa.gov/efservice/WATER_SYSTEM|VIOLATION|ENFORCEMENT_ACTION/.../JSON` returned 200, keyless.
- Counts (national): WATER_SYSTEM 434,040; VIOLATION 2,098,792; ENFORCEMENT_ACTION 2,246,037. California slice (pwsid beginning CA): 18,607 systems, 50,987 violations, 21,283 enforcement actions.
- Freshness: newest enforcement_date in the first 5,000 CA enforcement rows 2026-04-20; newest violation compliance-period begin 2026-01-16 in the 2,000-row sample. The update cadence was not measured here.
- Identifiers: `pwsid` (e.g. CA0103040), `violation_id`, `enforcement_id`, `facility_id`, `contaminant_code`, `rule_code`, `primacy_agency_code`.
- Free text: `enforcement_comment_text` is filled in 2,794 of 5,000 CA enforcement rows (56%); examples: "Failure to submit Service Line Inventory. Section 1414(g) of the Safe Drinking Water Act (SDWA), 42 U.S.C. § 300-3(g). Administrative Order, Docket No. PWS-AO-2026-040" (cites a docket number) and "Due to rTCR implementation, this TCR violation has been closed with this SOX enforcement record on 01/25/2019." Many comments are bare internal codes (e.g. `02_04_17C_006_0105016_23`).
- Personal data: WATER_SYSTEM carries `admin_name`, `phone_number`, `email_addr`, `fax_number`, `alt_phone_number`; these must be excluded from publication.
- Terms fetched: https://www.epa.gov/web-policies-and-procedures/epa-disclaimers
  - "Unless otherwise specified, geospatial data produced by the EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105."
  - "These documents may be freely distributed and used for non-commercial, scientific and educational purposes. Commercial use of the documents available from the EPA websites may be protected under the U.S. and Foreign Copyright Laws."
  - No page was found that grants or forbids commercial reuse of SDWIS records specifically (the open-data-policies page returned 200 but had no licence text matching our search). SDWIS records are compliance facts reported by state primacy agencies and published free with no login, so ADR-0018 free-public presumption applies.
- Verdict: **AMBER**. Conditions: publish facts only (no EPA documents or narrative copyright text beyond short factual comment excerpts); credit US EPA SDWIS and show the extraction date; exclude personal contact fields; keep `compliance_status_code` and dates so stale violations are not shown as current; use the Envirofacts API in paged, rate-limited form (no more than a few requests per second), and the ECHO bulk downloads for full snapshots.
- Scores: demand 5 (agents ask "is this water safe / who violates"), rights 3, acquisition 4 (paged API; some per-PWSID calls were slow), structuring 3, freshness 4, onboarding 4, poor access 3.

## Candidate 2: California State Water Board SAFER risk assessment (`water-ca-swrcb-safer-risk-assessment`)
- Reachable: CKAN `https://data.ca.gov/api/3/action/package_show?id=safer-failing-and-at-risk-drinking-water-systems` 200; CSV (time-limited blob link from the API) 200, 5.85 MB.
- 3,190 systems x 140 columns; `CREATED_DATE` 2026-10-02; CKAN `accrualPeriodicity` R/P1D and `metadata_modified` 2026-10-02 (daily refresh claimed; one snapshot observed).
- Identifiers: `WATER_SYSTEM_NUMBER` (= US PWSID, e.g. CA0103040), `TINWSYS_IS_NUMBER`, county name, lat/long, `REGIONAL_BOARD`.
- Free text: the `*_THRESHOLD_MET` columns hold criterion prose (e.g. "No violation over the last three years"), `*_ANALYTES` list analytes, `AUTOMATICALLY_AT_RISK_REASON` is filled for 204 of 3,190 rows. This is largely controlled vocabulary, so the structured format applies; the prose adds explanation.
- Terms fetched: https://data.ca.gov/dataset/safer-failing-and-at-risk-drinking-water-systems shows License "Other (Public Domain)" and the field "Public Access Level Public Rights No restrictions on public use".
- Verdict: **GREEN** (public-domain licence and "No restrictions on public use"). Note the file is derived partly from self-reported system data and U.S. Census inputs, so facts are credited to the State Water Board.
- Scores: demand 4, rights 5, acquisition 4 (the CSV link carries an expiring token; resolve it through the CKAN API each run), structuring 3, freshness 5, onboarding 4, poor access 4.

## Candidate 3: Ontario drinking-water quality and enforcement (`water-ontario-dws-orders-awqi`)
- Reachable: CKAN `https://data.ontario.ca/api/3/action/package_show?id=drinking-water-quality-and-enforcement` 200; `https://files.ontario.ca/moe_mapping/downloads/2Water/DWMD/DW_2024-25-EN.zip` 200, 43.7 MB (one download). Yearly files 2014-15 to 2024-25 (English and French); metadata_modified 2026-08-12, `update_frequency` yearly.
- 2024-25 contents: AWQI Data 2,882 incidents (incident dates 2024-04-01 to 2025-03-29), DWS Orders 14 orders (issued 2024-05-28 to 2025-03-31), DWS Inspections 1,053, plus convictions, certification, lab and test-result workbooks.
- Identifiers: `DWS #` (Ontario drinking water system number, 26xxxxxxx), `AWQI Notification #`. No US PWSID and no FIPS.
- Free text: DWS Orders `Order Summary`, 264 to 1,594 characters (median 1,078); e.g. "The order required that at the end of each month during a specified ninemonth period in 2025, the owner submit to the provincial officer a copy of all water sample results ..." Only 14 orders in the fiscal year, fewer than the 20-record sample size; earlier years were not pulled.
- Personal data: owner legal names include natural persons (for example sole-proprietor owners); exclude or aggregate those.
- Terms fetched: https://www.ontario.ca/page/open-government-licence-ontario
  - "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below."
  - Dataset page https://data.ontario.ca/dataset/drinking-water-quality-and-enforcement lists Licence "Open Government Licence – Ontario".
- Verdict: **AMBER**: express commercial permission with an attribution condition, and personal-data exclusion.
- Scores: demand 3, rights 4, acquisition 3 (yearly xlsx zips, 43 MB), structuring 4 (order prose to typed requirements), freshness 2 (yearly), onboarding 3, poor access 4.

## PARKED: EPA ECHO SDW REST (`water-epa-echo-sdw-rest`)
`https://echodata.epa.gov/echo/sdw_rest_services.get_systems?output=JSON&p_st=CA` and `...&p_pwsid=CA1910067` returned HTTP 502 (Apache proxy error) on three attempts, and an HTTP/2 PROTOCOL_ERROR on the first. Not worked around. The same SDWIS tables are reachable via Envirofacts (candidate 1), so nothing is lost. Re-test later.

## Not screened
UK Drinking Water Inspector (dwi.gov.uk home page 200, but no open-data endpoint was found; two guessed paths returned 404) and Environment Agency bathing-water API (guessed URL returned 403). No candidate entries were written for these because nothing about their data was measured.

## Linkage (measured)
- **Declared join, SAFER to EPA SDWIS on PWSID**: all **3,190/3,190** SAFER `WATER_SYSTEM_NUMBER` values exist as EPA `pwsid` among the 18,607 CA rows (3,187 of those EPA rows are active). A check that the two publishers agree: SAFER `POPULATION` equals EPA `population_served_count` for 2,241 of 3,190 systems (70%); the rest differ (different reporting dates).
- **Consistency check (not a join)**: of 25 randomly drawn SAFER systems flagged `PRIMARY_MCL_VIOLATION = YES` (254 flagged in total, seed 7), 19/25 have at least one MCL violation record in EPA SDWIS (first 300 rows by PWSID); 6/25 have none in that window. SAFER looks back three years, so EPA history that is older or past row 300 would not be counted.
- **Ontario**: zero joins. No shared identifier with the US/California members, and no cross-country name matching was attempted. Ontario links only to other Canadian sources (e.g. Ontario test results by DWS #), not screened here.
- Caveat on independence: California's data and EPA SDWIS both originate in the state's SDWIS reporting; they are different publishers and hosts, but not independent measurements of the same event, so agreement is not corroboration.

## Dataset verdict
Passes the screening gate: two non-RED members from different publishers/hosts (EPA data.epa.gov, SWRCB data.ca.gov) with a declared PWSID join (3,190/3,190). Free text present in EPA enforcement comments (56% filled) and Ontario order summaries. Ontario does not yet connect to the others; before RIGHTS_DETERMINED it needs a linking source (for example an Ontario-wide or Canadian water-system registry) or must move to a separate dataset.
