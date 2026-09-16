# Owner action — UA-001 first-source decision, 2026-09-16

Three candidates, compared on evidence measured today rather than inherited from
earlier research. **Nothing here activates anything.** No source is acquired,
published, promoted or contacted, and no rights cell is filled by engineering.

This sheet supersedes the candidate comparison in the earlier CCMS sheet. That
sheet's *structure* — seven operation/channel cells, exact fields,
transformations, retention, refresh, downstream permissions — still applies to
whichever candidate you select.

## Correction to what I told you earlier today

I reported ENERGY STAR as newly discovered. **It was not.** This repository has
carried it as a proposed source since before this session, deferred with the
reason recorded in `PROJECT_CHECKLIST.md`: *"Partner-submitted field rights
remain unknown."* There is a detailed review packet at
[`energy-star-air-source-heat-pumps-review-packet.md`](../sources/energy-star-air-source-heat-pumps-review-packet.md)
and a draft declaration at `docs/sources/proposed/energy-star-heat-pumps.yaml`
held at `UNDER_REVIEW` / `UNREVIEWED`.

What *is* new is the measured access posture, and one piece of rights evidence
that materially changes the prior assessment. The candidate is not new and the
blocking question was already correctly identified.

## The comparison

| | **DOE CCMS** | **ENERGY STAR** | **AU Energy Rating** |
| --- | --- | --- | --- |
| **Publisher** | US DOE | US EPA | Australian Government DCCEEW |
| **Supported access path** | **None found.** Undocumented Solr endpoint behind a browser-only edge | SODA API on Socrata: JSON/CSV/XML, `$select`/`$where`/`$limit` | CKAN API on `data.gov.au` + dated CSV downloads |
| **Reachable by an honest agent?** | **No — 403, including `robots.txt` itself** | **Yes — 200** on `/api/` and `/resource/` | **Yes — 200** on API and resource downloads |
| **Permitted by `robots.txt`?** | **Unknowable** — the policy file itself is 403 | **Yes** — only `/browse?*` variants disallowed | **No — `User-agent: * / Disallow: /`, the entire host** |
| **Licence** | None locatable | EPA Standard Open Data License, **attached per-dataset** in federal Common Core metadata | **CC-BY 3.0 AU**, explicit `license_url` |
| **Commercial redistribution** | Unknown | **Unresolved** — see §"The one question" | **Permitted with attribution** |
| **Population** | Mandatory US compliance certification | **Voluntary** label — a higher-efficiency subset | Mandatory AU/NZ registration, labelled **and** non-labelled |
| **Market** | US | US | **AU / NZ** |
| **Refresh cadence** | Unknown | **Unknown** — `rowsUpdatedAt` was today, which is one observation | **Unknown** — dated files seen 2026-08-23 and 2026-09-16; two observations establish no frequency |
| **Field origin documented?** | No | Partly — column labels name partner and CB origin | **Yes — DOCX data dictionaries per category** |
| **Bulk export** | None | Socrata CSV export | Direct CSV, 5.96 MB for air conditioners alone |
| **Technical stability** | Cache-busted bundle, re-versioned without notice | Stable asset IDs; portal root 301s but asset URLs persist | Stable CKAN IDs; **but see the platform-replacement risk** |
| **Ingestion compatibility** | US DOE metrics, matches the dictionary | US DOE metrics (`seer2`, `eer2`, `hspf2`), matches the dictionary | **Mismatch** — AS/NZS star ratings and kW, different test procedures, not convertible |

## DOE CCMS — the access question is now worse, not merely unresolved

Measured today with a descriptive agent (`data-foundry-research`):

```
https://www.regulations.doe.gov/robots.txt                       403
https://www.regulations.doe.gov/ccms                             403
https://www.regulations.doe.gov/ccms/help/help-and-contact-...   403
```

**The edge returns 403 for `robots.txt` itself.** That is qualitatively
different from "the site blocks scrapers": we cannot read the publisher's own
machine-readable access policy without impersonating a browser. Any claim that
crawling is permitted would have to be obtained by doing the very thing whose
permissibility is in question.

