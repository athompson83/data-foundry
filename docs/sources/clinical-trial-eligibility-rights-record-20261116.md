# Rights record — ClinicalTrials.gov eligibility criteria (`clinical-trial-eligibility`)

**Decision:** AMBER, permitted with conditions, for acquisition, storage, normalization, derivation and redistribution of structured eligibility facts derived from ClinicalTrials.gov study records on every surface, subject to the conditions below. Determined on 2026-11-16 under [ADR-0013](../decisions/ADR-0013-evidence-based-rights-determination.md) and [ADR-0018](../decisions/ADR-0018-free-public-data-presumed-usable.md). The bases are the published ClinicalTrials.gov Terms and Conditions, which permit publication and distribution of the data on stated conditions; free open access (no login, paywall or CAPTCHA, "available to all requesters ... at no charge"); and the US government operation of the database by the National Library of Medicine.

## Source

| | |
| --- | --- |
| Publisher | US National Library of Medicine (NIH, HHS), ClinicalTrials.gov |
| Endpoints | `https://clinicaltrials.gov/api/v2/studies/download?format=json.zip` (bulk), `https://clinicaltrials.gov/api/v2/studies` (deltas), `https://clinicaltrials.gov/api/v2/version` (processing timestamp) |
| Reachability, 2026-11-16 | API v2.0.5, `dataTimestamp` 2026-11-16T10:00:05; 612,025 studies, 65,010 with `overallStatus=RECRUITING` (declared User-Agent, no key) |
| Terms retrieved | <https://clinicaltrials.gov/about-site/terms-conditions> (last modified 2023-01-31). The page renders client-side; on 2026-11-16 its text was read from the site's lazy-loaded bundle `chunk-D_cHimam2.js` (SHA-256 `bc5e8f26c7e38d069697fdc2330dfb603f30daacc29584c58aab304fc01efda7`), unchanged from the 2026-09-27 reading in [`research-2026-09-27.md`](pipeline/research-2026-09-27.md). |
| robots.txt | `Disallow: /api/` for crawlers. NLM directs programmatic users to the documented v2 API; acquisition uses the bulk download plus at most 1 request/second deltas, never crawling of the web UI. |

## Evidence, verbatim (2026-11-16)

- "These Terms and Conditions apply to all data obtained from ClinicalTrials.gov, independent of format and method of acquisition."
- "ClinicalTrials.gov data are available to all requesters, both within and outside the United States, at no charge."
- "In any publication or distribution of these data, you should: Attribute the source of the data as ClinicalTrials.gov"; "Update the data such that they are current at all times"; "Clearly display the date the data were processed by ClinicalTrials.gov"; "State any modifications made to the content of the data, along with a complete description of the modifications"
- "You shall not assert any proprietary rights to any portion of the database, or represent the database or any part thereof to anyone as other than a United States Government database."
- "You shall not use any email addresses extracted from our database for marketing or other promotional purposes."
- "The ClinicalTrials.gov data carry an international copyright outside the United States and its Territories or Possessions. Some ClinicalTrials.gov data may be subject to the copyright of third parties; you should consult these entities for any additional terms of use."

## Reasoning

1. **Permission.** The terms anticipate "publication or distribution of these data" and attach conditions to it; they contain no prohibition of commercial reuse or redistribution. Under ADR-0018 free public data whose terms do not expressly forbid the use is usable, and here the publisher states the conditions expressly, so the verdict is AMBER (conditions), not GREEN.
2. **Copyright.** The database is a US government work. The terms note an international copyright outside the US and possible third-party copyright: study records are submitted by sponsors. We therefore serve extracted, typed facts with short evidence spans and a link to the study record, not bulk verbatim record text, and we claim no proprietary right in the underlying data.
3. **Personal data.** Study records carry central contacts, overall officials and site contacts (names, phones, emails). These fields are never stored in the served tables or returned on any surface; the raw archive keeps the record as published, access-restricted.
4. **Currency.** The terms ask that distributed data be kept current; the product syncs daily deltas and shows the ClinicalTrials.gov processing date (`dataTimestamp`) beside every record.
5. **Medical context.** Eligibility facts are a screening aid. Every surface states that they are not medical advice and that the study record and the study team decide eligibility.

## Exact fields redistributed

| Field | Source |
| --- | --- |
| `nct_id`, brief title, overall status, phase, study type, conditions, interventions (names only), sponsor organisation name | study record `protocolSection` identification, status, design, conditions, arms-interventions, sponsor modules |
| minimum age, maximum age, sex, healthy volunteers, standard age groups | `eligibilityModule` typed fields |
| inclusion and exclusion criteria items, each with its typed extraction (age, ECOG/Karnofsky, lab thresholds, infections, pregnancy/contraception, prior therapy) and a short evidence span (at most one criterion line) | `eligibilityModule.eligibilityCriteria`, parsed deterministically |
| last update posted date; ClinicalTrials.gov processing date | `statusModule`; `/api/v2/version` `dataTimestamp` |
| study record URL `https://clinicaltrials.gov/study/<nct_id>` | derived |

Not redistributed: `contactsLocationsModule` contacts, central contacts, overall officials, any person name, phone or email; full verbatim eligibility text in bulk; results documents and uploaded protocol PDFs.

## Rights cells

| Operation | Channel | State |
| --- | --- | --- |
| ACQUIRE, STORE, CACHE, NORMALIZE, DERIVE | — | ALLOW (raw record archived as published; contact fields never enter served tables) |
| Public web, search index, free and paid API, MCP, bulk export | all | ALLOW for the fields above, with the conditions below. Each channel is still enabled by its own product decision; indexable pages remain subject to rule 8. |

## Conditions and how each is met

| Condition | How the product meets it |
| --- | --- |
| Attribute the source as ClinicalTrials.gov | `attribution` block on every API/MCP response, page footer and bulk manifest: "Source: ClinicalTrials.gov, a service of the US National Library of Medicine. Structured by Data Foundry. Not endorsed by NLM or NIH." |
| Keep the data current | Daily delta sync from the v2 API; a record not refreshed within 7 days is marked stale and withheld from paid answers until refreshed. |
| Display the processing date | Each record and each bulk file carries `ctgov_processed_at` from `dataTimestamp`. |
| State modifications | A public method note describes the parser, its version and that criteria are split, typed and abbreviated to evidence spans; every derived field names its parser version. |
| No proprietary claim; present as a US government database | Licence text for our derived fields excludes the underlying data; documentation states the underlying records are a United States Government database. |
| No marketing use of emails | Emails are never stored in served tables or used. |
| International and third-party copyright | Short evidence spans and links only; no bulk verbatim criteria text. |
| robots.txt `/api/` disallow | Acquisition uses only the documented bulk download and API at 1 request/second; no crawling. |

**Re-review by:** 2027-11-16, or at once if the ClinicalTrials.gov terms (last modified 2023-01-31) change.
