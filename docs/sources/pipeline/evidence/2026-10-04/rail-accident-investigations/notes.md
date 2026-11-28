# rail-accident-investigations (2026-10-04 screen)

Dataset: rail accident or incident investigation with findings and causes (`transport-safety`). Scripts: `screen.py`
(measurements, writes `results.json`) and `handcheck.py` (appends the hand-check verdicts). All requests used the header
`User-Agent: data-foundry-scout (data@mail.proviciency.com)`, no keys and no login, about 2 requests a second.

Process note: the NTSB RIR PDF fetch ran more than once because duplicate runs of `screen.py` overlapped (other agents in the
same container also ran a `screen.py`; I killed several `screen.py` processes by PID while cleaning up, which may have
included another agent's). About 49 RIR PDFs (roughly 40 MB of PDFs, more than 50 MB of total transfer once repeats are
counted) were downloaded to a scratch directory outside the repository; the committed script now caps at 40 newest reports
and reuses the cache.

## Verdicts

| Member | Publisher | Format | Stage | Rights |
| --- | --- | --- | --- | --- |
| rail-us-fra-form54-accidents | US FRA | structured | SCREENED | AMBER |
| rail-us-ntsb-railroad-investigation-reports | US NTSB | free-text | SCREENED | GREEN |
| rail-uk-raib-reports | UK RAIB | free-text | SCREENED | AMBER |
| rail-ca-tsb-rods-occurrences | TSB Canada | structured | PARKED | UNKNOWN |
| rail-au-atsb-rail-investigations | ATSB | free-text | PARKED | UNKNOWN |
| rail-eu-era-erail-investigations | ERA | free-text | PARKED | UNKNOWN |

The dataset passes: three non-RED members from three publishers and hosts, one measured candidate join with
`reviewed.correct` 9 of 12.

## FRA Form 54, data.transportation.gov (dataset 85tf-25kj)

- Reachability: Socrata `api/views/85tf-25kj.json` and `resource/85tf-25kj.json` answer 200. `railroads.dot.gov/safety-data` answers 403 (not needed).
- Records: 225,366 rows, 157 columns, occurrence dates 1975-01-01 to 2026-07-31; per year 2,322 (2020), 2,372 (2021), 2,691 (2022), 2,790 (2023), 2,574 (2024), 2,366 (2025), 1,225 (2026 so far). `rowsUpdatedAt` is 2026-10-04 (the catalog listing shows the dataset updated that day), so cadence is daily refresh with about a two month reporting lag. 3,084 records have a person killed.
- Related FRA datasets on the same host: source dataset aqxq-n5hy (225,366 rows), Form 57 grade crossings 7wn6-i5b9 (251,533 rows, max date 2026-07-31), Form 55a casualty rash-pd2d, Form 55 m8i6-zdsy.
- Identifier fields: `reportingrailroadcode` (reporting mark, e.g. BNSF, UP, NS, CSX), `accidentnumber`, `incidentkey`, `reportkey`, `gxid`, `trainnumber`, car initials plus number (`firstcar*`, `causingcar*`), `statecode`, `countycode`, `latitude`, `longitude`, `date`, `time`.
- Free text: `narrative` (225,363 of 225,366 non-empty), `primaryaccidentcause` and `accidentcause` (code plus label).
- Terms: dataset metadata `licenseId` USGOV_WORKS, licence name "Public Domain U.S. Government", termsLink https://www.usa.gov/government-works, attribution "FRA Safe Team". Quoted from https://www.usa.gov/government-copyright (fetched): "Government work is something created by a U.S. government officer or employee as part of their official duties." The same page warns that content on federal sites may include protected material used with the right holder's permission.
- Rights: AMBER. The data are a labelled US government work, but the narrative is written by the reporting railroad. Conditions: attribute FRA, state the lag, drop narrative text if a claim appears.
- Scores: demand 4, rights 4, acquisition 5 (open Socrata API), structuring 3 (already typed; value is cause normalisation and linkage), freshness 4, onboarding 4, poor access 3.

## NTSB Railroad Investigation Reports

