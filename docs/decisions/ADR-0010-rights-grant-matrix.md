# ADR-0010 — Surface-aware rights-grant matrix

**Status:** ACCEPTED

**Original proposal:** 2026-08-23

**Acceptance recorded:** 2026-08-28

**Relates to:** `docs/owner-actions/rights-model-decision.md`, ADR-0007

**Implemented by:** `packages/canonical-schema/src/rights.ts`,
`packages/rights-engine/`, `packages/canonical-store/`,
`packages/query-model/`, migrations `0014`, `0016`, and `0019`, and the
scheduled-acquisition enforcement path. Migration `0023` and the query layer's
current-identity gates provide a separate identity-currentness prerequisite;
migration `0025` binds a source alias claim to exact immutable evidence so its
source participates in surface authorization. Neither migration creates
rights.

> This is an engineering control architecture, not a legal review. It records
> rights conclusions reached through the required review process; it does not
> create those conclusions. Acceptance of this ADR does not approve a source,
> authorize acquisition or publication, or establish that any licence covers a
> Data Foundry surface.

## 1. Decision

Data Foundry uses a sparse, fail-closed rights-grant matrix. A rights decision
applies to one stable scope cell and one exact operation/channel pair. No row
means no permission. Permission for one operation, channel, output class,
field, route, plan, or jurisdiction never implies permission for a neighboring
one.

This replaces the legacy all-or-nothing interpretation of
`commercial_use_allowed`, `redistribution_allowed`, and
`derivative_normalization_allowed`. Those declarations remain legacy metadata
during transition; they cannot create a matrix `ALLOW`.

The accepted design is Option B with field-level Option C semantics available
in the schema. Field-level capability is not a field-level grant. In particular,
manufacturer-, supplier-, certification-body-, partner-, or other third-party-
submitted values remain `UNKNOWN`/review-required unless an independently
supported decision covers their exact field or field group.

## 2. Decision vocabulary and runtime effect

| State | Runtime effect | Meaning |
| --- | --- | --- |
| `ALLOW` | Permit only when the decision, review, activation, terms, and dates are all effective | Affirmative permission is on record |
| `DENY` | Refuse | A prohibition is on record |
| `CONDITIONAL` | Refuse unless every structured condition has a current trusted receipt and required audit evidence | Permission carries enforceable obligations |
| `UNKNOWN` | Refuse | No affirmative answer has been established |
| `NOT_APPLICABLE` | Refuse, reported distinctly from `UNKNOWN` | The operation does not apply to this scope |

The resolver returns a machine-readable reason, selected cell and decision,
controlling terms version, blockers, applied exception relationships, unmet
conditions, and auditable obligations. Malformed input, malformed snapshots,
missing provenance, or ambiguous resolution refuse rather than degrade to a
default.

The existing coarse source guards remain additional hard stops. A prohibited
source, engaged kill switch, disallowed lifecycle status, `RED` or `UNREVIEWED`
classification, or missing evidenced publisher mapping cannot be rescued by a
matrix row.

## 3. Matrix axes

### 3.1 Sparse scope

Each `rights_cells` row names exactly one publisher or one source and may narrow
that identity with:

- acquisition route;
- account or product plan;
- jurisdiction;
- asset class;
- one field key or one source-owned, non-overlapping field group; and
- output class.

Unset optional dimensions match any request value, but do not create a grant
for an unrecorded operation or channel. Field scopes require a source; a field
key and field group cannot both be set.

Acquisition routes are `DIRECT_HTTP`, `BROWSER_RUN`, `CRAWL4AI`, `VENDOR_API`,
`SITEMAP`, `BULK_FILE`, `RSS`, and `MANUAL_UPLOAD`.

Asset classes are `DATA`, `DOCUMENT`, `IMAGE`, `TRADEMARK`, and `PERSONAL_DATA`.
Output classes are `RAW_RECORD`, `NORMALIZED_FACT`, `DERIVED_METRIC`, `METADATA`,
`IMAGE_OR_MEDIA`, and `PERSONAL_DATA`.

### 3.2 Operations and channels

Operations are:

