# Sources — `vehicles`

`sources/*.yaml` is what the machine enforces. This file is what the next
engineer reads before touching a connector.

- **All three sources are still proposed and fail-closed** in YAML:
  `UNDER_REVIEW`, `UNREVIEWED`, unapproved, and absent from `acquisition.yaml`.
- **The real files were captured and checked on 2026-09-26.** The evidence is in
  `docs/sources/evidence/vehicles/`.
- **The fixtures are real samples** of those files.
- **ADR-0013 determinations are written** in `docs/sources/determinations/`.
  NHTSA recalls: § 105, every surface `ALLOW`. EPA: `PUBLISHED_TERMS_PERMIT`,
  internal processing only, every customer surface `UNKNOWN` (see RIGHTS.md).
  Neither is recorded or activated yet.

## Source inventory

| Key | Publisher | Type | Authority | Format (verified) | Acquisition | Rights | Status | Cadence |
|---|---|---|---|---|---|---|---|---|
| `epa-fueleconomy-vehicles` | U.S. EPA / U.S. DOE (fueleconomy.gov, run by ORNL) | REGULATORY_FILING | 0 (unassigned) | CSV with header, CRLF, RFC 4180 quoting, in `vehicles.csv.zip` | BULK_FILE (proposed) | UNREVIEWED | UNDER_REVIEW | MONTHLY |
| `nhtsa-recalls` | U.S. DOT / NHTSA | REGULATORY_FILING | 0 (unassigned) | TAB-delimited, headerless, **unquoted**, CRLF, in `FLAT_RCL_PRE_2010.zip` + `FLAT_RCL_POST_2010.zip` | BULK_FILE (proposed) | UNREVIEWED | UNDER_REVIEW | WEEKLY |
| `nhtsa-vpic` | U.S. DOT / NHTSA (vPIC) | REGULATORY_FILING | 0 (unassigned) | JSON API; PostgreSQL 17 standalone DB | VENDOR_API (proposed) | UNREVIEWED | UNDER_REVIEW | MONTHLY |

`authority_rank` stays 0 until activation. The shape test uses EPA 85 and
NHTSA 80 only so that display spellings are readable. Those numbers are not a
decision.

## Source families

| Family | Sources | Uniquely provides |
|---|---|---|
| EPA/DOE fuel economy | `epa-fueleconomy-vehicles` | Configurations (engine, drive, transmission, fuel), fuel economy, tailpipe CO2, EV range |
| NHTSA recalls | `nhtsa-recalls` | Recall campaigns, components, defect/consequence/remedy text, affected make/model/year |
| NHTSA vPIC | `nhtsa-vpic` | VIN decoding; make list (declared, **not mapped**) |

## Per-source notes

### `epa-fueleconomy-vehicles`

- **What it is.** `https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip`:
  a 2,211,728 B archive holding one member, `vehicles.csv` (21,803,514 B).
  One row per tested configuration: 50,409 rows, model years 1984–2027,
  146 makes, 84 columns, updated 2026-09-18.
