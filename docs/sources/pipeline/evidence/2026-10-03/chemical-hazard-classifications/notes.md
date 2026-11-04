# chemical-hazard-classifications (category chemical-safety), screened 2026-10-03

Entity: a substance keyed by CAS number, with GHS hazard classification, occupational hazard prose and US TSCA status.
All numbers come from `screen.py` / `results.json` (UA `data-foundry-scout (data@mail.proviciency.com)`, about 0.6 s between requests, no keys, no logins). Sample: seed 7, 30 CAS numbers drawn from the NIOSH index.

**Verdict: passes.** 3 non-RED members from 3 publishers (CDC NIOSH, NCBI PubChem, US EPA), one free-text (NIOSH), two measured declared CAS joins. All three are AMBER; ECHA, NITE-CHRIP and CompTox are PARKED (UNKNOWN).

**Test gap:** `tooling/test/source-pipeline.test.ts` line 293 accepts declared joins only if the key matches `licen[cs]e number|UBI|GTIN|UPC|NOA|FL#|FIPS|zone|case number|cited ... notice URL|cited ... reference number|UEI`. "CAS number" is not accepted, so the snippet's two declared joins fail that test as written. Proposed fix: add `|\bCAS (?:registry )?number\b` to the regex. The join key text does contain "CAS number".

## NIOSH Pocket Guide to Chemical Hazards (chemical-niosh-pocket-guide) - free-text, AMBER
- Reachable: 200 for `https://www.cdc.gov/niosh/npg/npgdcas.html` (324 KB) and each entry page. 626 CAS-to-page links in the index (589 name rows counted by text parse; multi-CAS and group entries differ). No API or bulk file.
- Entry sample: 30/30 pages 200; symptoms, target organs and first aid populated 30/30 (the regex parse); page CAS equals index CAS 29/30 (one entry, 11107-01-0 tungsten carbide, lists several CAS numbers).
- Identifiers: CAS No., RTECS No., DOT ID. Free text: symptoms, target organs, first aid, incompatibilities, personal protection.
- Cadence: static. Sampled entry npgd0001 shows "Page last reviewed: October 30, 2019".
- Terms (https://www.cdc.gov/other/agencymaterials.html, fetched): "Most of the information on the CDC and ATSDR websites is not subject to copyright, is in the public domain, and may be freely used or reproduced without obtaining copyright permission." The same page requires attribution ("Source: CDC") and a non-endorsement disclaimer, and notes a few copyrighted exceptions.
- Rights: AMBER (public domain with attribution and disclaimer conditions). Not fresh, so freshness 1.

## PubChem GHS Classification (chemical-pubchem-ghs) - structured, AMBER
- Reachable: PUG REST name lookup (`/compound/name/<CAS>/cids/JSON`), synonyms, and PUG-View `?heading=GHS+Classification` all 200. No throttling seen at under 2 req/s.
- Sample: 27/30 NIOSH CAS numbers resolved to a CID, all 27 CIDs list the exact CAS number among synonyms, 27/27 have GHS H-codes and a signal word (Danger or Warning). 3 misses (404): 17702-41-9 decaborane, 8032-32-4 VM&P naphtha, 11107-01-0 cemented tungsten carbide.
- Structure: each statement carries a notifier percentage (example "H315 (77.4%)"); the H-code lists in results.json are the union across notifiers, a measurement artefact and not an official classification.
- Provenance: the GHS section for CID 702 (ethanol) cites "ECHA C&L Notifications Summary" ("13886 reports by companies from 79 notifications") and Regulation (EC) 1272/2008. So ECHA terms matter downstream.
- Terms (https://www.ncbi.nlm.nih.gov/home/about/policies/, fetched): "NCBI itself places no restrictions on the use or distribution of the data contained therein. Nor do we accept data when the submitter has requested restrictions on reuse or redistribution." and "However, some submitters of the original data (or the country of origin of such data) may claim patent, copyright, or other intellectual property rights in all or a portion of the data (that has been submitted)."
- The page also says US-government-created content is public domain and that PubChem-incorporated third-party material may be copyrighted.
- Rights: AMBER; keep depositor and percentage per statement, serve a depositor only after its terms are read. Not a PARKED case because NCBI places no restriction itself (ADR-0018).

## EPA TSCA Chemical Substance Inventory (chemical-epa-tsca-inventory) - structured, AMBER
- Reachable: page 200; `csv-non-cbi-tsca-inventory.zip` 200, 2,494,065 bytes. File TSCAINV_072026.csv: 70,774 rows, 36,522 ACTIVE, 34,252 INACTIVE. Columns: ID, CASRN, casregno, UID, EXP, ChemName, DEF, UVCB, FLAG, ACTIVITY. The EPA page says the inventory is updated about every six months (July 2026 update).
- Links: 28/30 sampled NIOSH CAS numbers are in TSCA (all ACTIVE); whole NIOSH index 539/626. PubChem-resolved sample to TSCA: 26/30.
- No hazard data and no free text.
- Terms (https://www.epa.gov/web-policies-and-procedures/epa-disclaimers, fetched): "These documents may be freely distributed and used for non-commercial, scientific and educational purposes. Commercial use of the documents available from the EPA websites may be protected under the U.S. and Foreign Copyright Laws." Same ambiguity as the existing epa-echo entry; needs a rights record.
- Rights: AMBER.

## PARKED
- **ECHA C&L inventory / registered substances**: `https://echa.europa.eu/legal-notice` and the C&L database page both return HTTP 403 with an Azure WAF challenge page. The legal notice could not be read, and we do not work around the challenge. UNKNOWN, parked. This is the key upstream for EU harmonised classifications; reopen when a documented keyless download is reachable.
- **Japan NITE-CHRIP**: `https://www.chemicals.nite.go.jp/en/` unreachable (proxy tunnel 502 Bad Gateway; earlier curl status 000). No terms read. UNKNOWN, parked, retry later.
- **EPA CompTox Dashboard**: dashboard URL is 200 but is a JavaScript app; the guessed downloadable-data and FAQ pages returned 404. No keyless bulk URL or terms found in this session. Parked UNKNOWN, not rejected.
- **OSHA hazcom**: `https://www.osha.gov/hazcom` returned 403 (CloudFront block); not screened.
- **Canada**: not measured. Open Government Licence - Canada is fetched and permits commercial use ("worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes"), and NPRI datasets exist on open.canada.ca under it, but no CAS-keyed substance file was measured this run. Candidate for a follow-up round.

## Linkage (declared, CAS number)
| Join | Measured | Notes |
| --- | --- | --- |
| NIOSH CAS to PubChem (synonym contains exact CAS) | 27/30 | misses are a mixture, a UVCB naphtha and decaborane |
| NIOSH CAS to TSCA CASRN | 28/30 (539/626 over full index) | all matches ACTIVE |
| PubChem-resolved to TSCA | 26/30 | |

CAS is an exact identifier assigned to the substance, so it links at the substance level without hand review. Caveat: a PubChem name search by CAS is a lookup; we verified the CAS appears in the returned compound's synonyms to rule out name-similarity hits. Multi-CAS and group entries (NIOSH "compounds" entries) must not auto-link. No candidate (name-based) joins were attempted.

## Scores (35 max)
NIOSH 4/4/3/4/1/4/3 = 23. PubChem 5/3/4/4/4/4/3 = 27. TSCA 4/3/5/3/3/5/2 = 25. Dataset 5/3/4/4/3/4/3 = 26.
