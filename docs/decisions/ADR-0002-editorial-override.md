# ADR-0002 — The editorial override wins outright, but only when it is auditable

- **Status:** Accepted
- **Date:** 2026-08-14
- **Scope:** `packages/canonical-store/src/fact-selection.ts`, `packages/provenance/src/explain.ts`, `services/ingest-worker/src/fact-policy.ts`, `verticals/*/normalizers/fact-selection.yaml`
- **Amends:** doc 04 "Fact selection / canonical view", criterion 6
- **Relates to:** [ADR-0001](./ADR-0001-canonical-fact-model.md) (append-versioned facts with evidence)

## Context

Doc 04 lists six selection criteria in priority order and ends with "explicit
editorial override". Implemented literally — and it was — the override sat sixth
in the cascade, behind direct authority, field reliability, recency,
corroboration and the deterministic consistency checks. Each rung only runs when
the rung above it failed to reduce the pool to one claim, so criterion 6 could
only fire when criteria 1–5 had **tied**.

That is precisely the case in which nothing needs overriding. A tie means the
platform has no opinion; whichever value an editor endorses would already have
been an acceptable answer. The situation an override exists for is the opposite
one: an authoritative source publishes a value that is *wrong*, we know it is
wrong, and the cascade decides it on criterion 1 before an editor is ever
consulted. So the feature named "editorial override" could not override
anything. It was a tiebreaker wearing a stronger word.

Three ways to fix it were available:

1. Leave it sixth and tell editors to fix the data upstream. Correct in
   principle, useless in practice: we do not control what a manufacturer
   publishes, and errata routinely reach us months before the directory
   re-publishes.
2. Let editorial staff write directly to the canonical value. Rejected outright
   — it breaks ADR-0001 (the canonical value is computed, not stored) and rule 2
   (no published fact without evidence).
3. Promote the override to the front of the cascade, and pay for that power with
   an audit contract.

## Decision

**An editorial override is criterion 0. It is evaluated before
`DIRECT_AUTHORITATIVE_SOURCE` and it wins outright.** The five source-derived
criteria keep doc 04's relative order behind it.

An override is only honoured when it is auditable. It must carry:

- **its own evidence row** — unchanged, and deliberately not relaxed. The
  eligibility pre-filter runs ahead of every criterion, so an override still
  needs an evidenced, non-retracted, in-validity, rights-clear claim from the
  named editorial source. An editor cannot conjure a value nobody asserted, and
  cannot launder a RED/UNREVIEWED claim into publication;
- **a written `reason`** — non-empty after trimming;
- **a named `reviewer`** — non-empty after trimming.

The policy shape changed accordingly. `editorialSources: readonly string[]` — a
bare list of source keys, carrying no audit information at all — was replaced by:

```ts
export interface EditorialOverride {
  readonly source: string;                // source id or domain
  readonly reason: string;                // required, non-empty after trim
  readonly reviewer: string;              // required, non-empty after trim
  readonly properties?: readonly string[]; // optional restriction
}
```

on `FactSelectionPolicy.editorialOverrides`.

### It fails closed, in three separate ways

- **A declaration missing a reason or a reviewer is ignored entirely.** It does
  not silently degrade into a tiebreaker, and it does not throw. An unauditable
  override is not a weaker override; it is not an override. Whitespace counts as
  missing. The selection trace reports how many declarations were discarded and
  why, so a mistyped config is visible rather than merely inert.
- **Two valid overrides competing for one property decide nothing.** The cascade
  falls through to the ordinary criteria and records that it did. Picking one
  would be inventing an editorial decision that nobody made; "ambiguous
  editorial intent" is a real state and the honest thing to do is say so. The
  same applies when a single override stands behind two different values.
- **`properties: []`** restricts an override to nothing, rather than to
  everything. The fail-closed reading of a list that names no properties.

### The result is labelled

`FactSelection` gained `editorially_corrected: boolean` and
`editorial_correction: { source, reason, reviewer } | null`, and
`FactExplanation` carries both plus a dedicated narrative line. A staff
correction that renders identically to a source-derived value is exactly the
thing a reader would want to have been told about — particularly the reader
comparing our page against the manufacturer's and wondering which of us is
broken.

