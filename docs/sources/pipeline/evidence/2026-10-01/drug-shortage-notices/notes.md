# drug-shortage-notices (health), screened 2026-10-01

Entity: a regulator drug shortage or discontinuation notice (ingredient, dosage form, strength, status, reason text,
recovery estimate) linked to NDC, RxCUI, DailyMed set id and ATC. Script: `screen.py`; output: `results.json`.
All requests used the header `User-Agent: data-foundry-scout (data@mail.proviciency.com)`, at most ~1.5 req/s, no keys.

## Verdict

| Member | Publisher | Rights | Stage |
| --- | --- | --- | --- |
| fda-drug-shortages-openfda | US FDA | GREEN | SCREENED |
| ema-medicine-shortages | EMA | AMBER | SCREENED |
| nlm-rxnorm-ndc-atc-map | US NLM | AMBER | SCREENED |
| tga-medicine-shortages | TGA | UNKNOWN | PARKED |
| drug-shortages-canada | Health Canada | UNKNOWN | PARKED |
| ashp-drug-shortages | ASHP | RED | PARKED |

The dataset passes the screen on the candidate join (EMA to FDA, 14/14 hand-checked). The declared NDC join is
measured but cannot be written as `declared` under the current test (see Linkage).

## FDA drug shortages (openFDA endpoint plus CDER database)

- `https://api.fda.gov/drug/shortages.json`: HTTP 200. 1,594 notices (`meta.results.total`), all fetched in two
  pages. `meta.last_updated` 2026-09-30; newest `update_date` 2026-09-29; oldest `initial_posting_date` 2012-01-01;
  1,025 notices updated in the 30 days before the newest date (daily-to-weekly cadence).
- Status: 1,153 Current, 434 To Be Discontinued, 7 Resolved.
- Identifiers: `package_ndc` 1,594/1,594; `openfda` block 1,381 (RxCUI list 1,344, application number 1,353, `spl_set_id`
  1,381, UNII, product NDC). No ATC in the record.
- Typed fields: generic_name, dosage_form (1,574), presentation (strength and NDC string), company_name, therapeutic_category,
  availability, update_type, discontinued_date (434), change_date, resolved_note.
