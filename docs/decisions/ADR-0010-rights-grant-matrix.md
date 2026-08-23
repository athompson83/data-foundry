# ADR-0010 — The rights-grant matrix

**Status:** PROPOSED — not accepted, not implemented, awaiting owner decision 1
**Date:** 2026-08-23
**Relates to:** `docs/owner-actions/rights-model-decision.md`, ADR-0007, `packages/source-registry/src/rights-policy.ts`, `packages/source-registry/src/publish-gate.ts`

> **This ADR specifies a design. It does not change any code.** It exists so the
> owner can approve or reject a concrete thing rather than a direction, and so
> that whoever implements it is not making the unresolved decisions on the way
> past.
>
> It is also **not a legal review.** Where it describes what a licence permits,
> that is an engineering reading offered so the mechanism can be built — never
> advice that the reading is correct.

---

## 1. What this replaces, and why

`rights_policy` records permission as three booleans — `commercial_use_allowed`,
`redistribution_allowed`, `derivative_normalization_allowed` — and
`publish-gate.ts` turns each `false` into a blocker. One gate, all-or-nothing: a
source is publishable everywhere or nowhere.

The decision memo shows why that cannot hold. EPREL's terms permit comparison
tools and forbid selling the data as it is or sublicensing access to it. Setting
`redistribution_allowed = true` ships the source to the paid API in breach;
`false` blocks it from the website the terms expressly permit. There is no third
value, and ten of twelve assessed candidates split *using* the data from
*selling access to* it.

**The failure is representational, not procedural.** No amount of care in filling
in the booleans produces a correct answer, because the correct answer is not
expressible.

---

## 2. The shape

**A grant is an assertion about one cell of a scope × operation space. Absence is
never permission.**

### 2.1 Decision states

| State | Runtime effect | Means |
|---|---|---|
| `ALLOW` | permit | The controlling terms permit this, and the evidence says where |
| `DENY` | refuse | The controlling terms forbid this |
| `CONDITIONAL` | **refuse unless every condition is satisfied and auditable** | Permitted with obligations — attribution, freshness, volume caps |
| `UNKNOWN` | refuse | Nobody has established an answer |
| `NOT_APPLICABLE` | refuse | The operation is meaningless for this combination |

`NOT_APPLICABLE` refuses like the others but is **reported differently**, and the
distinction is the point: "we do not need to ask" must never be mistaken for "we
asked and it said no", nor for "nobody looked". A review dashboard that
collapses them produces a false sense of coverage.

### 2.2 Scope dimensions

A grant may be scoped on any subset of these. Unset means "any".

| Dimension | Why it is separate |
|---|---|
| `publisher` | The legal entity. Broadest useful scope; a publisher-level `DENY` covers sources not yet declared |
| `source` | One registered source |
| `acquisition_route` | Bulk file, documented API, page fetch. **Terms routinely differ by route** — an API's terms are not the website's |
| `account_or_product_plan` | Rights can attach to the account that fetched, not just the data |
| `jurisdiction` | The same dataset can be reusable in one jurisdiction and not another |
| `asset_class` | Data, images, documents, trademarks |
| `field_or_field_group` | Where publisher-produced and partner-submitted values coexist in one source |
| `output_class` | What we would emit, which is not what we ingested |

### 2.3 Operations

`acquire` · `store` · `normalize` · `derive` · `display_publicly` ·
`build_comparison_tools` · `quote_or_excerpt` · `redistribute_raw` ·
`offer_bulk_export` · `sell_api_access` · `deliver_to_partners` ·
`train_models` · `evaluate_models` · `cache` · `retain_after_termination`

### 2.4 Distribution channels and output classes

Channels: `internal_processing` · `public_website` · `customer_api` ·
`bulk_download` · `partner_delivery`

Output classes: `raw_record` · `normalized_fact` · `derived_metric` ·
`metadata` · `image_or_media` · `personal_data`

**These are independent axes and are evaluated independently.** Permission to
display a `normalized_fact` on the `public_website` says nothing about emitting
a `raw_record` over the `customer_api`, and nothing at all about
`image_or_media` or `personal_data`.

---

## 3. The part that makes it usable

A naive reading of §2 is a combinatorial explosion — eight scope dimensions,
fifteen operations, five channels, six output classes. Nobody can answer that
many questions per source, and a model that demands it will be filled in
carelessly, which is worse than the booleans.

