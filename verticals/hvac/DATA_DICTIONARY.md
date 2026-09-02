# Data Dictionary — `hvac`

Every property, its type, its unit, and its **measured** source coverage.
Coverage figures are computed from `fixtures/golden/facts.json` across the 13
equipment models in the fixture set — measured, not estimated.

`schema_version: 0.1.0`

## Entity types

| Entity type | Description | Canonical URL | Count in fixtures |
|---|---|---|---:|
| `manufacturer` | Company that builds equipment; the identity scope for model numbers and SKUs | `/data/hvac/manufacturers/{slug}` | 3 |
| `equipment_model` | A specific manufactured model, identified by outdoor-unit model number | `/data/hvac/equipment/{slug}` | 13 |
| `certification` | A certified ratings record with its own lifecycle and validity window | `/data/hvac/certifications/{slug}` | 11 |

## Alias types

The deterministic resolution index (AGENTS.md rule 7). **Strong** means an exact
match on the normalized value asserts identity on its own.

| Alias type | Strong | Normalization | Example source form | Normalized |
|---|:---:|---|---|---|
| `model_number` | ✅ | uppercase, strip `- _ . / \` | `24acc6-36a003` | `24ACC636A003` |
| `ahri_ref` | ✅ | strip `AHRI` prefix, digits only | `AHRI 20134501` | `20134501` |
| `manufacturer_sku` | ✅ (scoped to manufacturer) | uppercase, collapse whitespace, **hyphens retained** | `ACS-24ACC636A003` | `ACS-24ACC636A003` |
| `upc` | ✅ | digits only, left-pad to 12, mod-10 checksum | `083456120010` | `083456120010` |
| `series_name` | ❌ | collapse whitespace, title case | `Comfort 16` | `Comfort 16` |

Two deliberate asymmetries:

- **Hyphens are stripped from `model_number` but retained in
  `manufacturer_sku`.** A model number's punctuation is arbitrary formatting; a
  SKU's prefix (`ACS-`) is structured meaning.
- **`series_name` is weak.** Six models share `Comfort 16`; matching on it would
  merge a product line into one entity.

`manufacturer` identity uses the platform's `CORE_ALIAS_TYPES` (`legal_name`,
`name`, `abbreviation`, `dba`, `former_name`) — manufacturers are named, not
part-numbered.

## Properties — `equipment_model`

`value_type: number` with a populated `unit` follows doc 04's own filter metadata
example (`field: voltage / value_type: number / unit: V`).

| Property | Type | Unit | Critical | Coverage | Description |
|---|---|---|:---:|---:|---|
| `product_type` | string (enum) | — | ✅ | **100%** (13/13) | Controlled category: `air_conditioner`, `heat_pump`, `gas_furnace`, `air_handler`, `packaged_unit` |
| `cooling_capacity_btu` | number | `BTU/h` | ✅ | **100%** (13/13) | Nominal cooling capacity. Direct from manufacturer feed and certification export; derived from tonnage elsewhere |
| `nominal_tonnage` | number | `ton` | ✅ | **100%** (13/13) | Capacity in refrigeration tons. Direct on 6 models, derived on 7 |
| `seer2` | number | — | ✅ | **100%** (13/13) | Seasonal Energy Efficiency Ratio 2. Dimensionless. The most contested property in the vertical |
| `eer2` | number | — | ❌ | **100%** (13/13) | Energy Efficiency Ratio 2 at rated conditions. Dimensionless |
| `hspf2` | number | — | ❌ | **23%** (3/13) | Heating Seasonal Performance Factor 2. **100% of the 3 heat pumps** — absence on air conditioners is correct absence, not a gap |
| `refrigerant` | string (enum) | — | ✅ | **100%** (13/13) | ASHRAE hyphenated designation: `R-410A`, `R-454B`, `R-32`, `R-22` |
| `voltage` | number | `V` | ✅ | **46%** (6/13) | Nominal supply voltage, lower bound of a dual rating. **The binding coverage gap** |
| `phase` | number | — | ❌ | **46%** (6/13) | Supply phase count (1 or 3) |
| `stage_count` | number | — | ❌ | **46%** (6/13) | Compressor capacity stages |
| `sound_level_db` | number | `dB` | ❌ | **46%** (6/13) | Rated sound level. A standing source of conflict |
| `weight_lb` | number | `lb` | ❌ | **46%** (6/13) | Net operating weight of the outdoor unit |

**Critical properties: 6** — `product_type`, `cooling_capacity_btu`,
`nominal_tonnage`, `seer2`, `refrigerant`, `voltage`. These drive the
indexability quality gate in `seo.yaml`.

### The coverage gap that matters

`voltage` sits at 46% and is critical, so it alone decides indexability for most
of the catalogue. Only the manufacturer source family publishes electrical data,
and the fixture set holds a manufacturer feed for **Acme only**. Consequence,
measured: **7 of 13 models clear the `entity_detail` gate, 6 do not**, and every
failure is the same missing property.

This is the gate doing its job. The fix is not a lower threshold — it is a
manufacturer source for Northwind and Borealis.

## Properties — `certification`

> **These descriptions are true of the fixture set, whose certification source is
> a synthetic certification body. They are not automatically true of real data.**
>
> No lawful source currently available to this vertical is a
> `CERTIFICATION_BODY`: the only registered one is a fixture, and the sole real
> US HVAC certification directory is prohibited in `packages/source-registry`.
> The lawful sources are `REGULATORY_FILING` — a regulator hosts the register,
> the **manufacturer** asserted the value. DOE says so itself, verbatim: *"The
> appearance of a model on this web site is not an indication that DOE has
> determined that the model is compliant with DOE energy conservation
> standards."*
>
> A value selected from a `REGULATORY_FILING` source must never be described as
> **certified**, **verified**, **approved**, **independently tested** or
> **determined**, on any surface. The accurate phrasing is *"manufacturer-reported,
> as filed with <agency>"*. A government host is not a claim.


| Property | Type | Unit | Critical | Coverage | Description |
|---|---|---|:---:|---:|---|
| `product_type` | string (enum) | — | ✅ | 100% (11/11) | Category as classified by the certifying body |
| `cooling_capacity_btu` | number | `BTU/h` | ✅ | 100% (11/11) | Certified cooling capacity |
| `seer2` | number | — | ✅ | 100% (11/11) | Certified SEER2 — authoritative for the linked model |
| `eer2` | number | — | ❌ | 100% (11/11) | Certified EER2 |
| `hspf2` | number | — | ❌ | 27% (3/11) | Certified HSPF2. 100% of certified heat pumps |
| `refrigerant` | string (enum) | — | ❌ | 100% (11/11) | Refrigerant as recorded on the certification |

## Properties — `manufacturer`

| Property | Type | Unit | Critical | Coverage | Description |
|---|---|---|:---:|---:|---|
| `product_type` | string (enum) | — | ❌ | derived | Categories observed in the manufacturer's catalogue. Derived from `manufactures` edges, never asserted by a source, so it cannot drift out of agreement with the catalogue |

## Source coverage matrix

Which source supplies which property. **The empty cells are the point** — they
are why more than one source exists.

| Property | acme-hvac-catalog | coolsupply-distributor | ahri-directory-export | acme-spec-sheets |
|---|:---:|:---:|:---:|:---:|
| `product_type` | ✅ | ✅ | ✅ | ✅ |
| `cooling_capacity_btu` | ✅ BTU/h | — (derived from tons) | ✅ BTU/h | ✅ BTU/h |
| `nominal_tonnage` | — (derived) | ✅ tons | — (derived) | ✅ tons |
| `seer2` | ✅ marketing | ✅ re-keyed | ✅ **certified** | — |
| `eer2` | ✅ | — | ✅ | — |
| `hspf2` | ✅ | — | ✅ | — |
| `refrigerant` | ✅ | ✅ | ✅ | ✅ |
| `voltage` | ✅ | — | — | ✅ |
| `phase` | ✅ | — | — | ✅ |
| `stage_count` | ✅ | — | — | ✅ |
| `sound_level_db` | — | ✅ unreliable | — | ✅ **primary** |
| `weight_lb` | ✅ | — | — | ✅ |
| `model_number` | ✅ | ✅ | ✅ | ✅ |
| `manufacturer_sku` | ✅ | — | — | — |
| `upc` | — | ✅ **only source** | — | — |
| `ahri_ref` | — | — | ✅ **only source** | — |
| `series_name` | ✅ | — | — | ✅ |
| supersession | ✅ **only source** | — | — | — |
| Models covered | 6 | 5 | 11 | 3 |

Four "only source" cells — supersession, `upc`, `ahri_ref`, and the certified
SEER2 — are the entire argument for maintaining four dissimilar sources instead
of one good one.

## Relationships

| Predicate | Subject → Object | Cardinality | Transitive | Symmetric | Inferred? | Edges |
|---|---|---|:---:|:---:|:---:|---:|
| `manufactures` | manufacturer → equipment_model | one-to-many | ❌ | ❌ | ❌ | 13 |
| `supersedes` | equipment_model → equipment_model | one-to-many | ✅ | ❌ | **never** | 2 |
| `certified_by` | equipment_model → certification | one-to-many | ❌ | ❌ | ❌ | 11 |
| `compatible_with` | equipment_model → equipment_model | many-to-many | ❌ forbidden | ✅ | **never** | 0 |

`compatible_with` has zero edges, and that is an assertion rather than an
omission: no source declares compatibility, inference is forbidden, and
transitive closure is explicitly forbidden. A pipeline that produces such an edge
from these fixtures has fabricated a safety- and warranty-relevant claim.

## Derived properties

| Property | Derived from | Rule | Precision | Applied |
|---|---|---|---|---|
| `nominal_tonnage` | `cooling_capacity_btu` | ÷ 12000 | exact by definition, rounded to 2dp | 7 of 13 models |
| `cooling_capacity_btu` | `nominal_tonnage` | × 12000 | exact by definition, rounded to 0dp | where only tonnage published |
| `voltage`, `phase` | `electrical` notation | regex split of `208/230-1-60` | exact | 6 models |

A derived value never displaces a directly published one (`only_if_absent`), and
carries evidence pointing at the property it came from plus the rule id.

## Units

| Unit | Canonical symbol | Accepted source spellings |
|---|---|---|
| Cooling capacity | `BTU/h` | `BTUh`, `btu/h`, `btu/hr`, `BTU/hr` |
| Tonnage | `ton` | `Ton`, `Tons`, `tonnage`, `TR` |
| Voltage | `V` | `volt`, `volts`, `VAC` |
| Sound | `dB` | `db`, `dBA`, `dB(A)` |
| Weight | `lb` | `lbs`, `pound`, `pounds` |

`12000 BTU/h = 1 ton`, exact by definition. Implementations must divide by 12000
rather than multiply by a decimal reciprocal — an inexact factor makes the
`capacity_tonnage_consistency` check fail on correct data.

## Value types

Platform `FACT_VALUE_TYPES`: `string` · `number` · `integer` · `boolean` ·
`date` · `datetime` · `enum` · `url` · `quantity` · `array` · `object`

This vertical uses `string` and `number` only. Enumerated properties
(`product_type`, `refrigerant`) are typed `string` with an `enum` constraint in
`entities/*.yaml` rather than `value_type: enum`, so the canonical value is the
term itself rather than an index into a list that may be reordered.
