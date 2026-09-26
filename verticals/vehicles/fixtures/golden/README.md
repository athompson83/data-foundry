# Golden records — `vehicles`

> **SYNTHETIC SHAPE FIXTURE — replace with captured artifacts before activation.**
> These files are the expected output over the synthetic fixtures, with the two
> mapped sources activated only inside `tests/shape-ingest.test.ts`. They are
> not EPA or NHTSA data.

| File | Contents |
|---|---|
| `entities.json` | 30 entities (3 makes, 10 model years, 12 configurations, 5 campaigns) with canonical names, slugs and every alias join key |
| `facts.json` | 262 canonical `(entity, property, value)` facts, each with the source(s) whose evidence backs it |
| `relationships.json` | 29 edges: 10 `makes`, 12 `configuration_of`, 7 `recall_affects` |

Entities are addressed by a stable handle rather than a database id:
`make:<slug>`, and `<entity_type>:<normalized primary alias>` for the rest
(`vehicle_model_year:EXAMPLARMOTORSROADSTER2020`). The handle uses the
*normalized* key on purpose: EPA's `PM-3` and NHTSA's `PM3` must both arrive at
`PLACEHOLDERMOTORWORKSPM32022`.

Display names depend on the test-only authority ranks (EPA 85, NHTSA 80):
the higher-ranked source's spelling of a shared alias is displayed, so
`Placeholder Motor Works PM-3 2022` shows EPA's casing, while
`PLACEHOLDER MOTOR WORKS PM-300 2022`, known only to NHTSA, shows NHTSA's.

No claim loses fact selection in this set (see `../README.md`). A golden file
changes only with a reason recorded in `../../CHANGELOG.md`.
