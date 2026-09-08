# ADR-0003 — Query-time identifier equivalence is compiled from the vertical alias specification

**Status:** Accepted and implemented (configuration parity verified with a synthetic second vertical)
**Date:** 2026-08-14
**Updated:** 2026-09-08
**Relates to:** AGENTS.md rules 4 and 7

## Context

The query layer previously guessed case-folded and separator-stripped forms.
That missed declared prefix rules, Unicode compatibility forms, padding, and
title case, and could incorrectly flatten structural separators. Ingestion
also applied an ASCII profile before its declared resolver operations, so a
vertical could lose a valid identifier before reaching its own rules.

## Decision

`normalizers/03-domain-normalization.yaml` is the identifier specification.
`compileAliasNormalization` compiles its rules and `vertical.yaml` alias type
metadata into the versioned `AliasNormalizationSpec` contract. The same
`AliasNormalizer` in `@data-foundry/normalization` executes that contract during
record normalization, entity resolution, direct identifier lookup, and exact
search. It is filesystem-free and performs no rights or identity decisions.

The edge, web, and MCP runtime compilers include `identifier_normalization` in
their committed artifacts. Every production composition injects it into the
canonical QueryModel, including ordinary surface reads and shared read
snapshots. The compiler bundles only explicitly listed verticals; test fixture
presence does not admit a new source, industry, or publication surface.

Each normalized probe retains its alias type and declared entity types. A key
from one alias rule cannot match a different alias type, and a rule preserving
hyphens cannot silently use a separator-stripped fallback. Direct lookup accepts
an optional source scope; without it, multiple owners remain multiple results,
never an automatic identity merge. `scoped_to` remains identity metadata for
resolution and never grants read authority.

NFKC remains the existing pre-pass. Additional punctuation and invisible-format
cleanup are explicit operations (`normalize_punctuation` and
`strip_format_characters`), so adopting them changes only the vertical that
declares them. Source display spelling remains unchanged. Validators, prefixes,
padding, and operation order are carried unchanged to each read surface.
Unknown operations, malformed arguments, duplicate rules, and mismatched alias
normalization declarations fail configuration validation.

The old spelling helpers remain compatibility utilities for unconfigured
internal callers and old fixtures. Configured runtime identifier reads do not
use their guessed spellings. Slug/name matching remains a separate search tier
and does not confer `EXACT_IDENTIFIER` status.

## Authority and rights

Exact alias reads continue through `current_entity_aliases`. Migration 0023
requires a current curated claim or a current FINALIZED source-record claim in
the current authority epoch. Migration 0025 additionally binds source claims to
immutable ALIAS evidence. Normalization cannot manufacture those claims,
reopen a withdrawn alias, revive a prior epoch, or make a retired source record
current. Existing surface rights and snapshot authorization still run after the
identity probe; a matching key is never distribution permission.

## Verification and onboarding gate

The test-only laboratory declaration in
`packages/query-model/test/fixtures/synthetic-laboratory.yaml` defines different
entity types, fields, filters, a relationship predicate, a prefix operation,
and a structural code that retains separators. Its PGlite test writes aliases
through the ingestion normalizer and reads them through the same compiled
specification. It covers NFKC, whitespace, case, separators, format characters,
source scope, alias-type collisions, withdrawal, denied rights, and authorized
web/API/RapidAPI/MCP reads with and without a shared snapshot. A separate
normalization regression preserves a declared non-ASCII identifier before
resolution and rejects values failing the shared validation rule.

A new industry must add source/golden examples demonstrating its declared
identifier equivalence and non-equivalence, and pass runtime compile checks.
This evidence removes the previous HVAC-only normalization assumption. It does
not authorize real sources, enable a second production vertical, or prove live
provider deployment.

## Compatibility

HVAC's declared alias operations are unchanged; persisted authoritative alias
keys require no migration for this interpreter move. Compiled ingestion plans
now include the alias specification, and intermediate normalized payloads use
that specification rather than generic profiles. This changes processing-plan
identity and must invalidate prior compiled runtime evidence. Future operation
changes still require schema-version/changelog review, golden verification,
and an explicit reprocessing/migration plan for already stored keys.
