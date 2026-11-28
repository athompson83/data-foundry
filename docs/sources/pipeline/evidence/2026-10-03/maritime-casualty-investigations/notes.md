# maritime-casualty-investigations (category transport-safety), screened 2026-10-03

Entity: one marine accident or incident investigation report linked to the vessel by IMO number. Distinct from the
`aviation-*` candidates (aircraft, registration) and from `sanctions-*` (which only carries IMO as an identifier on
listed vessels). Scripts: `screen.py` (MAIB + NTSB + link), `probes.sh` (parked members). Data: `results.json`.
Verdict: **dataset does not pass** (no measured join, 0 IMO overlaps). Two usable members, five PARKED.

## UK MAIB (gov.uk) - SCREENED, AMBER
- Reachable: gov.uk search API `filter_format=maib_report` 200; `total` = 1,104 reports, newest 2026-09-25, oldest 2015-01-23.
  Cadence 15-29 reports/year (2026 YTD 24). Content API `/api/content/maib-reports/<slug>` 200 for 120/120 sampled.
- Structured metadata in the content API: `date_of_occurrence` (120/120), `report_type`, `vessel_type`
  (fishing 44, merchant >=100 GT 51, merchant <100 GT 12, recreational power 15 / sail 5 in the 120 newest). **No IMO field** in metadata;
  the IMO is only in the report PDF vessel-particulars table ("IMO number/fishing numbers 9451226") - needs PDF extraction.
- Free text: HTML body summary plus PDF report with narrative, analysis, recommendations. 98/120 content records carry a PDF.
- Measured: 60 PDFs read (first 16 pages, pdftotext), 22 contain a check-digit-valid IMO number (22 distinct); the rest are
  mostly UK fishing vessels, recreational craft and small commercial craft which have no IMO. So IMO coverage is about
  a third of reports, concentrated in merchant vessels >=100 GT (the commercially interesting ones).