**It is sparse, and absence is refusal.** A source begins with zero grants and is
therefore refused for everything. A reviewer asserts only what the terms
actually say — typically five to fifteen rows — and every unasserted cell stays
`UNKNOWN` and blocked. **The work scales with what the terms address, not with
the size of the space.**

### 3.1 Resolution

Given a request tuple `(publisher, source, acquisition_route, plan,
jurisdiction, asset_class, field, operation, channel, output_class)`:

1. Select every grant whose scope matches the tuple (unset dimensions match
   anything).
2. **If any matching grant is `DENY`, the answer is `DENY`.** Deny is sticky and
   is not overridden by a more specific `ALLOW`.
3. Otherwise take the **most specific** matching grant by the precedence in
   §3.2 and return its state.
4. If no grant matches, return `UNKNOWN`.

**Step 2 is the load-bearing rule and deserves argument.** The natural
alternative — most-specific-wins for every state — is wrong here, because it
lets a narrow `ALLOW` defeat a broad prohibition. A publisher-level `DENY` (the
AHRI case) must not be overridable by someone adding a source-level `ALLOW` for
one dataset under that publisher. Prohibitions are the thing least likely to be
re-reviewed and most costly to get wrong, so they win.

The cost is real and should be stated: a genuine narrow exception — "this
publisher forbids redistribution *except* this one CC-BY dataset" — cannot be
expressed by adding an `ALLOW` under a `DENY`. It must be expressed by scoping
the `DENY` to exclude that source. That is more work, and it is work that leaves
the exception visible in the record instead of buried in resolution order.

### 3.2 Specificity precedence

Most specific first. **The order is total**, so two grants can never tie:

```
field_or_field_group > output_class > asset_class > acquisition_route
  > account_or_product_plan > jurisdiction > source > publisher
```

A uniqueness constraint over the full scope tuple plus operation and channel
prevents two grants occupying the same cell. Without both, the resolver picks
between equals silently — which is exactly the flaw review found in the memo's
first draft, where `use_case` and `access_tier` both named the API surface and
nothing said which won.

### 3.3 Every decision returns a reason

```ts
interface RightsDecision {
  readonly permitted: boolean;
  readonly state: 'ALLOW' | 'DENY' | 'CONDITIONAL' | 'UNKNOWN' | 'NOT_APPLICABLE';
  readonly reasonCode: string;      // machine-readable
  readonly grantId: string | null;  // null when the answer is absence
  readonly unmetConditions: readonly string[];
  readonly evidenceRef: string | null;
}
```

A blocked request must be able to say **which grant blocked it, or that none
existed** — otherwise an operator debugging a withheld fact cannot tell a
deliberate prohibition from an unfinished review.

---

## 4. Evidence

Every grant carries the record that justifies it. A grant without evidence is an
opinion with a primary key.

| Field | Note |
|---|---|
| `controlling_terms` | Licence, terms of use, or agreement |
| `artifact_version_or_hash` | Terms change; the hash says which text this reads |
| `clause_ref` | Exact section, page or clause |
| `effective_date` | When those terms took effect |
| `acquired_or_reviewed_at` | When we read them |
| `reviewer_type` | `HUMAN` / `COUNSEL` / `AUTOMATED` — **an automated assessment is never a rights review** |
| `jurisdiction` | |
| `conditions` | Structured; each independently checkable for `CONDITIONAL` |
| `attribution_requirements` | Exact required text where one applies |
| `expires_or_recheck_at` | A review with no expiry is one that will silently go stale |
| `superseded_by` | Points at the grant that replaced this one |

Grants are **append-only**. Superseding writes a new row and links back;
correcting by mutation would destroy the record of what we believed when we
published.

---

## 5. Rules the implementation must enforce

1. `UNKNOWN` blocks.
2. `CONDITIONAL` blocks unless every condition is satisfied **and auditable** — a
   condition nothing can check is not a condition, it is a hope.
3. Permission for one operation, output class or channel never implies another.
4. Rights attach to the acquisition route, the account or plan, and the intended
   output — not merely to the publisher.
5. Raw records, normalized facts, derived outputs, images and personal data are
   evaluated independently.
6. **No general commercial-use flag may imply permission to resell, sublicense,
   bulk-export or sell API access.** This is the specific error the booleans
   made possible.
7. Terms change, revocation or expiry triggers auditable disablement and
   re-review.
8. Every runtime decision returns a machine-readable allow or blocker reason.

---

## 6. Migration from the three booleans

**Existing declarations backfill to `UNKNOWN`, not to `ALLOW`.**