Separately, the supported-export question is now answered in the negative for
the cheapest route: **CCMS has no data.gov catalogue entry.** All 112 sitemap
shards were enumerated — 559,455 URLs — and no CCMS dataset appears. The
catalogue's own API is unusable (every route returns a non-CKAN
`{"detail":{},"message":"Not Found"}`; its `robots.txt` still carries literal
`# TODO` placeholder text), so the sitemap was the only remaining self-service
route.

**Conclusion:** there is no documented export or bulk mechanism we can find, and
no lawful way to establish crawl permission from here. The undocumented
browser-UA route and a supported route are not two options — only the first
exists, and the owner has already refused it for production. The
[prepared inquiry](../sources/doe-ccms-access-inquiry-draft.md) remains the only
route to a supported path, and it remains unsent pending your authorization.

## ENERGY STAR — the blocker is exactly where the packet left it

**Correction — this is not new evidence, and it does not narrow the blocker.**
An earlier draft of this sheet presented the licence attachment as a new finding
that materially narrowed the question. That was wrong, and a reviewer caught it.
The review packet **already records** `Licence pointer:
https://edg.epa.gov/EPA_Data_License.html` as **[VERIFIED]** (§1), already
reproduces the licence text verbatim (§3), and already analyses the exact
EPA-produced-versus-partner-submitted scope problem (§4). Nothing measured this
session moved the legal question.

What this session actually added is narrower and worth having, but it is
freshness rather than substance: the licence pointer is attached per-dataset in
federal Common Core metadata and is **systematic across six datasets** rather
than recorded for one, and the licence text is **unchanged as of today**:

```
"Common Core": {
  "License":   "https://edg.epa.gov/EPA_Data_License.html",
  "Publisher": "U.S. Environmental Protection Agency",
  "Contact Email": "certification@energystar.gov",
  "Program Code": "020:033", "Bureau Code": "020:00"
}
```

**Why the question is exactly as open as the packet already said.** The licence
text is scoped by its own wording:

> "Unless otherwise specified, all data **produced by the U.S EPA** is by default
> in the public domain and is not subject to domestic copyright protection under
> 17 U.S.C. § 105."

§105 removes copyright from works of the **U.S. Government**. The packet's §4
analysis holds: brand and model identifiers, performance ratings, capacities and
connectivity fields are **partner- or certification-body-submitted**, evidenced by
the dataset's own column labels (`energy_star_partner`, `manufacturer_type`,
`energy_star_model_identifier` labelled *"CB Model Identifier"*). An agency can
license only what it holds.

There is a strong counter-argument — the submitted values are overwhelmingly
**facts** (model numbers, measured ratings, dates), and facts are not
copyrightable in US law; what thin copyright a compilation attracts lives in
selection and arrangement, which here are EPA's and fall under §105. **That is a
legal judgement, not an engineering finding, and I am not making it.**

**Answer to the question you asked:** current documentation does **not** resolve
it, and — contrary to what I first reported — does not narrow it either. The
review packet had already identified the scope problem correctly and nothing
found today changes its terms. Human legal review is required, on the question
the packet already framed.

Unchanged and still open: **"ENERGY STAR" is a registered certification mark**
whose use EPA conditions on an active Partnership Agreement, which we do not
have. And `ahri_reference_number` remains unresolved, with a standing prohibition
on using it to reach the AHRI directory (refused in code).

## AU Energy Rating — the best licence, but no approved way to take it

Measured today on `data.gov.au` (CKAN API at `/data/api/3/...`; the bare
`/api/3/...` path 404s):

- **Licence: `cc-by` / Creative Commons Attribution 3.0 Australia**, with an
  explicit `license_url`. This is a genuine grant permitting commercial
  redistribution with attribution — categorically different from a statement
  about copyright status.
- **Two datasets**, both refreshed today: *Labelled Products* (15 resources) and
  *Non Labelled Products* (23 resources). The non-labelled set is the closer
  analogue to CCMS — it is the registered-but-unlabelled population.
- **HVAC coverage**: Air Conditioners (both sets), Chillers, Close Control Air
  Conditioners, Commercial Refrigerators, Hot Water Heaters electric and gas,
  Electric Motors.
