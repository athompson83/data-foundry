# building-permits (home-services) - screening notes, 2026-10-03

Entity: a municipal building or trade permit with free-text work description, linked to the parcel or address and the
licensed contractor. Script: `screen.py`; measured output: `results.json` (all counts below come from it, fetched
2026-10-03 with the scout User-Agent, about 2 req/s, no keys). Existing keys read first: contractors-wa-lni-licences
(AMBER, SCREENED), contractors-nyc-dob-licences (PARKED RED), contractors-ca-cslb-master (DISCOVERED, download blocked by
the CSLB firewall), plus the other contractors-* members. No existing key mentions permits.

## Verdict

| Member | Rights | Stage | Why |
|---|---|---|---|
| building-permits-seattle-sdci | AMBER | SCREENED | Public Domain licence in metadata; portal terms bar list-of-individuals commercial use |
| building-permits-sf-dbi (permits + contacts) | AMBER | SCREENED | PDDL; no re-identification; contacts hold natural-person names |
| building-permits-sf-assessor-roll | AMBER | SCREENED | PDDL; parcel attributes only |
| building-permits-chicago-dbs | UNKNOWN | PARKED | terms page 403, licence placeholder, natural-person contacts |
| building-permits-nyc-dob (DOB NOW + BIS) | UNKNOWN | PARKED | licence null, terms unreadable, owner and applicant names |
| building-permits-la-ladbs | UNKNOWN | PARKED | licence null, terms page 403, no contractor column |

The dataset passes the screening gate: Seattle (seattle.gov) and WA L&I (wa.gov) are non-RED, share no registrable domain,
and are joined by a hand-checked name link (18 of 22 correct). It is weak: the link is name-only and covers a minority of
Seattle rows.

## Seattle SDCI building permits (data.seattle.gov 76t5-zqzr)

