# Normalizers

Declarative normalization rules for this vertical. **No TypeScript lives here.**

A vertical is configuration and data, not a fork of the app (AGENTS.md rule 4).
These files are pure rule declarations that the platform's normalization engine
interprets. If you find yourself wanting to write a function, that is a signal
the platform rule vocabulary is too narrow — extend the platform's generic rule
engine and record the gap, do not add vertical-specific code.

## File layout

The files are named for doc 06's four normalization layers, in the order they
run. **Five of the six are loaded. Layer 1 is not** — see below.

| File | Doc 06 layer | Loaded? | Responsibility |
|---|---|---|---|
| `01-primitive-cleanup.yaml` | Layer 1 — Primitive cleanup | **No** | Unicode, whitespace, casing, punctuation, HTML entity decoding, null/unknown handling |
| `02-typed-values.yaml` | Layer 2 — Typed values | Yes | Numbers, dates, units → SI/canonical base units, booleans. Original value always retained |
| `03-domain-normalization.yaml` | Layer 3 — Domain normalization | Yes | Identifier tokenization, manufacturer aliases, certification identifiers, domain notations |
| `04-ontology-mapping.yaml` | Layer 4 — Ontology mapping | Yes | Source vocabulary → canonical controlled vocabulary. Source wording retained for provenance and search |
| `source-mappings.yaml` | — | Yes | Per-source field paths → canonical properties. The only file that knows how a specific source spells things |
| `fact-selection.yaml` | doc 04 | Yes | Which competing claim becomes the canonical value, and what happens to the losers |

### Layer 1 is declared but not read — do not edit it expecting an effect

`services/ingest-worker/src/config.ts` loads `02`, `03`, `04`,
`source-mappings.yaml` and `fact-selection.yaml`. It does **not** open
`01-primitive-cleanup.yaml`, and no `VerticalConfig` field retains it. Layer 1's
behaviour is hard-coded in `primitiveCleanup()` and `NULL_TOKENS`
(`packages/normalization/src`).

This is not hypothetical: the HVAC vertical's copy has already drifted from the
hard-coded behaviour, in two ways that reach published data.

* It declares `"not specified"` and `"see spec sheet"` as null tokens. Neither
  is in the hard-coded set, so those values are stored as literal strings rather
  than as absence — which can populate a *critical* property with junk and feed
  the indexability gate (rule 8).
* It declares a `strip_control_characters` op, describing exactly the bug it was
  meant to prevent: *"PDF text extraction emits stray form feeds and soft
  hyphens at line breaks; left in place they corrupt model numbers silently."*
  No such step exists. A soft hyphen survives both NFKC and whitespace
  collapsing, and a form feed becomes a space — so a model number broken across
  a PDF line break silently fails to match its clean form. That is a **join
  key**, not a display value.

`pnpm verticals:validate` rejects an unimplemented op in the files it does load;
it cannot help here, because nothing loads this one.

Whether this file becomes load-bearing or is removed is an open decision. It
changes what a published dataset says, and it needs an answer on whether a
vertical's cleanup declaration *replaces* the platform defaults or *extends*
them — the hard-coded set carries six tokens no vertical declared. Until that is
decided, treat this file as documentation of intent, not configuration.

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
