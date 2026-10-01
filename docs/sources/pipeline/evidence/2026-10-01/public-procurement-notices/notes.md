# public-procurement-notices screen (2026-10-01)

Entity: one public tender / contract-award notice with buyer, classification (CPV or UNSPSC), value, and description text.
All measurements from this container with `User-Agent: data-foundry-scout (data@mail.proviciency.com)`, anonymous, no keys,
under 2 req/s. Script: `screen.py` (re-runs the numbers into `results.json`). Working copies of the CanadaBuys CSVs (19 MB and
15 MB) were not committed.

## CanadaBuys tender and award notices (publisher: Public Services and Procurement Canada)
- Reachability: open.canada.ca CKAN `package_show` 200; CSVs at `canadabuys.canada.ca/opendata/pub/...` 200 (the HTML pages on
  canadabuys.canada.ca return 403 to us, the open-data CSVs do not).
- Files: `tenderNoticeComplete` 184,527,500 bytes (not downloaded, over the 50 MB cap), `awardNoticeComplete` 102,471,330 bytes
  (not downloaded), yearly files 2022-23 .. 2026-27 plus 2009-2022 archives. Downloaded 2026-27 tender (19.0 MB) and award (15.2 MB).
- Counts, 2026-27 fiscal year: 3,148 tender rows (published 2026-04-01 .. 2026-09-28), 4,262 award rows (published 2026-04-01 ..
  2026-09-30). Files rebuilt daily (Last-Modified 2026-10-01); CKAN `metadata_modified` 2026-09-30.
- Identifiers: referenceNumber, solicitationNumber (100% filled), contractNumber, UNSPSC (91.4% tender, 97.8% award), GSIN (3.9% / 0.6%).
  No buyer or supplier registry id (names and addresses only).
