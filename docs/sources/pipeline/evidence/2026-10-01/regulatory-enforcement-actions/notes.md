# regulatory-enforcement-actions: screening notes (2026-10-01)

Entity: an enforcement action (warning letter, civil or administrative case, litigation release, consumer-protection
order) against a named company, with violation narrative. All numbers below come from `screen.py` (run 2026-10-01,
output `results.json`); raw responses were cached outside the repo. Requests were at most about 2 per second (FTC:
one per 5.2 s, matching its robots.txt `Crawl-delay: 5`), declared User-Agent, no keys, no login.

Verdict: dataset passes the screening gate. 6 non-RED members from 6 publishers and hosts; no declared cross-publisher
join matched (0 shared court case numbers), but four candidate (name) joins have hand-confirmed same-company matches.
2 members PARKED (UK FCA, UK ICO).

## FDA warning letters (fda-warning-letters): AMBER
- Index: `https://www.fda.gov/datatables/views/ajax?...view_name=warning_letter_solr_index...` HTTP 200, `recordsTotal` 3,723
  (all 3,723 rows fetched in 4 requests of 1,000). Issued 2021-01-04 onward; newest posted 2026-09-29; 54 posted since 2026-09-01.
- Fields in the index: posted date, issue date, company link, issuing office (center), subject line. Letter pages: 26 of 26
  sampled returned full text (median 10,625 characters), free text: violation narrative, cited 21 CFR / FD&C Act sections.
  Identifiers: MARCS-CMS number in 10/26 sampled letters (and in every URL slug); "FEI" appears in 8/26 letters. 0/26 cite a court case number.
