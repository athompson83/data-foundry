# medical-device-approvals (category health), screened 2026-10-03

Scripts: `screen.py` (counts, 510(k) PDF sample, K-number joins, first DI attempt), `screen_join.py` (DI and name joins vs Health Canada), `screen_recall_link.py` (enforcement to device/recall to 510(k)). Output: `results.json`. All requests used the scout User-Agent, about 2 req/s or slower, no keys. Two full Health Canada lists were downloaded once (licence 10 MB, company 1.8 MB); a 45 MB device list was fetched once while probing.

## fda-device-510k-pma-clearances (GREEN)
- Reachable, HTTP 200. openFDA `device/510k`: 176,223 records, last_updated 2026-09-21, newest decision_date 2026-09-19, 3,234 decided in the last 12 months; 93,850 carry `statement_or_summary: Summary`. `device/pma`: 57,183 supplement-level records, newest decision 2026-09-18, 2,182 in the last 12 months. `device/classification`: 7,094 product codes.
- Identifiers: k_number, product_code, pma_number plus supplement_number, regulation_number, registration_number and fei_number (in `openfda`), applicant. Free text: the 510(k) summary PDF (`https://www.accessdata.fda.gov/cdrh_docs/pdf{YY}/{K}.pdf`) holds indications for use and predicate K-numbers; PMA `ao_statement` is short free text. The old `/pdfs/` path returns 404; the `pdfYY` path works.
- PDF sample: 25 random 2025-06 to 2026-09 Summary-flagged clearances, 24 returned a PDF (1 HTTP 404), all 24 had an indications/intended-use section, 21 cited a predicate K-number. (My snippet regex matched boilerplate text for some rows, so only presence is claimed, not extracted wording.)
- Terms (https://open.fda.gov/terms/): "Unless otherwise noted, the content, data, documentation, code, and related materials on openFDA is public domain and made available with a Creative Commons CC0 1.0 Universal dedication." The same page warns: "Some data on openFDA may not be public domain, such as copies of copyrightable works made available to the FDA by private entities." Verdict GREEN. Condition worth noting for the rights record: summary PDFs are submitter-authored; republish extracted facts, not the PDF text wholesale.
- Scores: demand 5, rights 5, acquisition 4, structuring 5 (indications and predicates only exist in PDFs), freshness 5, onboarding 4, poor access 3.

## fda-gudid-udi-devices (GREEN)
- openFDA `device/udi`: 5,182,695 records, last_updated 2026-09-02 (slower cadence). Fields: identifiers (primary and package DIs, issuing agency GS1/HIBCC/ICCBBA), brand_name, version_or_model_number, company_name, product_codes, premarket_submissions (cited K/P numbers), device_description, GMDN terms. Structured. Same openFDA CC0 terms as above.
- Declared link inside FDA: 29/30 sampled GUDID records' cited K-number resolve to a 510(k) record.
- Scores: demand 4, rights 4, acquisition 4, structuring 4, freshness 3, onboarding 3, poor access 2.

## hc-mdall-device-licences (AMBER)
- `https://health-products.canada.ca/api/medical-devices/` licence, device, company, deviceidentifier endpoints, HTTP 200, no key. Active licences: 35,844 (class 2: 26,412; 3: 7,850; 4: 1,582; Class I devices are not licensed), newest first_licence_status_dt and last_refresh_dt 2026-10-02, 2,238 first issued in the last 12 months. Company: 7,670 rows. Fields: original_licence_no, licence_name, appl_risk_class, licence_status, company_id; device endpoint adds device_id and trade_name; deviceidentifier gives `device_identifier` (catalogue or label number). `summarybasisdecision` endpoint returned 404 for the bare path, `licencetype` returned 7 rows. No intended-use text: MDALL is a structured register.
- Terms: the CKAN record for MDALL (https://open.canada.ca/data/en/dataset/c801a084-210b-4cd2-8513-26a00b66eb6f) states licence `ca-ogl-lgo`, Open Government Licence - Canada. Quote from https://open.canada.ca/en/open-government-licence-canada: "You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose." Condition: "Acknowledge the source of the Information by including any attribution statement specified by the Information Provider(s)". AMBER (attribution only).
- Scores: demand 4, rights 4, acquisition 4, structuring 3, freshness 5, onboarding 4, poor access 3.

## tga-artg-medical-devices (PARKED, UNKNOWN)
- `www.tga.gov.au` fails every request from this egress with `HTTP/2 INTERNAL_ERROR` (3 URLs, including copyright pages). `compliance.health.gov.au/artg/` returns 200 but only a JavaScript search shell ("ArtgSearch - Home", "This is a read only version of the page") with no data and no readable terms. No API or open export found. Not worked around.

## Rejected or not screened
- EU: EUDAMED public pages not screened (no open API found within this round); not claimed.

## Linkage (measured)
- Declared, within FDA: GUDID cited K-number to 510(k) 29/30. FDA device enforcement report (the live fda-recalls source) to openFDA `device/recall` by recall number 99/100, 60/100 carry k_numbers, 58/100 resolve to a 510(k). Reverse, 510(k) K-number to a device/recall record: 4/40 recent-decade clearances have recalls; recall k_numbers to 510(k): 30/30. Note the live fda-recalls ingestion uses the enforcement endpoint, which has no k_numbers; the join needs the `device/recall` endpoint.
- Declared, cross-publisher: FDA GUDID primary DI (zero-stripped) to Health Canada device_identifier 0/120 (first pass 0/60). No declared FDA-to-Canada identifier exists in the data; this is an honest zero.
- Candidate, cross-publisher: 150 sampled 2025-2026 510(k) clearances; 72 had an exact-normalised company match in Health Canada's company list, 54 had a licence from that company sharing device-name tokens (461 raw pairs). Best pair per clearance, hand-checked for the 23 with Jaccard >= 0.6: 19 same product, 4 not (da Vinci SP vs SI, BMD Titanium Spinal vs Cervical, Resolve vs CODA plate, TPH S36 unverifiable). Below 0.6 pairs were not checked and mostly differ.
- Dataset passes: four non-RED members across FDA and Health Canada; one reviewed candidate join (19/23) between independent publishers plus declared FDA-internal joins.
