# pesticide-product-labels (screened 2026-10-04)

Entity: a registered pesticide product (national registration number) with active ingredients, CAS numbers, status and
use sites. Script: `screen.py` (downloads with the scout User-Agent at about 1 request per second, total under 40 MB;
sample seed fixed). Output: `results.json` (counts, 20-record samples per member, link samples).

## EPA PPIS (pesticide-epa-ppis) - AMBER
- Page https://www.epa.gov/ingredients-used-pesticide-products/ppis-download-product-information-data: HTTP 200, lists
  zip downloads at https://www3.epa.gov/pesticides/PPISdata/*.zip (product, formula, chemcas, chemname, prodsite,
  prodpest, company ...). Page text: "FIFRA Section 3, Section 24(c), and Vocabulary data will be updated every Tuesday".
- Measured: product.txt 102,780 products (19,722 with no cancellation date = active; 945 restricted use); newest
  approval date 2026-09-22; formula.txt 154,006 rows covering 89,314 products; 1,220 distinct active-ingredient PC_CODEs
  in active-product formulations, 983 of them with a CAS in chemcas.txt (1,069 distinct CAS). Fixed-width ASCII; layout
  from the PPIS data dictionary PDF (https://www.epa.gov/sites/default/files/2021-01/documents/ppis-data-dictionary.pdf).
- Identifiers: REG_NR (registration number, first 6 digits company number), PC_CODE, CAS_NR. Free text: none beyond
  product name (label text is not in PPIS).
- Terms (https://www.epa.gov/web-policies-and-procedures/epa-disclaimers): "These documents may be freely distributed
  and used for non-commercial, scientific and educational purposes. Commercial use of the documents available from the
  EPA websites may be protected under the U.S. and Foreign Copyright Laws." Verdict AMBER (same conditions as the
  existing TSCA inventory entry): serve EPA-authored registration facts only; exclude company contacts.

## Health Canada PMRA PPID (pesticide-pmra-ppid) - AMBER (rights clarity 5)
- Open data record https://open.canada.ca/data/en/dataset/e10b0d6e-04ac-4014-a64a-666c3874bbe0 (CKAN API): licence
  Open Government Licence - Canada, frequency P1D, metadata modified 2026-08-27. CSV extracts at
  https://pest-control.canada.ca/pesticide-registry-api/api/extract/{product,ingredient,label,application,incident,mrl}:
  all HTTP 200 (product 11.1 MB, application 16.1 MB, ingredient 96 KB, label 1.6 MB), Windows-1252.
- Measured: 21,795 products (7,791 Current), newest first-registered date 2026-10-01; 5,636 current products have Sites
  of Use text and 5,553 have Pests; ingredient list 1,315 rows, 943 with a CAS number. Product rows carry active
  ingredient names (semicolon separated), not CAS. The label extract is only registration number, registrant, product
  name and status (no label text); per-registration lookup `/label/{id}` returns the same four fields.
- Terms (https://open.canada.ca/en/open-government-licence-canada): "The Information Provider grants you a worldwide,
  royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes, subject to
  the terms below." Also: "This licence does not grant you any right to use the Information in a way that suggests any
  official status or that the Information Provider endorses you or your use of the Information." Verdict AMBER only
  because attribution and the no-endorsement condition apply; effectively GREEN.

## APVMA PubCRIS (pesticide-apvma-pubcris) - AMBER
- data.gov.au dataset (CKAN API), licence Creative Commons Attribution 3.0 Australia, modified 2026-10-01; description:
  "This dataset is updated weekly and contains details of agricultural and veterinary chemical products and approved
  active constituents which are registered for use in Australia." CSVs HTTP 200 (product 3.6 MB, constit 143 KB,
  prodcon 1.2 MB; produse.csv 71 MB was only range-fetched, 3 MB, to read its layout: pcode, hostcode, pestcode).
- Measured: 18,793 products, newest registration date 9/09/2026; 2,797 constituents (code and name only, no CAS);
  prodcon gives constituent amounts per product.
- Terms (https://creativecommons.org/licenses/by/3.0/au/): "Share — copy and redistribute the material in any medium or
  format for any purpose, even commercially." The portal copyright page URL I guessed returned 404, so the portal
  notice is unconfirmed; the licence is the one declared on the dataset. AMBER (attribution).

## EPA PPLS label PDFs (pesticide-epa-ppls-labels) - PARKED
- https://ordspub.epa.gov/ords/pesticides/f?p=PPLS:1 HTTP 200; page says labels are PDFs accepted under FIFRA Section 3
  and "New labels were added to PPLS on October 03, 2026". Search is a session-bound Oracle APEX form (item P1_EPA_REG_NO);
  direct item URLs returned "no data found" and the label PDF URL pattern needs an acceptance date I could not derive.
  No label PDF was fetched, so no text, count or terms beyond the EPA disclaimer were measured. This is the free-text
  member the dataset needs; I did not script the APEX session because that is a workaround, not a documented route.

## EU Pesticides Database (pesticide-eu-pesticides-database) - PARKED (UNKNOWN)
- Every probe of https://ec.europa.eu/food/plant/pesticides/eu-pesticides-database/api/ (and /active-substances,
  /v3/api-docs) returned HTTP 200 with a "Server temporarily unavailable" HTML page. Nothing measured; terms unread.

## Not screened
- NPIC and EPA OPP decisions on regulations.gov: not probed (regulations.gov API needs a key by policy; NPIC is a
  referral service, not a data feed).

## Linkage (all from results.json)
- Declared, CAS number, EPA vs PMRA (independent publishers and hosts): 641 of EPA's 1,069 active-ingredient CAS numbers
  appear in PMRA's 943 (641/943 from the PMRA side). Hand-check of 25 random matched pairs (EPA name vs PMRA name):
  25/25 are the same CAS-registered substance; 3 (Alkyl dimethyl benzyl ammonium chloride, Aliphatic petroleum solvent
  vs MINERAL SPIRITS, Copper sulfate pentahydrate vs COPPER (PRESENT AS ...)) describe composition or form differently,
  so the CAS match is at substance level, not formulation level.
- Product to CAS: EPA product -> PC_CODE -> CAS is declared; PMRA product -> CAS goes through the ingredient name, so it
  is name-level and a review candidate. Registration numbers are separate national registers (the numeric collisions
  between EPA and PMRA numbers, 978, are coincidence and not a link).
- Candidate, ingredient name, PMRA vs APVMA (exact after removing punctuation and case): 418/1,315; hand-check of 20
  samples 20/20 same substance (APVMA has no CAS, so no declared join).
- Cross-dataset: EPA CAS vs NIOSH Pocket Guide CAS index (cdc.gov npgdcas page, 648 CAS): 86/1,069; PMRA vs NIOSH
  108/943. This ties the dataset to chemical-hazard-classifications, but the low overlap reflects NIOSH covering
  occupational chemicals, not pesticides.

## Verdict
Dataset passes the screening rule (3 non-RED members from 3 publishers and hosts, one declared CAS join with matches)
but has no free-text member until PPLS labels are acquired, so it cannot reach EVIDENCED. Scores reasoning: freshness 5
(weekly or daily feeds, newest records within 2 weeks), rights clarity highest for PMRA (OGL), lowest for EPA (disclaimer).