- **Depth**: the air-conditioner CSV has **155 columns** and 5.96 MB — registration
  number, submit ID, grant and expiry dates, submit status, refrigerant,
  rated/half/min capacity results at H1/H2/H3, TCSPF and HSPF across cold/mixed/hot
  climate zones, sound levels, demand-response capability.
- **Documented semantics**: DOCX data dictionaries per category — better field
  provenance than either US source.

### The blocker I initially missed — `robots.txt` prohibits the whole host

An earlier draft of this sheet said AU needed "only an attribution decision and
a check on the platform-replacement timing". **That was wrong.** I fetched
`data.gov.au/robots.txt`, recorded that it returned `200`, and never read it.
Its contents, re-read today and matching what this repository recorded on
2026-08-23:

```
User-agent: *
Disallow: /
```

The entire host, every path, every agent — including the CSV downloads above.
This platform sets `robots_policy.respect_robots: true`, so **a permissive
licence and a total crawl prohibition produce no approved automated acquisition
path.** `energyrating.gov.au`, the publisher's own portal, does not serve this
environment either, so there is no second door.

This is precisely the error this sheet warns about elsewhere: I let a successful
HTTP retrieval stand in for permission. The licence answers *may we use it*;
`robots.txt` answers *may we take it*; here they disagree, and the disagreement
was already on record in
[the source landscape](../sources/hvac-source-landscape-2026-08.md) before I
started.

**Route to yes:** written permission from DCCEEW for automated retrieval, or a
publisher-provided path outside `data.gov.au`. Until one exists, AU is not a
fallback that can be selected — it is a candidate needing an acquisition
approval of its own.

### Two further caveats

**Field coverage does not map.** The dataset carries AS/NZS star ratings and
kilowatt capacities; the HVAC dictionary is built on US DOE metrics (`seer2`,
`eer2`, `hspf2`, BTU/h, nominal tonnage). Those are **different test procedures,
not different units**, so converting between them would invent facts the source
does not contain.

**Platform timing.** A repository note dated 2026-09-08 records an announced
registration-system closure 28 September – 5 October 2026 with a replacement
platform on 6 October; **I could not re-verify that today** because
`energyrating.gov.au` does not serve this environment, so treat it as
recorded-but-unconfirmed.

## Recommendation

**No candidate is selectable today.** An earlier draft of this sheet recommended
ENERGY STAR conditional on counsel, with AU as a fallback "whose rights are
already clear". Both halves were overstated and are withdrawn — the reasoning is
in the two correction blocks above.

What the evidence does support is an ordering by **acquisition method**, which is
the gate that actually differs between them:

1. **ENERGY STAR is the only candidate with a lawful, policy-compliant
   acquisition path today.** Documented SODA API, `robots.txt` permitting
   `/api/` and `/resource/`, serves an honest agent, stable asset IDs, and field
   metrics that match the dictionary.

   **But "lawful-looking" is not "authorised", and this needs saying plainly
   because I got it wrong twice already in this document.** The review packet
   §2 marks the SODA method *proposed, not authorised*, and states the rule
   directly: **"Robots not disallowing a route is not a grant."** Its terms,
   licence scope, rate limits and redistribution constraints are recorded
   **[UNVERIFIED]** (§7a). So ENERGY STAR needs **two** approvals, not one — the
   rights question below **and** an acquisition-method authorisation. A
   favourable answer to the first does not make the source selectable on its
   own.
2. **AU Energy Rating has the strongest licence and no way to act on it.**
   CC-BY 3.0 AU genuinely permits commercial redistribution with attribution, but
   `Disallow: /` plus `respect_robots: true` means there is no approved automated
   path, and the AS/NZS metrics do not map to the dictionary. It needs written
   DCCEEW permission before it is a candidate at all.
3. **DOE CCMS has neither.** No readable access policy, no documented export, no
   catalogue entry.

So ENERGY STAR is where a *yes* would go furthest — but a recommendation to
select it would be a legal judgement I am not entitled to make, and this session
produced no evidence that makes that judgement easier than it was yesterday.

## The one question preventing selection

> **Does the EPA Standard Open Data License — as affirmatively attached to each
> ENERGY STAR dataset in its federal Common Core metadata — extend to partner-
> and certification-body-submitted values, or does it reach only EPA-produced
> fields?**
>
> And separately: **may we republish those values commercially while making no
> use of the ENERGY STAR certification mark**, given that mark use is
> conditioned on a Partnership Agreement we do not hold?

