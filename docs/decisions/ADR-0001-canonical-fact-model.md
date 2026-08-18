# ADR-0001 — Canonical fact model: append-versioned facts with evidence, and five separate confidence scores

- **Status:** Accepted
- **Date:** 2026-08-14
- **Scope:** `packages/canonical-schema`, `db/migrations/0004_facts.sql`, everything downstream of them
- **Supersedes:** —
- **Extended by:** [ADR-0002](./ADR-0002-editorial-override.md) — the editorial override becomes the first selection criterion and wins outright, subject to an audit contract. It does not change anything here: the canonical value stays computed, corrections stay evidence-backed claims, and overridden claims stay retained.

## Context

The platform turns claims made by many sources into a canonical answer. Two questions
determine the shape of every table, query and API response that follows:

1. What happens when a source changes its mind, or two sources disagree?
2. How confident are we, and confident about *what* exactly?

Both are easy to answer badly in a way that cannot be undone later. A fact table
that overwrites is not retrofittable into a versioned one — the history was never
written. A single `confidence` column cannot be split into five after the fact —
the component measurements were never kept.

Doc 04 states the requirements: "Do not overwrite conflicting facts prematurely",
"Every fact/relationship change should be reconstructable over time", "Use separate
scores". This ADR records *why*, so that a future change proposing to simplify
either decision has to argue against the reasoning rather than rediscover it.

## Decision 1 — Facts are append-versioned, with evidence, never overwritten

A `facts` row is an immutable claim about `(entity_id, property)` over a validity
interval. A new value is a **new row**:

- the previous version is closed by setting `valid_to` to the instant the new
  version opens (half-open interval `[valid_from, valid_to)`) and its status
  becomes `SUPERSEDED`;
- the new row's `supersedes_fact_id` points at the version it replaced;
- `normalized_value` is never updated. Ever.

Two independent time axes are stored: `valid_from`/`valid_to` (when the claim is
true of the world) and `recorded_at` (when the platform learned it).

Every fact must be backed by rows in `fact_evidence`, a genuine many-to-many join
to `(artifact, source_record, locator)`. Relationships get the identical treatment
via `relationship_evidence`.

Enforcement is not left to convention:

- a partial unique index (`facts_single_open_version_key`) permits at most one
  open `ACTIVE` version per `(entity_id, property)`, so a concurrent writer that
  tries to "update" a fact by inserting a parallel open row fails loudly instead
  of creating two current truths;
- `fact_evidence.artifact_id` is `ON DELETE RESTRICT`, so evidence cannot be
  garbage-collected out from under a published claim;
- `assertNonDestructiveFactUpdate()` rejects any UPDATE patch touching an
  immutable column, at the application write boundary.

### Why not overwrite

- **AGENTS.md rule 2 is unenforceable without it.** "No published fact without
  evidence" means a published value must be traceable to an artifact. Overwriting
  destroys the link between the value that is live now and the artifact that
  justified it.
- **"What did you say last March?" is a real question.** It is asked by
  customers auditing a dataset snapshot, by a manufacturer disputing a spec, and
  by us when a extractor regression ships. A dataset snapshot pins a version
  identifier; without fact history, an old snapshot cannot be explained, only
  re-downloaded.
- **Corrections must not rewrite history** (doc 13). A correction that overwrites
  is indistinguishable from the original having always been right, which is
  precisely the failure mode a corrections process exists to avoid.
- **Reprocessing needs a before state.** Rule 10 preserves raw evidence so
  canonical facts can be recomputed. Recomputation is only verifiable if the
  prior computed value still exists to diff against.
- **Disagreement is normal, not exceptional.** Doc 04's fact-selection rules
  (authority, field-level reliability, recency, corroboration, and — as
  criterion 0 per ADR-0002 — editorial override) all operate over *a set of
  competing claims*. Collapsing to one row
  per property at write time deletes the input to the selection the product is
  supposed to make. "Latest source wins" is explicitly rejected — but it is the
  only policy an overwriting table can implement.

### Costs accepted

- `facts` grows monotonically. Mitigated by indexing on
  `(entity_id, property)` and by the partial index that makes "current value"
  lookups a single-row hit rather than a scan-and-sort.
