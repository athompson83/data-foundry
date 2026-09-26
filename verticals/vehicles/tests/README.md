# Tests — `vehicles`

| File | What it proves | Imports |
|---|---|---|
| `vertical-config.test.ts` | vocabulary; DRAFT status; every source fail-closed; no acquisition target; synthetic banners on every fixture and golden; SOURCES.md lists every mapped column as unverified; identifier rules identical to HVAC's (ADR-0003 gate) with equivalence/non-equivalence examples; golden consistency; the six MCP tools; the product plan ladder | `yaml`, `vitest`, Node only |
| `shape-ingest.test.ts` | the committed declarations are refused by the real pipeline; over a **temporary activated copy**, the synthetic fixtures ingest through the real extraction, normalization, resolution and canonical store into exactly the golden entities, aliases, facts (with table-cell evidence) and relationships; identifiers read back through the compiled read-side specification; a re-run is a no-op | platform packages and `tests/support/harness.ts` |

Both run in the root Vitest workspace (`verticals/vehicles` is registered in
`vitest.workspace.ts`):

```bash
npx vitest run verticals/vehicles
```

The shape test proves configuration coherence and platform portability. It
does **not** prove the real EPA/NHTSA files map: the fixtures are synthetic.
