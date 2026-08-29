# ADR-0004 — Every customer-facing surface must serialize through the shared query-model serializer

**Status:** Accepted and enforced
**Date:** 2026-08-14
**Relates to:** AGENTS.md rule 5 ("One source of truth"), ADR-0002 (editorial override)

## Context

`editorially_corrected` reached the selection layer and `explainFact` but not
`CanonicalFactView`, so a corrected value was served to customers
indistinguishable from an evidence-selected one. That was fixed by projecting
the correction state onto the canonical view.

The projection alone is not sufficient. Rule 5 says web, REST, MCP and exports
must read from the same canonical query layer — but that is only true in
practice if they also *serialize* it the same way. An interface field that three
hand-written serializers each forget is not one source of truth; it is four.

The requirement was recorded before the customer surfaces existed. They now do:
`apps/api`, `apps/mcp`, `apps/web`, and `services/export-builder` all consume the
canonical query model, and their boundary/projection tests make this decision
executable rather than aspirational.

## Decision

> Every REST, MCP, search-index and bulk-export handler MUST produce its wire
> objects through the shared serializer in `@data-foundry/query-model`
> (`toRestFact` / `toMcpFact` / `toExportRow`, built on `correctionFields`).
> No surface may construct a fact wire object independently.

Corollaries:

- New trust fields are added to `CanonicalFactView` and the shared mapper, once.
  A surface that opts out of the mapper is the defect, not the missing field.
- OpenAPI and MCP output schemas derive from
  `CORRECTION_FIELDS_JSON_SCHEMA` so the documented contract cannot drift from
  the emitted payload.
- `selectionWarnings` is an OPEN string array on the wire. Consumers must ignore
  codes they do not recognise rather than failing; a schema enumerating today's
  codes would make tomorrow's payloads fail validation at an older client.
- Any cache or search-index document built from `CanonicalFactView` counts as a
  surface and is bound by the same rule.

## Enforcement

The evidence is split by the property each test actually checks:

- `apps/api/test/boundary.test.ts` scans the REST source tree. It requires
  `toRestFact` to be used from `wire.ts`, rejects a second REST fact-wire shape
  elsewhere in that app, and checks that the wrapper adds only the reviewer
  privacy guard rather than another projection.
- `apps/mcp/test/query-layer-boundary.test.ts` is a query-layer boundary test,
  not a private-serializer test. It requires MCP source to import the canonical
  query layer through its single seam and rejects store, driver, SQL, and
  selection/ranking implementations in the interface.
- `packages/query-model/test/editorial-projection.test.ts` exercises the shared
  `toRestFact`, `toMcpFact`, and `toExportRow` projections. It verifies that the
  correction fields and warnings survive each projection, reviewer identity is
  excluded, and the shared correction-schema fragment has the required shape.
- `services/export-builder/test/boundary.test.ts` compares emitted export rows
  with `toExportRow` field for field, checks that no projected fields are
  dropped, and rejects another export projection elsewhere in that service.
- `tests/contract/surface-parity.test.ts` is behavioral contract evidence: with
  the same query state and instant, REST and MCP must publish the same facts,
  values, trust fields, rights withholding, and reviewer-identity exclusion.
  It does not cover export rows.

`apps/web/test/boundary.test.ts` separately requires page-rendering code outside
the composition root to stay at or above the canonical query layer. Search-index
publication separately requires `SEARCH_INDEX` permission. Neither check is
described here as a private-serializer assertion.

## Consequences

- Adding a trust signal is a one-place change plus a schema regeneration.
- A surface that bypasses the mapper is detectable mechanically instead of by
  noticing a missing field in production.
