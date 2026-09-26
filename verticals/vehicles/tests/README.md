# Tests — `vehicles`

| File | What it proves | Imports |
|---|---|---|
| `vertical-config.test.ts` | vocabulary; DRAFT status; every source fail-closed; no acquisition target; REAL SAMPLE banners (URL + archive SHA-256, cross-checked against the evidence manifests) on every fixture and golden; SOURCES.md records every mapped column; identifier rules identical to HVAC's (ADR-0003 gate) with equivalence/non-equivalence examples; golden consistency; the six MCP tools; the product plan ladder | `yaml`, `vitest`, Node only |
| `shape-ingest.test.ts` | the committed declarations are refused by the real pipeline; over a **temporary activated copy**, the real-sample fixtures ingest through the real extraction, normalization, resolution and canonical store into exactly the golden entities, aliases, facts (with table-cell evidence) and relationships; identifiers read back through the compiled read-side specification; a re-run is a no-op | platform packages and `tests/support/harness.ts` |

Both run in the root Vitest workspace (`verticals/vehicles` is registered in
`vitest.workspace.ts`):

```bash
npx vitest run verticals/vehicles
```

The fixtures are verbatim rows of the captured files, so the shape test proves
the mappings read real rows. Full-file behavior (0 extraction issues on every
row, join rate) is measured separately and recorded in SOURCES.md and
QUALITY.md. Regenerate the goldens after an intended change with
`VEHICLES_UPDATE_GOLDENS=1 npx vitest run verticals/vehicles/tests/shape-ingest.test.ts`
and review the diff.
