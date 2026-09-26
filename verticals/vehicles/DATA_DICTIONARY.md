# Data Dictionary — `vehicles`

Coverage figures are measured on the **real-sample fixtures** (28 EPA rows,
16 NHTSA rows captured 2026-09-26) and describe only them. Full-file figures
are in SOURCES.md and QUALITY.md.

## Entity types

| Entity type | Description | Canonical URL |
|---|---|---|
| `make` | Vehicle make (manufacturer/brand), resolved through the publisher alias table | `/vehicles/makes/{slug}` |
| `vehicle_model_year` | Make + model + model year — the lookup entity | `/vehicles/model-years/{slug}` |
| `vehicle_configuration` | One EPA-tested configuration (vehicles.csv row) | `/vehicles/configurations/{slug}` (never indexed) |
| `recall_campaign` | One NHTSA recall campaign | `/vehicles/recalls/{slug}` |

## Alias types

Every rule is HVAC's chain: upper-case, strip `- _ . / \` and spaces
(ADR-0003; see `normalizers/03-domain-normalization.yaml`).

| Alias type | Strong? | Built from | Example source form | Normalized form |
|---|---|---|---|---|
| `make_model_year` | yes | EPA `make`+`baseModel`+`year`; NHTSA `MAKETXT`+`MODELTXT`+`YEARTXT`, joined by a space | `Ford F150 2019` / `FORD F-150 2019` | `FORDF1502019` |
| `epa_vehicle_id` | yes | EPA `id` | `39594` | `39594` |
| `nhtsa_campaign_number` | yes | NHTSA `CAMPNO` | `20V314000` (users: `20v-314-000`); also `21V00H000` | `20V314000` |
| `legal_name`, `name` (core) | yes / no | make spellings via `publisher_aliases` | `HONDA` | `HONDA` |

Display names: a model year shows its composite key's best-ranked source
spelling (`Honda Accord 2018`; an NHTSA-only key shows NHTSA's upper case,
`HONDA ACCORD HYBRID 2018`); a configuration shows
`EPA <id>`; a campaign `NHTSA <number>`.

## Properties — `vehicle_model_year`

| Property | Type | Unit | Critical | Description | Coverage (fixtures) |
|---|---|---|---|---|---|
| `model_year` | integer | — | yes | Model year | 11/11 (EPA 9, NHTSA 9, both 7 — agree) |
| `model_name` | string | — | yes | EPA base model name | 9/11 (EPA only; the 2 NHTSA-only keys are the measured join gap) |

## Properties — `vehicle_configuration` (EPA only)

Units are carried in the property name; `unit` is null because the platform
unit registry has no fuel-economy, volume or emissions dimension.

| Property | Type | Unit (by name) | Critical | Source column | Coverage |
|---|---|---|---|---|---|
| `model_year` | integer | — | yes | `year` | 28/28 |
| `make` | string | — | no | `make` | 28/28 |
| `model` | string | — | yes | `model` | 28/28 |
| `base_model` | string | — | no | `baseModel` | 28/28 |
| `vehicle_class` | string | — | no | `VClass` | 28/28 |
| `cylinders` | integer | — | no | `cylinders` | 26/28 (EVs absent) |
| `displacement_l` | number | litres | no | `displ` | 26/28 (EVs absent) |
| `drive` | string (controlled) | — | yes | `drive` | 28/28 (blank on 1,186 full-file rows, optional) |
| `transmission` | string | — | no | `trany` | 28/28 |
| `fuel_type` | string | — | yes | `fuelType` | 28/28 |
| `primary_fuel` | string | — | no | `fuelType1` | 28/28 |
| `powertrain_type` | string | — | no | `atvType` | 6/28 (blank = conventional) |
| `city_mpg` | number | mpg (MPGe for EVs) | yes | `city08` | 28/28 |
| `highway_mpg` | number | mpg (MPGe for EVs) | yes | `highway08` | 28/28 |
| `combined_mpg` | number | mpg (MPGe for EVs) | yes | `comb08` | 28/28 |
| `co2_tailpipe_gpm` | number | g CO2/mi | no | `co2TailpipeGpm` | 28/28 |
| `ev_range_mi` | integer | miles (0 = none, as published) | no | `range` | 28/28. **Correct only for EVs**: the 2017 Volt (PHEV) row carries its total range, 420 (QUALITY.md) |

`drive` terms: `front_wheel_drive`, `rear_wheel_drive`, `all_wheel_drive`,
`four_wheel_drive`, `part_time_four_wheel_drive`, `four_or_all_wheel_drive`,
`two_wheel_drive`.

## Properties — `recall_campaign` (NHTSA only)

| Property | Type | Unit | Critical | Source column | Coverage |
|---|---|---|---|---|---|
| `report_received_date` | date | — | yes | `RCDATE` (YYYYMMDD) | 11/11 |
| `component` | string | — | yes | `COMPNAME` | 11/11 (`18V629000` carries two competing values) |
| `summary` | string | — | yes | `DESC_DEFECT` | 11/11 |
| `consequence` | string | — | yes | `CONEQUENCE_DEFECT` | 11/11 |
| `remedy` | string | — | yes | `CORRECTIVE_ACTION` | 11/11 |
| `manufacturer_campaign_number` | string | — | no | `MFGCAMPNO` | 10/11 (free text, e.g. `K2G, V2F`) |
| `manufacturer_name` | string | — | no | `MFGNAME` | 11/11 |
| `potentially_affected` | integer | vehicles | no | `POTAFF` | 11/11 |
| `park_outside_advisory` | boolean | — | no | `PARK_OUTSIDE` | 11/11 |
| `do_not_drive_advisory` | boolean | — | no | `DO_NOT_DRIVE` | 11/11 (`23V283000` is `Yes`) |

## Properties — `make`

None. A make is an identity anchor for `makes` edges.

### Coverage matrix

| Property group | epa-fueleconomy-vehicles | nhtsa-recalls |
|---|---|---|
| `make_model_year`, `model_year`, `makes` edge | ✅ | ✅ |
| `model_name` | ✅ | — |
| configuration properties, `configuration_of` | ✅ | — |
| campaign properties, `recall_affects` | — | ✅ |

## Relationships

| Predicate | Subject → Object | Cardinality | Transitive | Description |
|---|---|---|---|---|
| `makes` | make → vehicle_model_year | one-to-many | no | The make builds the model year |
| `configuration_of` | vehicle_configuration → vehicle_model_year | many-to-one | no | EPA configuration of the model year |
| `recall_affects` | recall_campaign → vehicle_model_year | many-to-many | no | NHTSA campaign covers the model year (model-year level, not per VIN) |

## Derived properties

None. EPA's combined figure is published, not recomputed.
