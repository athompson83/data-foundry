# Recalls widening: consumer-product-recalls-north-america (2026-10-03)

Task: add at least one new member from a different publisher to the BUILDING dataset (CPSC + Health Canada).
Result: two new members, **Transport Canada VRDB** (`ca-tc-vehicle-recalls-database`, new) and **NHTSA**
(`nhtsa-recalls`, existing entry extended). One re-test parked (FSIS). Scripts: `screen.py`; numbers: `results.json`;
paste-ready YAML: `snippet.yaml`. All fetches keyless with the scout User-Agent, at most 2 requests a second.
Caveat on method: the Transport Canada CSV (207 MB) exceeded the 50 MB guidance and was fetched once in full.

## Dataset-stage gate (important for the merge)

`tooling/test/source-pipeline.test.ts` requires every member of a BUILDING dataset to be BUILDING or later, and every
member to sit in one connected graph of confirmed joins. So the `dataset_edit` in snippet.yaml must not be applied while
the two candidates are SCREENED. Build Transport Canada first (it joins CPSC by a declared citation), then NHTSA
(joins Transport Canada by a declared manufacturer number).

Scope decision for the orchestrator: these members add vehicles (NHTSA 26,376 campaigns, Transport Canada about
16,700 recalls), plus child restraints, tires and vehicle equipment. CPSC already carries ATVs, snowmobiles and
child products, and 81 CPSC recalls cite Transport Canada, so the products overlap. If vehicles are out of scope for
"consumer product", add only the child-restraint, tire and equipment slices (NHTSA 253 + 788 + 2,866 campaigns;
Transport Canada 220 + 38 + 268 + 226 recalls).

## 1. Transport Canada Vehicle Recalls Database (NEW, recommended first)

- Reachability: `https://opendatatc.tc.canada.ca/vrdb_full_monthly.csv` HTTP 200, 206,861,872 bytes, Last-Modified
  2026-10-03 09:00 UTC (the open.canada.ca metadata says monthly, the file is rebuilt daily). The JSON API
  `data.tc.gc.ca/v1.3/api/eng/vehicle-recall-database/recall?format=json` returns only its parameter schema without
  query parameters (200).
- Counts: 146,894 rows (one per make/model line) = 17,978 distinct recall numbers. Recall dates 1975-01-14 to
  2026-09-22 (newest). Categories by recall: Car 4,271, Truck 2,506, SUV 2,157, Light Truck and Van 1,546, Motorhome
  1,398, RV Trailer 1,146, Motorcycle 1,041, Bus 935, ATV 271, Tire 268, Snowmobile 232, Equipment 226, Child Car
  Seat 220, Booster Seat 38 and others.
- Full history reachable: yes, in the one CSV (1975 on). `vrdb_60days_daily.csv` (1.4 MB, 823 rows) is the cheap
  incremental, but it actually spans 2025-06-11 to 2026-09-22, not 60 days.
- Fields (15, from the CSV header; the variables file `recalls_variables.txt` returned a proxy 502 twice):
  RECALL_NUMBER_NUM, YEAR, MANUFACTURER_RECALL_NO_TXT (filled for 13,195 recalls), CATEGORY_ETXT/FTXT,
  MAKE_NAME_NM, MODEL_NAME_NM, UNIT_AFFECTED_NBR, SYSTEM_TYPE_ETXT/FTXT, NOTIFICATION_TYPE_ETXT/FTXT,
  COMMENT_ETXT/FTXT (free text: "Issue / Safety Risk / Corrective Actions", French is "Translation not available"
  on old rows), RECALL_DATE_DTE. There is no VIN range, no component part number, no manufacturer name other than make.
- Terms (verbatim, fetched 2026-10-03, dataset licence `ca-ogl-lgo` per open.canada.ca package_show):
  - https://open.canada.ca/en/open-government-licence-canada: "You are free to: Copy, modify, publish, translate,
    adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose."
  - same page: "If the Information Provider does not provide a specific attribution statement, or if you are using
    Information from several information providers and multiple attributions are not practical for your product or
    application, you must use the following attribution statement: Contains information licensed under the Open
    Government Licence – Canada."
  - dataset note (package_show): "The API excludes all the “inconsequential” or “non-safety related” recall data."
