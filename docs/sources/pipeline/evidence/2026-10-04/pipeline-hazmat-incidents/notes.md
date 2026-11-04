# pipeline-hazmat-incidents: screening notes (2026-10-04)

Data type: one pipeline / hazardous-materials release incident, with narrative, substance, cause, damages, linked to the
substance record (CAS number) and the operator. Script: `screen.py` (re-run: `pip install openpyxl; python3 screen.py`);
output: `results.json`. All requests used `User-Agent: data-foundry-scout (data@mail.proviciency.com)`, sequential at
about 1 request/s, no keys, no login. Largest download 9.8 MB.

## Member 1: US Coast Guard National Response Center (NRC) incident reports (SCREENED, AMBER)

- Reachability: `https://nrc.uscg.mil/` HTTP 200; `FOIAFiles/CY26.xlsx` 200, 9,828,856 bytes, `Last-Modified: Fri, 02 Oct 2026`
  (two days old). Yearly workbooks CY90 to CY26 plus decade bundles (`CYDECADE*.xlsx/.zip`) and `DataDictionary.xlsx` are linked.
  The NRC's `robots.txt` URL returns an HTML page (no robots rules).
- Measured (CY2026 workbook, reports received 2026-01-01 to 2026-09-27): 16,552 incident reports, 10 sheets (CALLS,
  INCIDENT_COMMONS, INCIDENT_DETAILS, INCIDENTS, MATERIAL_INVOLVED, MATERIAL_INV0LVED_CR, TRAINS_DETAIL, DERAILED_UNITS,
  VESSELS_DETAIL, MOBILE_DETAILS), 16,558 material rows. Incident types: FIXED 4,783, VESSEL 3,018, UNKNOWN SHEEN 2,285,
  RAILROAD NON-RELEASE 1,730, MOBILE 1,623, PIPELINE 1,121, STORAGE TANK 989, RAILROAD 497. Cadence: the file is rebuilt
  continuously (new reports within days).
- Identifiers: `SEQNOS` (the NRC report number), `CAS_NUMBER` (8.8% of material rows carry a real CAS: crude oil and fuels
  are `000000-00-0`), `CHRIS_CODE`, `UN_NUMBER` (0 of 16,558 rows in CY2026, so UN numbers cannot join), `STATE_AGENCY_REPORT_NUM`
  (2,278 incident-detail rows), `DOT_CROSSING_NUMBER`, `RESPONSIBLE_COMPANY` (75.1% filled on pipeline incidents).
- Free text: `DESCRIPTION_OF_INCIDENT` is filled on 100% of reports, median 215 characters; `DESC_REMEDIAL_ACTION`,
  `ADDITIONAL_INFO`, `INCIDENT_CAUSE`. Structured: material, amount, units, damage amount (144 of 1,121 pipeline
  incidents have a damage amount), injuries, fatalities, evacuations, location, lat/long.
- Cross-references inside the narratives (deterministic extraction `NRC REPORT <digits>`): 829 descriptions cite another NRC
  report number, 809 of those numbers exist in the same file (281 on pipeline incidents). These are declared update
  links (a 48 hour update cites the original report). 306 descriptions mention PHMSA, and the PHMSA update text cites the
  NRC number, so the NRC number is the declared join key into the PHMSA incident file if PHMSA becomes reachable (it is not today).
- Terms. The NRC page at `https://nrc.uscg.mil/` carries no licence. The only statement about the data is a quality caveat:
  "The spreadsheets posted to the NRC website contain INITIAL incident data that has not been validated or investigated by a federal/state response agency."
  The linked USCG privacy and security policy (`https://www.uscg.mil/Disclaim/`) and the FOIA library page return HTTP 403
  (Akamai) from this egress, so they were not read. The page offers the data for download with no login, paywall or CAPTCHA.
- Rights: AMBER under ADR-0018 `FREE_PUBLIC_ACCESS` (free public download, terms silent on reuse; the unread USCG policy is
  the open item). Conditions: label every record as an initial unvalidated report; redact personal data in narratives
  (89 of 16,552 descriptions contain a phone-number pattern) and publish no caller identity; read the USCG policy from a
  permitted route before paid delivery; drills (`CALLTYPE = DRL`) excluded.
- Samples: 40 pipeline-incident reports joined to their material rows pulled (25 kept in `results.json`).

## Member 2: Canada Energy Regulator (CER) pipeline incident data (SCREENED, AMBER)

