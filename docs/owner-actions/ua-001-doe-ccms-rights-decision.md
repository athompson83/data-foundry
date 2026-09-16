# Owner action — UA-001 rights decision sheet (DOE CCMS, first equipment slice)

Prepared 2026-09-16. **Nothing here approves anything.** This is the form of the
decision engineering needs, with every cell it cannot fill left empty, so the
named reviewer can answer once rather than in fragments.

Technical qualification is finished and lives in
[the source qualification record](../sources/hvac-first-source-qualification-20260916.md).
Read its **access-method acceptability** section before signing: it raises a
question that may change the answer to this whole sheet.

## The minimum that earns revenue

The resolver requires an exact effective decision per operation *and* channel.
**Seven cells are required** for a paid direct API — no fewer. Everything else
can stay `UNKNOWN` and the product still works, because an empty match refuses,
which is the correct default rather than a gap to be filled for completeness.

Seven and not six: `API_PAID` in `packages/rights-engine/src/surfaces.ts` is an
AND-bundle of three `DIRECT_CUSTOMER_API` requirements — `SERVE_API_ACCESS`,
`SELL_API_ACCESS` **and** `REDISTRIBUTE_NORMALIZED` — and that third one is
unconditional. It does not depend on how the response is characterised, so a
decision that returns only the first six fails closed on every normalized API
request.

| # | Operation | Channel | Needed for first revenue | Decision | Conditions |
| --- | --- | --- | --- | --- | --- |
| 1 | `ACQUIRE` | `INTERNAL_PROCESSING` | required | | |
| 2 | `STORE` | `INTERNAL_PROCESSING` | required | | |
| 3 | `CACHE` | `INTERNAL_PROCESSING` | required | | |
| 4 | `NORMALIZE` | `INTERNAL_PROCESSING` | required | | |
| 5 | `SERVE_API_ACCESS` | `DIRECT_CUSTOMER_API` | required | | |
| 6 | `SELL_API_ACCESS` | `DIRECT_CUSTOMER_API` | **required — this is the revenue cell** | | |
| 7 | `REDISTRIBUTE_NORMALIZED` | `DIRECT_CUSTOMER_API` | **required — not conditional** | | |

Decide each as `ALLOW`, `DENY`, `CONDITIONAL` or leave blank for `UNKNOWN`.
A `DENY` is sticky and only a narrower, independently evidenced exception clears
it, so do not use `DENY` as shorthand for "not yet".

## Deliberately deferred — leave blank unless you want them now

| Operation | Channel | Note |
| --- | --- | --- |
| `DISPLAY_PUBLICLY` | `PUBLIC_WEBSITE` | Public display does not follow from paid API permission |
| `DISPLAY_PUBLICLY` | `SEARCH_INDEX` | Indexing is a separate decision from display |
| `SELL_API_ACCESS` | `RAPIDAPI_MARKETPLACE` | Needs `UA-004` as well; a direct-API grant never implies it |
| `LLM_RETRIEVAL` | `MCP_AGENT` | Agent retrieval implies no API or export right |
| `OFFER_BULK_EXPORT` | `BULK_DOWNLOAD` | Bulk is the highest-leverage and highest-risk surface |
| `REDISTRIBUTE_RAW` | any | Raw redistribution is a distinct question from normalized facts |
| `TRAIN_MODELS` / `EVALUATE_MODELS` | `MODEL_PIPELINE` | Default off |
| `SUBLICENSE_ACCESS` | any | Default off |
| `DELIVER_TO_PARTNERS` | `PARTNER_DELIVERY` | Default off |

## Output classes in scope

| Class | Proposed | Your decision |
| --- | --- | --- |
| `NORMALIZED_FACT` | in scope | |
| `METADATA` | in scope | |
| `RAW_RECORD` | out of scope for the first slice | |
| `DERIVED_METRIC` | out of scope until a metric is actually defined | |
| `IMAGE_OR_MEDIA` | **off** | |
| `PERSONAL_DATA` | **off** | |

## The slice

The snapshot boundary must be the **filter**, not the page size — records absent
from a complete snapshot are read as retirements, so a truncated class would
publish as mass discontinuation.

| Field | Value |
| --- | --- |
| Equipment class (`Product_Group_s` value) | |
| Additional filter defining completeness | |
| Expected record count under that filter | |
| Exact endpoint / resource ID | **cannot be filled from public evidence — see qualification record** |

Approving a filtered source needs either a query-filter field on
`SourceRegistryEntry` or the filter declared inside the target URL. That is a
small contained change, but it is a change, and it should be decided here rather
than discovered during ingestion.

## Mandatory customer-facing wording

These follow from the publisher's own statements and may not be softened:

- Absence from the data is **not** discontinuation — models are only present if
  submitted within the past year, and absence from a *filtered* snapshot means
  less still.
- This is **manufacturer self-certification**, never "certified by DOE",
  independent verification, or third-party test results.
- Accuracy is **disclaimed at source**, and the publisher states the database
  "has no legal significance".
- Refresh is approximately **two-weekly upstream**. The pipeline's two-hour
  detection-to-publication target is an internal metric and must never be
  presented to a customer as data freshness.

| Field | Value |
| --- | --- |
| Exact attribution line | |
| Exact disclaimer text | |

## Rights basis and review record

| Field | Value |
| --- | --- |
| Rights basis for paid redistribution | |
| Immutable terms evidence (URL + retrieval date + hash) | |
| Named reviewer | |
| Reviewer type (`HUMAN` / `COUNSEL`) | |
| Decision date | |
| Activation date | |
| Review expiry / revisit date | |

US Government works are generally public domain, but DOE's web policy notes that
contributed or licensed private material can be protected — and these records are
manufacturer submissions hosted by a government body. Government hosting, a
permissive `robots.txt`, a public search interface and a successful HTTP
retrieval are **none of them** commercial redistribution authority. The basis has
to be stated positively.

## After this sheet is returned

Engineering records the decision with its evidence, adds the query-filter
capability if the slice needs one, and acquisition unblocks for that slice only.
Until then the source stays inactive and no record is retrieved.
