# legislation-bills-and-acts (category legal), screened 2026-10-03

Entity: a bill or Act with status history, sections, effective dates and amendments as typed structure. All numbers come from `screen.py` (`results.json`) and `check_titles.py` (`check_titles.out`), run 2026-10-03 with the scout User-Agent, at most 2 requests per second, no keys, no login.

Verdict: dataset PASSES at SCREENED on Canada: two non-RED members from different publishers and hosts, one declared join with matches (39/136). Four further sources were screened: two as separate SCREENED feeds without a counterpart (UK, US) and two PARKED (LEGISinfo, Australia).

## Justice Laws consolidated Acts, Canada (legislation-ca-justice-laws) - AMBER, SCREENED
- Reachable: `https://laws-lois.justice.gc.ca/eng/XML/Legis.xml` 200, 5.28 MB; 971 English Acts (1,942 listings across both languages), every row `CurrentToDate` 2026-09-21 (nightly-to-weekly consolidation cadence).
- Identifiers: `UniqueId` (e.g. A-0.6), `OfficialNumber` (499 of the 971 are `YYYY, c. N` statute chapters, the rest are chapter-less consolidations such as `A-1`), `LinkToXML`.
- Per-Act XML (25 sampled, all HTTP 200, 3 KB to 1.5 MB): `Identification` with `Parliament/Session/Number`, `BillNumber` (15 of 25 populated; older Acts omit them), `AnnualStatuteNumber`, `RecentAmendments/AmendmentCitation` (e.g. `2023, c. 8`, `SI/2019-55`), `lims:inforce-start-date` attributes (up to 6,009 in one Act), sections and free text (up to 697,000 characters).
- Terms (quoted from `https://laws-lois.justice.gc.ca/eng/XML/SI-97-5.xml`): "Anyone may, without charge or request for permission, reproduce enactments and consolidations of enactments of the Government of Canada, and decisions and reasons for decisions of federally-constituted courts and administrative tribunals, provided due diligence is exercised in ensuring the accuracy of the materials reproduced and the reproduction is not represented as an official version."
- Also read at `https://laws-lois.justice.gc.ca/eng/ImportantNote`: "The Department of Justice Canada assumes no responsibility for the accuracy or reliability of any reproduction derived from the legislative material on this site."
- Verdict AMBER (commercial reuse allowed without permission; conditions: due diligence, not presented as official, carry currency date). Scores: demand 4, rights 4, acquisition 5, structuring 4, freshness 5, onboarding 4, poor existing access 3 (the site is searchable but bulk typed amendment and in-force data is little used).

## Canada Gazette Part III (legislation-ca-gazette-part3) - AMBER, SCREENED, free text
- Index pages `https://gazette.gc.ca/rp-pr/p3/YYYY/index-eng.html` returned 200 for all 26 years 2000-2025 but only 2020-2025 parse (chapters per year: 15, 27, 21, 33, 34, 6; total 136 distinct `S.C. YYYY, c. N`). Pre-2020 pages use another layout and gave 0 (parser gap, not absence). 2025 volume 48 was modified 2026-04-03 and lists chapters 1 to 6; Part III is "published, at the request of Justice Canada, whenever there are enough enacted acts" (batchy cadence).
- Each volume links one PDF (`/rp-pr/p3/2025/g3-04801.pdf`, range-read 400 KB, valid `%PDF-`), so the enacting text is free text in PDF.
- Rights: the Gazette's own footer points to `https://www.canada.ca/en/transparency/terms.html`, which grants only "non-commercial purposes" reproduction for general material. Commercial reuse of the enactments rests on the Reproduction of Federal Law Order quoted above (enactments are covered). Verdict AMBER with that condition; publish enactment text only. Scores: demand 3, rights 3, acquisition 3, structuring 4, freshness 3, onboarding 3, poor existing access 4.

## Linkage (Gazette Part III to Justice Laws)
- Declared join on the cited statute chapter reference number: Gazette `(S.C. 2023, c. 17)` equals Justice Laws `OfficialNumber` `2023, c. 17`.
- Result: 39 of 136 Gazette chapters (2020-2025) match a Justice Laws OfficialNumber (255 Justice chapters fall in 2000-2025, 15.3 percent matched in that range because only 2020-2025 Gazette pages parse). Unmatched chapters are amending Acts with no standalone consolidation; their chapter appears instead in `RecentAmendments` of the amended Act (for example T-19.8 cites `2026, c. 7`, `2022, c. 10`, `2024, c. 17`), a second declared route not yet counted.
- Hand check of the 9 matched 2023 chapters (`check_titles.out`): 9 of 9 identical titles (Canada Disability Benefit Act c. 17, Online News Act c. 23, and seven others).
- Second measured join, PARKED member: Justice Laws `Parliament/Session/BillNumber` to LEGISinfo `ParliamentNumber/SessionNumber/NumberCode`: 15 of 15 sampled Acts match (declared by a named bill number). It cannot count toward the dataset while LEGISinfo is parked.

