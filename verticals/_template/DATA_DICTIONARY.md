# Data Dictionary — `template`

> Replace this file. Every property declared in `entities/*.yaml` must appear
> here with its **type, unit and source coverage**. A property that is not
> documented here is not shippable: the API schema, the filter UI and the MCP
> tool descriptions are all generated from this vocabulary, and a consumer
> cannot use a field whose unit is a guess.

## Entity types

| Entity type | Description | Canonical URL |
|---|---|---|
| `example_entity` | REPLACE_ME | `/data/template/examples/{slug}` |

## Alias types

Alias types are the deterministic resolution index (AGENTS.md rule 7).
"Strong" means an exact match on the normalized value asserts identity on its
own.

| Alias type | Strong? | Normalization | Example source form | Normalized form |
|---|---|---|---|---|
| REPLACE_ME | | | | |

## Properties — `example_entity`

Coverage is the fraction of entities of this type for which the source supplies
the property. Measure it from the fixtures; do not estimate it.

| Property | Type | Unit | Critical | Description | Source coverage |
|---|---|---|---|---|---|
| `example_identifier` | string | — | yes | REPLACE_ME | REPLACE_ME |
| `example_quantity` | quantity | REPLACE_ME | no | REPLACE_ME | REPLACE_ME |

### Coverage matrix

Which source supplies which property. Empty cells are the interesting ones —
they are why more than one source exists.

| Property | source-a | source-b |
|---|---|---|
| `example_identifier` | ✅ | ✅ |
| `example_quantity` | ✅ | — |

## Relationships

| Predicate | Subject → Object | Cardinality | Transitive | Description |
|---|---|---|---|---|
| REPLACE_ME | | | | |

## Derived properties

Properties the platform computes rather than reads. Each carries evidence
pointing at the property it was derived from plus the rule id.

| Property | Derived from | Rule | Precision |
|---|---|---|---|
| REPLACE_ME | | | |

## Value types

The platform's `FACT_VALUE_TYPES`, for reference:

`string` · `number` · `integer` · `boolean` · `date` · `datetime` · `enum` ·
`url` · `quantity` · `array` · `object`

`quantity` requires a `unit`. Everything else must have `unit: null`.
