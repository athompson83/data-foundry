# Owner decision — the rights model, and what it costs to get it wrong

**Prepared:** 2026-08-23 · **Status:** DECIDED — Option B accepted with required corrections

> This is an engineering analysis of publisher terms. **It is not a legal
> review** and must not be recorded as one. Where it says a licence permits or
> forbids something, that is a reading of the text, offered so the engineering
> consequences can be seen — not advice that the reading is correct.

> **Outcome recorded 2026-08-28:** the owner accepted the rights-grant matrix,
> designed to support field-level scope, subject to corrections RIGHTS-ADR-001
> through RIGHTS-ADR-007. ADR-0010 is the normative architecture and records the
> implemented schema and resolver. Sections 2–10 below preserve the analysis
> presented for the decision; their illustrative table and pseudocode are not
> the current schema. Acceptance creates no source permission or legal clearance.

---

## 1. The decision

**The question presented was how finely the platform records what each source
may be used for.**

Everything else in this memo exists to make that choice concrete. The
recommendation was **Option B, a rights-grant matrix**. The owner accepted that
direction with the corrections now incorporated in ADR-0010.

The architecture decision is resolved. Real-source publication remains blocked
unless the exact surface-specific grants are independently evidenced and
effective. In particular, the ENERGY STAR packet remains deferred as recorded
in §11.

---

## 2. Why the current model cannot express what the sources actually say

**Measured, not asserted.** `packages/source-registry/src/rights-policy.ts`
records permission as three booleans:

```
commercial_use_allowed          boolean
redistribution_allowed          boolean
derivative_normalization_allowed boolean
```

and `publish-gate.ts` turns each `false` into a **blocker**:

```ts
if (!entry.rights_policy.redistribution_allowed) {
  blockers.push({ code: 'REDISTRIBUTION_NOT_ALLOWED', … });
}
```

There is one gate, and it is all-or-nothing. **A source is publishable
everywhere or nowhere.**

### The source that breaks it

EU EPREL's API terms grant the right *"to reproduce, share and distribute the
Data for commercial and non-commercial purposes […] but not commercialize or
sell the data per se"*, and explicitly permit *"comparison tools"* — while
Article 4 §2 forbids:

> a. sell the data on their own to gain benefit from the data themselves without
> adding value with your service […] **but not sell those data as it is**, even
> when complementary parameters are associated to each record;
>
> b. […] redistribution, resale or **sublicense access to the Data**;

Read against this product: **the free comparison website is expressly
contemplated; the metered API is the thing forbidden.**

Now set the boolean. There is no third option:

| `redistribution_allowed` | Consequence |
|---|---|
| `true` | Gate passes. The source flows to the paid API and bulk export — the uses the terms forbid. |
| `false` | Gate blocks. The source is excluded from the free website the terms **expressly permit**. |

**Neither value is correct, and the schema offers no way to say so.** That is the
whole finding.

### It is not one awkward source

The same split appears across the candidate set: an open or institutional
licence that welcomes public display and consumption while reserving resale.
Ten of the twelve candidates in
`docs/sources/hvac-source-landscape-2026-08.md` have terms that distinguish
*using* the data from *selling access to* it. A model that cannot represent the
distinction will mis-record most of them — in whichever direction the person
filling in the form happens to lean.

### The commercially uncomfortable consequence

Under any correct model, **the free website can lawfully carry sources the paid
API cannot.** That inverts the usual assumption that paying customers get more.
It is worth deciding deliberately now rather than discovering it when a customer
asks why an API response omits a manufacturer their browser can see.

---

## 3. The three options

### Option A — add columns to `rights_policy`

`api_paid_allowed`, `bulk_export_allowed`, `sublicense_allowed`, and so on.

- **Cheapest.** One migration, one schema change, queries stay flat.
- **Fails on the second question.** Every new channel — MCP, an LLM dataset, a
  partner feed — is another column and another migration, and the columns
  accumulate as permanent schema regardless of whether a source ever answers them.
- **Cannot carry conditions.** "Permitted if attributed and refreshed within 24
  hours" has nowhere to live but prose, and prose is not enforceable.
