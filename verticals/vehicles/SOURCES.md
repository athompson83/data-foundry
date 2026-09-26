# Sources — `vehicles`

`sources/*.yaml` is what the machine enforces; this is what the next engineer
reads before touching a connector. **All three sources are proposed and
fail-closed** (`UNDER_REVIEW`, `UNREVIEWED`, unapproved, absent from
`acquisition.yaml`). **All fixtures are synthetic shape fixtures.** Nothing
here has been fetched from a real publisher.

## Source inventory

| Key | Publisher | Type | Authority | Format | Acquisition | Rights | Status | Cadence |
|---|---|---|---|---|---|---|---|---|
| `epa-fueleconomy-vehicles` | U.S. EPA / U.S. DOE (fueleconomy.gov) | REGULATORY_FILING | 0 (unassigned) | CSV (zipped, UNVERIFIED) | BULK_FILE (proposed) | UNREVIEWED | UNDER_REVIEW | MONTHLY |
| `nhtsa-recalls` | U.S. DOT / NHTSA | REGULATORY_FILING | 0 (unassigned) | tab-delimited, headerless (zipped, UNVERIFIED) | BULK_FILE (proposed) | UNREVIEWED | UNDER_REVIEW | WEEKLY |
| `nhtsa-vpic` | U.S. DOT / NHTSA (vPIC) | REGULATORY_FILING | 0 (unassigned) | API / database download | VENDOR_API (proposed) | UNREVIEWED | UNDER_REVIEW | MONTHLY |

`authority_rank` stays 0 until activation. The shape test uses EPA 85 /
NHTSA 80 only to make display spellings readable; those numbers are not a
decision.

## Source families

| Family | Sources | Uniquely provides |
|---|---|---|
| EPA/DOE fuel economy | `epa-fueleconomy-vehicles` | Configurations (engine, drive, transmission, fuel), fuel economy, tailpipe CO2, EV range |
| NHTSA recalls | `nhtsa-recalls` | Recall campaigns, components, defect/consequence/remedy text, affected make/model/year |
| NHTSA vPIC | `nhtsa-vpic` | VIN decoding; authoritative make/model names (declared, **not mapped**) |

Two independent agencies. Doc 17's three-family minimum is met only once vPIC
is mapped; `seo.yaml`'s dataset gate asks for two.

## Per-source notes

### `epa-fueleconomy-vehicles`

- **What it is:** the fueleconomy.gov bulk vehicle file: one row per tested
  configuration, from the 1984 model year on (UNVERIFIED range).
- **Why we need it:** the only source of configurations and fuel economy, and
  of the `baseModel` that names a model without trim or drivetrain.
