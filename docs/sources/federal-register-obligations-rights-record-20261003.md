# Rights record — Federal Register, eCFR and GovInfo FR bulk (regulatory obligation timelines)

**Decision:** GREEN for acquisition, storage, normalization, derivation, and redistribution of the Federal Register document metadata and text, and eCFR text, on every surface, subject to the conditions below. Determined on 2026-10-03 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md). The basis is `PUBLIC_DOMAIN_US_GOVERNMENT_WORK` (17 U.S.C. § 105), and [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md) (`FREE_PUBLIC_ACCESS`) applies independently. No written permission is needed.

## Source

| | |
| --- | --- |
| Publisher | Office of the Federal Register (NARA) and the U.S. Government Publishing Office (GPO) |
| Endpoints | `https://www.federalregister.gov/api/v1/documents.json` (no key), `https://www.ecfr.gov/api/versioner/v1/` (no key), `https://www.govinfo.gov/bulkdata/FR/` (open XML directory). No login, key or CAPTCHA on any of the three. |
| Reachability, 2026-10-03 | FR `documents.json` 200 (RULE, 2025-10-01 to 2026-09-30: count 2,727, 3 pages at `per_page=1000`; per-month counts 99 to about 232, all single page). eCFR `titles.json` 200 (up to date as of 2026-10-01); `versions/title-40.json?part=84` 200 (122 versions); `structure/2026-10-01/title-40.json` 200 (9.4 MB). GovInfo `bulkdata/FR/2026/09/FR-2026-09-30.xml` 200 (4.9 MB, Vol. 91 No. 188). |
| Refresh | Daily (each FR issue; eCFR `up_to_date_as_of` 2026-10-01; GovInfo 2026 directory modified 03-Oct-2026). |
| Access notes | Requests were made with `User-Agent: data-foundry-scout (data@mail.proviciency.com)`. The eCFR `full/` endpoint answers 406 unless the request allows compression (`Accept-Encoding: gzip`). FederalRegister.gov and eCFR.gov HTML pages, and the FR developer-documentation pages, redirect to `unblock.federalregister.gov` (CAPTCHA "Request Access"; the page says programmatic access "is limited to access to our extensive developer APIs"). Pages are therefore not fetched; only the APIs and GovInfo bulk are used. `robots.txt` disallows only search and account paths, not `/api/`. |
| Terms retrieved | <https://www.govinfo.gov/about/policies> 2026-10-03, SHA-256 `d9e3a2f1cb4486ab4ecc4eff640f94f9a9bb8655ca71ff00694b236e7011ad1c`. <https://www.law.cornell.edu/uscode/text/17/105> 2026-10-03, SHA-256 `e0f425493dd80314c4777e99d29a229f1e72ffedd433891c958dec0500fed6d5`. |

## Evidence, verbatim

From GovInfo, "Public Domain & Copyright Notice":

> Title 17, Section 105, United States Code, provides that: Copyright protection under this title is not available for any work of the United States Government, but the United States Government is not precluded from receiving and holding copyrights transferred to it by assignment, bequest, or otherwise. The intent of the section is to place in the public domain all work of the United States Government, which is defined in 17 U.S.C. § 101 as work prepared by an officer or employee of the United States Government as part of the person's official duties. By virtue of the foregoing, public documents can generally be reprinted without legal restriction. However, Government publications may contain copyrighted material which was used with permission of the copyright owner.

From 17 U.S.C. § 105(a):

> Copyright protection under this title is not available for any work of the United States Government, but the United States Government is not precluded from receiving and holding copyrights transferred to it by assignment, bequest, or otherwise.

The FederalRegister.gov developer terms page could not be retrieved (CAPTCHA wall, see above), so no quote is taken from it. The decision does not depend on it: the documents are federal agency work under § 105, the GPO notice states they "can generally be reprinted without legal restriction", and the APIs are open without a key (ADR-0018).

## Reasoning

1. **Copyright.** Rules, notices and the CFR are written by federal officers in their official duties and compiled by the Office of the Federal Register and GPO. They are § 105 works.
2. **Commercial use.** No source states a limit on commercial use. The three endpoints are free and open, which also satisfies ADR-0018.
3. **Third-party material.** The GovInfo notice warns that publications "may contain copyrighted material which was used with permission of the copyright owner". The obligation-timeline product redistributes dates, citations, CFR references, agency names, and short extracted clauses, never full copyrighted attachments, tables, images or incorporated-by-reference standards.
4. **Personal data.** None beyond agency contact officials named in the text. Contact blocks (`FOR FURTHER INFORMATION CONTACT`) are not extracted or served. Docket and RIN identifiers are not personal data.
5. **Access.** API and bulk only, identifying User-Agent, paged requests, at least 2 s between requests, gzip enabled for eCFR. HTML pages on FederalRegister.gov and eCFR.gov are never scraped.

## Exact fields redistributed

| Source | Fields |
| --- | --- |
| FR `documents.json` | `document_number`, `title`, `publication_date`, `type`, `agency_names`, `cfr_references` (`title`, `part`, `chapter`), `effective_on`, `dates`, `citation`, `html_url`, `docket_ids`, `regulation_id_numbers`, `correction_of`, `abstract`, `full_text_xml_url` |
| GovInfo FR bulk XML | Rule and proposed-rule text (the `RULE`, `PRORULE` elements: `PREAMB`, `DATES`, `EFFDATE`, `SUPLINF`, `REGTEXT`) used to extract compliance dates, stay, delay and extension clauses |
| eCFR versioner | `versions` (`date`, `amendment_date`, `identifier`, `part`, `subpart`, `title`, `type`, `substantive`, `removed`) and `structure`, plus section text through `full/` |
| Derived by Data Foundry | obligation rows (applies-to, trigger, compliance date, stay or delay chain with the amending document number, current-in-eCFR flag), normalized agency and CFR keys |

## Measured on 2026-10-03

- FR rules, 2025-10-01 to 2026-09-30: 2,727 (the 2026-09-27 round counted 2,719). First 1,000 oldest rules: `cfr_references`, `agency_names`, `citation`, `html_url`, `full_text_xml_url` 1,000; `abstract` 992; `dates` 992; `effective_on` 905; `docket_ids` 908; `regulation_id_numbers` 590; `correction_of` set on 3.
- eCFR title 40 part 84: 122 section versions. GovInfo issue file FR-2026-09-30.xml: 4,932,804 bytes.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW |
| Public web, search index, free and paid API, RapidAPI, MCP, bulk export | all | ALLOW for the fields above. Each channel is still enabled by its own product decision. |

## Conditions

- Serve dates and clauses with the FR citation and document number so every obligation traces to the official publication. State "as published in the Federal Register" and show the retrieval date; the eCFR is "not the official legal edition" and users are directed to the official source for legal reliance.
- No implication of endorsement by NARA, GPO, or any agency, and no use of agency seals.
- Exclude third-party copyrighted attachments and incorporated-by-reference material; keep contact blocks out.
- Use GovInfo bulk XML for rule text. Do not fetch FederalRegister.gov or eCFR.gov HTML.
- Sync daily while served.

## Attribution carried

"Federal Register and eCFR data via the Office of the Federal Register and GovInfo (U.S. GPO). U.S. Government work in the public domain. Not the official legal edition; not affiliated with or endorsed by any agency."

**Re-review by:** 2027-10-03, or at once if the GovInfo policy page, the API access model, or the CAPTCHA wall scope changes.
