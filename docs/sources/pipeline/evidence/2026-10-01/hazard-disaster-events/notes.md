# hazard-disaster-events screening (2026-10-01)

Entity: hazard/disaster event (declaration, alert, earthquake, storm event) located by FIPS, county or geometry, with narrative text.
Scripts: `screen.py` (all numbers), output `results.json`. Existing key `roofing-ncei-storm-events` (SCREENED, GREEN) is reused as a member by citation, not duplicated.

**Verdict: no `datasets:` entry.** Three non-RED new members plus the cited NCEI key exist, but the only measured declared join (NWS to NCEI) is between two NOAA offices (same publisher, so not independent), and the only independent-publisher FIPS join (FEMA to NCEI) rests on a member whose terms we could not read (PARKED/UNKNOWN). Reopen when FEMA's terms are readable.

## FEMA OpenFEMA DisasterDeclarationsSummaries (`hazard-fema-disaster-declarations`) - PARKED, UNKNOWN
- `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries`: HTTP 200; 70,423 rows (1953 to date); newest declaration 2026-09-25 (EM-3654-HI); dataset metadata accrualPeriodicity R/PT20M, lastDataSetRefresh 2026-10-01T13:48Z; 2,147 rows since 2025-06-01.
- Identifiers: femaDeclarationString, disasterNumber, fipsStateCode + fipsCountyCode, placeCode, incidentId. Free text: only declarationTitle (short). It is a structured feed.
- Terms: `https://www.fema.gov/about/openfema/terms-conditions` returned 403 Access Denied (Akamai) to our User-Agent; other fema.gov HTML pages the same; the web.archive.org mirror was unreachable from the proxy. The `license` field in the OpenFemaDataSets metadata is null (accessLevel "public"). Quoted only from the metadata API (`https://www.fema.gov/api/open/v1/OpenFemaDataSets`): "Citation: FEMA's citation requirements for datasets (API usage or file downloads) can be found on the OpenFEMA Terms and Conditions page, Citing Data section". Terms unreadable, so parked, not worked around.
- Related OpenFEMA sets noted (not screened): PublicAssistanceFundedProjectsDetails 849,718 rows, DeclarationDenials 1,303, FemaWebDisasterSummaries 4,035.

## NWS alerts API (`hazard-nws-active-alerts`) - SCREENED, GREEN
- `https://api.weather.gov/alerts/active`: HTTP 200; 347 active alerts at 13:54Z, all with description text; fields id (urn:oid), event, headline, description, instruction, geocode.SAME and geocode.UGC, eventCode, sender, sent/onset/expires. Updates continuously.
- History: `alerts?start=2026-06-01...&end=2026-06-02...` returned 0 features, so there is no history; a build must poll and archive.
- Terms (`https://www.weather.gov/disclaimer`, fetched, 200): "The information on National Weather Service (NWS) Web pages are in the public domain, unless specifically noted otherwise, and may be used without charge for any lawful purpose so long as you do not: 1) claim it is your own". API page (`https://www.weather.gov/documentation/services-web-api`) asks for a User-Agent with contact details; no key needed today ("This will be replaced with an API key in the future").
- Verdict GREEN (conditions: do not claim as own, no implied endorsement; per the same page).

## USGS earthquakes (`hazard-usgs-earthquakes`) - SCREENED, GREEN
- `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson`: 200; 2,013 M2.5+ events in 30 days; newest 2026-10-01T13:36Z; FDSN count since 2026-09-01 is 10,854 (all magnitudes). Identifiers id, ids, code, net, url; text only `place` ("3 km SW of Pahala, Hawaii") and `title`. No FIPS or county.
- Terms (`https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits`, 200): "USGS-authored or produced data and information are considered to be in the U.S. Public Domain." Credit is requested, and third-party photographs excluded (not used).
- GREEN. Structured, no narrative.

## NOAA NCEI Storm Events (existing key `roofing-ncei-storm-events`, cited)
- 2026 file `StormEvents_details-ftp_v1.0_d2026_c20260918.csv.gz` 200, 7.5 MB, 39,062 rows, months 202601 to 202606, 32,574 with EVENT_NARRATIVE, all with EPISODE_NARRATIVE; CZ_TYPE C (county) 20,550, Z (zone) 18,510. Identifiers EVENT_ID, EPISODE_ID, STATE_FIPS, CZ_FIPS, WFO. Directory listing also has d2025_c20260819. Terms: same weather.gov/disclaimer public-domain quote as above (already in candidates.yaml). Publication lag about 80 days.

## ECCC CAP alerts (`hazard-eccc-cap-alerts`) - SCREENED, AMBER
- `https://dd.weather.gc.ca/today/alerts/cap/`: 200 (weather.gc.ca/rss reset the connection; dd works). Date dir 20261001 only; 12 CAP files existed at 14:00Z, all fetched: each has identifier (urn:oid:2.49.0.1.124...), description, CLC and CAP-CP location geocodes. api.weather.gc.ca/collections 200 (OGC API, not used).
- Terms (`https://eccc-msc.github.io/open-data/licence/readme_en/`, v2.1.1): "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below." and "In the case of weather alerts (i.e. watches/warnings), any information shall be reproduced in such a way that there is no alteration of the content or intent of the alert."
- AMBER: attribution statement, no alteration of alerts, no implied endorsement.

## Linkage (measured, `results.json`)
- A. NWS active alerts to NCEI 2026, declared place codes (FIPS): 321/555 distinct NWS county SAME codes (0+state+county) appear as NCEI county-type events in 2026; UGC zone codes 365/615 match NCEI zone-type (state abbreviation from FEMA rows + CZ_FIPS). These are place-level matches only. Event-level matches: 0, because NWS keeps no history and NCEI ends 2026-06-30. Both members are NOAA, so this is not an independent-publisher join.
- B. FEMA declarations to NCEI (informational, FEMA parked): 128/543 FEMA DR county rows with incident start in 2026 have an NCEI county event in the same county FIPS between incident start (minus 1 day) and incident end (or 2026-06-30 if open). County FIPS plus time window; the FIPS names the place, the window is an attribute, so event-level links stay candidates for review.
- C. USGS and ECCC: no identifier joins to any US member (USGS has no FIPS; ECCC uses CLC/SGC). Zero links measured; no name-based hand check attempted.
- Sample sizes pulled: FEMA 1,000 rows, NWS 347, USGS 2,013, NCEI 39,062, ECCC 12 (all that existed).