- Header carries recipient personal name, title and e-mail on 26/26 sampled letters (personal data, to be excluded).
- Terms (https://www.fda.gov/about-fda/about-website/website-policies): "Unless otherwise noted, the contents of the FDA website (www.fda.gov) — both text and graphics — are not copyrighted. They are in the public domain and may be republished, reprinted and otherwise used freely by anyone without the need to obtain permission from FDA."
- Rights: AMBER (public domain, but personal contact data and (b)(4) redactions need handling). The datatable feed is an undocumented site endpoint.

## EPA ECHO enforcement cases (epa-echo-enforcement-cases): AMBER
- `case_rest_services.get_cases` HTTP 200 with `p_case_category=JDC`: 18,652 rows (15,783 civil judicial + 2,869 criminal);
  `get_case_info` reports 312,444 cases in total (15,783 judicial, 293,792 administrative, 2,869 criminal). The unfiltered
  administrative query is refused ("Queryset Limit would be exceeded"), so a full pull needs state or year slicing.
- I fetched 13,652 of the 18,652 listed rows: 5 of 19 pages failed after 3 retries (intermittent HTTP 503 from echodata.epa.gov). Newest filed 2026-09-25.
  7,374 listed rows carry a court docket and 2,709 a DOJ docket; 3,563 show a federal penalty above $0.
- `get_case_report` for the 30 most recently filed cases: 28/30 have a free-text CaseSummary, 27/30 FRS registry ids, 30/30 defendants, 24/30 a court or DOJ docket (formats such as `90-5-1-1-12725`), plus milestones and penalties. The listing is a structured feed; narrative is short.
- Terms (https://www.epa.gov/web-policies-and-procedures/epa-disclaimers): "These documents may be freely distributed and used for non-commercial, scientific and educational purposes. Commercial use of the documents available from the EPA websites may be protected under the U.S. and Foreign Copyright Laws." No ECHO-specific licence page was found (echo.epa.gov FAQ and data-use pages carry none).
- Rights: AMBER, bordering UNKNOWN: federal work, but the EPA sentence reserves commercial-use copyright for some documents. Needs an ADR-0013 record; exclude natural persons.

## SEC litigation releases (sec-litigation-releases): GREEN
- Listing `https://www.sec.gov/enforcement-litigation/litigation-releases?page=N`: 120 pages, 11,986 releases from 1995-09-20 to 2026-09-30; 39 in the last 30 days. (The RSS URL I tried returned 404.)
- 27/28 sampled releases returned usable text (median 6,562 characters): caption naming the SEC v. defendant, court and civil action number, narrative of charges, relief. Court case numbers matched the `D:YY-cv-N` regex in 14/28; others use forms like "07 CV 6709" or "09-CV-22821-COOKE/Bandstra", so the cited-case-number extractor needs several formats. (The page navigation contains "CIK Lookup", so CIK is not in the release text; CIK needs a lookup by name.)
- Terms (https://www.sec.gov/about/privacy-information): "Information presented on sec.gov is considered public information and may be copied or further distributed by users of the web site without the SEC’s permission." Existing registry conditions apply (declared User-Agent, 10 requests/second, no seal).
- Rights: GREEN.

## CFPB enforcement actions (cfpb-enforcement-actions): GREEN
- Listing `https://www.consumerfinance.gov/enforcement/actions/?page=N`: 17 pages, 386 action pages. RSS feed HTTP 200 but stale: 25 items, last build 2025-09-22, newest item 2025-08-21 (the HTML listing is the complete source).
- 26/26 sampled pages return an "Action Details" block with forum, docket number (`2025-CFPB-0004` for administrative; `1:25-ap-01052`, `1:17-cv-...` for court actions), filing date, status, products. 11/26 carry a federal court case number. Narrative about 3,000-3,800 characters.
- Terms (https://www.consumerfinance.gov/privacy/website-privacy-policy/): "Information created by the CFPB is in the public domain and you may reproduce, publish, or otherwise use it without the Bureau’s permission." The same page warns that copyrighted third-party material may appear.
- Rights: GREEN (exclude third-party material). Freshness score is low: few new actions per month.

## FTC cases and proceedings (ftc-cases-proceedings): AMBER
- Listing HTML, 306 pages of 20 (about 6,120 cases), about 1 MB per page; robots.txt `Crawl-delay: 5`, which I honoured. I collected 247 titles from 12 pages and fetched 24 case pages.
- 13/24 sampled pages have a case summary of more than 100 characters; 2/24 cite a federal court case number in page text (e.g. `3:19-cv-55`); 9/24 contain a docket or file number phrase; some slugs embed the FTC file number (`191-0031-syngenta-corteva-ftc-v`). Several "cases" are index pages (banned debt collectors).
- Terms (https://www.ftc.gov/policy-notices/website-policy): "Most material on the FTC’s website is considered work of the United States Government, meaning that the material is in the public domain and is not subject to copyright restrictions ( 17 U.S.C. 105 )." Attribution requested where feasible.
- Rights: AMBER only because acquisition is slow (crawl delay) and pages mix government and third-party content; the licence itself is clear. api.ftc.gov needs a key, so not used.

## UK CMA cases (uk-cma-cases): GREEN
- `https://www.gov.uk/api/search.json?filter_format=cma_case`: HTTP 200, 2,585 cases, newest 2026-10-01. Newest 100 by type: mergers 33, consumer-enforcement 20, sau-referral 21, ca98-and-civil-cartels 9, markets 7. Content API `https://www.gov.uk/api/content/cma-cases/...`: 25/25 sampled bodies have text (1,682 to 3,964+ characters) with structured metadata (case_state, case_type, market_sector, opened_date); no stable cross-agency identifier.
- Terms (https://www.gov.uk/help/terms-conditions): "is published under the Open Government Licence (OGL), which also sets out which content is exempt." (the page says content "is subject to Crown copyright protection and" is published under OGL).
- Rights: GREEN with OGL attribution. Not a US company-enforcement source, so it adds jurisdiction breadth, not links.

## PARKED
- UK FCA final notices (uk-fca-enforcement): `https://www.fca.org.uk/news/search-results?...` HTTP 403 from our egress, `/terms-and-conditions` 404. Terms unreadable: UNKNOWN, parked. Not worked around.
- UK ICO enforcement (uk-ico-enforcement): landing page HTTP 200 but only 1,709 characters of text, no listing or count. Page states "All text content is available under the Open Government Licence v3." Not measured further: parked.
- Not screened: DOJ press releases, OFAC, OSHA, state attorneys general (candidate follow-ups).

## Linkage (measured)
Declared join (a cited court case number naming the counterpart litigation): ECHO supplies 911 court docket numbers in federal form (from 13,652 listed cases). Court numbers extracted from 28 sampled SEC releases (17 found), 26 CFPB actions (11), 24 FTC cases (2) and 26 FDA letters (0): 0 shared by two publishers. Result: 0 declared matches (this is an undercount: the SEC "07 CV 6709" style is not matched by the regex, and the SEC sample is 28 of 11,986).

Candidate joins on exact normalised company names (lower case, punctuation and corporate suffixes stripped), run over the whole name sets (FDA 3,548 distinct; ECHO 11,058 of the 13,652 fetched cases; SEC 16,960 respondent names; CFPB 379; FTC 245). Hand check = I read both records' names, the SEC release captions and the ECHO case names and judged whether they name the same legal entity. No identifier is shared, so this is an entity link and never a merge of two actions.

| Pair | Matched | Hand-checked same company |
| --- | --- | --- |
| FDA vs SEC | 4 | 4/4 |
| CFPB vs SEC | 3 | 3/3 |
| ECHO vs FDA | 5 | 5/5 |
| ECHO vs SEC | 31 | 19/31 (rejected: 4 personal names, 5 generic fragments, 3 uncorroborated small-company names) |
| FTC vs all others | 0 | n/a |
| CFPB vs FDA, CFPB vs ECHO | 0 | n/a |

Not tested: agency identifiers across agencies (FDA FEI/CMS, EPA FRS id, SEC CIK have no counterpart in another agency's data, so they link only to their own agency's registry).

## Scores reasoning
Agent demand is high for "what has regulator X done to company Y", the answer needing five agency sites today. Structuring value is highest for FDA and SEC free text (violations, cited sections, court numbers, penalties). Freshness is daily for FDA, SEC, FTC, CMA, weekly for ECHO, low for CFPB. Acquisition is hardest for FTC (5 s crawl delay, 1 MB pages) and ECHO (503s, query caps). The dataset gate is passed on name candidates; the declared court-number join is the main follow-up.
