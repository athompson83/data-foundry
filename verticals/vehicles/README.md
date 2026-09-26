# `vehicles` — US Vehicle Recalls & Fuel Economy

The second Data Foundry vertical: US federal vehicle data — NHTSA safety
recalls joined to EPA/DOE fuel economy on one deterministic model-year key.
Headline product: **VIN → open recalls, with the decoded vehicle and its fuel
economy** (docs/commercial-validation/conversion-first-decision-20260926.md).
Make/model/year lookups come first, because VIN decoding needs NHTSA vPIC,
which is declared but not yet captured or mapped.

## Status — read this first

| | State |
|---|---|
| Vertical | `DRAFT` |
| Sources | 3 declared, all `UNDER_REVIEW` / `UNREVIEWED` / unapproved; 2 mapped |
| Rights | No ADR-0013 determination captured. Expected basis `PUBLIC_DOMAIN_US_GOVERNMENT_WORK` ([RIGHTS.md](RIGHTS.md)) |
| Fixtures | **SYNTHETIC SHAPE FIXTURES** with fictional makes ([fixtures/README.md](fixtures/README.md)) |
| Column names | **UNVERIFIED** — every mapped column is listed in [SOURCES.md](SOURCES.md#unverified-source-assumptions) |
| Acquisition | none scheduled (`acquisition.yaml` targets empty) |
| Bundles | edge, web and MCP runtimes compiled (bundling is not publication); not in the acquisition or ingestion-worker bundles |
| Offer | `product.yaml` prelaunch: Evaluate $0/100, Starter $9/1,000, Developer $49/5,000, Growth $149/25,000, Scale $299/75,000 |

## Model

```text
make ──makes──▶ vehicle_model_year ◀──configuration_of── vehicle_configuration (EPA)
                        ▲
                        └──recall_affects── recall_campaign (NHTSA)
```

- `vehicle_model_year` is keyed by the composite `make_model_year` alias
  (make + model + year, folded and separator-stripped).
- `vehicle_configuration` is keyed by EPA's `id`; `recall_campaign` by NHTSA's
  campaign number.

## Platform capabilities this vertical added (generic, not vehicle code)

All in `services/ingest-worker/src/compile.ts`, `packages/extraction` and
`services/ingest-worker/src/resolution.ts`, available to every vertical:

1. **Composite source values** — a CSV mapping may read `paths: [a, b, c]`
   (extraction selector `csv_columns`, all-or-nothing, one locator citing
   every cell). Relationship `*_from` accepts the same list.
2. **Composite record keys** — `source_record_key: [a, b]`, because keys are
   unique across all streams of one source.
3. **Headerless delimited files** — `parsing.columns`.
4. **Publisher entity type from configuration** — the entity type
   `publisher_aliases` resolves to (HVAC `manufacturer`, here `make`) is read
   from the source mappings instead of being hard-coded.
5. **Declarative display names** — `canonical_name.pattern` in an entity file,
   so a composite key already containing the make is not prefixed twice.

## Verifying

```bash
pnpm verticals:validate
npx vitest run verticals/vehicles
```

`tests/vertical-config.test.ts` checks configuration, fail-closed sources,
fixture banners and that SOURCES.md lists every mapped column.
`tests/shape-ingest.test.ts` runs the real pipeline over the fixtures and
compares the output with `fixtures/golden/`.

## Before activation

See the ordered list in [RIGHTS.md](RIGHTS.md) and the gaps in
[QUALITY.md](QUALITY.md): capture artifacts and terms (`UA-009`), verify every
column, write and record the determinations, add a row filter for non-vehicle
recalls, design the bulk load and refresh, then map vPIC for the VIN lookup.
