# Tests

Vertical-level tests. These validate **configuration and data**, not platform
behaviour — platform logic is tested in `packages/*/test`.

Per AGENTS.md "Testing requirements", a vertical's tests must preserve:

| Requirement | Where it is checked |
|---|---|
| schema compatibility or explicit migration | `vertical.yaml` `schema_version` vs `CHANGELOG.md` |
| provenance coverage | every golden fact carries evidence |
| source fixture extraction | fixtures parse and contain the declared fields |
| entity-resolution golden tests | fixture identifiers normalize to the expected join keys |
| API/MCP parity | `mcp.yaml` tools reference only declared entity types and properties |
| structured metadata validity | `seo.yaml` structured-data blocks are complete |
| sitemap/indexability consistency | every indexable page class has a quality gate |
| rights gates | every source passes the activation gate; `pnpm verticals:validate` |

## Self-containment

These tests import only `yaml`, `zod` and Node built-ins — never a platform
package that may not be built yet, and never the ingestion pipeline. A vertical's
configuration must be verifiable on its own, before any pipeline exists to
consume it. That is what makes the config the contract rather than a description
of code someone already wrote.

## Running

Vertical test directories are `tests/` (doc 11), while the root Vitest projects
in `vitest.config.ts` glob `test/**/*.test.ts` within each registered project
root. A vertical is therefore not picked up by `pnpm test` until it is added to
`vitest.workspace.ts` — which is platform config, owned by the platform, not by
a vertical.

Until then, run them directly:

```bash
npx vitest run --root verticals/<slug>
```