- **Cannot express `REQUIRES_REVIEW`.** A boolean has two states; the honest
  answer for most source/use pairs today is a third one.

### Option B — a rights-grant matrix — **recommended**

One row per (source policy × use case). The use case names the surface, and
the surface is the only thing a grant needs to be keyed on.

```
rights_grants
  rights_policy_id   → the source's policy
  use_case           closed vocabulary (see below) — THE ONLY channel dimension
  permission         ALLOWED | PROHIBITED | REQUIRES_REVIEW | UNKNOWN
  conditions         text — the obligation that travels with the grant
  attribution_ref    the exact required credit, when one applies
  policy_version     which version of the publisher's terms this reads
  effective_from     when those terms took effect
  review_status      / reviewed_by / reviewed_at
  evidence_ref       pointer to the quoted term this row rests on
```

Use-case vocabulary, closed, matching the enforcement points in §5:

`ACQUISITION` · `NORMALIZATION` · `WEB_ITEM_PAGE` · `WEB_SEARCH_COMPARE` ·
`API_FREE` · `API_PAID` · `BULK_EXPORT` · `REDISTRIBUTION` · `SUBLICENSE` ·
`DERIVED_STATISTICS` · `LLM_RETRIEVAL` · `MODEL_TRAINING` ·
`CUSTOMER_ENRICHMENT`

**One dimension, not two.** An earlier draft of this proposal carried both a
`use_case` containing `API_FREE`/`API_PAID` *and* an `access_tier` containing
`PUBLIC_FREE`/`PUBLIC_PAID`. Review caught it, and it was right: two ways to
name the same surface is two ways to answer the same question, and nothing said
which wins when they disagree. A source could carry `API_PAID = PROHIBITED` and
`PUBLIC_PAID = ALLOWED` simultaneously, and the resolver would have to pick —
silently. The tier is folded into the use case, one row per surface, and the
primary key `(rights_policy_id, use_case)` makes a contradiction unrepresentable
rather than merely discouraged.

- **Expresses EPREL exactly**: `WEB_SEARCH_COMPARE = ALLOWED`,
  `API_PAID = PROHIBITED`, `SUBLICENSE = PROHIBITED`, each with the quoted
  article in `evidence_ref`.
- **Fails closed by construction.** An absent row is not permission. A new use
  case added tomorrow is `UNKNOWN` for every existing source until someone
  reviews it — which is the correct default and the one Option A cannot give,
  because a new boolean column has to default to something.
- **Costs**: a join on every enforcement path, and an admin surface to edit it.
- **Costs, honestly stated**: reviewing a source becomes 13 answers instead of 3.
  That is more work, and it is work that was previously being skipped rather
  than done.

### Option C — Option B plus field-level overrides

Adds per-field or per-provenance exceptions on top of the matrix.

- **The only option that handles §4 correctly.**
- **Most complex**, and every enforcement point must then resolve
  policy-then-override rather than reading one row.
- **Recommendation: design for it, do not build it yet.** Option B's grant row
  can carry an optional field scope later without restructuring; committing to
  the full override resolution now buys complexity before the first real source
  has landed.

---

## 4. Partner-submitted values — the question under the question

**Every lawful candidate has mixed provenance inside one source**, and each
publisher says so in its own words:

| Source | What the publisher says |
|---|---|
| ENERGY STAR | Certified values are submitted by partners and certification bodies; the EPA public-domain notice covers **EPA-produced** content (packet §4) |
| DOE CCMS | *"information submitted by importers and U.S. manufacturers"* |
| EPREL | *"provided directly by the suppliers, who are solely responsible for its accuracy"* (Article 7 §1) |
| AU DCCEEW | *"collected from suppliers when they register appliances"* |

So "the EPA's data is public domain" may be true of the dataset and still not
settle the rights in a SEER2 value a manufacturer submitted. **This is the
single largest unresolved question in the whole rights picture**, and it is
legal, not engineering.

It also has a schema consequence: if partner-submitted values carry different
rights from publisher-produced ones, then rights attach **below the source**, at
the field or claim level — which is Option C. Until §11's decision 2 is
answered, Option B records the source-level grant and the question stays visibly
open rather than silently assumed.

