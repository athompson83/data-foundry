# Quality — `vehicles`

There are two kinds of number here, measured on 2026-09-26:

- **Fixture numbers** come from the real-sample fixtures (28 EPA rows, 16
  NHTSA rows) through the real pipeline.
- **Full-file numbers** come from the complete captured files:
  - `vehicles.csv`: 50,409 rows;
  - `FLAT_RCL_PRE_2010.txt` + `FLAT_RCL_POST_2010.txt`: 327,245 rows, of which
    286,110 are vehicle rows.

## Quality dimensions (doc 14)

| Dimension | How it is measured here | Target | Current |
|---|---|---|---|
| Source authority | `authority_rank` of contributing sources | ≥1 source ≥80 per critical property | unassigned (0) until activation |
| Extraction accuracy | fixture extraction vs. golden records; full-file extraction issues | 100% on fixtures; 0 issues | 100% on fixtures (`tests/shape-ingest.test.ts`). Full files: 0 extraction issues on 50,409 EPA rows and 286,110 NHTSA vehicle rows |
| Normalization accuracy | normalized join keys vs. golden | 100% on fixtures | 100% |
| Entity-resolution accuracy | golden matches and non-matches | 0 false merges | 0. `HONDA ACCORD HYBRID 2018` and `Honda Accord 2018` stay distinct; so do `C 300` and `C-Class` |
| **EPA ↔ NHTSA join rate** | NHTSA vehicle make/model/year keys (MY 1984–2027, make known to EPA) matching an EPA `make`+`baseModel`+`year` key | not yet set | **40.9% of keys (7,083 / 17,310); 41.5% of rows**. See below |
| Completeness | critical-field coverage per entity | ≥92% | fixture model years: 9/11 carry EPA `model_name`. The two NHTSA-only keys are the measured join gap |
| Freshness | sources refreshed within cadence | ≥96% within 2× cadence | not measurable (not acquired) |
| Provenance coverage | facts with evidence | 100% | 100% (580/580 fixture facts), every locator a table cell |
| Relationship validity | orphan/cyclic edges | 0 orphans | 0 |
| Rights-policy coverage | sources with complete rights metadata | 100% | 100% complete. Determinations written for 2 of 3 sources; 0 recorded |
| Idempotency | unchanged re-run writes nothing | 0 new versions | 0, after fixing a canonical-store bug the real data exposed (below) |

## The join, measured on the full files

The model-year key is make + model + year, upper-cased with separators
stripped. The population is the 17,310 distinct NHTSA vehicle keys whose make
EPA also uses (MY 1984–2027). The other 47,553 keys belong to makes EPA does
not cover at all: heavy trucks, buses, RVs, trailers, motorcycles.

| Rule | Keys matched | Recall rows matched |
|---|---|---|
| EPA `baseModel` only (**the committed mapping**) | 40.9% | 41.5% |
| `baseModel` **or** EPA `model` | 51.4% | 62.2% |
| `baseModel` or `model` or `model` with drive tokens (AWD/FWD/2WD/4WD/4matic/xDrive…) removed | 53.9% | 71.4% |

- **Campaign level.** 9,689 vehicle campaigns name an EPA make. 67.1% reach
  at least one EPA model year. 50.1% reach every one of their EPA-make model
  years.
- **By make** (keys, `baseModel` rule). Nissan 76%, Kia 75%, Toyota 74%,
  Hyundai 70%, Audi 66%, Honda 42%, Chevrolet 37%, Ford 32%, BMW 12%,
  **Mercedes-Benz 6%**.
- **Typical misses.**
  - NHTSA names the trim or engine where EPA names the line: `C 300` vs
    `C-Class`, `GLE 450` vs `GLE-Class`, `330I` vs `3 Series`.
  - NHTSA splits a powertrain into its own model: `ACCORD HYBRID` vs `Accord`.
- **vPIC does not close the gap.** Its model names follow EPA's line names
  (`GetModelsForMakeYear` returns `C-Class`), not the recall file's.
- **Product consequence.** Recall-to-configuration answers are complete for
  only about 40–70% of recall rows, depending on the rule. Until a reviewed
  crosswalk exists, the headline "recalls for this vehicle" must be keyed on
  NHTSA's own make/model/year (or on VIN via vPIC → recalls API parity), not
  on EPA's model year. A deterministic crosswalk is possible: add `model` as a
  second strong alias source, then a reviewed NHTSA-`MODELTXT` → EPA-`baseModel`
  table. It is never a fuzzy match.

## Declarative quality rules