This is the only honest mapping and it should be stated plainly, because it is
the step most likely to be softened under delivery pressure. `commercial_use_allowed: true`
was recorded by someone answering *"may we use this commercially?"*. It is not
an answer to *"may we sell API access to it?"* — nobody was asked that, and a
migration that writes `ALLOW` would manufacture permission at scale, in bulk,
with no evidence rows behind it.

The cost is that every source is blocked for everything until reviewed. **That
cost is currently zero**: no real source has been acquired, no deployment
exists, and the fixture sources are synthetic. This is the cheapest moment this
migration will ever have.

`publish-gate.ts` gains an operation and channel parameter. A caller that cannot
name the surface it is gating for is a caller that should not be publishing.

---

## 7. Delivery, in order

Each phase is independently reviewable and leaves the tree working.

| Phase | Contents | Gate |
|---|---|---|
| 1 | Vocabularies as closed enums + schemas; no storage | Types compile; enums match this ADR |
| 2 | Migration: `rights_grants` table, uniqueness over the scope tuple, evidence columns, append-only trigger or convention | Applies to clean and populated PG16; reapply is a no-op |
| 3 | Resolver + reason codes, deny-by-default, sticky `DENY`, total specificity order | Unit tests incl. negative controls in §8 |
| 4 | `publish-gate.ts` takes operation and channel; call sites updated | Full suite; no caller left passing a default |
| 5 | Backfill to `UNKNOWN`; booleans marked deprecated, not dropped | Both models readable during transition |
| 6 | Enforcement at API/web/export/MCP boundaries | Integration tests per channel |
| 7 | Remove the booleans | Only once nothing reads them |

**Phases 1–3 are safe to build before the owner answers decision 2** (partner-
submitted field ownership), because `field_or_field_group` scoping exists in the
model whether or not it is used. Phase 4 onward changes runtime behaviour and
should wait for decision 1.

---

## 8. Tests this must pass, including the negative controls

A permission system whose tests only assert permitted paths is a permission
system nobody has checked.

1. **Absence blocks.** A source with zero grants is refused for every operation.
   *Negative control:* the resolver must return `UNKNOWN`, not a default.
2. **Sticky deny.** A publisher-level `DENY` beats a source-level `ALLOW`.
   *Mutation:* make deny non-sticky; this test must fail.
3. **No cross-implication.** `display_publicly` = `ALLOW` leaves
   `sell_api_access` `UNKNOWN`. Asserted for every adjacent pair that a careless
   implementation would conflate.
4. **Channel independence.** `public_website` `ALLOW` does not permit
   `customer_api`.
5. **Output-class independence.** `normalized_fact` `ALLOW` does not permit
   `raw_record`, `image_or_media` or `personal_data`.
6. **Route independence.** An API-route grant does not permit a page fetch.
7. **`CONDITIONAL` blocks with unmet conditions**, and the decision names which.
   *Negative control:* a condition that nothing can evaluate must block, never
   pass by default.
8. **`NOT_APPLICABLE` is not permission** — it refuses, and reports distinctly
   from `UNKNOWN`.
9. **Expiry blocks.** A grant past `expires_or_recheck_at` stops permitting
   without anyone editing it.
10. **Specificity is total.** No two grants can occupy one cell; the constraint
    is proved by an insert the database refuses.
11. **Every decision carries a reason**, including the absence case.
12. **The EPREL shape, end to end**: `build_comparison_tools` on
    `public_website` permitted; `sell_api_access` on `customer_api` and
    `deliver_to_partners` refused; from one source's grants.

---

## 9. What this deliberately does not do

- **It does not decide any source's rights.** It is a place to record decisions,
  not a substitute for making them.
- **It does not replace legal review.** `reviewer_type` exists to record that
  distinction, and an `AUTOMATED` reviewer never satisfies a rights review.
- **It does not implement partner-submitted field ownership.** The
  `field_or_field_group` dimension makes it *representable*; whether those
  values carry separate rights is owner decision 2, and it is legal.
- **It does not add plans, prices or invoices.** `account_or_product_plan` is a
  scope key, not a billing entity. ADR-0007 keeps commercial arrangements out of
  this schema and that stands.

---

## 10. What the owner is approving

Approving this ADR means: the shape in §2, deny-by-default and sticky `DENY` in
§3, the evidence requirements in §4, and the backfill-to-`UNKNOWN` in §6. It
does **not** authorise deployment, source acquisition, or any change to what is
currently published — there is nothing published.

Rejecting it means Option A (columns) or the status quo, and the memo's §3 says
what each costs.
