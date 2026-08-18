# Normalizers

Declarative normalization rules for this vertical. **No TypeScript lives here.**

A vertical is configuration and data, not a fork of the app (AGENTS.md rule 4).
These files are pure rule declarations that the platform's normalization engine
interprets. If you find yourself wanting to write a function, that is a signal
the platform rule vocabulary is too narrow — extend the platform's generic rule
engine and record the gap, do not add vertical-specific code.

## File layout

The files map one-to-one onto doc 06's four normalization layers, in the order
they run:

| File | Doc 06 layer | Responsibility |
|---|---|---|
| `01-primitive-cleanup.yaml` | Layer 1 — Primitive cleanup | Unicode, whitespace, casing, punctuation, HTML entity decoding, null/unknown handling |
| `02-typed-values.yaml` | Layer 2 — Typed values | Numbers, dates, units → SI/canonical base units, booleans. Original value always retained |
| `03-domain-normalization.yaml` | Layer 3 — Domain normalization | Identifier tokenization, manufacturer aliases, certification identifiers, domain notations |
| `04-ontology-mapping.yaml` | Layer 4 — Ontology mapping | Source vocabulary → canonical controlled vocabulary. Source wording retained for provenance and search |
| `source-mappings.yaml` | — | Per-source field paths → canonical properties. The only file that knows how a specific source spells things |
| `fact-selection.yaml` | doc 04 | Which competing claim becomes the canonical value, and what happens to the losers |

## The two rules that matter

**Deterministic first.** Doc 06: *"Use AI where ambiguity remains, not where
deterministic logic already works."* Everything expressible as a rule must be a
rule. AGENTS.md rule 7: exact identifiers beat semantic search — never replace
deterministic matching with vector similarity.

**Never destroy the original.** Every rule records the pre-normalization value
as evidence (`fact_evidence.source_value`). Normalization produces a *candidate*
alongside the original; it does not overwrite it.

## Adding a source

Adding a source should touch exactly one file: `source-mappings.yaml`. If it
forces a change to layers 1–4, the new source has introduced genuinely new
domain vocabulary — which is a canonical-model change and belongs in
`CHANGELOG.md` with a `schema_version` bump.
