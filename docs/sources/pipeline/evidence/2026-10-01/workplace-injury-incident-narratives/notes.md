# workplace-injury-incident-narratives (screened 2026-10-01)

Verdict: PASSES screening on mining. Two non-RED members from different publishers (US DOL MSHA, US EIA) joined by a declared MSHA mine ID. OSHA and NEISS are PARKED. Script: `screen.py`; output: `results.json`. All requests carried the data-foundry-scout User-Agent, about 2 req/s or slower.

## MSHA accident, injury and illness data (US DOL MSHA) - AMBER
- Reachability: `https://arlweb.msha.gov/OpenGovernmentData/DataSets/Accidents.zip` HTTP 200, 52,240,903 bytes, Last-Modified Fri 25 Sep 2026; `Mines.zip` HTTP 200, 7,304,825 bytes. Definition file `Accidents_Definition_File.txt` HTTP 200.
- Cadence: page says "These files are updated every Friday afternoon unless otherwise noted here." and "All updates are complete replacements of each of the files."
- Size limit: the zip is over 50 MB, so only a 25,000,000-byte range was fetched and stream-inflated: 131,593 rows (about 48 percent of the 228.7 MB table). The full row count is therefore about 270k, estimated, not measured. Rows span 2000-01-01 to 2026-09-22 (newest in the partial). Roughly 2,700 to 2,900 rows per year in the partial.
- Identifiers: MINE_ID (7 chars), OPERATOR_ID, CONTROLLER_ID, CONTRACTOR_ID (10.4 percent filled), DOCUMENT_NO (unique report). Declared join per the definition file: "Use mine_id to join to the Mines and Inspections tables." No NAICS field (Mines carries SIC).
- Free text: NARRATIVE present on 131,592 of 131,593 rows (100 percent, also at 2000, 2005, 2010, 2015, 2020, 2025); median 175 characters. Structured fields include degree of injury, nature of injury, body part, equipment, equipment manufacturer and model, occupation, activity, accident type.
- Sample narrative: "While operating the tailgate side of the shear, a rock fell from the roof onto the tailgate drum. A small rock came off the drum and hit the employee on right thumb while holding the remote. They received 5 stitches." No names seen in 25 samples, but a personal-data scan is still required.
- Terms (fetched): https://www.dol.gov/general/aboutdol/copyright - "Materials created by the federal government are generally part of the public domain and may be used, reproduced and distributed without permission." Same page: such materials "may not be used in a manner that implies any affiliation or endorsement by the DOL", and some page content may be third-party copyrighted. The MSHA open-data page itself carries no separate licence.
- Verdict AMBER: public domain, with credit and no-endorsement conditions plus a personal-data scan of narratives before publishing them. Raw zip always preserved.

## MSHA Mines register - same publisher, same zip family
92,028 mines, fields include name, state, status, operator, SIC, coordinates. Declared join Accidents.MINE_ID to Mines.MINE_ID: 2000/2000 sampled accident rows matched. It is a lookup of the same publisher, so it is not counted as the independent join.

## EIA coal mine production by MSHA ID (US EIA) - AMBER
- `coalpublic2022.xls` HTTP 200, 1,261,376 bytes, Last-Modified 29 Sep 2023; it is SpreadsheetML XML despite the name. 790 mine rows for 2022 with MSHA ID, mine name, state, county, status, type, operating company and address, production, average employees, labor hours. The 2023 and 2024 files and the copyright page returned a transient HTTP 503 on the head request (2023 later returned 200 on a plain GET); the current-year file needs confirming. The directory page `/coal/data/public/` returns 403.
- Format: structured, no free text. Annual cadence.
- Terms (fetched, https://www.eia.gov/about/copyrights_reuse.php): "U.S. government publications are in the public domain and are not subject to copyright protection. You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products that are on our website or that you receive through our email distribution service." It asks for an acknowledgment with the publication date.
- Verdict AMBER (acknowledgment condition).

## Linkage (measured)
Declared join: MSHA accident MINE_ID == EIA "MSHA ID" zero-padded to 7 digits (EIA names the MSHA mine).
- Coal-mine accident rows 2020 onward in the partial: 6,287 of 6,673 (94.2 percent) match a mine in the EIA 2022 file. The rest are mines idle or closed in 2022.
- Distinct coal mines with 2020+ accidents: 574, of which 427 are in EIA 2022.
- All coal rows all years: 24,327 of 61,060 match (older mines are absent from the 2022 file).
- Hand check: 25 random matched accidents; 25/25 had the same mine name (case-insensitive) in MSHA Mines and EIA, and state agreed (EIA uses regional state labels). Caveat: the link is mine-level (establishment), not incident-level, and EIA is itself partly sourced from MSHA, though published separately.

## OSHA Severe Injury Reports - PARKED (UNKNOWN)
`https://www.osha.gov/severe-injury`, `.../severeinjury.csv`, `/data` and `/disclaimers` all returned HTTP 403 (CloudFront "request could not be satisfied") with our User-Agent. Terms could not be read, so no rights verdict. Not worked around. Public domain status would likely come from the DOL page above, but unverified for osha.gov. `enforcedata.dol.gov/views/data_catalogs.php` returns 200 but is a JavaScript app with no readable data links, so no bulk file was verified. The existing `contractors-osha-inspections` key (DOL API key needed) is untouched; an OSHA activity-number join to inspections would be declared once reachable. NAICS is a filter only.

## CPSC NEISS - PARKED (out of scope)
Page HTTP 200. It covers hospital emergency-department visits for consumer-product injuries (narratives up to 400 characters from 2019, annual files, "most recent 20 years"), a sample of hospitals, with no employer or establishment identifier and no stated reuse licence on that page. Not a workplace dataset; revisit for consumer-product injuries.

## BLS CFOI/SOII, Canada
Not screened this round: BLS publishes aggregates without narratives, and no open Canadian incident narrative feed was identified. Not measured, so not recorded as findings.

## Scores
MSHA: demand 4, rights 4, acquisition 5 (one zip, no key), structuring 5 (narratives to equipment, task, body part), freshness 5 (weekly), onboarding 4, poor access 4. EIA: lower on freshness (annual, file dated 2023) and demand.
