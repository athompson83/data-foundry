# Data Dictionary — `vehicles`

Coverage figures are measured on the **synthetic shape fixtures** and describe
only them.

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
| `make_model_year` | yes | EPA `make`+`baseModel`+`year`; NHTSA `MAKETXT`+`MODELTXT`+`YEARTXT`, joined by a space | `Placeholder Motor Works PM-3 2022` / `PLACEHOLDER MOTOR WORKS PM3 2022` | `PLACEHOLDERMOTORWORKSPM32022` |
| `epa_vehicle_id` | yes | EPA `id` | `900004` | `900004` |
| `nhtsa_campaign_number` | yes | NHTSA `CAMPNO` | `20V901000` (users: `20v-901-000`) | `20V901000` |
| `legal_name`, `name` (core) | yes / no | make spellings via `publisher_aliases` | `EXAMPLAR MOTORS` | `EXAMPLAR MOTORS` |

Display names: a model year shows its composite key's best-ranked source
spelling (`Examplar Motors Roadster 2020`); a configuration shows
`EPA <id>`; a campaign `NHTSA <number>`.

## Properties — `vehicle_model_year`

| Property | Type | Unit | Critical | Description | Coverage (synthetic) |
|---|---|---|---|---|---|
| `model_year` | integer | — | yes | Model year | 10/10 (EPA 9, NHTSA 6, both 5 — agree) |
| `model_name` | string | — | yes | EPA base model name | 9/10 (EPA only) |

## Properties — `vehicle_configuration` (EPA only)

Units are carried in the property name; `unit` is null because the platform
unit registry has no fuel-economy, volume or emissions dimension.

| Property | Type | Unit (by name) | Critical | Source column | Coverage |
|---|---|---|---|---|---|
| `model_year` | integer | — | yes | `year` | 12/12 |
| `make` | string | — | no | `make` | 12/12 |
| `model` | string | — | yes | `model` | 12/12 |
| `base_model` | string | — | no | `baseModel` | 12/12 |
| `vehicle_class` | string | — | no | `VClass` | 12/12 |
| `cylinders` | integer | — | no | `cylinders` | 11/12 (EV absent) |
| `displacement_l` | number | litres | no | `displ` | 11/12 (EV absent) |
| `drive` | string (controlled) | — | yes | `drive` | 12/12 |
| `transmission` | string | — | no | `trany` | 12/12 |
| `fuel_type` | string | — | yes | `fuelType` | 12/12 |
| `primary_fuel` | string | — | no | `fuelType1` | 12/12 |
| `powertrain_type` | string | — | no | `atvType` | 3/12 (blank = conventional) |
| `city_mpg` | number | mpg (MPGe for EVs) | yes | `city08` | 12/12 |
| `highway_mpg` | number | mpg (MPGe for EVs) | yes | `highway08` | 12/12 |
| `combined_mpg` | number | mpg (MPGe for EVs) | yes | `comb08` | 12/12 |
| `co2_tailpipe_gpm` | number | g CO2/mi | no | `co2TailpipeGpm` | 12/12 |
| `ev_range_mi` | integer | miles (0 = none, as published) | no | `range` | 12/12 |

`drive` terms: `front_wheel_drive`, `rear_wheel_drive`, `all_wheel_drive`,
`four_wheel_drive`, `part_time_four_wheel_drive`, `four_or_all_wheel_drive`,
`two_wheel_drive`.

## Properties — `recall_campaign` (NHTSA only)

| Property | Type | Unit | Critical | Source column | Coverage |
|---|---|---|---|---|---|
| `report_received_date` | date | — | yes | `RCDATE` (YYYYMMDD) | 5/5 |
| `component` | string | — | yes | `COMPNAME` | 5/5 |
| `summary` | string | — | yes | `DESC_DEFECT` | 5/5 |
| `consequence` | string | — | yes | `CONEQUENCE_DEFECT` | 5/5 |
| `remedy` | string | — | yes | `CORRECTIVE_ACTION` | 5/5 |
| `manufacturer_campaign_number` | string | — | no | `MFGCAMPNO` | 5/5 |
| `manufacturer_name` | string | — | no | `MFGNAME` | 5/5 |
| `potentially_affected` | integer | vehicles | no | `POTAFF` | 5/5 |
| `park_outside_advisory` | boolean | — | no | `PARK_OUTSIDE` | 5/5 |
| `do_not_drive_advisory` | boolean | — | no | `DO_NOT_DRIVE` | 5/5 |

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