| Rule id | Type | Property | Severity | What it catches |
|---|---|---|---|---|
| `model_year_in_range` | range | `model_year` | error | NHTSA's `9999` placeholder (581 vehicle rows); extraction errors. The real minimum is 1949, the rule's floor |
| `make_model_year_format` | regex (alias) | `make_model_year` | error | a key not ending in a four-digit year |
| `model_year_has_a_make` | required_edge | `makes` | error | a model year whose make did not resolve |
| `configuration_links_to_a_model_year` | required_edge | `configuration_of` | error | a configuration whose key found no model year |
| `*_mpg_in_range` | range | city/highway/combined | error | swapped or mis-scaled columns. Real maxima: 153/142/146 MPGe, within the 200 ceiling |
| `cylinders_in_range`, `displacement_in_range`, `co2_in_range`, `ev_range_in_range` | range | — | error | unit or column errors. Real `range` maximum 640 |
| `campaign_number_format` | regex (alias) | `nhtsa_campaign_number` | error | malformed campaign numbers (pattern widened for `21V00H000`) |
| `campaign_affects_a_model_year` | required_edge | `recall_affects` | warning | a campaign none of whose make/model/years resolved |
| `configuration_year_agrees_with_model_year` | cross_entity_property | `model_year` | error | a composite key that resolved to the wrong year |

A failing rule demotes a fact; it never deletes one.

## Known gaps (activation blockers first)

| Gap | Impact | Mitigation | Owner |
|---|---|---|---|
| **EPA rights: every customer surface is `UNKNOWN`** | fueleconomy.gov's copyright statement limits use to non-commercial, scientific and educational purposes, so no EPA fact may reach a customer | Re-determine from an EPA-hosted (§ 105) publication or from written approval (RIGHTS.md) | platform |
| **Join rate about 41%** | Most recalls do not reach EPA configurations; the recall product must not depend on the join | Key the recall product on NHTSA's make/model/year; add `model` as a second alias and a reviewed crosswalk (above) | platform |
| **Makes table covers 7 makes** | Every other make is quarantined (`unknown_publisher_policy: quarantine`). The full files name 146 EPA and 1,818 NHTSA vehicle makes | Generate the table from vPIC `GetAllMakes` plus the captured files, then review it | platform |
| **NHTSA snapshot split across two archives** | The CLI accepts one `--artifact` per source, and `full_snapshot` retires records missing from the loaded artifact. Loading PRE_2010 and then POST_2010 would retire the pre-2010 recalls | Let one run take both archives as one snapshot, or declare the pre-2010 file a separate stream or source (`docs/owner-actions/vehicles-initial-load.md`) | platform |
| **`range` semantics** | `ev_range_mi` is correct only for EVs. PHEVs carry total range (2017 Volt: 420; its electric range is in `rangeA`); FCVs carry hydrogen range | Map `ev_range_mi` only where `atvType` is `EV`, and map the PHEV electric range from `rangeA`, before activation | platform |
| **Multi-component campaigns** | `component` is a scalar. 2,188 of 26,358 vehicle campaigns name several, which then compete (fixture `18V629000` holds two values) | Model components as a list or as their own entity | platform |
| **Duplicate rows per campaign × model year** | 23,968 groups span several rows (components and parts). The keys stay idempotent, but record volume is about 1.8× the distinct campaign × model-year count | None needed for correctness; consider pre-aggregating at load | platform |
| **Mojibake in free text** | About 2,700 cp1252 C1 characters (U+0091–U+0094) in NHTSA free text | NFKC plus control-character stripping removes them; a real cp1252 repair would restore the apostrophes | platform |
| **File size and scheduled refresh** | POST_2010 is 311 MB uncompressed, above every scheduled limit | Initial load through `pnpm ingest --artifact`; refresh still needs a streamed design | platform |
| **No VIN decode** | The headline VIN → recalls lookup does not exist | vPIC is feasible (standalone PostgreSQL DB, MY1995+ at about 99% per NHTSA's FAQ) but still declared, unmapped and undetermined | platform |
| **Units not in the unit registry** | mpg, litres, g/mi and miles are carried in property names with `unit: null` | Add fuel-economy, volume and emissions dimensions when a second source needs conversion | platform |

### Fixed while verifying (2026-09-26)

- **Canonical store double-parsed JSONB string values.** It read a fact's
  value back and parsed it again, so the string `"2019030012"` (a real
  `MFGCAMPNO`) became the number 2019030012. Every unchanged re-run then wrote
  a new fact version. This affects any numeric-looking string fact in any
  vertical, including HVAC model numbers. `packages/canonical-store/src/rows.ts`
  now keeps driver-decoded JSONB values as they are. There is a regression test
  in `packages/canonical-store/test/versioning.test.ts`.