- **Streams.** `model_years` (the row's make + base model + year) and
  `configurations` (the row itself, keyed by `id`).
- **Quirks (verified).**
  - EVs publish MPGe in the mpg columns, blank `cylinders`/`displ`, and `0.0`
    in `co2TailpipeGpm`.
  - `range` is `0` for conventional vehicles, the **total** range for plug-in
    hybrids, and the hydrogen range for fuel-cell vehicles (see QUALITY.md).
  - `atvType` is blank for conventional vehicles.
  - `drive` is blank on 1,186 rows, almost all model year 1984.
- **Failure modes.** A renamed column fails extraction with `UNKNOWN_COLUMN`.
  The file is header-based, so column order does not matter. A new `drive`
  string quarantines its value.

### `nhtsa-recalls`

- **What it is.** There is no single `FLAT_RCL.zip`. NHTSA splits the complete
  history by report-received date (`RCDATE`):
  - `FLAT_RCL_PRE_2010.zip` (7,435,840 B): `FLAT_RCL_PRE_2010.txt`, 81,710 rows
    plus 5 blank lines.
  - `FLAT_RCL_POST_2010.zip` (15,039,755 B): `FLAT_RCL_POST_2010.txt`,
    245,535 rows.

  Both are regenerated daily (2026-09-26 07:02). The same directory also holds
  annual/quarterly report files and 5-year `RCL_FROM_*` extracts, none of them
  mapped.
- **Row grain (verified).** One row per campaign × make/model/year × component
  × manufacturer part. 23,968 of 160,447 vehicle campaign × make/model/year
  groups span several rows.
- **Streams.** `affected_model_years` and `campaigns`. Many rows resolve to one
  campaign on `CAMPNO`.
- **Row filter.** Both streams declare `where: { column: RCLTYPECD, in: [V] }`.
  Only vehicle rows become records: 286,110 of 327,245.
- **Quirks (verified).**
  - The file is headerless, so the column order is configuration.
  - It is **unquoted**. `"` is literal text, and 16 fields begin with it. The
    mapping declares `quote: ""`, because an RFC 4180 parser throws
    `INVALID_OPENING_QUOTE` on the first such row.
  - There are cp1252 mojibake characters (U+0092, etc.).
  - 104 make/model/year cells carry leading or trailing spaces.
  - Unknown model year is `9999`: 581 vehicle rows.
- **Failure mode.** A column inserted by NHTSA shifts every later column without
  any extraction error. `RCL.txt`'s change log records such changes, most
  recently fields 28 and 29 in May 2025. Re-check it on every refresh.

### `nhtsa-vpic`

- Declared, not mapped, not fixtured, not acquired.
- **VIN decoding is feasible.** `DecodeVinValues` returns a clean decode, and
  NHTSA publishes a monthly standalone PostgreSQL 17 database (67.8 MB custom
  dump) for offline decoding.
- vPIC does **not** reconcile the recall file's model names. It names models
  like EPA's `baseModel` (`C-Class`), not like `MODELTXT` (`C 300`). See
  QUALITY.md.

## Source verification (2026-09-26)

Each item was checked against the captured file and the agency's own field
description (`docs/sources/evidence/vehicles/`). "OK" means the committed
mapping matched. Anything else is recorded along with what was changed.

### Artifact locations and formats

- **EPA.** URL, packaging and member `vehicles.csv` are OK. The archive limits
  hold with more than 10× headroom: 1 member of 8 allowed; 21.8 MB of 256 MiB
  uncompressed; ratio 9.9 of 200.
- **NHTSA.** The URL was **wrong**: there is no `FLAT_RCL.zip`. Changed to the
  two archives above. The member glob `FLAT_RCL*.txt` matches the one member
  of each archive. Limits: 1 member of 8; POST_2010 uncompressed 311 MB of
  512 MiB (about 1.7× headroom, and growing); ratio 20.7 of 200. Delimiter TAB,
  no header, `YYYYMMDD` dates: OK. Quoting **changed** to `quote: ""`.
- **Full-file extraction.** The committed mappings extract every row of all
  three members with **zero** extraction issues:
  - EPA: 50,409 records in each of 2 streams.
  - NHTSA: 67,311 + 218,799 vehicle records in each of 2 streams.
- **vPIC.** The API is at `/api/` on `vpic.nhtsa.dot.gov`: OK.
- **robots.txt.** Retrieved for every host (`robots.json`):
  - `vpic.nhtsa.dot.gov`: 404, none published.
  - `api.nhtsa.gov`: 403 gateway, none published.
  - `static.nhtsa.gov`: 404 NoSuchKey, none published.
  - `www.fueleconomy.gov`: **not retrievable** (an empty reply on three
    attempts, while other pages loaded). The connector must re-check it on
    every run.

### `epa-fueleconomy-vehicles` columns (header names)

All 18 mapped names exist in the captured header. Their meanings come from the
data description at `/feg/ws/index.shtml`.

| Column | Mapped to | Verified |
|---|---|---|
| `id` | `epa_vehicle_id` alias; record key | "vehicle record id"; digits only; 50,409 unique |
| `year` | `model_year` | "model year"; 1984–2027 |
| `make` | `makes` subject; `make`; model-year key | "manufacturer (division)"; 146 values |
| `baseModel` | `model_name`, `base_model`; model-year key | "base model name"; never blank. It joins NHTSA `MODELTXT` on only about 41% of keys (QUALITY.md) |
| `model` | `model` | "model name (carline)" |
| `VClass` | `vehicle_class` | "EPA vehicle size class"; 34 values, including legacy spellings |
| `cylinders` | `cylinders` | blank on 1,654 rows (EVs); `NA` on 3, a null token |
| `displ` | `displacement_l` | litres; blank on 1,653; `NA` on 2 |
| `drive` | `drive` | exactly the 7 strings in `04-ontology-mapping.yaml`; blank on 1,186, now `optional` |
| `trany` | `transmission` | 41 values; blank on 11, now `optional` |
| `fuelType` | `fuel_type` | 16 values |
| `fuelType1` | `primary_fuel` | 7 values; blank on 2, now `optional` |
| `atvType` | `powertrain_type` | blank, `Hybrid`, `EV`, `FFV`, `Diesel`, `Plug-in Hybrid`, `CNG`, `FCV`, `Bifuel (CNG)`, `Bifuel (LPG)`, `eFCV` |
| `city08` | `city_mpg` | MPGe for EV/CNG (footnote 11); maximum 153 |
| `highway08` | `highway_mpg` | same; maximum 142 |
| `comb08` | `combined_mpg` | same; range 7–146 |
| `co2TailpipeGpm` | `co2_tailpipe_gpm` | g/mi, fractional; `0.0` for EVs. Before MY2013 it is an EPA estimate (footnote 5) |
| `range` | `ev_range_mi` | **Not described** in the data description. EV: all-electric range. PHEV: total range. FCV: hydrogen range. **Semantic gap** (QUALITY.md) |

### `nhtsa-recalls` columns (declared order of the headerless file)

The order `RECORD_ID`, `CAMPNO`, `MAKETXT`, `MODELTXT`, `YEARTXT`,
`MFGCAMPNO`, `COMPNAME`, `MFGNAME`, `BGMAN`, `ENDMAN`, `RCLTYPECD`, `POTAFF`,
`ODATE`, `INFLUENCED_BY`, `MFGTXT`, `RCDATE`, `DATEA`, `RPNO`, `FMVSS`,
`DESC_DEFECT`, `CONEQUENCE_DEFECT`, `CORRECTIVE_ACTION`, `NOTES`,
`RCL_CMPT_ID`, `MFR_COMP_NAME`, `MFR_COMP_DESC`, `MFR_COMP_PTNO`,
`DO_NOT_DRIVE`, `PARK_OUTSIDE` is **identical to `RCL.txt`** (fields 1–29).
Every one of the 327,245 data rows has exactly 29 fields.

| Column | Mapped to | Verified |
|---|---|---|
| `RECORD_ID` | record key (both streams) | field 1, "Running Sequence Number, Which Uniquely Identifies The Record"; unique across both files |
| `RCLTYPECD` | row filter only | field 11. Codes found: `V` 286,110; `E` 17,131; `T` 22,307; `C` 1,161; `I` 393 and `X` 143 (pre-2010 "improvement campaigns"). The campaign letter always equals the code. `V` is the only vehicle-recall code |
| `CAMPNO` | `nhtsa_campaign_number` alias | field 2, CHAR(12). Shape `YY` + type letter + 6 characters. The third of those is a letter in 1,678 rows of 2021 campaigns (`21V00H000`), so the pattern was widened to `^[0-9]{2}[VEICTX][0-9]{2}[0-9A-Z][0-9]{3}$` |
| `MAKETXT` | `makes` subject; model-year key | field 3; 1,818 distinct vehicle makes (EPA has 146) |
| `MODELTXT` | model-year key | field 4, CHAR(256); upper case; spelling differs from EPA `baseModel` (QUALITY.md) |
| `YEARTXT` | `model_year`; model-year key | field 5: "9999 If Unknown Or N/A" (581 vehicle rows); otherwise 1949–2027 |
| `MFGCAMPNO` | `manufacturer_campaign_number` | field 6; blank on 89,022 vehicle rows; free text such as `K2G, V2F` or `Multiple Codes` |
| `COMPNAME` | `component` | field 7. 2,188 of 26,358 vehicle campaigns name more than one |
| `MFGNAME` | `manufacturer_name` | field 8; never blank |
| `POTAFF` | `potentially_affected` | field 12, NUMBER(9); digits only; `0` on 203 vehicle rows |
| `RCDATE` | `report_received_date` | field 16; `YYYYMMDD` on every row |
| `DESC_DEFECT` | `summary` | field 20, CHAR(6000); blank on 7,632 vehicle rows, now `optional` |
| `CONEQUENCE_DEFECT` | `consequence` | field 21 (NHTSA's spelling); blank on 16,015, now `optional` |
| `CORRECTIVE_ACTION` | `remedy` | field 22; blank on 7,535, now `optional` |
| `DO_NOT_DRIVE` | `do_not_drive_advisory` | field 28, exactly `Yes`/`No`; `Yes` on 2,123 post-2010 rows |
| `PARK_OUTSIDE` | `park_outside_advisory` | field 29, exactly `Yes`/`No`; `Yes` on 1,288 post-2010 rows |

### Semantics assumed by the model

- One row is one campaign × make/model/year. **Refined:** it is also per
  component and per manufacturer part. `MFR_COMP_*` values are cross-joined
  with every vehicle of the campaign, so they are not per-vehicle facts and
  stay excluded.
- **Parity.** The flat file's vehicle campaigns for HONDA/ACCORD/2018 equal
  the recalls API's answer exactly (six campaigns).
- **Join.** EPA `baseModel` and NHTSA `MODELTXT` agree on only about 41% of
  shared-make keys. This is the largest product finding (QUALITY.md).
- **Rights.** NHTSA's publication is a § 105 federal work. fueleconomy.gov's
  published terms restrict commercial use (RIGHTS.md).

## Real samples

The fixtures are verbatim rows of the captured members; only CRLF became LF.
Each file carries a banner with the source URL and the archive's SHA-256, and
`fixtures/README.md` lists the source line numbers.
