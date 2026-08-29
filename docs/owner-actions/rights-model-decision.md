# Owner decision — rights model

## Decision status

The owner accepted corrected Option B: an evidence-backed rights-grant matrix
designed to support field and field-group scope without assuming that such
rights exist. ADR-0010 is accepted and the repository implementation is present
in `packages/rights-engine`, canonical storage, migrations 0014 and 0016, and
the surface/acquisition gates.

This is no longer a choice among Options A, B, and C. The remaining owner/legal
work is to create exact source decisions supported by evidence. Engineering
must not invent those decisions.

## What authorizes an operation

An operation is permitted only when the resolver finds an effective exact
matrix decision for the requested operation, channel, source/publisher identity,
and applicable scope at the request's explicit instant. Positive permission is
bound to current immutable terms evidence, named human/counsel review,
activation, dates, and satisfied structured conditions.

The surface bundles are independent. Relevant examples include:

- acquisition: `ACQUIRE`, `STORE`, and `CACHE` on `INTERNAL_PROCESSING`;
- public display: `PUBLIC_WEB`;
- indexing and sitemap inclusion: `SEARCH_INDEX`;
- direct API: `API_FREE` or `API_PAID`;
- marketplace API: `RAPIDAPI`;
- agent retrieval: `MCP`;
- bulk delivery: `BULK_EXPORT`.

Public display does not imply indexing. Direct paid API does not imply
RapidAPI. RapidAPI does not imply direct API. MCP does not imply any API or
export permission. An empty match is `UNKNOWN`/`NO_GRANT` and refuses.

Legacy `GREEN`/`AMBER` classifications and source-declaration booleans remain
inventory/risk metadata and additional hard stops only. They cannot activate a
matrix decision. Migration 0014 manufactured no publisher mapping, terms
version, evidence, rights cell, decision, or `ALLOW`; it recorded
`REVIEW_REQUIRED` assessments only.

## Required corrections implemented

The accepted design includes all seven corrections from the owner decision:

1. A matching `DENY` is sticky. Only an explicit, independently evidenced,
   strictly narrower exception relationship to that exact denial can clear it;
   an ordinary narrower `ALLOW` never can.
2. Sparse PostgreSQL identities use `UNIQUE NULLS NOT DISTINCT`, with real
   PostgreSQL negative coverage for duplicate nullable scopes.
3. Stable cell identity/current activation is separate from immutable decision,
   terms, evidence, and activation history.
4. Positive permission fails closed when its controlling terms version/hash is
   no longer current, is revoked, expires, or reaches re-review.
5. Automated assessments may record research/negative states but cannot create
   effective positive permission.
6. Resolver precedence is a precise lexicographic ordering with ambiguity,
   cross-dimension, multiple-denial, exception, expiry, and absence controls.
7. Rights are an AND across every relevant provenance contribution and derived
   dependency. One permissive source cannot launder a blocked contributor.

## Recorded owner decisions

| Decision | Current rule |
| --- | --- |
| Partner-submitted values | `UNKNOWN` until explicitly reviewed. Publisher terms do not implicitly cover manufacturer-, supplier-, partner-, or other third-party-submitted fields. |
| ENERGY STAR packet | `DEFERRED`. Keep it `UNDER_REVIEW`, `UNREVIEWED`, unapproved, outside the runtime registry, and without grants. Do not sign, promote, acquire, publish, contact, or initiate publisher outreach. |
| API-key vertical scope | One key maps to exactly one vertical for V1. Future multi-vertical entitlement must be explicit, never a nullable wildcard. |
| HVAC product wording | Use exactly “Manufacturer-reported, as filed with US regulators” for the general regulatory-filing claim. Do not call filings certified, verified, approved, or determined by a regulator unless exact provenance genuinely supports that narrower claim. |
| Publisher outreach | Not authorized in this work package. Existing draft research may remain documentation only; no message, terms acceptance, or outreach initiation follows from it. |

## Current source state

No real HVAC source has an effective reviewed publication/commercial bundle.
The four registered HVAC sources are synthetic fixtures and prove enforcement
mechanics only. Their `GREEN`/`AMBER` inventory labels are statements about
fictional data the project authored, not evidence about a real publisher.

The ENERGY STAR packet and proposed YAML remain evidence/research artifacts. A
validated YAML file, passing CI, a snapshot digest, or `sources:readiness`
inventory output cannot convert them into a grant.

## Readiness evidence

Run the readiness command with a canonical `--as-of`. Current grant evidence
must come from either:

1. live Postgres selected by a named environment variable; or
2. a schema-, metadata-, canonicalization-, and digest-validated qualified
   snapshot whose output remains visibly snapshot-backed.

The snapshot proves integrity of the represented bytes, not authority or
live-current database state. Declarations and fixtures without one of these
evidence modes produce deterministic `UNKNOWN` surface results.

## Non-decisions

The rights engine does not provide legal advice, decide a real source's rights,
approve customer terms, authorize publication, set prices, or approve
ENERGY STAR. It makes recorded decisions auditable and fail-closed; it cannot
create permission that the owner or authorized reviewer has not supplied.