- HTTP 200 on metadata, count and rows. 193,407 rows; `issueddate` 1900-01-01 to 2026-10-01; rows updated 2026-10-03
  (daily). `description` non-empty on 192,619 rows (free text, for example "Construct additions and alterations to
  existing one family dwelling per plan.").
- Identifiers: `permitnum`, `originaladdress1/city/zip`, latitude/longitude. No parcel number, no contractor licence number.
  `contractorcompanyname` on 32,086 rows (16.6 percent); 5 of the 40 most recent rows. It is sometimes a natural person
  (for example "Lorrie Voigt" on a 2025 permit), so it needs entity filtering.
- Personal data: no owner or applicant fields. The only exposure is a person-name contractor value; exclude by matching to a
  business-entity licence record.
- Terms (https://data.seattle.gov/stories/s/Data-Policy/6ukr-wvup/, fetched 200): "To the extent the data consists of a list
  of individuals or can be readily sorted, filtered, or configured as a list of individuals, it is not to be used for a
  commercial purpose." and "Unless otherwise indicated, data on this site does not require specific attribution." Dataset
  licence: Public Domain.
- Rights: AMBER. Public Domain licence is express; the list-of-individuals clause is met by publishing per-property and
  per-business records only.
- Scores 4/4/5/4/5/4/3.

## San Francisco DBI permits and contacts (data.sfgov.org i98e-djp9, 3pee-9qhc)

- HTTP 200 (data.sfgov.org 301-redirects metadata to data.sf.gov, followed). Permits: 1,296,335 rows, 1906-11-08 to
  2026-10-01, updated 2026-10-02; `description` on 1,277,594 rows (lower-case free text, for example "remove and replace
  (e)plywood sheeting with 1/2 cdx plywood ..."). Identifiers: `permit_number`, `block`, `lot`, address, `record_id`.
- Contacts: 1,035,855 rows; role `contractor` on 585,805 rows, of which 585,340 carry `license1` (a state CSLB licence
  number such as 552877) plus `firm_name`, `firm_address`, `sf_business_license_number`. Same publisher as the permits, so
  the permit_number join is internal, not a cross-source link. Data quality: newest `from_date` is 2048-11-06 (invalid).
- Personal data: contacts carry `first_name` (39 of 40 sampled), `last_name` (36), `agent_address` (4). Exclude all three;
  keep firm name, firm address and licence number for role contractor only, and drop rows without a firm.
- Terms (https://www.sf.gov/reports/april-2017/datasf-terms-use, fetched 200): "Except where otherwise stated in the file
  containing such Data or on the page from which such Data is accessed, including its metadata, Data is made available under
  the Public Domain Dedication and License v1.0". Metadata of both datasets states PDDL. The same page forbids
  re-identification of individuals.
- Rights: AMBER (PDDL is an express commercial grant; conditions are the personal-name exclusions).
- Scores 4/4/5/4/5/4/3.

## San Francisco Assessor secured roll (data.sfgov.org wv5m-vpq2)

- HTTP 200; PDDL in metadata; roll years through 2025; fields block, lot, parcel_number, use, year built, units, zoning,
  assessed values; no owner names. Annual, so freshness 2. Different publisher (Assessor-Recorder) from DBI but the same
  registrable domain, so it does not count as an independent member in the test.
- Linkage (permit block+lot to roll block+lot, exact): 60 of 60 recent permits (issued 2026) matched an assessor parcel
  (51 distinct parcels, 56 distinct permits). Hand check of the 8 recorded examples: street name of the permit appears in the
  assessor `property_location` in 8 of 8 (for example 738 North Point St to 0738 NORTH POINT ST). Block/lot is an exact parcel
  identifier but is not in the test's declared-key list, so it is recorded as `candidate` with reviewed 8/8.
  Caveat: a permit block can carry a letter suffix (0554C) that I did not see miss in this sample, and condo lots map
  to different parcels than the street address.
- Terms: same DataSF page as above. Rights AMBER (roll-year as-of date shown).
- Scores 3/4/5/3/2/4/3.

## Contractor cross-check: Seattle to WA L&I (existing contractors-wa-lni-licences)

- Seattle publishes only a company name, so the join is `candidate` (name only, never auto-merged). Method: 40 distinct
  normalised contractor names from 120 recent Seattle permits (issued after 2025-06-01, name length at least 6), looked up in
  data.wa.gov m8qx-ubtq (businesstype not Individual) by exact normalised name (upper-case, punctuation and legal-form tokens
  dropped).
- Result: 22 of 40 matched a WA licence name (55 percent). Hand check (name, legal form, number of candidate licences, status):
  18 correct, 4 not confirmed: Valentine Roofing (two WA candidates, the shown one EXPIRED), Kitsap Roofing and Rainier Roofing
  Company (two candidates each), ZR Roofing Inc vs ZR ROOFING (Partnership, EXPIRED, form mismatch). Reported as reviewed
  correct 18, checked 22. This is plausibility by name, form and uniqueness, not confirmation on the permit page.
- Not matched (18 of 40): causes not examined (could be natural persons, name variants or unlicensed firms).
- Because only 16.6 percent of Seattle permits have a contractor name, effective permit-to-licence coverage is about 9 percent
  (16.6 x 0.55). That is the honest figure to build against.

## Contractor licence-number cross-check (declared) - not possible this round

- SF contacts `license1` is a CSLB number, but contractors-ca-cslb-master is not downloadable from this egress (firewall
  rejection recorded 2026-09-27), so the declared SF-to-CSLB join is 0/0 (unmeasured).
- NYC BIS `permittee_s_license__` and `hic_license` (33,225 rows) would link to NYC DCWP "Issued Licenses" (data.cityofnewyork.us
  w7w3-xahh, licence number `license_nbr`), but NYC DOB is parked on rights, and contractors-nyc-dob-licences is already
  PARKED RED. Not measured.
- Seattle, Chicago and LA publish no contractor licence number.

## Chicago building permits (data.cityofchicago.org ydr8-5enu) - PARKED UNKNOWN

- HTTP 200. 849,358 rows, 2006-01-03 to 2026-10-02, updated 2026-10-03; `work_description` on 848,479 rows. Identifiers:
  `permit_`, `pin_list` (Cook County PIN; present on 30 of 40 sampled), address. Up to 15 `contact_N_name/type/city` triples
  (types in sample: OWNER 38, WEB APPLICANT 28, ELECTRICAL CONTRACTOR 19, GENERAL CONTRACTOR 11). No licence number column.
- Personal data: `contact_1_name` present on 40 of 40 sampled, `contact_2_name` 40, `contact_3_name` 37; these include owners
  and natural persons.
- Terms: portal footer links `http://www.cityofchicago.org/city/en/narr/foia/data_disclaimer.html` ("Terms of Use"), which
  returned HTTP 403 (also the https and www.chicago.gov variants). Dataset licence is the placeholder "See Terms of Use".
  Unreadable terms, so no quote: PARKED UNKNOWN. Not worked around.

## NYC DOB NOW and DOB permit issuance (data.cityofnewyork.us rbx6-tga4, ipu4-2q9a) - PARKED UNKNOWN

- HTTP 200. DOB NOW: 1,009,464 rows, issued 2016-06-23 to 2026-10-01, updated 2026-10-02, `job_description` on 1,009,462
  rows, `bbl` on 39 of 40 sampled. BIS issuance: 3,990,806 rows, run date 2026-10-02, issuance dates through 10/01/2026,
  `hic_license` on 33,225 rows, `permittee_s_license__`; no description field.
- Personal data: DOB NOW `owner_name` 40 of 40 sampled, applicant first/last name 40 of 40; BIS permittee first/last name and
  phone 35 of 40, owner first/last name 40 of 40.
- Terms: dataset licence null. nyc.gov terms (https://www.nyc.gov/main/terms-of-use, fetched 200) carry no open-data clause;
  the Open Data terms point to the NYC Admin Code page that returned 403 on 2026-09-27 (research-2026-09-27-composites.md).
  PARKED UNKNOWN.

## Los Angeles LADBS permits (data.lacity.org pi9x-tg5x, gwh9-jnip) - PARKED UNKNOWN

- HTTP 200. 414,950 issued permits 2020-01-01 to 2026-09-26, updated 2026-09-28 (weekly per metadata);
  `work_desc` on all rows; `apn` and `pin_nbr` present on 40 of 40 sampled; no owner or contractor columns (no personal data
  in the table, but also no contractor link).
- Terms: dataset licence null; `https://www.lacity.gov/data-terms-use` and `https://www.lacity.gov/terms-use` returned 403; no
  terms footer link on data.lacity.org/browse. PARKED UNKNOWN.

## Summary of linkage numbers

- SF permit to SF Assessor roll, block+lot: 60/60 (same host, so not counted as independent; reviewed 8/8).
- Seattle contractor name to WA L&I: 22/40 matched, reviewed 18/22 correct (candidate only).
- Declared licence-number joins: none measurable (CSLB unavailable, NYC parked).

## What would make this stronger

Add a declared parcel join for Seattle (King County parcel, address-to-PIN), recover the CSLB master for SF licence numbers
(declared, 585k contractor rows), and reopen Chicago/NYC/LA if their terms become readable.