- Every read path must filter on validity. Mitigated by
  `currentFactVersion()` / `currentFactsByProperty()` in `canonical-schema`, so
  no consumer hand-rolls the interval logic.
- Writers must perform two statements (close, then insert). Mitigated by
  `appendFactVersion()`, which returns exactly those two writes and refuses
  drafts that would corrupt the timeline (backdating, cross-entity, cross-property,
  overlapping an already-closed version).

### Rejected alternatives

- **Overwrite in place with an audit trigger.** The audit table becomes a
  second, weaker fact model with no evidence links and no validity semantics.
  Queries against history would not agree with queries against the live table.
- **Event-sourcing everything.** Correct, and far heavier than a small team
  needs. Bitemporal rows in Postgres give reconstructability without a projection
  layer to keep in sync.
- **Soft-delete flag only.** Records that a value stopped being current but not
  *when* it was current, which does not support "as of" queries or snapshot
  explanation.

## Decision 2 — Five separate confidence scores, branded, never collapsed

`extraction_confidence`, `identity_confidence`, `fact_confidence`,
`relationship_confidence` and `entity_quality_score` are five distinct branded
types in `packages/canonical-schema/src/confidence.ts`. They live on different
tables, are produced by different stages, and cannot be assigned to one another
without an explicit `rawScore()` unwrap.

| score | produced by | answers |
|---|---|---|
| `extraction_confidence` | extraction | did we read this value off the artifact correctly? |
| `identity_confidence` | entity resolution | are these two records the same real-world thing? |
| `fact_confidence` | validation | is this claim about this entity true? |
| `relationship_confidence` | validation | does this edge between two entities hold? |
| `entity_quality_score` | quality worker | how complete/corroborated/fresh is this entity overall? |

### Why they must stay separate

- **They are not commensurable.** A value extracted perfectly (0.99) from a page
  attached to the wrong entity (identity 0.4) is not a "0.7 confident fact". It is
  a certainly-read value about a probably-wrong thing. Any arithmetic that
  produces one number from those two produces a number that means nothing.
- **They fail for different reasons and have different fixes.** Low extraction
  confidence means fix the parser. Low identity confidence means fix matching or
  send it to human review. Low fact confidence means seek corroboration. A single
  number tells an operator that something is wrong but not which team owns it.
- **The "Verified" badge is policy, not a threshold.** Doc 04 requires the
  user-facing badge to be earned by policy criteria — authoritative source,
  corroboration, recency, no unresolved dispute — not by an LLM emitting a high
  number. Keeping the inputs separate is what makes such a policy expressible.
  With one score, "verified" inevitably degrades into `confidence > 0.9`.
- **Collapsing is irreversible; separating is not.** A product surface can
  always compute a summary from five scores. Five scores cannot be recovered from
  their average.
- **AGENTS.md rule 3.** Merges must be auditable and reversible. An audit needs
  to see the identity score the merge was based on, independent of how well the
  underlying values were extracted.

### Why *branded* types rather than five plain numbers

The pipeline threads all five through similarly-shaped functions. Nominal typing
turns "we passed extraction confidence into the fact confidence column" from a
data-quality incident discovered months later into a compile error. `rawScore()`
exists as the single, deliberately conspicuous escape hatch — reaching for it is
the moment to check whether two different measurements are about to be mixed.

The database mirrors this: each score is a separate column on the table that owns
it, constrained to `[0, 1]`, with a comment naming which score it is.

`authority_rank` is deliberately **not** on the unit interval (it is an integer
0–100 on `sources`) so it cannot be mistaken for, or arithmetically blended with,
a confidence score.

## Consequences

- Query-model and API surfaces must expose "as of" semantics for facts, and must
  never present a fact without a path to its evidence.
- Any future normalization/extraction package writes `extraction_confidence`
  only; entity-resolution writes `identity_confidence` only. Cross-writing is a
  type error.
- A migration that adds `ON CONFLICT ... DO UPDATE SET normalized_value = ...` to
  `facts` violates this ADR and should be rejected in review.
- Dataset snapshots remain explainable: a snapshot version plus the fact history
  is sufficient to reconstruct exactly what was published and why.