`ACQUIRE` · `STORE` · `NORMALIZE` · `DERIVE` · `DISPLAY_PUBLICLY` ·
`BUILD_COMPARISON_TOOLS` · `QUOTE_OR_EXCERPT` · `SERVE_API_ACCESS` ·
`SELL_API_ACCESS` · `REDISTRIBUTE_RAW` · `REDISTRIBUTE_NORMALIZED` ·
`OFFER_BULK_EXPORT` · `SUBLICENSE_ACCESS` · `LLM_RETRIEVAL` ·
`DELIVER_TO_PARTNERS` · `TRAIN_MODELS` · `EVALUATE_MODELS` · `CACHE` ·
`RETAIN_AFTER_TERMINATION`.

Channels are:

`INTERNAL_PROCESSING` · `PUBLIC_WEBSITE` · `SEARCH_INDEX` ·
`DIRECT_CUSTOMER_API` · `RAPIDAPI_MARKETPLACE` · `MCP_AGENT` ·
`BULK_DOWNLOAD` · `PARTNER_DELIVERY` · `MODEL_PIPELINE`.

Operations and channels are separate axes because a commercial surface can
require several independent permissions. The code defines explicit AND-bundles:

| Surface | Required operation/channel decisions |
| --- | --- |
| `PUBLIC_WEB` | `DISPLAY_PUBLICLY` / `PUBLIC_WEBSITE` |
| `SEARCH_INDEX` | `DISPLAY_PUBLICLY` / `SEARCH_INDEX` |
| `API_FREE` | `SERVE_API_ACCESS` / `DIRECT_CUSTOMER_API` |
| `API_PAID` | API service + `SELL_API_ACCESS` + `REDISTRIBUTE_NORMALIZED`, all on `DIRECT_CUSTOMER_API` |
| `RAPIDAPI` | API service + sale + normalized redistribution + `SUBLICENSE_ACCESS`, all on `RAPIDAPI_MARKETPLACE` |
| `MCP` | `LLM_RETRIEVAL` / `MCP_AGENT` |
| `BULK_EXPORT` | `OFFER_BULK_EXPORT` + normalized redistribution on `BULK_DOWNLOAD` |
| `PARTNER_DELIVERY` | partner delivery + sublicense on `PARTNER_DELIVERY` |
| `MODEL_TRAINING` | `TRAIN_MODELS` / `MODEL_PIPELINE` |
| `MODEL_EVALUATION` | `EVALUATE_MODELS` / `MODEL_PIPELINE` |

These bundles are entitlements, not a hierarchy. Public-web permission does not
authorize a free API. Direct paid-API permission does not authorize RapidAPI.
API service permission alone does not authorize selling or redistribution.

## 4. Immutable storage and current activation

The PostgreSQL model separates stable identity from immutable history:

- `rights_publishers` records stable publisher identity. A source-to-publisher
  mapping requires independent evidence and a human/counsel reviewer. The
  resolver refuses unmapped sources, and an evidenced mapping cannot be added
  or changed after source rights history exists.
- `rights_evidence_artifacts` stores immutable content hashes and storage
  pointers for terms, agreements, policies, correspondence, and review memos.
- `rights_terms_cells`, `rights_terms_versions`, and append-only terms activation
  events preserve every terms version while exposing one current state per cell.
- `rights_cells` records the stable sparse matrix identity.
- `rights_decisions` records immutable decision versions. Append-only activation
  events select one unambiguous current decision for a cell; a replacement must
  explicitly supersede the previous current decision in the same cell.
- `rights_decision_conditions` freezes structured condition definitions when a
  decision is first activated.
- `rights_deny_exceptions` records the exceptional relationship described in
  §5, rather than mutating either decision.

All nullable scope identity indexes use PostgreSQL
`UNIQUE ... NULLS NOT DISTINCT`. Therefore two all-null or partially-null
representations of the same scope are duplicates on PostgreSQL 16, not distinct
rows that evade uniqueness. Real-PostgreSQL negative tests cover duplicate
terms scopes and duplicate matrix cells.

Rights, terms, activation, exception, field-group, migration-assessment, entity-
evidence, and fact-dependency history tables reject update, delete, and truncate.
Historical evidence is never silently rewritten.

## 5. Sticky `DENY` and explicit narrow exceptions