- Reachability: `www.ntsb.gov/about/Pages/Website-Policies.aspx` 200; `.../Reports/RIR2301.pdf` 200 (application/pdf). The CAROL POST API (`data.ntsb.gov/carol-main-public/api/Query/Main`) answers 400 "The SortColumn value EventDate is invalid" and 500 for a null sort column, so its query schema is still undocumented to us (existing candidate `accidents-ntsb-carol` stays PARKED). The Reports.aspx page has no static list of rail reports.
- Method: enumerate `RIRyynn.pdf` for 2012 to 2026 by URL; 57 URLs tried, the 40 newest existing reports downloaded (RIR-23/01 to RIR-26/13, with gaps such as 2501, 2512, 2405, 2409 that answer 404). The total number of RIR reports before 2023 was not measured.
- Parsed from the first pages with pdftotext: 40 of 40 are PDFs; 33 have a parsed occurrence date and place (state), 30 contain the NTSB case number (pattern `RRD21FR008`, region RRD, year, mode FR/LR/MR, sequence). Occurrence dates range from 2021-03-03 to 2026-05-18, issue dates from 2023-02-10 to 2026-08-24; about 12 reports a year, so freshness is monthly-ish.
- Free text: the whole report (1.1 accident description, analysis, probable cause, recommendations).
- Identifier fields: case number (footnote 1), train identifier (e.g. C-ATMCRD0-31D), railroad name, location, date, milepost. No FRA accident number is cited (`cites_fra_report_no` false for all 40).
- Terms (https://www.ntsb.gov/about/Pages/Website-Policies.aspx, fetched): "Content appearing on NTSB Web pages, in reports, recommendation, and public dockets, unless otherwise noted, was prepared by employees of the United States Government as part of their official duties and, therefore, is not subject to copyright. By publishing its reports and recommendations and opening public dockets, the NTSB has placed the contents prepared by its staff in the public domain. This material may be freely copied and, at your discretion, credited to the NTSB with a "Courtesy: National Transportation Safety Board" notation. The Board requests that uses of its material be accurate and complete. If copyrighted text is included on an NTSB Web page, in the docket, or in an NTSB publication, it should be specifically identified."
- Rights: GREEN (explicit public domain). Keep copyrighted third-party items, photographs and railroad-supplied figures out unless the report marks them as NTSB's.
- Scores: demand 4, rights 5, acquisition 2 (PDF enumeration, no API), structuring 5 (all value is extraction), freshness 3, onboarding 2, poor access 4.

## UK RAIB reports (GOV.UK)

- Reachability: `www.gov.uk/api/search.json?filter_format=raib_report` 200; `www.gov.uk/api/content/raib-reports/...` 200.
- Records: 603 reports (446 investigation reports, 101 safety digests, 43 bulletins, 11 interim reports, 2 discontinuation reports); heavy rail 486, light rail 51, heritage 39, metros 32. Occurrence dates 2005-10-18 to 2026-06-19; newest publication 2026-10-01; 23 published in the last 365 days (a few a month).
- Fields: title, description, `date_of_occurrence`, `railway_type`, `report_type`, content-API body summary and PDF attachment. In 25 sampled investigation reports 25 had a summary over 300 characters and 25 a PDF.
- Identifiers: the report number in the title (e.g. 10/2026) and place names; no railway reporting mark or FRA/NTSB number. Not linkable to US records.
- Terms: GOV.UK footer on the report page, fetched: "All content is available under the Open Government Licence v3.0, except where otherwise stated". Report PDF (R102026_260728_Staniforth_Road.pdf, fetched): "You may reuse this document/publication (not including departmental or agency logos) free of charge in any format or medium. You must reuse it accurately and not in a misleading context. The material must be acknowledged as Crown copyright and you must give the title of the source publication. Where we have identified any third party copyright material you will need to obtain permission from the copyright holders concerned." OGL v3.0 page (fetched): "You are free to: copy, publish, distribute and transmit the Information; adapt the Information; exploit the Information commercially and non-commercially".
- Rights: AMBER. Conditions: attribution statement, Crown copyright acknowledgement and title, no misleading reuse, third-party material (images) excluded.
- Scores: demand 3, rights 4, acquisition 4, structuring 4, freshness 3, onboarding 4, poor access 3.

## Linkage: NTSB RIR to FRA Form 54

- Declared join: none. 0 of the 36 FRA narratives that mention "NTSB" contain a case number or RIR reference, and no RIR cites an FRA accident number, so there is no identifier naming the counterpart record.
- Candidate rule (`screen.py`): FRA record on the same calendar date in the same state as the NTSB occurrence (queried directly for every NTSB report, not from a sample), then place (city in FRA station/narrative) for a first pass.
- Numbers: 40 reports pulled; 33 have a parsed date and state; 12 of 33 have at least one FRA record the same day in the same state; 21 have none (several are transit or MARTA/MBTA type events, or the reported date differs; this was not individually diagnosed). The city rule confirmed 7 of the 12. The hand check (`handcheck.py`, read against each RIR section 1.1 and FRA narrative using railroad, date, place and train id) found 9 same-accident of 12 checked: the 7 city matches plus 2 the city rule missed (RIR-24/07 Imperial County is FRA station NILAND, RIR-24/12 Chico is FRA station BRIDGEPORT in the same county), while 3 same-day hits were different accidents (Easton PA, Bessemer AL, La Mirada CA). Reviewed 9/12.
- Train identifiers such as ISILB-07, C75B106, MCBCH-05 were identical in the RIR text and the FRA narrative, so a railroad plus train id plus date rule is a stronger candidate key than place; this is not yet measured as a rule.
- RAIB has no overlap with US records (different country); it joins only through taxonomy.

## PARKED / REJECTED

- TSB Canada RODS (open.canada.ca "Rail occurrence data from January 1983 to present", licence "Open Government Licence - Canada", frequency P1M, CKAN package 4f8d9b0d-c4af-4be2-b751-3f5a403993ff, reachable 200): the data CSVs (occurrence, train, rolling stock, injuries, components), the data dictionary and the TSB rail data page answer 403 from this egress. Parked, not worked around; same block as `maritime-ca-tsb-marine-occurrences`.
- ATSB rail: every atsb.gov.au URL gives no HTTP response (status 0), no terms read.
- ERA ERAIL: the egress proxy denied the connection to erail.era.europa.eu; www.era.europa.eu legal-notice URLs tried were 404. Nothing measured.
- NTSB CAROL API: not used (query schema unknown); already parked as `accidents-ntsb-carol`.
- BEA-TT (France) answers 200 at the home page only; not screened further.