- Reachability: `https://www.cer-rec.gc.ca/open/incident/pipeline-incidents-comprehensive-data.csv` HTTP 200, 2,451,628 bytes;
  dictionary CSV 200. Catalogue record on open.canada.ca (`7dffedc4-23fa-440c-a36d-adf5a6cc09f1`, "Pipeline Incident Data", frequency P1M,
  CER says quarterly) lists the CSV, a French copy and the dictionary.
- Measured: 2,034 incidents, 102 columns, reported 2008-01-02 to 2026-09-25 (52 in 2026), 63 distinct companies, 2,033 in
  Canada and 1 in the United States (Maine). 40.1% have a released volume. Substance values are categories ("Natural Gas - Sweet" 559,
  "Crude Oil - Sweet" 53); there is no CAS or UN column, so substance links to chemical records only by hand.
- Identifiers: `Incident Number` (INC2017-032), `Related NEB event number`, company, pipeline name, lat/long, kilometre post.
- Free text: weak. The longest fields are coded cause strings ("Detailed what happened", "Detailed why it happened"),
  not narratives. Format: structured.
- Terms (https://open.canada.ca/en/open-government-licence-canada, fetched): "You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose."
  Attribution required; the Exemptions paragraph excludes "Personal Information" and third-party rights.
- Rights: AMBER (express commercial permission with attribution, so conditions: "Contains information licensed under the Open Government Licence – Canada", link the licence, no implied endorsement, serve no personal information).
- Samples: all 2,034 rows read; 52 incidents of 2026 used in linkage.

## PARKED: PHMSA pipeline incident and hazmat incident data (phmsa.dot.gov)

HTTP 403 "Access Denied" (Akamai) from this egress for `/data-and-statistics/pipeline/source-data`, the hazmat
incident statistics page, the flagged-incident zip and the site root. Not worked around. `portal.phmsa.dot.gov` answers 200 but
is the operator portal, not a data download. Rights UNKNOWN (terms unread). Reopen when a permitted route exists
(the data is also published on data.transportation.gov; not probed further, no record counts measured).

## PARKED: Transportation Safety Board of Canada pipeline occurrence data (PODS)

The catalogue (`3f273148-3aaf-4194-b846-04fbf524e476`) lists the CSV `https://www.tsb.gc.ca/sites/default/files/stats/PODSdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv`
under the Open Government Licence - Canada, but tsb.gc.ca returns 403 for the CSV, the dictionary, the home page and robots.txt.
Counts and dates unmeasured. Parked as UNKNOWN until reachable.

## REJECTED / not screened

- EPA ERNS: ERNS is the NRC notification record itself, so it adds no independent publisher; use the NRC files.
- Alberta Energy Regulator pipeline incidents: not probed in this round (time); candidate for the next round.

## Linkage (measured)

1. NRC material CAS number to the NIOSH Pocket Guide index (cdc.gov, `chemical-niosh-pocket-guide`, 626 CAS entries
   parsed from `npgdcas.html`, HTTP 200). DECLARED (a CAS number names the substance). Leading zeros stripped ("007664-41-7").
   62 of 89 distinct CY2026 NRC CAS numbers are in the NIOSH index; 1,321 of 1,453 NRC material rows with a CAS; 1,264 NRC incidents
   have a NIOSH-covered substance, 18 of them pipeline incidents. Hand check of the 25 most frequent matched CAS numbers:
   25/25 are the same substance by name (ammonia, ethylene glycol, benzene, chlorine, hydrogen sulfide, ...). Weak point: most pipeline
   releases are crude oil or gas with no CAS (pipeline incidents with material rows: 99.6%, but only 18 with a NIOSH CAS), so the substance link is strong for chemical releases and thin for oil.
2. NRC to CER on operator (first word of the company) within 7 days, 2026: 9 candidate pairs from 1,121 NRC pipeline incidents
   x 52 CER incidents; hand-checked 9, 0 same event (US releases in LA/MT/TX/WI against Canadian SK/AB/MB incidents). A cross-border
   event link is not found. CER is therefore linked to the dataset by taxonomy and operator only, not by a measured join.
3. NRC to PHMSA by cited NRC report number: not measurable (PHMSA 403).
4. NRC to NRC: 809 declared update citations of an NRC report number.

## Verdict

Dataset `pipeline-hazmat-incidents` passes the screen: two non-RED members from different publishers (USCG NRC, CER) plus the
NIOSH record, and one declared measured join (NRC CAS to NIOSH, 62/89). Honest limit: the NRC to CER link is zero, and
the two strongest pipeline sources (PHMSA, TSB) are blocked. The CER member is a feed in the same entity type, not a linked one.
