# Quality — `vehicles`

Measured on the synthetic shape fixtures only. None of these numbers describes
real EPA or NHTSA data.

## Quality dimensions (doc 14)

| Dimension | How it is measured here | Target | Current (synthetic) |
|---|---|---|---|
| Source authority | `authority_rank` of contributing sources | ≥1 source ≥80 per critical property | unassigned (0) until activation |
| Extraction accuracy | fixture extraction vs. golden records | 100% on fixtures | 100% (`tests/shape-ingest.test.ts`) |
| Normalization accuracy | normalized join keys vs. golden | 100% on fixtures | 100% |
| Entity-resolution accuracy | golden matches/non-matches | 0 false merges | 0; PM-3 / PM-30 / PM-300 stay distinct |
| Completeness | critical-field coverage per entity | ≥92% | model years 9/10 (PM-300 has no EPA `model_name`) |
| Freshness | sources refreshed within cadence | ≥96% within 2× cadence | not measurable (not acquired) |
| Provenance coverage | facts with evidence | 100% | 100% (262/262), every locator a table cell |
| Relationship validity | orphan/cyclic edges | 0 orphans | 0 |
| Rights-policy coverage | sources with complete rights metadata | 100% | 100% complete, 0% determined |

## Declarative quality rules

| Rule id | Type | Property | Severity | What it catches |
|---|---|---|---|---|
| `model_year_in_range` | range | `model_year` | error | NHTSA's `9999` placeholder; extraction errors |
| `make_model_year_format` | regex (alias) | `make_model_year` | error | a key not ending in a four-digit year |
| `model_year_has_a_make` | required_edge | `makes` | error | a model year whose make did not resolve |
| `configuration_links_to_a_model_year` | required_edge | `configuration_of` | error | a configuration whose key found no model year |
| `*_mpg_in_range` | range | city/highway/combined | error | swapped or mis-scaled columns (EV MPGe allowed to 200) |
| `cylinders_in_range`, `displacement_in_range`, `co2_in_range`, `ev_range_in_range` | range | — | error | unit or column errors |
| `campaign_number_format` | regex (alias) | `nhtsa_campaign_number` | error | malformed campaign numbers |
| `campaign_affects_a_model_year` | required_edge | `recall_affects` | warning | a campaign none of whose make/model/years resolved |
| `configuration_year_agrees_with_model_year` | cross_entity_property | `model_year` | error | a composite key that resolved to the wrong year |

A failing rule demotes a fact; it never deletes one.

## Known gaps

| Gap | Impact | Mitigation | Owner |
|---|---|---|---|
| **All column names and the NHTSA column order are unverified** | The mappings may not read the real files at all, or (NHTSA, headerless) may read the wrong column silently | Capture artifacts (`UA-009`), check SOURCES.md's list, re-derive goldens | platform |
| **EPA `baseModel` vs NHTSA `MODELTXT` spellings** | Where the agencies name a model differently, two model-year entities are created and the recall does not reach EPA's configurations. The platform never guesses the join | `model_name_and_year` blocking surfaces some splits for review; the real fix is vPIC's model list as a deterministic crosswalk | platform |
| **Composite key uses raw make text** | A make spelled differently in the two files (beyond case/punctuation) splits a model year, although both spellings resolve to one make | Same as above; add a crosswalk rather than widen normalization | platform |
| **Multi-component campaigns** | `component` is a scalar; a campaign listing several components across rows would carry competing values (escalated, not auto-resolved) | Model components as a list or as their own entity once real rows are seen | platform |
| **Recall-type filter rests on unverified codes** | Both NHTSA streams keep only `RCLTYPECD = V` rows (the generic `where` row filter), so equipment/tire/child-seat rows no longer create model years or campaigns — the fixture's `E` and `T` rows prove it. But the code set (`V`/`E`/`T`/`C`) is UNVERIFIED: a different real encoding would drop vehicle recalls silently | Verify the code set on a captured file; compare the `V`-row campaign count with NHTSA's published vehicle-recall totals before activation | platform |
| **`9999` model years** | Placeholder years create model-year entities that fail `model_year_in_range`. The fixture's `9999` row is a tire recall the row filter already excludes; a vehicle row with `9999` would still pass it | Quarantine by validation, or a further row filter once the real distribution of `9999` is known | platform |
| **File size and zip packaging** | Neither bulk file fits the scheduled ingestion limits, and neither is unzipped | Offline `pnpm ingest` for the initial snapshot; archive adapter or unzipped route; partitioned refresh design | platform |
| **No VIN decode** | The headline VIN → recalls lookup does not exist | `nhtsa-vpic` is declared, fail-closed and unmapped | platform |
| **Units not in the unit registry** | mpg, litres, g/mi and miles are carried in property names with `unit: null` | Add fuel-economy/volume/emissions dimensions when a second source needs conversion | platform |