- Free text: tenderDescription (98.6% filled), awardDescription (86.1%), EN and FR, HTML-escaped.
- Terms (https://open.canada.ca/en/open-government-licence-canada): "The Information Provider grants you a worldwide, royalty-free,
  perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to the terms below." and
  "This licence does not grant you any right to use: Personal Information; third party rights the Information Provider is not
  authorized to license;". Attribution statement required: "Contains information licensed under the Open Government Licence – Canada."
- Rights: AMBER (commercial use allowed; conditions are attribution, exclude personal information such as contact names/emails/phones
  and third-party rights).
- Linkage inside the member: 927 of 2,790 distinct award solicitationNumbers appear among the 3,039 tender solicitationNumbers of the
  same fiscal-year file (33%; the rest were tendered before 2026-04-01 or never published as tenders). Same publisher, so not an independence proof.

## UK Contracts Finder OCDS (publisher: Cabinet Office / CCS)
- Reachability 200 on `/Published/Notices/OCDS/Search`. Cursor pagination stops after 20 pages x 100 = 2,000 releases per query
  window, so a full backfill needs date-sliced windows. Sampled 2,000 award releases dated 2026-09-10 .. 2026-09-29 (newest = day
  before the run, daily cadence). Every release has tender.description (100%), CPV classification, awards[].value, parties with roles.
- Identifiers: OCID, notice id, buyer id `GB-CFS-*`, supplier `GB-COH-<Companies House number>` (482 distinct in the sample).
- Terms (https://www.contractsfinder.service.gov.uk/Home/TermsAndConditions): "You can reproduce content published on Contracts Finder and
  Find a Tender under the OGL as long as you follow the licence". The page also says most content is Crown copyright under the OGL, "except where otherwise stated".
  The OCDS package itself carries `license: http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/`.
- Rights: AMBER (OGL v3: attribution, no personal data: parties carry contactPoint names, emails and phones, which must be dropped, plus
  third-party rights carve-out).

## UK Find a Tender OCDS (publisher: Cabinet Office, same publisher as Contracts Finder)
- Reachability 200 on `/api/1.0/ocdsReleasePackages`; sampled 2,000 award releases 2026-08-03 .. 2026-09-29; newest release dated
  2026-10-01 (live). description 100%, CPV, `GB-COH`/`GB-UKPRN`/`GB-PPON` identifiers (779 distinct GB-COH suppliers).
- Terms: same OGL grant. The /Content/TermsAndConditions page footer reads "All content is available under the Open Government Licence
  v3.0 , except where otherwise stated" (the automatic quote check in screen.py missed it once, a fetch/format flake; the Contracts Finder quote above covers both services and was verified).
- Rights: AMBER, same conditions as Contracts Finder.
- Contracts Finder vs Find a Tender: 0 shared OCIDs in the two samples (different date windows and notice populations); 56 supplier
  Companies House numbers appear in both. Both are the Cabinet Office, so this is not counted as an independent join.

## EU TED (publisher: Publications Office of the European Union)
- Reachability: `POST https://api.ted.europa.eu/v3/notices/search` 200 with no key (docs: "does not require authentication, making it
  openly accessible to any system or user", https://docs.ted.europa.eu/api/latest/search.html). `ted.europa.eu/en/legal-notice` answers 200 to
  curl in screen.py but earlier probes returned HTTP 202 with an empty challenge body, so the TED legal notice could not be read reliably.
- Counts: 7,060,653 notices all time; 17,507 published since 2026-09-25 (cadence: about 3,000 per working day); newest sampled 2026-09-25 on
  that call. 1,019 notices since 2026-01-01 name a UK-registered winner.
- Identifiers: publication-number, notice-identifier, procedure-identifier (CN to CAN link: 22 of 25 sampled CANs have a CN with the same
  procedure-identifier), buyer-identifier, winner-identifier (national company numbers). Free text: notice-title, description-proc, description-lot.
  Note winner-name arrays are de-duplicated and not aligned to winner-identifier arrays, so pair them from the notice XML (https://ted.europa.eu/en/notice/<n>/xml answers 200).
- Terms: no TED-specific licence statement could be fetched. The Commission legal notice (https://commission.europa.eu/legal-notice_en)
  states: "content owned by the EU on this website is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence". Applies to commission.europa.eu
  content, so it is only indirect evidence for TED.
- Rights: AMBER, with the explicit condition that the TED/Publications Office reuse statement is confirmed before RIGHTS_DETERMINED
  (a rights record under ADR-0013 cannot rest on the Commission notice alone). Attribution (CC BY 4.0 style), exclude natural-person contacts, notice text is authored by national buyers.

## USAspending awards API (publisher: US Treasury, Bureau of the Fiscal Service)
- Reachability 200; `POST /api/v2/search/spending_by_award/` returned 50 rows; 191,110 contract awards in September 2026 alone; data updated 09/30/2026.
  Fields: Award ID (PIID), Recipient Name, Recipient UEI (100% filled in the sample), Description (free text), NAICS, PSC, awarding agency, amount. No CPV/UNSPSC.
- Terms: no data-terms page was readable: usaspending.gov pages are a JavaScript shell, `api.usaspending.gov` has no licence text, the repo LICENSE (CC0)
  covers code. Only README line fetched: "all federal spending data which is open source and provided to the public as part of the DATA Act".
  usa.gov (https://www.usa.gov/government-copyright) warns "Not everything that appears on a federal government website is a government work."
- Rights: UNKNOWN for our purposes, PARKED. Federal contract data is very likely public domain (US government work), but no readable quote exists, and the brief says do not guess.
  Reopen when a data-terms statement is quotable. It would add a UEI join target.

## SAM.gov Opportunities (publisher: GSA)
- `https://api.sam.gov/prod/opportunities/v2/search` unauthenticated returned 404 (the API requires a key, per the brief). Existing candidate
  `contractors-sam-entities` is PARKED on the same account/key blocker and D&B terms. PARKED, not worked around.

## Linkage (declared join: Companies House company number)
UK Companies House numbers appear in TED winner-identifier and in OCDS GB-COH supplier ids. Sample: 1,000 TED notices with a UK winner
(since 2026-01-01) holding 624 distinct Companies House-shaped ids (8 digits, or OC/NI-prefixed); 2,000 Contracts Finder and 2,000 Find a Tender award
releases (Aug-Sep 2026). Matches: 8 ids in Contracts Finder, 5 in Find a Tender, 12 distinct (02174990 is in both), over 17 TED notices.
Hand check of the same-company question from the notice XML and names: 11 of 12 same legal entity by name; 1 (NI606324) is the TED name "PlotBox" against
OCDS "GSS (NI) Limited" (a trading name, unconfirmed). Low recall is expected: the UK sample covers only about two months. 0 of 2,000 CF and 0 of 2,000 FTS OCIDs overlap each other.
CanadaBuys has no identifier shared with any other member (names only), so it stays unlinked at this stage; CPV vs UNSPSC is classification (filter, not join).
Note for the orchestrator: `tooling/test/source-pipeline.test.ts` line 293 limits `declared` keys to an identifier regex that does not include
Companies House numbers, so add `Companies House` to that regex, otherwise the declared key below fails that test.

## Scores
TED: strongest (7M notices, anonymous API, daily). UK OCDS: complete structured OCDS with supplier ids. CanadaBuys: bilingual descriptions, no entity ids.
Free-text structuring value is high everywhere (descriptions to CPV/UNSPSC mapping, value, lot and framework extraction). Poor existing access is lower for TED and the UK (free portals exist).