- Free text: `shortage_reason` 414/1,594 (closed phrases such as "Demand increase for the drug" 109, "Shortage of an
  active ingredient" 60, plus "Other" 152), `related_info` 1,095/1,594 (sentences such as "Product temporarily unavailable.
  Estimated recovery: TBD."), `related_info_link` 35.
- `https://www.accessdata.fda.gov/scripts/drugshortages/default.cfm`: HTTP 200, 625 ingredient entries (227 current,
  386 discontinuation, 12 resolved). Detail pages (checked one: Atropine Sulfate Injection) carry per-company,
  per-NDC "Shortage Reason (per FDASIA)" and "Related Information" text, e.g. "Next Delivery: August 2026; Estimated
  Recovery: September 2026; Shortage per Manufacturer: Manufacturing Delay". Historical xlsx linked at
  `https://www.accessdata.fda.gov/drugsatfda_docs/DS/shortages_current_and_historical.xlsx` (not downloaded).
- Terms (fetched):
  - https://open.fda.gov/terms/: "Unless otherwise noted, the content, data, documentation, code, and related materials on openFDA is public domain and made available with a Creative Commons CC0 1.0 Universal dedication."
  - Same page, carve-out: "Some data on openFDA may not be public domain, such as copies of copyrightable works made available to the FDA by private entities."
  - https://www.fda.gov/about-fda/about-website/website-policies: "Unless otherwise noted, the contents of the FDA website (www.fda.gov) — both text and graphics — are not copyrighted. They are in the public domain and may be republished, reprinted and otherwise used freely by anyone without the need to obtain permission from FDA."
- Rights: GREEN. Shortage notices are FDA-authored; the private-works carve-out concerns label text and the like, not
  these fields. The API disclaimer says not to rely on it for medical decisions; keep that notice on any product.

## EMA medicine shortages catalogue

- `.../medicines-output-shortages-report_en.xlsx` (linked from `/en/medicines/download-medicine-data`): HTTP 200, 88 KB,
  generated "01/10/2026 - 06:00" (daily). 85 shortages: 27 ongoing, 53 resolved, 5 discontinued; newest last-updated 2026-09-22.
- Columns: Category, Medicine affected, Supply shortage status, INN or common name, Therapeutic area (MeSH),
  Pharmaceutical forms affected, Strengths affected, Availability of alternatives, Start of shortage date,
  Expected resolution date, Expected resolution, First/Last updated, Shortage URL. Several columns are sparse
  and shift position in the sheet, so the parser maps by position, not by compacting blanks.
- No NDC, RxCUI or ATC column. The only drug identifier is the INN; the ATC code is not in the catalogue.
- Free text: each Shortage URL is a prose page (reason, monitoring, member states, advice). Of the first 20 pages,
  8 yielded a "Reason for shortage" paragraph under my regex (the rest use other headings), for example: "The causes of the shortages are multifactorial and include an unexpected increase in demand."
- Terms (fetched): https://www.ema.europa.eu/en/about-us/legal-notice: "Information and documents made available on EMA's webpages are public and may be reproduced and / or distributed, totally or in part, irrespective of the means and / or the formats used, for non-commercial and commercial purposes, provided that EMA is always acknowledged as the source of the material."
  Carve-out, same page: "The above-mentioned permissions do not apply to content supplied by third parties."
- Rights: AMBER (commercial reuse permitted with acknowledgement; third-party content excluded). The catalogue only
  lists shortages EMA assessed (the page says it links to national registers for the rest).

## NLM RxNorm, RxClass and DailyMed (identifier crosswalk)

- `https://rxnav.nlm.nih.gov/REST/ndcstatus.json?ndc=...` returns the RxCUI for an NDC; `.../rxclass/class/byRxcui.json?...&relaSource=ATC`
  returns ATC classes; `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?ndc=...` returns SPL set ids. All HTTP 200.
  DailyMed `db_published_date` was Sep 30, 2026.
- Terms (fetched): https://lhncbc.nlm.nih.gov/RxNav/TermsofService.html: "The APIs (RxNorm, RxTerms, Prescribable RxNorm, and RxClass) may be used free-of-charge."
  and "NLM requires that users of the APIs (RxNorm, RxTerms, Prescribable RxNorm, and RxClass) send no more than 20 requests per second per IP address."
  The page also asks that apps include the statement "This product uses publicly available data from the U.S. National Library of Medicine (NLM)...".
  It says "RxClass includes SNOMED Clinical Terms® (SNOMED CT®) which is used by permission of the International Health Terminology Standards Development Organisation (IHTSDO)."
- Rights: AMBER. NDC to RxCUI is RxNorm (non-proprietary). The ATC hierarchy served through RxClass originates with WHO;
  this page does not state its redistribution terms, so ATC redistribution is unverified and left to a rights record.
  DailyMed's own terms are covered by the existing `drug-label-facts` entry (copyrightable label text carve-out); this
  dataset uses DailyMed only for set ids.

## Linkage (measured)

Declared join, FDA notice to NLM (NDC): 25 random openFDA notices with an `openfda` block (seed 20261001).
- 24/25 package NDCs resolved by RxNorm to an RxCUI, and in all 24 that RxCUI is in the notice's own `openfda.rxcui` list.
  The miss (31722-276-32) has no RxNorm NDC record.
- 25/25 NDCs resolved by DailyMed to a set id that is in the notice's `openfda.spl_set_id` list.
- 24/25 got ATC codes through RxClass for that RxCUI.
Caveat: openFDA builds its `openfda` block from the same NLM and DailyMed sources, so this confirms the identifier works in
both directions; it does not prove two independently authored notices describe the same event.
Test limitation: `tooling/test/source-pipeline.test.ts` only accepts a `declared` key matching licence number, UBI, GTIN, UPC,
NOA, FL#, FIPS, zone, case number or cited notice URL. NDC and RxCUI are not listed, so the declared entry is commented
out in `snippet.yaml`; add `NDC|RxCUI` to that regex to enable it.

Candidate join, EMA to FDA (INN equals substance name, exact normalised string): 14/85 EMA notices matched at least one of the
1,594 FDA notices. Hand check of all 14: 14/14 are the same active substance (liraglutide x2, semaglutide x2, methotrexate,
ifosfamide, somatropin, insulin lispro, methylphenidate, hydroxocobalamin, aprepitant, peginterferon alfa-2a, voriconazole,
arsenic trioxide). Limits: this links the substance, not the shortage event (one EMA notice maps to 1 to 11 FDA notices);
the ADHD-medicines notice names three ingredients and only methylphenidate matched; 71/85 EMA notices have no FDA counterpart
(many are EU-only or biologics with different INN spellings, so the exact rule undercounts).

## PARKED or rejected

- Drug Shortages Canada (drugshortagescanada.ca): redirects to healthproductshortages.ca; HTTP 403 with a Cloudflare
  "Just a moment" challenge for the home page and /api. No terms or API readable. UNKNOWN, parked; not worked around.
- ASHP: `https://www.ashp.org/drug-shortages/current-shortages` and `/terms-of-use` return HTTP 403 (Cloudflare challenge).
  Terms unreadable; ASHP is expected to restrict reuse. RED, parked.
- TGA Australia: the shortage database page `https://apps.tga.gov.au/prod/MSI/search` is reachable (HTTP 200) and embeds
  992 records as JSON (424 current, 288 discontinued, 188 resolved, 92 anticipated; newest 2026-10-01; ARTG number on all 992,
  `atc_level1` on 990, TGA management-action text on 794). But the copyright page on www.tga.gov.au fails from our egress
  (HTTP/2 INTERNAL_ERROR, then empty reply; 5 tries on 3 URLs) and the apps page states no terms, so rights are UNKNOWN. Parked.
  Its ARTG number would be a declared join to Australian product registers, not to NDC.
- Not measured: Health Canada's open.canada.ca listing (search page returned HTTP 400), national EU registers.

## Scores reasoning

Demand 5: agents answering "is X available, what are the alternatives" need a clean NDC-keyed status; FDA's feed is
machine-readable but the reason is a free-text phrase list. Rights 3 at dataset level (one GREEN, two AMBER with an
unresolved ATC question). Acquisition 5 (JSON API, xlsx, REST). Structuring 4: reason and recovery phrases to a closed set,
NDC to RxCUI to ATC, status harmonisation across jurisdictions. Freshness 5 (FDA updated 2026-09-29, EMA daily).
Onboarding 4. Poor existing access 3: FDA's own database and ASHP already serve people well; the gap is a joined,
identifier-keyed machine view across jurisdictions.
