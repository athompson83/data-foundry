# US federal vehicle data: rights determination (ADR-0013), 2026-09-26

**Status:** written, **not yet recorded** (`pnpm rights:record`) and **not
activated**. Every source YAML under `verticals/vehicles/sources/` stays
`UNDER_REVIEW` / `UNREVIEWED` until a separate, reviewed activation step.

**Determination records (machine-readable):**

- [`determinations/nhtsa-recalls.yaml`](determinations/nhtsa-recalls.yaml): basis
  `PUBLIC_DOMAIN_US_GOVERNMENT_WORK`. All seven customer surfaces are `ALLOW`.
- [`determinations/epa-fueleconomy-vehicles.yaml`](determinations/epa-fueleconomy-vehicles.yaml):
  basis `PUBLISHED_TERMS_PERMIT`, **not** § 105. Internal acquisition, storage and
  caching are `ALLOW`. **All seven customer surfaces are `UNKNOWN`** because the
  host's published copyright statement is a contrary restriction (see below).

`reviewed_by` is `Data Foundry evidence-based determination (ADR-0013)`. It
records the determination, not a person.

## Why the two sources differ

The two agencies publish their bulk files through different hosts, and the
hosts publish different terms.

### NHTSA recalls: § 105 applies and nothing contrary was found

- The flat files are published by NHTSA, an agency of the U.S. Department of
  Transportation, from NHTSA's own bucket (`static.nhtsa.gov`, S3 bucket
  `production.static.nhtsa.dot.gov`). The field description `RCL.txt` states
  that the file "contains all NHTSA safety-related defect and compliance
  campaigns since 1967."
- A work of the United States Government is not subject to copyright
  (17 U.S.C. § 105). The recall summaries (`DESC_DEFECT`,
  `CONEQUENCE_DEFECT`, `CORRECTIVE_ACTION`) are NHTSA's summaries of the
  manufacturers' Part 573 reports. The manufacturers' own filings (PDFs) are
  **not** acquired or republished.
- NHTSA's vPIC FAQ, on the same agency's developer site, says: "Is there a
  licensing requirement or registration requirement to use the APIs? No, NHTSA
  is a government agency and the services provided on the API are free for use
  by the public as an offering as a part of our Open Data initiatives." This
  covers vPIC, not the flat files. It is recorded as corroborating agency
  policy, not as the basis.
- NHTSA's site-wide "Web Policies & Notices" page (`www.nhtsa.gov`) could not
  be retrieved from the build environment (HTTP 403). ADR-0013 allows this
  only when the basis does not depend on that text. The § 105 basis does not.
  The page must be captured from an unrestricted network at the first
  re-determination, or sooner if one is available.
- No restriction was found on any captured NHTSA page. There is no licence
  text, no click-through, no API key, and no robots.txt on `static.nhtsa.gov`
  (HTTP 404 NoSuchKey).

### EPA/DOE fueleconomy.gov: the host's copyright statement restricts commercial use

- The download page says: "Fuel economy data are the result of vehicle testing
  done at the Environmental Protection Agency's National Vehicle and Fuel
  Emissions Laboratory in Ann Arbor, Michigan, and by vehicle manufacturers
  with oversight by EPA." The values are EPA regulatory data.
- The site, however, "is administered by Oak Ridge National Laboratory for the
  U.S. Department of Energy and the U.S. Environmental Protection Agency." Its
  only terms page, linked from every footer as "Privacy/Security"
  (`/feg/ORNL-disclaimer.htm`), says under **Copyright Status**:

  > Documents provided from the web server were sponsored by a contractor of
  > the U.S. Government under contract DE-AC05-00OR22725. Accordingly, the U.S.
  > Government retains a nonexclusive, royalty-free license to publish or
  > reproduce these documents, or to allow others to do so, for U.S.
  > Government purposes. These documents may be freely distributed and used
  > for non-commercial, scientific and educational purposes.

