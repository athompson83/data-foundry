# HVAC first-source technical qualification — 16 September 2026

Status: **documentation and endpoint research only.** No candidate is approved,
acquired, contacted or published. No product row was retrieved. ENERGY STAR
remains deferred and is not a fallback. This record resolves the *technical*
half of the review packet as far as public evidence permits, so the named
reviewer's remaining work is the rights decision rather than engineering
discovery.

Supersedes nothing. It extends
[the 2026-09-08 source review](hvac-source-review-20260908.md) with primary
observations taken today.

## Reachability, measured 2026-09-16

The first thing that changed since 8 September is what can actually be reached
from an automated environment.

| Candidate | Host | Automated GET | Note |
| --- | --- | --- | --- |
| DOE CCMS | `www.regulations.doe.gov` | **200** | Reachable with a plain descriptive user agent |
| Australian Energy Rating | `www.energyrating.gov.au` | **403** | Refused with the same client; could not be qualified from here |
| data.gov.au CKAN search | `data.gov.au` | 404 on the tried path | Endpoint shape unconfirmed; not pursued further |

A first pass using a different fetcher returned 403 for the DOE host too. That
was the fetcher's own user agent being refused, not the publisher refusing
automated access — worth recording because it nearly produced the wrong
conclusion. **A single 403 is not evidence of a publisher policy.**

The Australian register could not be qualified from this environment. That is
an environment-and-publisher observation, not a finding that automated access
is prohibited there; it means the candidate cannot be advanced without either a
different egress or an arrangement with the publisher.

## DOE CCMS — technical qualification

### Access method

The public database is a **Solr-backed search API consumed by a browser
application**, not a static file. Evidence, from the shipped front-end bundle
`/certification-data/ccms-min/main.js` read 2026-09-16:

- The application is built on AjaxSolr (`AjaxSolr.Manager`, `AjaxSolr.Parameter`).
- Responses are JSON (`&wt=json`) and carry Solr's `response.numFound`.
- The store exposes `fq`, `q` and `start`, so results are **filterable and
  paginated** rather than all-or-nothing.
- A `DownloadResultsWidget` implements "Download all data in CSV format"; the
  CSV is assembled client-side from result rows, so it is a view of the query,
  not a separately published bulk file.

**Unresolved:** the concrete Solr base URL is resolved at runtime rather than
hardcoded in the bundle or the static HTML, so it was not captured here. It has
to be confirmed during implementation, and named exactly in the review packet's
"exact endpoint/resource IDs" cell before approval.

### Fit against the ingestion limits

This is the decisive engineering question and it has a good answer. The
release's `INGESTION_LIMITS` are 16 artifacts, 1 MiB each, 4 MiB total, 1,000
records and a 32 KiB receipt.

A complete equipment class is far larger than 1,000 records, so **the class as a
whole cannot be a delivery**. Because the endpoint supports Solr `fq` filtering
with an exact `numFound`, a slice can be defined that is genuinely complete in
its own terms — for example one equipment class narrowed by manufacturer or
another indexed facet — and its size confirmed *before* acquisition rather than
discovered by truncation.

That matters beyond capacity: the pipeline treats records omitted from a
complete snapshot as retirements. A truncated class would therefore read as mass
retirement of everything past the cut. The snapshot boundary must be the filter,
not the page size, and the acquisition target must declare that filter.

**Repository gap this exposes:** `SourceRegistryEntry` has no query-filter
field, which is the same gap the ENERGY STAR packet recorded. Approving any
filtered source requires either adding that field or declaring the filter inside
the target URL. This is a small, contained change, but it is a change, and it
should be decided with the source rather than discovered during ingestion.

### Refresh characteristics

Quoted from the database home page, read 2026-09-16:

- "the certification database will be updated approximately **every two weeks**
  to allow DOE time to actively review all submissions", although "manufacturers
  may submit new information daily".

Consequences the operational policy should absorb:

- A 12-hour conditional check is defensible but will return unchanged for most
  cycles. Conditional-GET support on the Solr endpoint is **unconfirmed** and
  must be measured; if absent, freshness has to come from comparing a stable
  digest rather than from a 304.
- The release's two-hour detection-to-publication target is a *pipeline* metric.
  Against a two-week upstream cadence it must never be presented to a customer
  as data freshness.

### Coverage and provenance semantics

Quoted from the same page:

- "The public certification database houses only certification records of
  **current basic models that have been submitted within the past year**."
- "The data provided are the representations **certified to DOE by manufacturers
  and their third party representatives**. DOE makes no representations or
  warranties regarding the accuracy of the data."
- "The public certification database **has no legal significance**."

Three hard product constraints follow, each of which the release already has
machinery to honour and none of which may be softened in customer-facing copy:

1. **Absence is not discontinuation.** A model missing from the database may
   simply not have been submitted within the past year. Absence from a filtered
   snapshot means even less. Retirement semantics must be scoped to the declared
   filter and never presented as "no longer manufactured".
2. **This is self-certification, not independent testing.** It may never be
   described as certification *by* DOE, independent verification, or third-party
   test results.
3. **Accuracy is disclaimed at source.** Published facts must carry that
   provenance, and the accuracy disclaimer belongs in the coverage limitations
   a customer sees.

### Automated-access etiquette

`https://www.regulations.doe.gov/robots.txt`, read 2026-09-16, disallows only
`/@search`, `/@@search` and `/search`, and publishes a sitemap. The
`/certification-data/` paths are not disallowed. No crawl-delay is specified.

`robots.txt` is neither a licence nor permission to redistribute. It answers the
packet's "robots/rate-limit requirements" cell and nothing else.

## What is still the reviewer's to decide

Engineering has taken this as far as public evidence allows. The remaining
questions are legal and commercial, and none of them can be inferred from a
public URL, a government host, a permissive `robots.txt` or an open endpoint:

1. **Rights basis for paid redistribution.** US Government works are generally
   public domain, but the DOE web policy notes that contributed or licensed
   private material can be protected. These records are manufacturer
   submissions hosted by a government body. What is the precise basis for
   redistributing the selected values to paying subscribers?
2. **Per-surface decisions.** Public web, search indexing, free API, paid API,
   RapidAPI, MCP retrieval and bulk export each need their own answer. Images
   default off.
3. **The equipment slice.** Which class, and which filter defines a complete
   snapshot?
4. **Attribution and disclaimer text.** What exact wording must accompany
   published facts, given the accuracy disclaimer and the no-legal-significance
   statement?
5. **Review expiry.** Who is the named reviewer, with what authority, and when
   is the decision revisited?

## Recommendation

Advance DOE CCMS as the first-source candidate and let the Australian register
lapse to "unqualified — unreachable" rather than carrying it as an equal option
it is not. DOE CCMS is reachable, structured, filterable, and its scope and
provenance semantics are documented plainly enough to build honest product copy
around. Its limitations are real but they are *describable*, which is what the
rights-and-evidence model needs.

Nothing here approves it. Acquisition stays blocked until a named reviewer
records the decision under `UA-001`.
