# Onboarding a real source

Phase 1 proved the factory runs. It ran on four sources we invented, on domains
reserved so they resolve to nobody. Every rights check passed because we wrote
the terms being checked.

Phase 2 is the first time that stops being true. This document is the procedure
for it: what to decide before fetching a byte, what has to be recorded, and what
counts as proof afterwards.

Run `pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z hvac` at the
explicit instant being reviewed. It reads the same declarations the pipeline
reads, evaluates exact canonical surface bundles when live DB or validated
snapshot evidence is supplied, and reports blockers by name. With no rights
evidence the seven surfaces are `UNKNOWN`, which is correct.

**Worked example.** The first candidate to go through this procedure is EPA's
ENERGY STAR certified heat-pump data. Its review packet is at
`docs/sources/energy-star-air-source-heat-pumps-review-packet.md`, the draft
declaration at `docs/sources/proposed/energy-star-heat-pumps.yaml`, and the
retrieved evidence under `docs/sources/evidence/`. It is **not approved** — the
packet is what a reviewer reads, not a decision. `docs/sources/prohibited-sources.md`
records the sources that are refused before any of this begins.

---

## The rule this all serves

> **AGENTS.md rule 1** — no source without rights metadata.
> **AGENTS.md rule 10** — preserve raw evidence.

A rights review is not paperwork attached to an engineering task. It is the
engineering task: the platform fails closed without it, and the answer changes
what the code is allowed to do with the bytes.

---

## Stage 1 — before any request is made

Nothing is fetched at this stage. A source that cannot clear it is not a
candidate, and finding that out costs one afternoon rather than one migration.

**1. Read the terms yourself.** Not the marketing page. The terms of use, the
API terms if there is an API, the licence file if the data ships with one, and
the `robots.txt`. Record the URLs; they are fields on the declaration.

**2. Answer the six questions the declaration asks.** Each maps to a field in
`sources/<key>.yaml`, and each has a real answer, not a default:

| Question | Field | If unclear |
| --- | --- | --- |
| May we acquire it this way at all? | `acquisition_policy.method` | Do not proceed on a method the terms do not contemplate |
| May we use it commercially? | `rights_policy.commercial_use_allowed` | `false`. Silence is not permission |
| May we redistribute it? | `rights_policy.redistribution_allowed` | `false` |
| May we normalize and derive from it? | `rights_policy.derivative_normalization_allowed` | `false` — this is the one most often missed, and it is the one the whole platform does |
| Must we attribute, and how exactly? | `rights_policy.attribution` | If required, the display text is mandatory. An obligation nobody wrote down cannot be honoured |
| May we reuse the images? | `rights_policy.images_reusable` + `image_policy` | `false`. The right to state a specification is never the right to republish a photograph (rule 9) |

**3. Decide the classification honestly.**

- `GREEN` — reviewed; use, redistribution and derivation permitted on the
  recorded terms.
- `AMBER` — reviewed; permitted **with conditions**. Write the conditions down;
  they travel with the data to every surface.
- `RED` — reviewed; publication is not permitted. Acquiring for internal
  analysis may still be fine; publishing is not.
- `UNREVIEWED` — nobody has looked. Refused at the write boundary and again at
  the read boundary.

`RED` and `UNREVIEWED` are not failure states. They are correct outcomes that
keep bad data out. A source recorded honestly as `RED` is worth more than one
optimistically marked `GREEN`.

**4. Record personal data if present.** `rights_policy.personal_data_present`.
If true, stop and get a handling decision before acquisition — the readiness
report treats it as a blocker for exactly that reason.

**5. Name a human reviewer and a review date.** `reviewed_by`, `reviewed_at`,
`next_review_at`. Terms change. A review with no expiry is a review that will
silently go stale.

---

## Stage 2 — acquisition

**Prefer the published bulk file over crawling.** It is cheaper, it is more
stable, and it is usually what the publisher intends. `acquisition_policy.method`
records what is acquired; the notes record how.

**Set `max_requests_per_minute` deliberately.** The cap exists to make an
accidental crawl loop visible immediately, not to describe expected traffic.

**Honour `robots.txt` and snapshot it.** `robots_policy.snapshot_hash` and
`snapshot_at` record what it said when we read it, so a later dispute has an
answer.

**Retain the artifacts.** `provenance_retention.retain_artifacts: true` unless
there is a specific reason not to, and if not, say why. Content is addressed by
digest and written once; a re-fetch of unchanged bytes adds a retrieval record,
not a second copy.

---

## Stage 3 — what counts as proof

The milestone is not "we ingested something". It is that the factory handled a
source it did not know about, without vertical-specific platform code and
without weakening a control. All of the following, on one real source:

- [ ] A real external artifact acquired through a supported provider adapter.
- [ ] Rights metadata complete, with a named human reviewer and a review date.
- [ ] Immutable raw evidence stored, addressed by content digest.
- [ ] Field locators preserved — every extracted value points back into the bytes.
- [ ] Records extracted without a source-specific branch in platform code.
- [ ] Identifiers normalized deterministically.
- [ ] Entities resolved with no vertical-specific platform code.
- [ ] Conflicts retained and explainable, not silently collapsed.
- [ ] Verification state generated correctly, and stored as an event.
- [ ] Incremental refresh works: unchanged bytes deduplicate physically.
- [ ] Retrieval history remains visible after that deduplication.
- [ ] Provenance coverage measured.
- [ ] Cost per useful canonical record measured.

The last two are the ones that get skipped. They are also the two that decide
whether any of this is a business.

### Measuring the last two

**Provenance coverage** already exists: `packages/provenance` reports the
fraction of published facts whose lineage resolves to stored evidence. Phase 1
holds it at 1.0 on fixtures. The number to record is what it is on real data,
where extraction is messier.

**Cost per useful canonical record** is requests plus rendering plus storage
plus any LLM adjudication, divided by the count of canonical facts that a
customer would pay for — not the count of rows written. A source that yields ten
thousand rows and forty useful facts is expensive, and the ratio is the only
thing that says so early.

---

## Stage 4 — before anything is sold

`DATA_RIGHTS.md` states the five conditions. The command
`pnpm sources:readiness -- --as-of <canonical-UTC-instant>` checks the mechanical
ones and prints the rest as the gate they are. A vertical stays
`status: DRAFT` until all five hold, and `DRAFT` verticals do not publish.

The condition no tool can check for you is the fourth: a published dataset
licence stating the terms customers receive, which will not be MIT and must not
claim more than the upstream terms allow us to grant.

---

## Choosing a candidate

Technical promise and legal availability are different axes, and the second one
disqualifies faster. Look for:

- **A published bulk export or a documented API**, rather than a site that must
  be crawled. Cheaper, more stable, and a far clearer signal of intent.
- **Explicit terms**, ideally a named licence. An open-data portal with a
  stated licence beats a richer source with silent terms every time — "we could
  not find anything forbidding it" is not a rights review.
- **A registry or certification body**, where publication is the point of the
  organisation's existence.
- **Genuine independence from the sources already declared.** Three mirrors of
  one upstream feed are one family, and corroboration between them means nothing.

Avoid, at least first: sources behind authentication, sources whose terms forbid
automated access, anything carrying personal data, and anything whose value
depends on republishing images.

Do not ingest or publish a real source until its rights posture has been
reviewed for acquisition method, commercial use, redistribution, derivative
normalization, attribution, provenance retention and image reuse. That list is
the checklist in Stage 1, and it is the same list whether the source is a
government registry or a manufacturer's catalogue.