- Rights: **AMBER** (attribution only; same licence family as the Health Canada member). Commercial redistribution
  is expressly allowed.
- Scores: demand 4, rights 5, acquisition 5, structuring 3, freshness 5, onboarding 4, poor access 2.

## 2. NHTSA recalls (existing `nhtsa-recalls`, extended)

- Reachability: `static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip` 200, 14,904,195 bytes, Last-Modified
  2026-10-03 07:02; `FLAT_RCL_PRE_2010.zip` 200, 7,441,156 bytes; `RCL.txt` data dictionary 200;
  `FLAT_RCL.zip` is 404. API: `api.nhtsa.gov/recalls/campaignNumber?campaignNumber=26V421` 200 (JSON),
  `recallsByVehicle?make=&model=&modelYear=` 200, `products/vehicle/modelYears|makes?issueType=r` 200.
  `www.nhtsa.gov` (terms, robots, dataset pages) is Akamai 403 from this egress; `static.nhtsa.gov/robots.txt` is 404.
- Counts: 327,429 flat rows (PRE 83.8 MB + POST 311 MB uncompressed, tab-delimited latin-1, no header) = 30,347
  campaigns, report-received dates 1966-01-19 to 2026-10-01 (newest, two days old). By type: V 26,376, E 2,866,
  T 788, C 253, I 53, X 11. Since 2010: V 13,655, E 1,362, T 200, C 71.
- Full history: both zips together. There is no list-all API call; the API needs make+model+year or a campaign number.
- Fields (29, RCL.txt): RECORD_ID, CAMPNO, MAKETXT, MODELTXT, YEARTXT, MFGCAMPNO (filled 181,109 of 245,719
  post-2010 rows), COMPNAME, MFGNAME, BGMAN, ENDMAN, RCLTYPECD (V/E/C/T), POTAFF, ODATE, INFLUENCED_BY, MFGTXT,
  RCDATE, DATEA, RPNO, FMVSS, DESC_DEFECT, CONEQUENCE_DEFECT, CORRECTIVE_ACTION, NOTES, RCL_CMPT_ID, MFR_COMP_NAME,
  MFR_COMP_DESC, MFR_COMP_PTNO, DO_NOT_DRIVE, PARK_OUTSIDE. The API adds NHTSAActionNumber (investigation id, for
  example EA15001), overTheAirUpdate and parkIt/parkOutSide flags. The flat file has no GTIN or UPC; child-seat model
  numbers sit in MODELTXT.
- Terms (the only terms text readable): https://api.nhtsa.gov/ "API Use Policy": "This API is NOT meant to be used
  by any other applications to perform bulk VIN lookups. Users/Applications attempting bulk VIN lookups will be
  controlled by an automated traffic rate control mechanism to ensure optimal performance of the NHTSA websites and
  minimize adverse impact to its users." That restricts bulk API lookups only. No licence page could be read.
- Rights: **AMBER**. Free public download, no login, no paywall, and no terms found that forbid reuse (ADR-0018
  presumption); US government work basis (17 U.S.C. 105) is an inference, not a quoted statement. Conditions: take the
  flat files, not bulk API calls; re-read the terms from Worker egress; exclude NOTES free text pending review;
  attribute as manufacturer-reported Part 573 data.
- Scores: demand 4, rights 3, acquisition 5, structuring 3, freshness 5, onboarding 4, poor access 2.

## Linkage

