# ADR-0003 — Query-time identifier equivalence must be compiled from the vertical's alias specification

**Status:** Accepted (requirement recorded); implementation deferred
**Date:** 2026-08-14
**Relates to:** AGENTS.md rule 7 ("Exact identifiers beat semantic search"), rule 4 ("No vertical-specific forks of the app")

## Context

An adversarial audit found that the query layer could not find identifiers the
ingest pipeline had just stored.

The write path normalizes an alias through the vertical's **declared** op chain
(`verticals/hvac/normalizers/03-domain-normalization.yaml`: upper-case, then
strip separators), producing `24ACC636A003`. Both read paths instead *guessed*
at a set of plausible spellings:

- `identifierCandidates` generated a separator-stripped form only in LOWER case,
  so it could never equal an upper-cased stored value.
- `lookupByIdentifier` used its own weaker set — `{raw, lower, upper}`, no
  separator stripping at all — so one package held **two disagreeing definitions
  of "exact"**.

Consequences observed: `24acc6-36a003` and `24ACC6 36A003` — spellings the
vertical's own YAML documents as the same identifier, and which two of its four
sources publish — both missed. In `search()`, an unrelated aftermarket listing
literally *named* `24acc6-36a003` was served at rank 1 flagged `exact: true`
while the entity that actually owned the model number was demoted to the fuzzy
tier.

The existing 887-test suite did not catch this because `test/support.ts` seeded
`normalized_value` in lower case. The fixtures agreed with the bug.

## Decision (implemented)

The immediate repair generates the separator-stripped form in **both** case
conventions and makes `lookupByIdentifier` delegate to `identifierCandidates`,
so the query layer has exactly one definition of "exact".

This is correct for HVAC and vertical-agnostic in the sense that it covers
either case convention. It is **not** a general solution: it hard-codes the
platform's assumption that identifier equivalence is *case-fold + strip
separators*.

## Decision (deferred — required before the second vertical)

> Query-time identifier equivalence must eventually be **compiled from the same
> vertical-declared alias normalization specification used at ingestion**, not
> re-derived by the query layer.

A vertical whose op chain does something else — title case, checksum stripping,
prefix normalization, locale-specific folding — will silently miss under the
current implementation. Silently: the query returns zero rows rather than
erroring, which is the worst failure mode for rule 7.

### Required future contract test

Normalize representative source identifiers through the **write** path, generate
candidates through the **read** path, and prove that every stored normalized
value is discoverable. Cover at minimum:

- case folding
- separator removal
- whitespace handling
- Unicode normalization (NFKC; soft hyphens and zero-width characters, which PDF
  text extraction genuinely produces — see `normalization/src/text.ts`)
- at least one vertical-specific operation

The test must derive both sides from the vertical config so that changing the
config cannot desynchronize them.

## Gate

This is a **launch gate before introducing any vertical whose identifier rules
differ from HVAC's**. It is explicitly not a blocker for the HVAC vertical,
whose op chain the current implementation covers.

## Consequences

- The platform keeps a documented, testable assumption rather than an implicit one.
- `collapseIdentifierUpper` and the both-conventions candidate set are interim
  scaffolding, expected to be deleted when the compiled normalizer lands.
- Until then, adding a vertical is not purely a configuration change for
  identifier lookup — which is a known, recorded deviation from rule 4.