Both are answerable by counsel from the evidence in the review packet — which
already contained what is needed. Nothing in this sheet adds to it. Neither is answerable by engineering, and neither should be inferred
from data.gov presence, a government host, public accessibility, a permissive
`robots.txt`, or the existence of an API endpoint — none of which establish
permission to redistribute commercially.

## What the rights answer unlocks — source onboarding, not the paid path

**Source onboarding is what a rights answer unblocks. The paid path is not.**
An earlier revision of this section opened by saying the paid path was "not
waiting on engineering", which contradicted the correction at the end of the
same section. The correction is right and the opening was wrong.

`pnpm sources:readiness` on the merged release reports the vertical `NOT_READY`,
and names the blocking conditions itself:

```
hvac — NOT_READY overall (seven-surface revenue readiness: UNKNOWN)
  rights evidence: NONE — all seven surface results are UNKNOWN
  sources: 0 real / 4 synthetic, 0 real publisher(s)
  blocking real-source validation:
    - every source is synthetic: the rights machinery has been exercised,
      but never against terms written by someone else
    - no real source has a current, named rights review with an approved
      acquisition method
```

For a paid direct API, the tool names the three cells that must be granted, and
`API_PAID` is an AND-bundle so all three are required:

| Operation | Channel |
| --- | --- |
| `SERVE_API_ACCESS` | `DIRECT_CUSTOMER_API` |
| `SELL_API_ACCESS` | `DIRECT_CUSTOMER_API` |
| `REDISTRIBUTE_NORMALIZED` | `DIRECT_CUSTOMER_API` |

Everything behind those cells is built and passing: the `api-keys` and
`usage-events` packages are green on the merged release (3 files, 61 tests),
including the PGlite-backed invoice aggregation, and the six legacy declaration
inventory checks pass. The machinery refuses to serve without evidence, which is
the correct behaviour and is why no amount of further engineering moves this.

**What the answer does and does not do.** It unblocks **real-source onboarding**
— it does not by itself make a paid request possible, and an earlier draft of
this section said otherwise. A favourable answer leaves `sources: 0 real`
unchanged until several further steps happen, none of which counsel can do:

- The ENERGY STAR declaration is still an **unloaded draft** under `docs/`,
  deliberately outside the registry loader's path, at `UNDER_REVIEW` /
  `UNREVIEWED`. Promoting and configuring it is a separate act.
- Three API cells are not the whole grant, and an earlier revision of this
  section undercounted the rest. `docs/source-onboarding.md` Stage 2 requires
  effective **`ACQUIRE`, `STORE` and `CACHE`** decisions *before transport*, and
  the ingest pipeline separately requires **`NORMALIZE`** and **`DERIVE`**. That
  is **five** internal cells, so the minimum for a paid direct API is **at least
  eight**, not seven. Leaving `CACHE` unrecorded fails the very first fetch
  closed.
- Data then has to be actually acquired, normalised and evidence-backed.
- **UA-002 is independently blocked** — the hosted schema cannot be caught up
  from this environment — and the deployment and commercial-activation work
  tracked under UA-007 is blocked separately again.

So the readiness excerpt diagnoses *why there is no rights-reviewed real source
today*. It does not certify that everything downstream is ready. The pricing and
invoicing sheet remains separately open, and it gates the price rather than the
possibility.

## If you want to move fastest

Three asks, in descending order of how much they unblock:

1. **To counsel** — the ENERGY STAR question above. It is the only path where a
   single answer converts a candidate into a selectable source, because the
   acquisition side is already clean.
2. **To DCCEEW** — written permission for automated retrieval, which would make
   AU selectable on acquisition. Note this needs a *product* answer first
   (would a first customer buy AU/NZ data?) and a *schema* answer second (the
   AS/NZS metrics do not map), so it is further from revenue than it looks.
3. **To DOE** — authorize the prepared inquiry. A supported CCMS extract would
   complement whichever choice you make rather than replace it.

Only the first is a single question with a single answer. The other two each
open further work.