- Work produced by a government *contractor* is not automatically a § 105
  work, and ADR-0013's § 105 basis requires "no contrary restriction in the
  agency's published terms." This paragraph is such a restriction for anything
  commercial. The underlying mpg and CO2 figures are facts and are probably not
  copyrightable. But ADR-0013 has no "uncopyrightable facts" basis, and this
  determination does not invent one.
- **Decision.** Basis `PUBLISHED_TERMS_PERMIT`, limited to what the paragraph
  permits. The platform may acquire, store and cache the file for evaluation
  and quality work: internal, non-commercial and scientific use. Every
  customer surface is `UNKNOWN`, which the engine treats as refusal.
  `NORMALIZE` and `DERIVE` are left undeclared (`UNKNOWN`).
- **How to lift it** (routine engineering work, not an owner decision):
  1. Capture the same data from an EPA-hosted publication (for example EPA's
     own fuel-economy data releases on `epa.gov`, which were not reachable from
     this environment) whose terms carry no contractor restriction, and
     re-determine on § 105.
  2. Or obtain written confirmation from the fueleconomy.gov maintainers
     (`/feg/contacts.shtml`) or EPA that `vehicles.csv` may be redistributed
     commercially. Store it as `AGREEMENT` evidence and re-determine as
     `DOCUMENTED_APPROVAL` or `PUBLISHED_TERMS_PERMIT`.

## Surfaces

| Surface | `nhtsa-recalls` | `epa-fueleconomy-vehicles` |
|---|---|---|
| `PUBLIC_WEB` | ALLOW: § 105, attribution and disclaimer rendered | UNKNOWN: commercial display not permitted by the copyright statement |
| `SEARCH_INDEX` | ALLOW: § 105. Indexability stays quality-gated (`seo.yaml`) | UNKNOWN |
| `API_FREE` | ALLOW | UNKNOWN: a free tier of a commercial API is still commercial use |
| `API_PAID` | ALLOW | UNKNOWN |
| `RAPIDAPI` | ALLOW: no licence, so no sublicensing restriction | UNKNOWN |
| `MCP` | ALLOW | UNKNOWN |
| `BULK_EXPORT` | ALLOW: the agency itself publishes the full file | UNKNOWN |
| `ACQUIRE` / `STORE` / `CACHE` | ALLOW | ALLOW: evaluation and scientific use, which the statement permits |
| `NORMALIZE` / `DERIVE` | ALLOW | not declared (UNKNOWN) |

## Hard stops checked

| Hard stop | `nhtsa-recalls` | `epa-fueleconomy-vehicles` |
|---|---|---|
| Personal data | None in the mapped fields. `NOTES` and the remedy text carry manufacturer customer-service and NHTSA hotline **business** numbers, not personal data. `NOTES` stays excluded. | None. `vehicles.csv` has no person-level data. The My MPG web service (per-driver data) is **not** used. |
| Third-party marks | Make and model names are the manufacturers' marks, used nominatively to identify vehicles. No logos. | Same. |
| Images | None acquired. | The site's vehicle photographs are manufacturer/Ward's copyright. They are **not** acquired; `images_reusable: false`. |
| Embedded third-party content | Manufacturer-supplied part names/numbers (`MFR_COMP_*`) are excluded. | None in the mapped columns. |
| Rate limits / robots | No robots.txt on `static.nhtsa.gov` or `api.nhtsa.gov`. The source takes one GET per refresh. | robots.txt could not be retrieved (empty reply on three attempts, while other pages loaded). The acquisition path is one GET of `/feg/epadata/vehicles.csv.zip` per month. The connector must re-check robots on each run. |
| Endorsement | Disclaimer required (below). | Disclaimer required. The ORNL page's "Disclaimer of Endorsement" also applies. |

## Attribution and disclaimers every carrying surface must render

- NHTSA: "Source: NHTSA recall data (manufacturer-reported), retrieved <date>.
  Not endorsed by NHTSA or the U.S. Department of Transportation. Check a
  specific vehicle's VIN at nhtsa.gov/recalls."
- EPA (when a surface is ever allowed): "Source: U.S. EPA / U.S. DOE
  fueleconomy.gov vehicle data, retrieved <date>. Not endorsed by EPA or DOE."