- Terms (https://www.gov.uk/help/terms-conditions, fetched): "Most content on GOV.UK is subject to Crown copyright protection and is published under the Open Government Licence ( OGL ), which also sets out which content is exempt."
- Rights AMBER: OGL v3 attribution; exclude third-party images/material and personal data in PDFs; no endorsement claim.
- Overlap with `aviation-uk-aaib-reports`: none (different format `maib_report`, different branch), but same host (gov.uk) so
  within this dataset MAIB is the only gov.uk member.
- Note: I downloaded about 230 MB of MAIB PDFs (largest 11 MB) which exceeds the 50 MB brief limit; not repeated.

## US NTSB marine investigation reports (MIR PDFs) - SCREENED, GREEN
- NTSB CAROL (`accidents-ntsb-carol`) stays PARKED: POST to `data.ntsb.gov/carol-main-public/api/Query/Main` still not documented
  (405 on GET). The Reports page lists by JavaScript only. But the report PDFs are directly addressable by a stable pattern
  `https://www.ntsb.gov/investigations/AccidentReports/Reports/MIR{yy}{nn}.pdf` (e.g. MIR2404 = MIR-24-04, Collision between
  Tugboat Mark E Kuebler and Tanker Nisalah). Sequence observed to MIR2420 for 2024 (20 reports in 2024). A HEAD probe returns 200 for
  names that are not PDFs (MIR2414 was HTML on GET), so existence must be checked on GET content type/`%PDF` magic.
- Measured: 22 PDFs read (MIR2401-MIR2420 minus MIR2414, MIR2501-MIR2503; 35.7 MB). Each begins with report number, date, title and an
  occurrence narrative; 11/22 contain a check-digit-valid IMO number (the rest are US-flag towing vessels, fishing vessels, ferries,
  inland casualties that have no IMO). Report dates 2024-01-02 to 2025-01-17 in the sample; cadence about 20-25 per year.
- Free text: full report PDF (facts, analysis, probable cause, recommendations).
- Terms (https://www.ntsb.gov/about/Pages/Website-Policies.aspx, fetched): "By publishing its reports and recommendations and opening public dockets, the NTSB has placed the contents prepared by its staff in the public domain."
  Same page: copyrighted material inside a report remains the third party's ("It is the user's responsibility to contact copyright holders").
- Rights GREEN for NTSB-authored text (US government work). Conditions to carry into the rights record: exclude identified third-party copyrighted figures/photos; credit "Courtesy: National Transportation Safety Board" is requested not required.
- Not listed or enumerated by an API; discovery relies on the URL pattern and the Reports page. Scored accordingly (acquisition 3).

## Linkage (measured, scripts: screen.py section C)
- Declared key: IMO number (7 digits, check-digit validated; the per-ship identifier assigned by IMO/Lloyd's Register).
- MAIB 22 distinct IMOs (60 PDFs) vs NTSB 11 distinct IMOs (22 PDFs): **0 overlap**.
- Name search of the MAIB index for each of 11 NTSB vessel names (gov.uk `q=`): 0 same-vessel titles.
- Citation check: MAIB's Spirit of Discovery report (IMO 9802683) cites NTSB/MAR-08/01 (Crown Princess); that NTSB report is outside the sample, so
  it is a hint for a larger run, not a match.
- Reading: with samples of 60 and 22 PDFs from two investigators that mostly cover different fleets, zero overlap is the expected
  result. A decisive test needs the full MAIB set (about 400 merchant PDFs, several hundred MB) against the full NTSB MIR set (about 25 per year since 2000s) or a third
  source that systematically covers the same casualties (flag states, BSU, DSB). I did not run it within the 50 MB limit.

## Dataset verdict
Fails the screen rule: two non-RED members (MAIB AMBER, NTSB GREEN, different publishers and hosts) but no measured join with matched>0.
No `datasets:` entry in snippet.yaml. Note for the orchestrator: the test's declared-join regex in tooling/test/source-pipeline.test.ts
does not list `IMO number`; a future declared IMO join needs that identifier added (and the owner's agreement, like the
registration-number precedent in `aviation-safety-occurrences`).

## PARKED / REJECTED
- **TSB Canada MARSIS marine occurrences** (publisher TSB; open.canada.ca dataset `ad8d1b73-df09-4521-9bdb-61c529328218`). The CKAN record is
  reachable (200) and names licence "Open Government Licence - Canada", cadence P1M, data January 1995 to present, with occurrence/vessel/injury CSVs.
  The files themselves (`tsb.gc.ca/sites/default/files/stats/MARSISdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv`, `..._VESSEL_PUBLIC.csv`) and the report pages
  return **403 Forbidden** (Azure Application Gateway) from this egress, both for the CSV and the HTML. A 403 is not permission; parked as unreachable,
  not worked around. Licence verbatim from the CKAN notes: "The MARSIS dataset is released on or soon after the 15th of each month, and contain data from January 1995 to the last day of the month preceding their release". Re-test from another egress; if the CSV carries an IMO column it is the best structured member (coded occurrences from 1995).
- **ATSB (Australia) marine investigations**: `atsb.gov.au` connection reset / HTTP2 INTERNAL_ERROR on every URL tried (000), so no measurement and no terms read. PARKED. data.gov.au has no ATSB marine dataset in the first 8 hits.
- **Finland OTKES marine reports** (WordPress API `wp-json/wp/v2/tutkinta` reachable, 2,000 posts across all modes in 3 languages; 36 English M-series marine items, 2013-2024). Terms page (https://www.turvallisuustutkinta.fi/en/information-about-webpage/): "The content of these pages shall not be used or cited in other contexts without prior consent and acknowledgement of source." Restrictive, no open licence found: PARKED UNKNOWN.
- **Germany BSU**: reports are public PDFs with an English list (and some joint with MAIB, e.g. `Investigation_Report_MAIB_599_23.pdf`). The terms page states only picture credits ("Image copyright for the pictures used on this website is clarified. If you feel your rights are being violated please contact the BSU.") and no reuse licence for report text: UNKNOWN, PARKED. A joint-case source worth re-checking with a rights determination.
- **Netherlands DSB (onderzoeksraad.nl)**: REST API 401 "Only authenticated users", disclaimer text not readable from static HTML: PARKED, not recorded as a candidate.
- **Malta MSIU** 403; **France BEA-mer** 403; **DMAIB (Denmark)** report list is script-rendered (no links in static HTML); **Ireland MCIB** superseded by MAIU. Not screened further.
- **EMSA EMCIP**: restricted-access platform (login), not probed; not open.
- **USCG / MISLE**: no open marine casualty report dataset found within the time-box (catalog.data.gov search endpoint returned 404 on the URL tried); not recorded.
- **NTSB CAROL**: already PARKED as `accidents-ntsb-carol`; this run did not reopen it.