`DENY` is sticky by default. An ordinary, more-specific `ALLOW` or
`CONDITIONAL` never overrides any matching denial. Every matching denial is
evaluated; clearing one denial does not clear another.

A genuine lawful exception is representable only by an explicit
`rights_deny_exceptions` relationship that:

1. names one exact current `DENY` decision and one matching `ALLOW` or
   `CONDITIONAL` decision;
2. keeps the same operation and channel;
3. is a strict, non-widening subset of the denied identity and every scope
   dimension;
4. carries independent relationship evidence whose artifact and content hash
   are distinct from both decisions' evidence;
5. records a human or counsel reviewer, clause, effective window, expiry or
   re-review date, and reviewer provenance; and
6. is itself current while the exception decision independently resolves to an
   effective permission.

An equal, broader, cross-operation, cross-channel, stale, automated, weakly
evidenced, or incorrectly mapped exception refuses. A conservative current
`DENY` remains blocking when its supporting terms are old; it must be explicitly
superseded or validly excepted rather than expiring into permission.

This resolves RIGHTS-ADR-001 without weakening sticky-deny semantics.

## 6. Precise resolution order

For a request tuple, the resolver executes this order:

1. Validate the request and snapshot. Invalid structures return
   `MALFORMED_SNAPSHOT`.
2. Apply the source hard stops in §2.
3. Select cells matching the exact operation and channel, publisher/source
   identity, and every populated scope dimension. No match returns `NO_GRANT`
   with state `UNKNOWN`.
4. Evaluate every matching `DENY`. Any denial lacking a valid exact exception
   returns `STICKY_DENY` and names all remaining blocking decision IDs.
5. Remove denied candidates. Sort remaining candidates by the following
   lexicographic specificity vector, most specific first:

   ```text
   field key (2) > field group (1) > unset (0),
   then output class,
   then asset class,
   then acquisition route,
   then account or product plan,
   then jurisdiction,
   then source identity over publisher identity
   ```

   Each later component breaks a tie only when all earlier components are
   equal. Specificity is not the count of populated dimensions. An equal vector
   remaining after database and snapshot validation returns `AMBIGUOUS_SCOPE`;
   IDs are never a hidden tie-breaker.
6. Evaluate the selected decision's activation, review, terms, dates, and
   conditions. Only `ALLOW` and fully satisfied `CONDITIONAL` return permitted.

Adversarial tests cover cross-dimension precedence, equal scope shapes, multiple
matching denials, strict exceptions, expiry/re-review, and absence. This resolves
RIGHTS-ADR-002 and RIGHTS-ADR-006 together with the database identity rules.

## 7. Terms, review, and conditions

Positive permission is bound to an immutable controlling terms version whose
SHA-256 must equal its immutable evidence artifact hash and whose terms scope
must cover the decision cell. That terms version must still be the current,
active, effective version, activated by a human or counsel, and not expired or
due for re-review. Superseding terms explicitly name the previous current
version; revocation is terminal for the revoked version.

An `ALLOW` or `CONDITIONAL` decision also requires:

- review status `APPROVED` by a named `HUMAN` or `COUNSEL` reviewer;
- activation by that reviewer type and identity after review;
- an effective window and future re-review time;
- the exact current terms binding, evidence artifact, and clause reference; and
- for `CONDITIONAL`, at least one frozen structured condition.

`AUTOMATED` assessments may record `UNKNOWN`, `DENY`, or research findings. They
cannot activate effective `ALLOW` or `CONDITIONAL` permission, and the runtime
rejects automated positive reviews or activations even if malformed data evades
one storage boundary. This resolves RIGHTS-ADR-004 and RIGHTS-ADR-005.

A condition is satisfied only by a trusted server-computed receipt matching the
condition ID, evaluator key and version, parameters SHA-256, and exact canonical
parameters. It must be current, explicitly satisfied, and carry an audit
reference when required. Client input is never a trusted receipt. Unknown
evaluators, stale or mismatched receipts, missing audit evidence, or an empty
condition list refuse.

## 8. All provenance contributions must authorize

Rights are evaluated as an AND across every relevant contribution and every
required surface intent. One permissive source cannot launder a blocked source.
An empty contribution set refuses as `MISSING_PROVENANCE`.

