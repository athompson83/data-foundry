# ADR-0004 — Every customer-facing surface must serialize through the shared query-model serializer

**Status:** Accepted (requirement recorded); enforcement deferred until the surfaces exist
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

At the time of writing, `apps/api`, `apps/mcp` and `services/export-builder` do
not exist (roadmap Phase 3/4), so this requirement is recorded before the
surfaces that must honour it are built.

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

## Enforcement (deferred)

When the first customer-facing surface lands, add a boundary test asserting that
no module outside `@data-foundry/query-model` constructs a fact wire object
literal — the same shape of dependency-boundary test used elsewhere in the repo,
rather than reviewer discipline.

## Consequences

- Adding a trust signal is a one-place change plus a schema regeneration.
- A surface that bypasses the mapper is detectable mechanically instead of by
  noticing a missing field in production.
