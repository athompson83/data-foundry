# Tests — `hvac`

Vertical-level tests. These validate **configuration and data**, not platform
behaviour — platform logic is tested in `packages/*/test`.

| File | Covers |
|---|---|
| `vertical-config.test.ts` | The shared vocabulary, entity/relationship/source declarations, rights metadata and the activation gate, filter and SEO policy, MCP tool shape, normalizer rule structure, fixture presence |
| `golden-data.test.ts` | Golden entities, facts and relationships: join-key normalization, evidence coverage, both conflicts, unit consistency, graph integrity, supersession traversal, and the indexability gate arithmetic |

## Self-containment

Both files import only `yaml`, `vitest` and Node built-ins — never a platform
package that may not be built yet, and never the ingestion pipeline.

A vertical's configuration must be verifiable **on its own**, before any pipeline
exists to consume it. That is what makes the config the contract rather than a
description of code someone already wrote. It also means these tests keep working
while three sibling waves are mid-flight.

The Layer 3 `model_number` normalization rule is deliberately **re-implemented**
in `golden-data.test.ts` rather than imported. The test asserts that the golden
join keys are what the *declared rule* produces; if the rule and the golden data
ever drift apart, that is exactly the failure worth catching.

## AGENTS.md testing requirements

| Requirement | Where |
|---|---|
| schema compatibility | `vertical.yaml` vocabulary assertions |
| provenance coverage | every golden fact carries evidence (171/171) |
| source fixture extraction | fixture parse and record-count tests |
| entity-resolution golden tests | join keys, UPC checksums, negative judgments |
| API/MCP parity | MCP tools reference only declared properties |
| structured metadata validity | every page class has a quality gate |
| sitemap/indexability consistency | `include_only_indexable`, gate arithmetic |
| rights gates | activation gate re-run per ACTIVE source |

## Running

```bash
npx vitest run --root verticals/hvac
```

Vertical test directories are `tests/` (doc 11), while the root Vitest projects
in `vitest.config.ts` glob `test/**/*.test.ts` within each registered project
root. These tests therefore do **not** run under `pnpm test` until
`verticals/hvac` is added to `vitest.workspace.ts` — which is platform
configuration, owned by the platform rather than by a vertical.

`pnpm verticals:validate` runs independently of Vitest and does gate CI today.