The persistence model records exact entity evidence and fact evidence, and
`fact_dependencies` records the input DAG for derived facts. Derived output must
authorize the derived fact and recursively authorize every contributing input;
cycles are rejected. A canonical candidate or relationship with multiple source
contributions is withheld in full when any contribution lacks the exact grants.
This resolves RIGHTS-ADR-007.

Fact validity and publication authorization use separate clocks. `policy.at`
selects the exact immutable fact version. The surface authorizer loads that fact
and its recursive dependencies by ID even when now superseded, then evaluates
source status, terms, and grants at the response or export `asOf`. It never
substitutes the currently valid fact; failure to authorize the exact historical
provenance refuses the output.

Identity and relationship currency are separate fail-closed prerequisites.
Resolution and search consume `current_entity_aliases`, whose rows require an
open curated claim or a claim from a current `FINALIZED` source-record revision
in the alias's current authority epoch. Customer-facing entity authorization
requires at least one current `FINALIZED` entity-evidence row before evaluating
the retained entity contributions. Relationship authorization evaluates only
current `FINALIZED` relationship contributions and also requires both endpoint
entities to authorize. Historical rows remain auditable, but a withdrawn sole
identity or edge cannot remain visible merely because its storage row survives.
These gates prove current provenance support, not legal permission; the exact
surface bundle still resolves across the applicable contributions.

Source-record reconciliation persists `source-record-evidence@3`, covering the
exact entity/manufacturer targets, accepted alias values and locators, fact
projections, resolution audit, and relationship disposition/endpoints/writer.
An exact replay remains a no-op; a semantic/evidence change creates an immutable
successor. When a refresh has no usable strong identifier, it still finalizes a
zero-claim successor and withdraws the prior source-only current support rather
than leaving the old revision authoritative or creating a phantom entity.

## 9. Migration semantics

Migration `0014_rights_grant_matrix.sql` creates no `ALLOW` from legacy
classifications or booleans. Every existing source receives only an immutable
`REVIEW_REQUIRED` migration assessment. No publisher mapping, terms record,
rights cell, decision, evidence row, or grant is fabricated.

New acquisition artifacts record immutable acquisition route, plan,
jurisdiction, and the exact durable policy snapshot so later rights resolution
cannot silently reinterpret how bytes were obtained. Legacy artifact scope that
cannot be truthfully backfilled remains unmanufactured and fail-closed.

Forward migration `0016_core_rights_hardening.sql` applies the same rule to
operational and derived-output state. Existing sources receive no guessed kill
switch value, existing facts receive no inferred output kind, and neither state
may authorize a distribution query while NULL. A referenced field group's
membership is sealed, and newly classified derived facts must commit their
complete dependency set atomically; later membership or dependency mutation
requires a new immutable lineage rather than changing the meaning of history.

Forward migration `0019_scheduled_acquisition_pre_persistence.sql` leaves every
pre-existing scheduled run at immutable receipt contract v1 with its three
successful-checkpoint contract. Every new claim is immutable contract v2 and
requires four ordered checkpoints: `INITIAL`, `PRE_PROVIDER`, `PRE_TRANSPORT`,
and `PRE_PERSISTENCE`. The migration manufactures no fourth checkpoint for an
existing run, and a refusal may end either contract at the checkpoint where the
current rights resolver refuses.

Forward migration `0023_entity_alias_claim_currentness.sql` adds immutable
alias-claim history and an authority epoch advanced exactly once on each alias
validity transition. A claim must cite the alias's current epoch; a source claim
must cite a current `FINALIZED` source-record revision and derive its source
identity from that record. The migration deliberately creates no claim from
legacy `entity_aliases.source_id` or any other historical display field, so
unknown old authority remains fail-closed. Retiring and reopening an alias
cannot reactivate a prior-epoch assertion.

Forward migration `0025_alias_claim_evidence_gate.sql` requires each
source-record alias claim to cite one exact immutable `ALIAS` entity-evidence
row before it enters `current_entity_aliases`. The claim, entity, source-record,
and locator must match. Existing unlinked rows are not backfilled or inferred;
they remain historical-only until a rights-admitted reingest records an exact
pair. This makes the alias's contributing source part of the ordinary
surface-rights AND rather than allowing a claim-only spelling to ride on an
independently authorized entity.