## Parliament of Canada LEGISinfo (legislation-ca-parl-legisinfo) - UNKNOWN, PARKED
- `https://www.parl.ca/legisinfo/en/bills/json?parlsession=all` 200: 7,145 bills over 20 sessions (35-1 to 45-1), 1,081 with royal assent, newest assent 2026-06-18, stage dates for each reading, sponsor, bilingual titles. `StatuteChapter` and `StatuteYear` are present as fields but empty in all 7,145 rows, so the chapter join must go through the bill number.
- Terms (`https://www.parl.ca/ImportantNotices-e.html`): "Permission to reproduce—in whole or in part—or to otherwise use the content of this website may be sought from the appropriate source." No open licence is stated, and the open-data page (`https://www.parl.ca/legisinfo/en/open-data`) returned a system-error page. The House of Commons notice (`https://www.ourcommons.ca/en/important-notices`) restricts commercial use of proceedings. Parked UNKNOWN; no workaround attempted.

## UK legislation.gov.uk (legislation-uk-gov-acts) - AMBER, SCREENED (no counterpart yet)
- `https://www.legislation.gov.uk/ukpga/data.feed` 200: 17,560 Public General Acts, feed updated 2026-10-02, 20 entries per page, ids like `http://www.legislation.gov.uk/id/ukpga/2025/36`; Year and Number fields; royal assent date not in the feed entry. `ukpga/2018/12/data.xml` is 5.9 MB with 306 section groups, 1,803 `RestrictStartDate` attributes (point-in-time) and 2,086 commentaries (amendment effects).
- Terms (`https://www.legislation.gov.uk/developer/formats/xml`): "All content is available under the Open Government Licence v3.0 except where otherwise stated." Verdict AMBER (attribution, exclude EUR-Lex-derived content). Scores: demand 4, rights 4, acquisition 5, structuring 5, freshness 5, onboarding 4, poor existing access 2.
- UK Parliament Bills API `https://bills.parliament.uk/api/v1/Bills` answered 403, so no second UK publisher was measured; not added to the dataset.

## GovInfo BILLSTATUS (legislation-us-govinfo-billstatus) - GREEN, SCREENED (no counterpart yet)
- Directory `https://www.govinfo.gov/bulkdata/BILLSTATUS/119/hr` 200 with 10,714 House bill files; each file is XML (6 to 22 KB sampled, 27 files, all 200), updateDate newest 2026-09-29, fields: bill number and type, introducedDate, actions, sponsor bioguideId, committees, CBO estimates, summaries, `laws` (HR 1 gives 119-21, HR 4 gives 119-28; 25 random bills had no law).
- Terms (`https://www.govinfo.gov/about/policies`): "Copyright protection under this title is not available for any work of the United States Government". GREEN. Scores: demand 5, rights 5, acquisition 4, structuring 4, freshness 5, onboarding 4, poor existing access 2.
- No independent counterpart: `https://uscode.house.gov/download/download.shtml` serves a "Site is currently under maintenance" page and the zips answer 403; `https://api.congress.gov/v3/bill` answers 403 without a key. Federal Register citations of "Public Law 119-21" are the obvious next test but overlap federal-register-obligations, so not run.

## Australia Federal Register of Legislation (legislation-au-federal-register) - UNKNOWN, PARKED
- `https://api.prod.legislation.gov.au/v1/titles` 200 (OData): 13,744 Acts; 2025 Acts carry `originatingBillUri` to ParlInfo (e.g. r7351), `statusHistory`, `nameHistory`. The copyright and help pages are script-rendered; fetched text had no licence wording. Parked until terms are readable.

## Rejected or not attempted
- EUR-Lex/Cellar: not screened (brief: only if open; EU-derived content is already excluded from the OGL grant on legislation.gov.uk).
- Congress.gov API: needs an API key (credential), rejected.
- OLRC US Code bulk: under maintenance / 403, parked as an access failure, not recorded as a candidate.

## What would make this dataset stronger
Confirm the LEGISinfo terms (adds stage history and 7,145 bills, 15/15 bill-number match), parse pre-2020 Gazette volumes, and find a US or UK counterpart (a second publisher naming public law or Act numbers) so the portfolio is not Canada-only.
