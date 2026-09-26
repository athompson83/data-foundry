# Golden records — `vehicles`

> **REAL SAMPLE captured 2026-09-26.** These files are the canonical output of
> the real pipeline over `../epa-vehicles.csv` and `../nhtsa-flat-rcl.csv`,
> which are verbatim rows of the EPA and NHTSA files. The two mapped sources
> are activated only inside `tests/shape-ingest.test.ts`. That test writes
> these files when `VEHICLES_UPDATE_GOLDENS=1`, and otherwise compares a fresh
> run against them.

| File | Contents |
|---|---|
| `entities.json` | 57 entities (7 makes, 11 model years, 28 configurations, 11 campaigns) with canonical names, slugs and every alias join key |
| `facts.json` | 580 canonical `(entity, property, value)` facts, each with the source(s) whose evidence backs it |
| `relationships.json` | 51 edges: 11 `makes`, 28 `configuration_of`, 12 `recall_affects` |

Entities are addressed by a stable handle, not a database id:

- `make:<slug>` for makes;
- `<entity_type>:<normalized primary alias>` for everything else, for example
  `vehicle_model_year:FORDF1502019`.

EPA's `F150` and NHTSA's `F-150` both arrive at `FORDF1502019`.

Display names depend on the test-only authority ranks (EPA 85, NHTSA 80). A
key both agencies share shows EPA's spelling (`Honda Accord 2018`). A key only
NHTSA knows shows NHTSA's (`HONDA ACCORD HYBRID 2018`).

**One contested property.** `recall_campaign:18V629000` has two `component`
values, one from each of its two rows. The fact model holds a scalar
(QUALITY.md). A golden file changes only with a reason recorded in
`../../CHANGELOG.md`.