---

## 5. Where a rights decision has to be enforced

| Enforcement point | Today | Under Option B |
|---|---|---|
| Ingestion eligibility | `evaluateAcquisitionGate` — status + classification | + `ACQUISITION` grant |
| Fact promotion | `canPublish(rights_classification)` | + `NORMALIZATION` grant |
| Public item page | one global gate | `WEB_ITEM_PAGE` |
| Search / compare | one global gate | `WEB_SEARCH_COMPARE` |
| Free API | **not distinguished** | `API_FREE` |
| Paid API | **not distinguished** | `API_PAID` ← the EPREL case |
| Bulk export | one global gate | `BULK_EXPORT` |
| MCP / agent access | **not distinguished** | `LLM_RETRIEVAL` |
| Search-index publication | **not distinguished** | `WEB_SEARCH_COMPARE` |
| LLM dataset publication | **not distinguished** | `MODEL_TRAINING` |
| Admin source review | manual | grant review workflow |

Five of eleven are not distinguishable today. The two that matter commercially —
paid API and LLM/dataset use — are both in that five.

---

## 6. Implementation cost

Estimated against the current codebase, for Option B:

- **One migration** creating `rights_grants` with two closed vocabularies, plus
  backfill of existing declarations at `REQUIRES_REVIEW` (not `ALLOWED` — a
  migration must not manufacture permission).
- **One resolver** in `packages/source-registry`, returning a permission for a
  (source, use case, tier) triple, defaulting to `UNKNOWN` → deny.
- **`publish-gate.ts` gains a use-case parameter.** Its current callers pass the
  surface they are gating for; a caller that cannot name one is a caller that
  should not be publishing.
- **Query layer** carries the tier from the request context so the API can
  filter what the website may still show.
- **Reversible.** Nothing here is a contractual commitment; the grant rows are
  data and the vocabulary can be widened by migration.

**What is not reversible** is publishing data under a wrong reading of a
licence. Retracting a published fact is possible; retracting an API response a
customer has already stored is not.

---

## 7. HVAC source authority — corrected, and what it changes

Fixed in PR #14 (`c27e5fc`), and it changes what the product may claim.

`fact-selection.yaml` declared `CERTIFICATION_BODY` authoritative for seven
properties including SEER2. The only source with that type is a **synthetic
fixture**; the sole real US HVAC certification directory is prohibited in code.
Worse, `fact-policy.ts` **dropped an unsatisfiable declaration silently** — the
property left the policy, and selection fell through to corroboration, a
majority vote over exactly the claims the declaration existed to outrank. That
would have happened with every test green.

Three corrections, each with a test that failed first:

1. A new source type, `REGULATORY_FILING` — a register a regulator **hosts** and
   a manufacturer **asserts**. DOE's own words: *"The appearance of a model on
   this web site is not an indication that DOE has determined that the model is
   compliant."*
2. The loader now **refuses** a preference no registered source can satisfy.
3. `DATA_DICTIONARY.md` and `SOURCES.md` now state that a value selected from that
   source class may never be called certified, verified, approved or determined.

**The product consequence:** Data Foundry can accurately offer *"manufacturer-
reported HVAC specifications as filed with US regulators, with the filing's
provenance attached."* It cannot offer *"certified ratings"* — that is AHRI's
licensed product, which is precisely why it is licensed. The first is still
differentiated and still saleable; it is a different claim, and the marketing
must match it.

---

## 8. ENERGY STAR packet — one defect removed from your path

The packet's condition 2 needs a **named human signature**; no agent can supply
it.

One thing that would have gone wrong on signing day is now fixed. The proposed
declaration carried `source_type: GOVERNMENT`, which is in neither the schema
enum nor the database CHECK. Nothing reads `docs/sources/proposed/`, so it would
have surfaced as a validation error at the exact moment the file was promoted —
the one step of the procedure meant to be mechanical. It now reads
`REGULATORY_FILING`, and `tooling/test/proposed-sources.test.ts` reads the
drafts so this class of defect cannot recur.

**Still open, and legal:** packet §4 — whether partner-submitted values inherit
the EPA's public-domain status. See §4 above; it is the same question.