- **Streams:** `model_years` (the row's make + base model + year) and
  `configurations` (the row itself, keyed by `id`).
- **Quirks:** EVs publish MPGe in the mpg columns and blank engine columns;
  `range` is 0 for non-EVs; `atvType` is blank for conventional vehicles.
- **Failure modes:** a renamed or reordered column fails extraction with
  `UNKNOWN_COLUMN` (header-based, so order does not matter); a new `drive`
  string quarantines its value.

### `nhtsa-recalls`

- **What it is:** the NHTSA recall flat file: one row per campaign ×
  make/model/year (× component, UNVERIFIED).
- **Why we need it:** recall campaigns and which model years they affect —
  the headline product.
- **Streams:** `affected_model_years` (the make/model/year each row names) and
  `campaigns` (the campaign, keyed by `RECORD_ID`; many rows resolve to one
  campaign on `CAMPNO`).
- **Quirks:** headerless, so the column ORDER is configuration
  (`parsing.columns`) and a wrong position silently maps the wrong column —
  the most dangerous assumption in this vertical. Upper-case text. Unknown year
  written `9999` (UNVERIFIED). Includes equipment, tire and child-seat
  campaigns this vertical does not model.
- **Failure modes:** a column inserted by NHTSA shifts every later column
  without any extraction error; verify against the dictionary on every refresh
  until a header-bearing artifact is available.

### `nhtsa-vpic`

- Declared so the VIN → recalls headline has a named, fail-closed dependency.
  Not mapped, not fixtured, not acquired. Also the planned source of an
  authoritative make/model list to reconcile EPA and NHTSA model names
  deterministically.

## Unverified source assumptions

**Activation blocker.** Every item below was written from memory of the
agencies' published data dictionaries, not from a captured artifact. Each must
be checked against a captured file (and the current dictionary) and the result
recorded in `CHANGELOG.md` before any source leaves `UNDER_REVIEW`.
`tests/vertical-config.test.ts` fails if a mapped column is missing from this
section.

### Artifact locations and formats (all sources)

- EPA bulk file URL and packaging: believed to be
  `https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip` (zipped CSV).
  The platform has no zip adapter.
- NHTSA flat file URL and packaging: believed to be
  `https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL.zip` (zipped, tab-delimited,
  no header, no quoting). Quote handling of free-text fields is unverified.
- vPIC API path `/api/` on `vpic.nhtsa.dot.gov`.
- All three `robots.txt` files (not retrieved; `snapshot_hash` is null).
- File sizes: both bulk files are believed to exceed the 16 MiB direct-HTTP
  ceiling and the scheduled ingestion record limits.

### `epa-fueleconomy-vehicles` columns (header names)

| Column | Mapped to | What is unverified |
|---|---|---|
| `id` | `epa_vehicle_id` alias; record key | name; digits-only; stability across releases |
| `year` | `model_year` (both streams); part of the model-year key and record key | name; four digits |
| `make` | `makes` subject; `make`; part of the model-year key | name; spellings vs NHTSA `MAKETXT` |
| `baseModel` | `model_name`, `base_model`; part of the model-year key | name; that it equals NHTSA `MODELTXT` for the same model often enough to join |
| `model` | `model` | name |
| `VClass` | `vehicle_class` | name; value set |
| `cylinders` | `cylinders` | name; blank for EVs |
| `displ` | `displacement_l` | name; litres; blank for EVs |
| `drive` | `drive` (controlled vocabulary) | name; the exact value set in `normalizers/04-ontology-mapping.yaml` |
| `trany` | `transmission` | name (EPA's spelling) |
| `fuelType` | `fuel_type` | name; value set |
| `fuelType1` | `primary_fuel` | name; value set |
| `atvType` | `powertrain_type` | name; value set; blank for conventional vehicles |
| `city08` | `city_mpg` | name; MPGe for EVs |
| `highway08` | `highway_mpg` | name; MPGe for EVs |
| `comb08` | `combined_mpg` | name; MPGe for EVs |
| `co2TailpipeGpm` | `co2_tailpipe_gpm` | name; grams per mile; 0 for EVs |
| `range` | `ev_range_mi` | name; miles; 0 for non-EVs; PHEV semantics |

Unmapped columns present in the fixture (`barrels08`, `engId`, `eng_dscr`,
`mpgData`, `mfrCode`, `createdOn`, `modifiedOn`) are there only to make the
shape realistic; their names are equally unverified.

### `nhtsa-recalls` columns (declared order of the headerless file)

The whole ordered list is an assumption: `RECORD_ID`, `CAMPNO`, `MAKETXT`,
`MODELTXT`, `YEARTXT`, `MFGCAMPNO`, `COMPNAME`, `MFGNAME`, `BGMAN`, `ENDMAN`,
`RCLTYPECD`, `POTAFF`, `ODATE`, `INFLUENCED_BY`, `MFGTXT`, `RCDATE`, `DATEA`,
`RPNO`, `FMVSS`, `DESC_DEFECT`, `CONEQUENCE_DEFECT`, `CORRECTIVE_ACTION`,
`NOTES`, `RCL_CMPT_ID`, `MFR_COMP_NAME`, `MFR_COMP_DESC`, `MFR_COMP_PTNO`,
`DO_NOT_DRIVE`, `PARK_OUTSIDE`.

| Column | Mapped to | What is unverified |
|---|---|---|
| `RECORD_ID` | record key (both streams) | position 1; unique per row; stable across releases |
| `CAMPNO` | `nhtsa_campaign_number` alias | position; format `^\d{2}[VEICT]\d{6}$` (the letter set) |
| `MAKETXT` | `makes` subject; part of the model-year key | position; spellings vs EPA `make` |
| `MODELTXT` | part of the model-year key | position; spellings vs EPA `baseModel` |
| `YEARTXT` | `model_year`; part of the model-year key and record key | position; `9999` for unknown |
| `MFGCAMPNO` | `manufacturer_campaign_number` | position |
| `COMPNAME` | `component` | position; one or several components per campaign |
| `MFGNAME` | `manufacturer_name` | position |
| `POTAFF` | `potentially_affected` | position; integer without separators |
| `RCDATE` | `report_received_date` | position; `YYYYMMDD` |
| `DESC_DEFECT` | `summary` | position |
| `CONEQUENCE_DEFECT` | `consequence` | position; NHTSA's own misspelling |
| `CORRECTIVE_ACTION` | `remedy` | position |
| `DO_NOT_DRIVE` | `do_not_drive_advisory` | presence, position and `Yes`/`No` encoding (newer columns) |
| `PARK_OUTSIDE` | `park_outside_advisory` | presence, position and `Yes`/`No` encoding (newer columns) |

### Semantics assumed by the model

- One flat-file row = one campaign × make/model/year; `POTAFF`, dates and text
  are repeated identically on every row of a campaign.
- `RCLTYPECD = V` marks vehicle campaigns; others are equipment/tire/seat.
- EPA `baseModel` and NHTSA `MODELTXT` name the same model the same way often
  enough for a useful join (see QUALITY.md for what happens when they do not).
- Both agencies' publications are works of the US Government with no contrary
  restriction (the expected ADR-0013 basis — see RIGHTS.md).

## Synthetic vs. real sources

The **declarations** name the real agencies and their real domains because
they are proposals for those real sources, and they are fail-closed. The
**fixtures and goldens** are synthetic: fictional makes, fictional ids and
campaign numbers, fictional text, each file bannered `SYNTHETIC SHAPE FIXTURE`.
No fixture was fetched from, or attributed as data to, EPA, DOE or NHTSA, and
the offline harness serves them from disk — no request reaches any agency.
