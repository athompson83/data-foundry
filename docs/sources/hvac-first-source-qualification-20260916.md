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
| DOE CCMS | `www.regulations.doe.gov` | **200 only with a browser user agent** | See the correction below |
| Australian Energy Rating | `www.energyrating.gov.au` | **403** | Refused with the same client; could not be qualified from here |
| data.gov.au CKAN search | `data.gov.au` | 404 on the tried path | Endpoint shape unconfirmed; not pursued further |

A first pass using a different fetcher returned 403 for the DOE host too. That
was read at the time as the fetcher's own user agent being refused rather than
the publisher refusing automated access. **A single 403 is not evidence of a
publisher policy** — that methodological point stands, but the specific
conclusion drawn from it was wrong, and is corrected immediately below.

### Correction, measured later the same day

The DOE host was re-probed with four clients against the same URL:

| Client user agent | Result |
| --- | --- |
| `curl/8.5.0` | **403** |
| `Mozilla/5.0` | **403** |
| `data-foundry-research` | **403** |
| Full Chrome desktop UA string | **200** |

A descriptive agent token does not work. Only a complete browser user agent is
served. The earlier cell claiming "reachable with a plain descriptive user
agent" was not reproducible and should not be relied on.

This is a materially different finding from "the fetcher was at fault", and it
is dealt with as a decision rather than an engineering detail under
[access-method acceptability](#access-method-acceptability-and-durability).

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

## Query surface, confirmed from the shipped bundle

Read 2026-09-16 from `/certification-data/ccms-min/main.js?v=20260915022737`:

- Every query is a `POST` to `<solrUrl>select` with `wt=json`.
- The parameters in use are `q`, `fq`, `fl`, `start`, `rows` and `sort`, plus
  facet requests. Filtering, projection, paging, ordering and exact counts are
  therefore all available — the slice model this product needs is supported.
- The equipment-class facet is **`Product_Group_s`**; the application bootstraps
  its class list with `q=Product_Group_s:*`. Other observed fields follow the
  same Solr dynamic-field convention (`Cost_Category_s`, and a bare `oop`).
- CSV export is confirmed client-side: the bundle loads `papaparse` and builds
  the download from result rows. There is no separately published bulk file.

**`solrUrl` is still not resolvable from published assets.** The bundle contains
only AjaxSolr's library default, `http://localhost:8983/solr/`; the real value is
supplied at runtime and is not in the HTML, the bundle, or a fetched config. The
review packet's "exact endpoint/resource IDs" cell therefore **still cannot be
filled from public evidence**, which is the same gap 8 September recorded, now
with the reason rather than the symptom.

## Access-method acceptability and durability

Three observations combine into one decision the reviewer has to make, and it is
not an engineering detail:

1. **The edge serves only browser user agents.** An acquisition pipeline would
   have to present itself as a desktop browser to retrieve anything at all.
2. **The endpoint is internal and unnamed.** It is not a documented API; it is
   the private backend of a search page, discovered by reading the page's own
   JavaScript.
3. **It is unversioned and changes.** The bundle is cache-busted with a
   timestamp — `20260915022737`, the day before this reading. Field names,
   parameters and the endpoint itself can move without notice or deprecation.

What this is **not**: `robots.txt` does not disallow `/certification-data/`, the
records are public, and nothing observed states a prohibition on automated
access. This is not a finding that retrieval is forbidden.

What it **is**: a paid product would rest on an undocumented internal endpoint,
reached by misrepresenting the client, with no stability contract, carrying
records whose accuracy the publisher disclaims and which it says have "no legal
significance". Each of those is survivable alone. Together they describe a
supply chain that can break silently between two-week refresh cycles and that
the publisher never agreed to serve.

The honest options, for the reviewer rather than for engineering:

- **Ask DOE.** The help-and-contact page exists. A short request for the
  supported way to obtain these records in bulk converts every one of the three
  observations above into either a documented path or a clear answer. This
  costs a letter and is the only option that removes the durability risk rather
  than accepting it.
- **Proceed on the public endpoint with the risk recorded**, a descriptive user
  agent that identifies the operator, low request volume, and an explicit
  expectation that the pipeline may break without warning. Note that a
  descriptive agent currently receives 403, so this option as stated may not
  retrieve anything — which is itself the answer to whether the publisher wants
  automated clients.
- **Do not build on it.** Treat CCMS as corroboration for a source that does
  publish a supported interface, rather than as the primary supply.

Engineering's recommendation is the first: **ask before building.** The cost is
days; the alternative is a revenue-bearing pipeline whose upstream never agreed
to be one.

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
6. **Access method.** Is presenting a browser user agent to an undocumented
   internal endpoint an acceptable way to supply a paid product, or must a
   supported path be requested from DOE first? See
   [access-method acceptability](#access-method-acceptability-and-durability).

## Recommendation

Advance DOE CCMS as the first-source candidate and let the Australian register
lapse to "unqualified — unreachable" rather than carrying it as an equal option
it is not. DOE CCMS is structured, filterable, and its scope and provenance
semantics are documented plainly enough to build honest product copy around. Its
limitations are real but they are *describable*, which is what the
rights-and-evidence model needs.

Advance it, however, **with the access question answered first**. The later
measurements in this document weakened the "reachable" claim specifically: it is
reachable by a browser, not by a declared automated client, over an endpoint the
publisher has not published. Sending DOE a short request for a supported bulk
path is the cheapest way to convert that from a standing risk into a fact, and it
can run in parallel with the rights decision rather than after it.

Nothing here approves it. Acquisition stays blocked until a named reviewer
records the decision under `UA-001`.