---

## 9. Outreach options — prepared, not initiated

**No publisher has been contacted, and none will be without your instruction.**

| Publisher | What would be asked | If granted | If refused |
|---|---|---|---|
| **DCCEEW** (Australia) | An exemption from `data.gov.au`'s `Disallow: /`, or a retrieval path outside that host | The best licence of the twelve becomes usable — CC BY 3.0 AU permits commercial use, redistribution and derivation | No loss; the data is AS/NZS-metric anyway and does not fit the US dictionary |
| **EPREL** (EU) | Written confirmation that a free comparison surface is permitted while the metered API is not | Removes the §2 ambiguity for the largest EU dataset | Fall back to front-end-only, or drop it |
| **CEC** (California) | Written permission for automated access to MAEDbS | A state-level US register, complementary to the federal ones | No loss; the federal sources cover the same models |

**Recommended order: EPREL first.** It is the only one whose answer changes a
schema decision rather than merely adding a source.

---

## 10. Known unknowns — and what may not be assumed

- **Field coverage is unmeasured for five candidates.** Measuring it requires
  downloading records, which is not authorised. It may not be inferred from
  documentation, schemas or screenshots.
- **Update cadence is UNKNOWN for every candidate except DOE CCMS**, which states
  *"approximately every two weeks."* One observed timestamp is not a cadence.
- **Image rights are unassessed** for candidates 3–9. The right to state a
  specification is never the right to republish a photograph.
- **Personal data is not affirmatively cleared** for any candidate. "Product
  registries are unlikely to carry it" is an inference, not evidence.
- **No terms have been reviewed by a lawyer.**

A source may remain a candidate with all of these UNKNOWN. It may not be marked
acquisition-ready on that basis.

---

## 11. Owner decisions

| # | Decision | Outcome | Current engineering rule |
|---|---|---|---|
| 1 | **Rights model granularity** | **ACCEPTED:** corrected Option B; field-level scope is representable | Follow ADR-0010. Absence is refusal and migration creates no `ALLOW`. |
| 2 | **Partner-submitted field ownership** (legal) | **UNKNOWN until explicitly reviewed** | Do not assume a publisher licence flows through to third-party-submitted fields. No implicit field grant. |
| 3 | **ENERGY STAR packet** | **DEFERRED** | Do not sign, promote, or mark the source acquisition-ready until the partner-submitted-rights question receives the required human review. Synthetic-fixture work may continue. |
| 4 | **One API key per vertical** | **CONFIRMED for V1** | Each key has exactly one `vertical_id`; future multi-vertical access must be modeled explicitly. |
| 5 | **Product claim wording for HVAC** | **CONFIRMED** | Use *“Manufacturer-reported, as filed with US regulators”*. Do not imply regulator certification, verification, approval, or determination without exact supporting provenance. |
| 6 | **Publisher outreach** | **NOT AUTHORIZED in this work package** | Do not send publisher communications or accept terms. Existing draft material may remain documentation only. |

### What breaks under each rights option

- **Option A:** ships fastest; the next distribution channel needs a migration,
  and conditions and `REQUIRES_REVIEW` remain unrepresentable. Sources whose
  terms split web from API get recorded wrongly in one direction or the other.
- **Option B:** paid API and LLM products become gateable per source, which is
  what makes them safely sellable. Source review gets more laborious and honest.
- **Option C:** the only option that survives §4 resolving against us — i.e. if
  partner-submitted values turn out to carry separate rights.

### The revenue shape

The metered API is the revenue line, and it is the use case most licences
restrict. Under Option B some sources will be `API_PAID = PROHIBITED` while
remaining `WEB_SEARCH_COMPARE = ALLOWED`. **The advertising-funded free surface
may therefore be broader than the paid one.** That is not a flaw in the model —
it is what the licences say, made visible. A model that hid it would be selling
access we do not have.

---

*Prepared from repository evidence and publisher documentation retrieved
2026-08-23. No source records were downloaded and no publisher was contacted in
preparing this memo. The accepted engineering mechanism is implemented by
ADR-0010; it grants no real source permission.*