Customer query operations execute authorization and projection inside one
fresh `REPEATABLE READ`, read-only database snapshot. This makes the source AND
atomic with identifier lookup, search, facts, relationships, comparison, and
facets: a contribution committed mid-operation cannot enter the response after
authorization evaluated an older contribution set.

This resolves RIGHTS-ADR-003 by preserving immutable versions while selecting
one current activation, rather than combining mutable `superseded_by` fields
with a one-row-per-cell table.

## 10. Required negative controls

The implementation must continue to prove at least these cases:

1. Absence, explicit `UNKNOWN`, and `NOT_APPLICABLE` all refuse and remain
   distinguishable.
2. Public web does not imply free API, paid API, RapidAPI, MCP, bulk export,
   partner delivery, model training, or evaluation.
3. `SERVE_API_ACCESS` does not imply sale, redistribution, or sublicense.
4. Channel, route, plan, jurisdiction, asset, output, and neighboring field
   permissions do not imply one another.
5. Every matching `DENY` remains sticky unless its exact, independently
   evidenced, strict-narrow exception is effective.
6. PostgreSQL refuses duplicate sparse terms and rights cells with null scope
   dimensions.
7. Superseding, revocation, activation, expiry, and re-review changes fail
   positive permission closed without mutating history.
8. Automated positive permission, unknown condition evaluators, invalid or stale
   condition receipts, and missing audit references refuse.
9. Any unauthorized provenance contribution blocks the complete emitted fact,
   relationship, or derived output.
10. Legacy migration records review work but manufactures no permission.
11. Scheduled acquisition re-runs the complete stored ACQUIRE/STORE/CACHE
     resolver after transport and result-manifest validation, immediately before
     the first artifact write or a NOT_MODIFIED freshness success; revocation at
     that boundary refuses the run and leaves no new artifact or freshness.
12. Historical selection loads the exact selected fact and every recursive
    contributor by immutable ID while current publication rights govern; a
    now-superseded fact is never silently replaced by its current successor.
13. Legacy aliases receive no manufactured claim; withdrawn source-only aliases
    leave the current lookup relation, and retire/reopen cannot reactivate an
    older authority epoch.
14. An entity or relationship without current `FINALIZED` supporting evidence
    is withheld even though its immutable history remains stored.
15. A refresh with no usable strong identifier finalizes a zero-claim successor,
    creates no phantom canonical authority, and cannot leave the superseded
    revision current by omission.
16. A source-record alias claim without exact linked `ALIAS` evidence is absent
    from resolution and search; mismatched evidence is rejected, an ungranted
    alias source blocks the entity on that surface, and migration creates no
    legacy linkage by inference.

## 11. Owner decisions recorded with acceptance

- **Partner-submitted values:** `UNKNOWN` until explicitly reviewed. The field
  and field-group schema supports a later evidenced decision but creates no
  implicit grant.
- **ENERGY STAR:** deferred. Do not sign, promote, acquire as ready, or publish
  the proposed source until the partner-submitted-rights question receives the
  required human review. Synthetic fixture verification may continue.
- **API-key vertical scope:** one API key maps to exactly one vertical for V1.
  Rights scope and customer access entitlement are separate controls; future
  multi-vertical entitlement must be explicit, not a nullable `vertical_id`.
- **HVAC product wording:** regulatory-filing values may be described as
  “Manufacturer-reported, as filed with US regulators.” They must not be called
  certified, verified, approved, or determined by the regulator unless exact
  provenance supports that claim.
- **Publisher outreach:** not authorized in this work package. No communication
  or terms acceptance follows from this ADR.

## 12. Consequences and non-goals

The free public surface may be broader than a paid API or marketplace surface
when independently reviewed grants permit public display but not paid
distribution. That is an intentional consequence of surface-specific
enforcement, not a reason to infer paid rights from web rights.

This ADR does not decide any real source's rights, replace counsel or owner
review, approve the ENERGY STAR packet, authorize publisher contact, define
plans or prices, create invoices, or make a provisioned API/MCP credential into
a data grant. It provides the auditable mechanism that keeps those decisions
independent and fail-closed.
