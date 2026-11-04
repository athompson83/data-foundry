# Charity and nonprofit registry (dataset key `charity-nonprofit-registry`), screening 2026-10-04

Entity: one registered charity or tax-exempt nonprofit (identity, status, purposes, activities, finances). Four
independent national regulators were screened from this container with `User-Agent: data-foundry-scout
(data@mail.proviciency.com)`, at most ~2 requests per second, no keys, no login. Scripts: `screen.py` (measurements,
writes `results.json`) and `check_links.py` (records the hand-check, writes `hand_check.json`). Largest single download
was the UK zip (44 MB). Everything below is measured unless marked as a judgement.

## Verdict table

| Member | Publisher | HTTP | Records | Cadence | Rights | Stage |
| --- | --- | --- | --- | --- | --- | --- |
| ACNC Charity Register (AU) | Australian Charities and Not-for-profits Commission | 200 | 66,399 | weekly (CKAN modified 2026-09-27) | AMBER (CC BY) | SCREENED |
| CRA List of charities (CA) | Canada Revenue Agency | 200 | 83,761 charities (2024 return year) | annual (published 2026-04-30) | AMBER (OGL-Canada) | SCREENED |
| Charity Commission register (E&W) | Charity Commission for England and Wales | 200 | 396,297 rows, 184,090 Registered | daily (extract dated 2026-10-04) | AMBER (OGL v3.0) | SCREENED |
| IRS EO BMF and 990 e-file XML (US) | Internal Revenue Service | 200 | 1,964,958 BMF rows (stated); 990 XML | BMF monthly (posted 9/8/2026); 990 XML monthly (latest 2026-08-20) | GREEN (US government work) | SCREENED |
| ProPublica Nonprofit Explorer API (US) | ProPublica | 200 | n/a | n/a | RED | PARKED |

## ACNC Charity Register (Australia)

- Source: CKAN dataset https://data.gov.au/data/dataset/b050b242-4487-4306-abf5-07ca073e5594 (API `package_show` HTTP 200).
  CSV resource `datadotgov_main.csv`, 15,117,409 bytes, 66,399 rows, 69 columns. Dataset description: "###_NOTE: This dataset is
  updated weekly. Please ensure that you use the most up-to-date version._###". Newest non-future registration date 2026-09-15
  (one row, ABN 30875120742, carries a future date 2026-10-21: a source data-quality defect to flag in validation).
- Identifiers: `ABN` (65,792 of 66,399 populated). Website populated on 43,775 rows. Twelve purpose flags (advancing health,
  education, religion, ...) and 29 beneficiary flags, as Y/blank, plus operating states and countries.
- Free text: only `Charity_Legal_Name` and `Other_Organisation_Names`. This extract has no mission or activity prose and no
  finances. Finances are in the separate per-year "ACNC Annual Information Statement (AIS) Data" datasets on the same portal
  (found by `package_search?q=ACNC`, 56 results; several years carry licence "notspecified" or CC BY 2.5, so each year needs its own
  licence read before use). Classified structured.