| Join | Mode | Result |
| --- | --- | --- |
| CPSC `Inconjunctions[].URL` (`wwwapps.tc.gc.ca ... ?rn=`) to Transport Canada recall number | declared | 76/81 CPSC recalls resolve in the full VRDB CSV (24 ATV, 24 restricted-use vehicle, 21 snowmobile, 3 competition, 2 equipment, 2 motorcycle). 5 cite numbers absent from the file (2023565, 2023458, 2023081, 2021734 and one more). A further 4 CPSC recalls cite a Health Canada-index Transport Canada notice. |
| Transport Canada `MANUFACTURER_RECALL_NO_TXT` to NHTSA `MFGCAMPNO` + same make | declared | 13,195 TC recalls carry a manufacturer number; 5,384 match an NHTSA number exactly; 4,665 also agree on make or manufacturer. Random 20 hand-checked: 20/20 same OEM and same defect (Ford, GM, Forest River, Volvo, Audi and others). Child seats 0/220 and boosters 0/38 match this way; equipment 90, tires 1. |
| CPSC title/text names NHTSA, then manufacturer + model + date to an NHTSA C campaign | candidate | 13 CPSC recalls mention NHTSA; 10 are joint child-seat recalls (1998-2016) with an NHTSA campaign, all 10 correct (10/10). Two of them cite the number in text ("recall number 02E-027", "99E-022") whose digits match 02C027000 and 99C022000 but with the wrong type letter, so the number cannot be used verbatim. Only 2 of the 10 are after 2010. |
| CPSC manufacturer name + 90 days to any NHTSA campaign | rejected | 78 pairs for 44 CPSC recalls; 2 post-2010. First 20 hand-checked: about 2 clearly correct. Names alone are noise (Sears, Ward and Cosco match unrelated products). |
| Transport Canada child seat/booster/tire/equipment since 2010 to NHTSA C/T/E on make + shared model token + 90 days | candidate | 130/443 match; random 20 hand-checked: 16/20 correct, 4 not confirmable from the fields (Bridgestone Dueler vs Turanza, Maxi-Cosi Mico XP Max vs Coral XP, Britax B-Safe Gen2 vs Endeavours, Evenflo Big Kid AMP). |
| Health Canada index "Transport Canada" notices to VRDB (recall number in the notice title) | declared, not a dataset join | 9,904 TC-organisation notices in the Health Canada index (updated 2011-01-12 to 2026-09-29); 9,895 carry a number, 9,468 resolve to the VRDB. 8,514 VRDB recalls are not in the index, so the VRDB is the complete source. |

Honest limits: CPSC and NHTSA barely overlap after 2010 (CPSC left child car seats to NHTSA); the useful new
connection is vehicle-class recalls (ATV, off-road, snowmobile, equipment) between CPSC and Transport Canada, and the
Transport Canada to NHTSA manufacturer number for road vehicles.

## What "full history" acquisition would require

- Transport Canada: stream the 207 MB CSV (save it to R2 as the raw artifact; never load it whole), group rows by
  RECALL_NUMBER_NUM (about 8 rows per recall), parse COMMENT_ETXT sections. Refresh daily from the same URL (rebuilt
  daily) or the 1.4 MB 60-day file; key on RECALL_NUMBER_NUM + MAKE + MODEL. Normalise UNIT_AFFECTED_NBR ("2,700.00"
  strings), repair mojibake in a few rows, and treat YEAR as model year, not recall year.
- NHTSA: download the two zips (22 MB) to R2, stream the tab files (latin-1, no header, 29 columns), dedupe on
  CAMPNO (327,429 rows to 30,347 campaigns; one row per make/model/year/component, RCL_CMPT_ID is unique per row).
  The files are regenerated daily so an incremental is a diff on RECORD_ID. Use `campaignNumber` API calls only for
  detail and OTA/park flags on new campaigns, within the rate-control policy. Join to Transport Canada by the
  normalised MFGCAMPNO plus make, and to CPSC only as a reviewed candidate.
- Both: preserve raw artifacts, attribution strings, and the OGL / NHTSA conditions in the rights record.

## Other candidates

- USDA FSIS recall API (`us-fsis-recall-api-2026`): PARKED. Re-tested 2026-10-03, HTTP 403 Akamai Access Denied for
  `/fsis/api/recall/v/1` and for the RCL.txt media file; terms unread. Food, not a consumer-product member.
- EU Safety Gate, UK OPSS, ACCC, NZ MBIE: all HTTP 200 today and already SCREENED members of
  `home-product-recalls-global` with measured joins there; not re-measured. CPSC text names EU/UK/AU regulators in
  only 13 of 10,027 recalls, so there is no new declared CPSC link to add. They could become members of this dataset
  later through GTIN/Safety Gate case number, which is already recorded for the global dataset.