### The badge policy is unchanged, deliberately

`EDITORIAL_OVERRIDE` remains **excluded** from `VERIFIED_DECIDERS` in
`packages/provenance/src/verification-policy.ts`. Staff assertion is not source
verification, and promoting the override in the *selection* cascade must not
promote it in the *trust* claim. A value can be simultaneously "editorially
corrected" (we changed it, here is who and why) and "not source verified" (no
authoritative document backs the corrected figure yet). Those are different
statements and the surface renders both. The allowlist is exactly
`{DIRECT_AUTHORITATIVE_SOURCE, SOLE_ELIGIBLE_CANDIDATE}` and this ADR does not
widen it.

### Losing claims are still retained

Unchanged, and worth stating because a correction is the most tempting moment to
delete: the overridden authoritative claim stays in `facts` with its evidence
and is reported as a retained conflict (AGENTS.md rule 10, doc 04's "do not
overwrite conflicting facts prematurely"). "The manufacturer's spec sheet says
72" remains answerable after an editor has corrected it to 70.

## Consequences

- The `SOLE_ELIGIBLE_CANDIDATE` short-circuit is never labelled as an editorial
  correction. With one surviving claim there is no rival value to correct, so
  the label would assert a decision that was not taken.
- `DOC04_SELECTION_PRECEDENCE` now lists `EDITORIAL_OVERRIDE` first. It
  documents the order the code runs, not the order doc 04 wished for; a
  precedence constant that disagrees with the cascade is worse than none.
- Verticals declare corrections under `editorial_override.overrides` in
  `normalizers/fact-selection.yaml`. Both shipped verticals declare an empty
  list: HVAC's two fixture conflicts are settled by authority and field
  reliability, and reaching for an override to settle either would hide a
  source-quality problem behind a manual patch.
- `editorial_override.requires_reason` / `requires_reviewer` are enforced
  unconditionally by the cascade. The YAML keys document the invariant; setting
  either to `false` changes nothing. A vertical cannot opt out of being
  accountable for its own corrections. Writing `false` is now **rejected at load
  time** rather than silently overruled: being overruled without being told is
  the right outcome reached the wrong way.

## The expiry gap, and why the knob is refused

`editorial_override.max_age_days` was **declared but not enforced**. The intent
— an override should expire so a manual patch cannot outlive the problem it
fixed — is right, but expiry needs a declaration date on each override entry,
and the cascade does not read one. Until it does, a stale override keeps
winning. Closing it requires a `declared_at` on `EditorialOverride` and a
comparison against the selection's `at`, which is a schema change to the
vertical config and is deliberately left out of this ADR rather than
half-implemented.

What has changed is that the gap is no longer papered over by an accepted
option. `buildFactSelectionPolicy` **rejects** `max_age_days` outright, with a
message naming the missing `declared_at`. A configuration option is a promise
to whoever reads the YAML, and `max_age_days: 365` read exactly like a
guarantee that a correction lapses in a year. An option that is accepted and
disregarded is worse than an option that does not exist: the first misleads, the
second merely limits. The key is refused whether or not the mechanism is
`enabled`, because a promise left lying in a file is still read.

## Rejected alternatives

- **Keep it sixth and document the limitation.** The word "override" would keep
  promising something the code does not do. A misnamed feature is a defect
  whether or not it is written down.
- **Make the override a confidence boost rather than a decision.** It would
  interact with reliability scores in ways nobody could predict from the config,
  and the answer to "why does the page say 70?" would become an arithmetic
  argument rather than "j.okafor corrected it on this date for this reason".
- **Resolve competing overrides by reviewer seniority or declaration order.**
  Both invent an authority ranking among staff that the platform has no basis
  for, and make the published value depend on YAML ordering. Falling through to
  the ordinary criteria is the only answer that does not fabricate a decision.
- **Allow an override without evidence.** This is the request that will
  eventually be made ("we just need to force this one value"), and it is the one
  that must stay refused: it breaks rule 2, and it removes the only thing that
  lets anyone reconstruct what the correction was based on.