- Terms. Portal licence field: "Creative Commons Attribution 3.0 Australia" (license_url http://creativecommons.org/licenses/by/3.0/au/).
  Quoted from https://creativecommons.org/licenses/by/3.0/au/ : "Share — copy and redistribute the material in any medium or format for any purpose, even commercially."
  and "Attribution — You must give appropriate credit".
- Rights: AMBER. Conditions: attribute ACNC and link the licence, state if changed, do not imply endorsement; re-read the licence
  of each AIS year before use; the register has a published responsible-persons note ("names of any Responsible Persons" are only
  on the live register), so none of that is in scope.

## Canada Revenue Agency List of charities (Canada)

- Source: open.canada.ca CKAN `package_search` HTTP 200; per-return-year datasets "1990" to "2024 List of charities" under
  organization `cra-arc`. 2024 dataset id 80c00cdb-1358-415c-bb8b-0de7f12675b8, frequency P1Y, date_published 2026-04-30.
  The portal `metadata_modified` of all recent years reads 2026-10-04 (a portal-side touch, not a new return year). 22 CSV resources
  per year: identification, financial data, programs, directors, qualified donees, Schedule 2 activities abroad, Schedule 3 compensation,
  Schedule 7 political activities, web URLs.
- Measured: `ident_2024_updated.csv` 13,203,780 bytes, 83,761 charities; fields `BN, Category, Sub Category, Designation, Legal Name,
  Account Name, address, Province, Postal Code, Country`. `new_ongoing_programs_2024_updated.csv`: first 4 MB sampled, 11,515 program rows,
  FPE all 2024; description median 206 chars, p90 664 chars (free prose, e.g. "Cat rescue organization  take in stray and unwanted
  cats  spay and neuter  adopt to loving homes."). `weburl_2024_updated.csv` 34,371 URLs.
- Identifier: `BN` (9-digit business number plus `RR0001`). Free text: program descriptions and Schedule 7 political-activity descriptions.
  Files are served through a 302 to an Azure blob with a short-lived SAS token, so the artifact URL must be re-resolved on each fetch.
- Terms, quoted from https://open.canada.ca/en/open-government-licence-canada : "The Information Provider grants you a worldwide,
  royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below."
  Exemption on the same page: "This licence does not grant you any right to use: Personal Information;". Attribution statement if none
  is given: "Contains information licensed under the Open Government Licence – Canada."
- Rights: AMBER. Conditions: attribution statement; exclude the directors/officers and compensation files (personal information
  exemption); no endorsement implication.

## Charity Commission for England and Wales register extract (UK)

- Source: https://register-of-charities.charitycommission.gov.uk/en/register/full-register-download (HTTP 200) lists the "publicextract"
  zips in txt and json (charity, annual return history/part A/part B, area of operation, classification, governing document,
  other names, policy, published report, trustee). `publicextract.charity.zip` (txt) HEAD: 44,181,908 bytes, Last-Modified 2026-10-04 01:08 GMT,
  so it refreshes daily. Measured in full: 396,297 rows, 184,090 `Registered` (rest removed), `date_of_extract` 2026-10-04.
- Identifiers: `registered_charity_number`, `organisation_number`, `charity_company_registration_number` (31,303 registered rows) which is a declared
  link to a company registry, but no company registry is a member here. Finances: `latest_income`, `latest_expenditure`.
- Free text: `charity_activities` populated for 163,277 registered charities, median 203 chars. `charity_contact_web` 102,495 rows.
- Terms, quoted from the page: "All content is available under the Open Government Licence v3.0 , except where otherwise stated" (page footer; the
  space before the comma is as printed).
- Rights: AMBER. Conditions: OGL v3.0 attribution ("Contains public sector information licensed under the Open Government Licence v3.0");
  the extract has `charity_contact_email`, `charity_contact_phone` and a trustee table that are personal data: exclude them by default;
  do not use the trustee file.

## IRS Exempt Organizations BMF and Form 990 e-file XML (United States)

- BMF page https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf HTTP 200: "Updated data
  posting date: 9/8/2026 Record count: 1,964,958", one CSV per state. Measured `eo_vt.csv` (Vermont): 6,566 rows,
  fields `EIN, NAME, STREET, CITY, STATE, ZIP, SUBSECTION, RULING, DEDUCTIBILITY, FOUNDATION, ASSET_AMT, INCOME_AMT, REVENUE_AMT, NTEE_CD, STATUS`;
  NTEE populated on 4,663 of them. No prose.
- 990 series: https://www.irs.gov/charities-non-profits/form-990-series-downloads, monthly zips plus `index_2026.csv`, latest XML posting 2026-08-20
  per the bulk-downloads page. `2026_TEOS_XML_01A.zip` is 314,704,706 bytes (too large to fetch); the first 8,000,000 bytes were
  range-fetched and 1,470 complete XML filings decoded (990 781, 990EZ 503, 990PF 157, 990T 29). 1,284 of them have mission/activity/purpose text
  (`MissionDesc`, `ActivityOrMissionDesc`, `PrimaryExemptPurposeTxt`), plus program descriptions and revenue. This is the free-text member
  within the US source, structured BMF plus prose 990 XML.
- Identifier: `EIN`. The XML also contains officer and signer names, phone numbers and street addresses: exclude people fields.
- Terms: the IRS page states no licence. The determination rests on US law, quoted from https://www.copyright.gov/title17/92chap1.html (17 U.S.C. 105):
  "Copyright protection under this title is not available for any work of the United States Government". IRS content is a government work; the filings
  are public records the IRS posts for download with no login.
- Rights: GREEN (US government work, ADR-0013), with a personal-data exclusion for officer, signer and contact fields. Note that the
  BMF is derived from filings by the organisations; third-party attachments inside XML may carry their own rights, so publish extracted fields, not
  the raw attachments.

## ProPublica Nonprofit Explorer API (PARKED, RED)

- https://projects.propublica.org/nonprofits/api HTTP 200; JSON API v2, no key. It republishes the IRS data above, so it adds nothing the IRS
  member does not carry.
- Terms: the API page says "Usage constitues agreement to our Data Terms of Use" (sic) and links https://www.propublica.org/about/propublica-data-terms-of-use, which says:
  "You can’t republish the raw data in its entirety or otherwise distribute the data (in whole or in part) on a stand-alone basis." and
  "You can’t sub-license or resell the data to others."
  The same page also says "You can’t charge people money to look at the data". This forbids resale and redistribution: RED, parked, not
  worked around. The IRS primary source is used instead.

## Linkage measurement

Declared identifiers: none. Each register keys on its own national ID (ABN, BN, charity number/company number, EIN) and no column in any
member names another member's identifier. UK `charity_company_registration_number` would be declared if a company registry became a member.
So every cross-source link here is a candidate (reviewed), never automatic. What the candidates mean: international charities register a
national affiliate in each country (e.g. "World Bicycle Relief Australia Limited" and "WORLD BICYCLE RELIEF CANADA"). Those are separate legal
entities, so a link is `affiliate-of`, not an identity merge. Hand-check rule recorded in `check_links.py`: correct = same named organisation or
direct national affiliate of the same named parent; platform domains (facebook, google, linktr.ee ...) and different local units (congregations,
parishes, branches) are wrong. The judgement is mine and listed domain by domain in `hand_check.json`.

Website domain (normalised host from each register's own website field), full registers, platform domains dropped:

| Pair | Shared domains | Hand-checked correct |
| --- | --- | --- |
| ACNC vs CRA | 36 (46 before dropping platforms) | 29/36 |
| ACNC vs UK | 151 (161 raw) | 124/151 |
| CRA vs UK | 59 (66 raw) | 45/59 |

Wrong examples: `bahai.org` (local spiritual assemblies), `jw.org` (individual congregations), `anu.edu.au` (a childcare centre vs the ANU UK
foundation), `fb.com`/`m.me`/`none.com` (shared hosts), `tjc.org` (local churches).

Exact normalised legal name (lower-case, ASCII, drop "the/inc/ltd/limited/society/association/foundation/trust/charity/charitable/of"):
ACNC vs CRA 483 matches, ACNC vs UK 820, CRA vs UK 773. Precision is poor: a random sample of 25 ACNC vs UK name matches (`random.seed(7)`) had
8/25 correct (BAPS Charities, Hothouse Theatre, Empart, Justsow Giving, Muslim Care, British Council, Child Migrants Trust, Bible League); the rest
are different organisations sharing generic names ("all saints church", "hastings", "smiles", "believe"). Names alone therefore stay candidates
and website domain is the stronger candidate key.

US sample (1,416 distinct filer names from the 990 XML slice): name matches vs ACNC 5, CRA 12, UK 15, hand-checked 0/5, 1/12 (The Mission of
Tao-Confucianism), 2/15 (Love146, Variety - the Children's Charity). Vermont BMF (5,896 distinct names) vs ACNC/CRA/UK: 38/59/53 raw name matches, not hand-checked.
The US member is therefore weakly connected to the others, which is honest: US 501(c)(3)s rarely register abroad under the same name.

## Scoring reasoning

- agent_demand 4: "who runs charity X, what are its purposes and finances, which national affiliates share its brand" is a common due-diligence, giving and
  compliance question; sanctions and KYC use cases also want charity status.
- rights_clarity 4 for OGL/CC BY/US-government sources (conditions are plain attribution); ProPublica 1.
- acquisition_ease 5 for CKAN CSV and daily zip, 4 for the IRS (large state files, 314 MB XML zips need ranged or batch handling).
- structuring_value 4: purposes/activities prose becomes typed fields (purpose class, beneficiaries, activity country) under one taxonomy; ICNPO or NTEE
  mapping across countries is real normalisation work.
- freshness: UK daily, ACNC weekly, IRS monthly, CRA annual.
- poor_existing_access 3: each register has a search UI and bulk files, but no single multi-country machine feed (ProPublica and Candid cover the US only; Candid is paid).

## Parked or rejected, and caveats

- ProPublica Nonprofit Explorer: RED, see above.
- Not screened (no measurement made): New Zealand Charities Services register, Ireland Charities Regulator, Scotland OSCR, GivingTuesday and Candid (paid).
  Next scout: OSCR and NZ Charities Services are the likeliest additional free members.
- UK extract includes removed charities (212,207 of 396,297 rows): publish status and removal date, do not present them as active.
- Declared linking would need a company-registry member (UK charity company number) or a cross-border ID such as LEI or Wikidata QID; neither was
  present in any member extract (no LEI or Wikidata column in ACNC, CRA, UK or IRS files).
