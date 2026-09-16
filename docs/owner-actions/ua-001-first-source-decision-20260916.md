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
| **Serves an honest agent?** | **No — 403, including `robots.txt` itself** | **Yes — 200** on `/api/` and `/resource/` | **Yes — 200** on API and resource downloads |
| **Licence** | None locatable | EPA Standard Open Data License, **attached per-dataset** in federal Common Core metadata | **CC-BY 3.0 AU**, explicit `license_url` |
| **Commercial redistribution** | Unknown | **Unresolved** — see §"The one question" | **Permitted with attribution** |
| **Population** | Mandatory US compliance certification | **Voluntary** label — a higher-efficiency subset | Mandatory AU/NZ registration, labelled **and** non-labelled |
| **Market** | US | US | **AU / NZ** |
| **Refresh cadence** | Unknown | `rowsUpdatedAt` = today | Refreshed today; filenames datestamped `ac_2026_09_16.csv` |
| **Field origin documented?** | No | Partly — column labels name partner and CB origin | **Yes — DOCX data dictionaries per category** |
| **Bulk export** | None | Socrata CSV export | Direct CSV, 5.96 MB for air conditioners alone |
| **Technical stability** | Cache-busted bundle, re-versioned without notice | Stable asset IDs; portal root 301s but asset URLs persist | Stable CKAN IDs; **but see the platform-replacement risk** |

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

## ENERGY STAR — the prior blocker is narrower than recorded

**New evidence that changes the earlier assessment.** The review packet recorded
the rights position as effectively unstated: top-level `licenseId` is `None` and
`license` is empty. That is true but incomplete. Each dataset's **federal Common
Core metadata affirmatively attaches a licence**, and it is systematic — checked
on six datasets, identical every time:

```
"Common Core": {
  "License":   "https://edg.epa.gov/EPA_Data_License.html",
  "Publisher": "U.S. Environmental Protection Agency",
  "Contact Email": "certification@energystar.gov",
  "Program Code": "020:033", "Bureau Code": "020:00"
}
```

So EPA *has* declared terms for these compilations, through the standard federal
mechanism. That is stronger than "no licence stated".

**Why it still does not close the question.** The licence text, re-verified
verbatim today and unchanged, is scoped by its own wording:

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

**Answer to the question you asked:** current documentation **narrows** the issue
substantially but does **not** resolve it. Human legal review is still required —
on a much smaller question than before.

Unchanged and still open: **"ENERGY STAR" is a registered certification mark**
whose use EPA conditions on an active Partnership Agreement, which we do not
have. And `ahri_reference_number` remains unresolved, with a standing prohibition
on using it to reach the AHRI directory (refused in code).

## AU Energy Rating — the best rights posture, the wrong market

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

**Two caveats.** The market is AU/NZ, not US, which is a product-positioning
question rather than a technical one. And a repository note dated 2026-09-08
records an announced registration-system closure 28 September – 5 October 2026
with a replacement platform on 6 October; **I could not re-verify that today**
because `energyrating.gov.au` does not serve this environment, so treat it as
recorded-but-unconfirmed and material to timing.

## Recommendation

**ENERGY STAR, for the US slice, conditional on one legal answer** — with AU
Energy Rating as a strong second whose rights are *already* clear.

The evidence materially supports this ordering:

1. **CCMS is not selectable.** Not on rights — on access. There is no lawful
   route we can establish without impersonation, and the publisher will not even
   serve its access policy to an honest client.
2. **ENERGY STAR is the only candidate that is both US-market and lawfully
   fetchable today.** Its acquisition method is documented, robots-permitted and
   stable, and its licence is affirmatively attached by the publisher.
3. **AU Energy Rating has the strongest rights position of the three** and the
   richest fields, and would be the recommendation outright if AU/NZ coverage
   sells. If the answer on ENERGY STAR comes back unfavourable, this is the
   fallback that does not require a legal judgement call.

Do not activate anything on this recommendation. It orders the candidates; it
does not approve one.

## The one question preventing unconditional selection

> **Does the EPA Standard Open Data License — as affirmatively attached to each
> ENERGY STAR dataset in its federal Common Core metadata — extend to partner-
> and certification-body-submitted values, or does it reach only EPA-produced
> fields?**
>
> And separately: **may we republish those values commercially while making no
> use of the ENERGY STAR certification mark**, given that mark use is
> conditioned on a Partnership Agreement we do not hold?

Both are answerable by counsel from the evidence in this sheet and the review
packet. Neither is answerable by engineering, and neither should be inferred
from data.gov presence, a government host, public accessibility, a permissive
`robots.txt`, or the existence of an API endpoint — none of which establish
permission to redistribute commercially.

## What the answer unlocks, measured

The paid path is not waiting on engineering. `pnpm sources:readiness` on the
merged release reports the vertical `NOT_READY` for exactly one reason, and
names the blocking conditions itself:

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

So the paid-API track and this sheet are the same decision wearing two hats.
Answering the rights question for one candidate is what turns
`sources: 0 real / 4 synthetic` into a real publisher and lets the first paid
request happen. The pricing and invoicing sheet remains separately open, but it
gates the price, not the possibility.

## If you want to move fastest

Two questions, either of which unblocks a first source:

1. **To counsel**, the question above. Unblocks ENERGY STAR for the US market.
2. **To yourself**, a product question: *would a first paying customer buy AU/NZ
   equipment data?* If yes, AU Energy Rating needs no legal judgement call — only
   an attribution decision and a check on the platform-replacement timing.

Authorizing the DOE inquiry remains worthwhile regardless. If DOE offers a
supported CCMS extract, it complements rather than replaces either choice.