## Evidence

All files are committed byte-for-byte under
[`evidence/vehicles/`](evidence/vehicles/) (`.gitattributes` marks the
directory `-text`). Bulk archives are **not** committed; each has a manifest
with URL, retrieval time, size, SHA-256, member listing, header and first rows,
and row counts. See that directory's README for the full table.

| Key | URL | Retrieved (UTC) | SHA-256 |
|---|---|---|---|
| fueleconomy copyright statement | https://www.fueleconomy.gov/feg/ORNL-disclaimer.htm | 2026-09-26T21:20:35Z | `5ccccc187a4a6478a4d957ddf9258e1046999200ed7270e16680a43d61210460` |
| fueleconomy download page | https://www.fueleconomy.gov/feg/download.shtml | 2026-09-26T21:20:00Z | `1d196c4e780b6f426b9be25d90576c550bd4d345b3deed0275c70464801996bc` |
| fueleconomy web services + data description | https://www.fueleconomy.gov/feg/ws/index.shtml | 2026-09-26T21:19:59Z | `a4d82d1d266b1070f396322ac2b387270e95a9e63b60704a4b1641bd430577a0` |
| vehicles.csv.zip (manifest only) | https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip | 2026-09-26T21:21:32Z | `fd9132961f2aff95464b9671aec025ecd886092521aa8855e79f77717a45ec0f` |
| NHTSA RCL field description | https://static.nhtsa.gov/odi/ffdd/rcl/RCL.txt | 2026-09-26T21:21:19Z | `3438cc7e4131efa401dfe6437dbe035607e092c129155dfb411d459d58802203` |
| NHTSA RCL directory listing | https://static.nhtsa.gov/?prefix=odi/ffdd/rcl/ | 2026-09-26T21:21:18Z | `f3a4397c67c627aa71af20e102a612ae8f8ed52366e52a8a38cbe722612869df` |
| FLAT_RCL_PRE_2010.zip (manifest only) | https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_PRE_2010.zip | 2026-09-26T21:21:25Z | `d771bf14248ee62f75050f3c61f62d4afc3a5d9a4a7f539bb32d07d9f48bfe46` |
| FLAT_RCL_POST_2010.zip (manifest only) | https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip | 2026-09-26T21:21:27Z | `306e4fb488c45e184d0dc79a786c9e8062029d634e3590ced869fd26ba2cac95` |
| vPIC FAQ (agency open-data statement) | https://vpic.nhtsa.dot.gov/api/home/index/faq | 2026-09-26T21:25:36Z | `31862b354baa88d1068c3ea5e22f83d8e9892db2fe0d34ca3b5d329f14e2a975` |
| recalls API sample (parity check) | https://api.nhtsa.gov/recalls/recallsByVehicle?make=honda&model=accord&modelYear=2018 | 2026-09-26T21:25:13Z | `367260043e263abbc8183c9a190833f1ba004e001d87ebe1653b52cacb5bad8d` |
| robots.txt, four hosts | see `robots.json` | 2026-09-26T21:19:30Z | `94bb36583e6b5108be66c35f9321690ceb7bb2365ed0d909732f389b1adcca38` |
| NHTSA web policies | https://www.nhtsa.gov/about-nhtsa/web-policies-notices | not retrieved (HTTP 403 from the build environment) | — |

## Re-determination

`recheck_at` is 2027-09-26, 12 months out, the ADR-0013 maximum. Re-determine
sooner if either host's terms page changes (its SHA-256 no longer matches), if
RCL.txt's change log adds fields, or when EPA-hosted evidence or written
approval for `vehicles.csv` becomes available.

## What this does not do

- It does not record any rights cell. Run
  `POSTGRES_URL=... corepack pnpm rights:record -- --file docs/sources/determinations/<key>.yaml`
  per source (use `--dry-run` first).
- It does not activate either source, approve acquisition, or assign
  `authority_rank`.
- It does not cover `nhtsa-vpic`. The vPIC FAQ above supports the same § 105
  basis, but vPIC is not mapped and gets its own determination when it is.
