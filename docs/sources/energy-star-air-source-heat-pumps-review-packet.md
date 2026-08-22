# Source rights review packet — EPA ENERGY STAR Certified Heat Pumps

> **STATUS: AWAITING HUMAN REVIEW. NOT APPROVED. NOT INGESTED.**
>
> This packet is evidence assembled for a reviewer. It is **not** a rights
> decision and must not be read as one. `reviewed_by` is empty and stays empty
> until a person has read this, checked it, and put their own name to it.
>
> Everything below is labelled **[VERIFIED]** (observed directly, with the
> command or URL that produced it), **[INFERRED]** (a reasonable reading of
> evidence, which the reviewer must confirm), **[UNKNOWN]** (not established —
> do not convert these into either a pass or a fail), or **[REVIEWER]** (a
> decision only a person can make).

Prepared: 2026-08-22 · Candidate for: `hvac` vertical (Commercial HVAC Intelligence)

---

## 1. Dataset identity

| | |
| --- | --- |
| **Canonical dataset** | `83eb-xbyy` — *ENERGY STAR Certified Heat Pumps* **[VERIFIED]** |
| **Named candidate** | `w7cv-9xjt` — *ENERGY STAR Certified Air-Source Heat Pumps* **[VERIFIED]** |
| **Relationship** | `w7cv-9xjt` is a Socrata **derived filter view** whose `modifyingViewUid` is `83eb-xbyy` **[VERIFIED]** |
| **Publisher** | U.S. Environmental Protection Agency **[VERIFIED]** |
| **Steward / contact** | EPA ENERGY STAR program — `certification@energystar.gov` **[VERIFIED]** |
| **Provenance flag** | `official` **[VERIFIED]** |
| **Licence pointer** | `https://edg.epa.gov/EPA_Data_License.html` **[VERIFIED]** |
| **Row count** | 281,828 **[VERIFIED]** — identical on both ids |
| **Rows last updated** | 2026-08-21T16:29:50Z **[VERIFIED]** |
| **View last modified** | 2025-02-18T20:54:31Z **[VERIFIED]** |
| **Created / published** | 2024-05-14 **[VERIFIED]** |

Metadata source (public, unauthenticated):

```bash
curl -s https://data.energystar.gov/api/views/83eb-xbyy.json
curl -s https://data.energystar.gov/api/views/w7cv-9xjt.json
curl -s 'https://data.energystar.gov/resource/83eb-xbyy.json?$select=count(*)'
```

### 1a. The named candidate is a pass-through of its parent — **[VERIFIED]**

The directive names *"ENERGY STAR Certified Air-Source Heat Pumps"*. That asset
(`w7cv-9xjt`) is a filter view, and its filter is currently empty (`query: {}`).
It returns exactly the parent's rows:

| product_type | `w7cv-9xjt` | `83eb-xbyy` |
| --- | ---: | ---: |
| HP - Split System | 263,326 | 263,326 |
| HP - Mini or Multi Split | 17,649 | 17,649 |
| HP - Single Package | 853 | 853 |
| **total** | **281,828** | **281,828** |

All three types are air-source heat pumps, so the view's *name* is not wrong
today. The risk is structural: **the view performs no narrowing, so it cannot
be relied on to keep performing one.** If EPA ever widens the parent, the view
passes the widening straight through under a name that promises otherwise.

**Recommendation to the reviewer:** declare the source against the parent
`83eb-xbyy` and apply our own explicit `product_type` filter, so the scope of
what we ingest is stated in our configuration rather than assumed from an
asset's title. **[REVIEWER]**

**That recommendation currently has nowhere machine-readable to live, and that
is a promotion prerequisite.** `SourceRegistryEntry` has no field for a
source-side acquisition query — no `query`, `filter`, `params` or `selector` —
and `verticals/<slug>/filters.yaml` is the *read* model (web facets, API
parameters, SEO), not an acquisition input. So the filter exists today only as
prose in `acquisition_policy.notes`, which nothing enforces and nothing reads.

Adding such a field is a real design decision — it belongs with the acquisition
provider configuration, it needs to be recorded in the policy snapshot so a
stored artifact can say what scope produced it, and it affects every provider —
and it should not be invented for a source nobody has approved yet. **Before
this declaration is promoted, either that field exists and carries the filter,
or the scope is enforced in the extraction mapping and the notes say so.** A
recommendation that lives only in a comment is the kind of control that is
already gone and has not been noticed. **[REVIEWER]**

### 1b. Scope note — "central" is not what this dataset is

`w7cv-9xjt` is *not* the same asset as "ENERGY STAR Certified Central Air
Conditioners and Air-Source Heat Pumps" (a separate dataset that also carries
cooling-only products). 17,649 of the rows here are mini/multi-split, which are
not central ducted equipment. **A "Commercial HVAC Intelligence" scope decision
is required** on whether mini-splits are in or out. **[REVIEWER]**

---

## 2. The six questions from `docs/source-onboarding.md`

| # | Question | Field | Evidence | Proposed answer |
| --- | --- | --- | --- | --- |
| 1 | May we acquire it this way at all? | `acquisition_policy.method` | robots **disallows** `/api/odata/` and `/OData.svc/`, and **does not disallow** `/resource/` or `/api/views/` **[VERIFIED]** — §7. Terms, licence scope, rate limits and redistribution constraints are **[UNVERIFIED]** — §7a | SODA `/resource/`, **not OData** — *proposed*, not authorised. Robots not disallowing a route is not a grant |
| 2 | May we use it commercially? | `commercial_use_allowed` | EPA licence: *"all data produced by the U.S EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105"* **[VERIFIED]** | Yes for EPA-produced content; see §4 for the submitted-content question **[REVIEWER]** |
| 3 | May we redistribute it? | `redistribution_allowed` | Public domain implies redistribution. No attribution condition is stated in the licence **[VERIFIED]** | Yes **[REVIEWER]** |
| 4 | May we normalize and derive from it? | `derivative_normalization_allowed` | Public domain; no derivative restriction stated **[VERIFIED]** | Yes **[REVIEWER]** |
| 5 | Must we attribute, and how exactly? | `rights_policy.attribution` | The licence states **no** attribution requirement **[VERIFIED]**. But EPA disclaims warranty and the mark rules forbid implying endorsement (§5) | Attribution **not legally required**; recommended anyway as *"Source: U.S. EPA ENERGY STAR certified product data, retrieved <date>"* **[REVIEWER]** |
| 6 | May we reuse the images? | `images_reusable` + `image_policy` | The dataset contains **no images** — all 48 columns are text, number or date **[VERIFIED]** | `false`, `cache_to_r2_permitted: false`. Nothing to decide, so decide nothing |

---

## 3. Licence text, verbatim — **[VERIFIED]**

From `https://edg.epa.gov/EPA_Data_License.html`:

> Unless otherwise specified, all data produced by the U.S EPA is by default in
> the public domain and is not subject to domestic copyright protection under
> 17 U.S.C. § 105.
>
> Additionally, please be advised that although these data have been processed
> successfully on a computer system at the U.S. EPA, no warranty expressed or
> implied is made regarding the accuracy or utility of the data on any other
> system or for general or scientific purposes, nor shall the act of
> distribution constitute any such warranty. It is also strongly recommended
> that careful attention be paid to the contents of the metadata file
> associated with these data to evaluate data set limitations, restrictions or
> intended use. The U.S. EPA shall not be held liable for improper or incorrect
> use of the data.

Two obligations follow that are ours, not EPA's:

1. **The warranty disclaimer travels.** If we publish these values we inherit
   the accuracy risk and must not present them as warranted by EPA.
2. **"Unless otherwise specified"** is doing real work — it is the hook on which
   §4 hangs.

---

## 4. Who produced which field — **[INFERRED, reviewer must confirm]**

This is the question the licence's *"data produced by the U.S EPA"* turns on.
17 U.S.C. § 105 removes copyright from works of the **U.S. Government**. It says
nothing about third-party content a government agency republishes.

The dataset's own column labels are the evidence that most of it is submitted:

- `energy_star_partner` and `manufacturer_type` (`"System Manufacturer"` in the
  sample) name a **partner** as the origin of the record. **[VERIFIED]**
- `energy_star_model_identifier` is labelled **"CB Model Identifier"** — CB is
  the certification body. An identifier minted by a certification body is not
  authored by EPA. **[VERIFIED label; INFERRED meaning]**
- `ahri_reference_number` is an identifier minted by AHRI. **[VERIFIED field]**

| Field group | Origin | Basis |
| --- | --- | --- |
| `pd_id` (ENERGY STAR Unique ID) | EPA | EPA's own record key **[INFERRED]** |
| `tax_credit_eligible`, `meets_most_efficient_criteria`, `cold_climate`, `meets_peak_cooling_requirements` | EPA | Derived by EPA from its own published criteria **[INFERRED]** |
| `date_certified` | EPA / CB | Certification event **[UNKNOWN]** which party stamps it |
| Brand and model fields (`outdoor_unit_brand_name`, `model_number`, `indoor_unit_*`, `furnace_model_number`, `series_name`, `upc`) | Partner | Manufacturer-supplied identifiers **[INFERRED]** |
| Performance ratings (`seer2_btu_wh`, `eer2_btu_wh`, `hspf2_btu_wh`, capacities at 47/17/5 °F, `cop_at_5_f`) | Partner / CB | Test results submitted for certification **[INFERRED]** |
| `ahri_reference_number` | AHRI (via partner) | See §6 **[VERIFIED field, INFERRED chain]** |
| Connectivity fields (`connected_capability`, `connects_using`, `dr_protocol`, communication module brands/models) | Partner | Manufacturer-declared **[INFERRED]** |
| `date_available_on_market`, `markets` | Partner | Manufacturer-declared **[INFERRED]** |

**Why this is probably fine, and why a person still has to say so:**
the submitted values are overwhelmingly **facts** — a model number, a measured
SEER2, a capacity in Btu/h. Facts are not copyrightable, and a compilation of
them published by EPA is public domain. That is a strong position. It is not a
position an AI should record as settled, because the "unless otherwise
specified" clause and the treatment of partner-submitted content are exactly the
kind of question a rights review exists to have a human answer. **[REVIEWER]**

---

## 5. Trademarks — **[VERIFIED rules, REVIEWER decision]**

Two distinct marks appear:

**"ENERGY STAR" is a registered certification mark owned by EPA.** EPA's brand
guidelines state the marks *"may never be used in any manner that would imply
EPA or ENERGY STAR endorsement or approval of an organization, its products, or
its services"*, and that use of the marks requires an active Partnership
Agreement. **[VERIFIED]**

**Manufacturer brand names** (`outdoor_unit_brand_name`, `indoor_unit_brand_name`,
`energy_star_partner`) are third-party trademarks appearing as data values.

The position this platform should take, for the reviewer to accept or reject:

- Treat every trademark-bearing value as an **identifier only**. Storing and
  displaying "this record names brand X, model Y" is factual reporting about a
  public certification record.
- **Do not** display the ENERGY STAR logo or any certification mark artwork.
  We are not an ENERGY STAR partner and have no licence to.
- **Do not** phrase anything as endorsement — not of us by EPA, and not of a
  product by us. Publish the certification as a dated observation of a public
  record ("appeared in EPA's certified list as of 2026-08-21"), never as
  "ENERGY STAR approved by us".
- Do not use "ENERGY STAR" in any product name, domain, or marketing claim of
  ours. **[REVIEWER]**

---

## 6. The AHRI reference number — the trap in this dataset

`ahri_reference_number` is a column of the EPA dataset. **[VERIFIED]**

This is the one place where the excluded source and the candidate source touch,
and the distinction is sharp:

- **Permitted:** storing the AHRI reference number *as it appears in EPA's
  public dataset*, as an identifier. It reached us from EPA, under EPA's terms.
- **Prohibited:** using that number to query, scrape, join against, or
  reconstruct the AHRI Certification Directory. That is acquiring from AHRI,
  and `packages/source-registry/src/prohibited-sources.ts` refuses it in code —
  see `docs/sources/prohibited-sources.md`.

An identifier is not a licence to the thing it identifies.

---

## 7. Delivery mechanisms — **[VERIFIED]**

| Mechanism | Endpoint | Notes |
| --- | --- | --- |
| SODA JSON | `https://data.energystar.gov/resource/83eb-xbyy.json` | Supports `$select` / `$where` / `$limit` / `$offset` / `$group` |
| SODA CSV | `https://data.energystar.gov/resource/83eb-xbyy.csv` | Same query surface |
| Metadata | `https://data.energystar.gov/api/views/83eb-xbyy.json` | Columns, licence, cadence, row-update timestamp |
| Bulk export | Socrata dataset export (CSV) | Not exercised — a full export is an ingestion, and none is authorised yet |

`https://data.energystar.gov/` now 301-redirects to
`https://www.energystar.gov/productfinder/advanced`; **deep asset URLs and the
API continue to work.** **[VERIFIED]** Any documentation we write must use asset
URLs, not the portal root.

**No app token was used and none was obtained.** Socrata throttles anonymous
requests more aggressively than tokened ones; obtaining a token is a
registration step for a person, not an agent. **[REVIEWER]**

### robots — **[VERIFIED]**

`docs/sources/evidence/data.energystar.gov-robots.txt`, retrieved
2026-08-22T00:40:01Z, SHA-256
`a6c856352c621a97f9fcfb2b212d4fc530169b319c9e7b49fc2e6299d736c7a2`. One
`User-agent: *` group, `Crawl-delay: 1`, 55 `Disallow` lines. In full:

| Group | Patterns | Bears on us |
| --- | --- | --- |
| Faceted search | `/browse`, `/browse/*`, `/*/browse`, `/page/*`, `/catalog/*`, `/facet/*` — each with `?*&category=`, `federation_filter=`, `limitTo=`, `q=`, `sortBy=`, `tags=`, `view_type=` | No. We do not crawl the search UI |
| **OData** | **`/api/odata/`**, **`/OData.svc/`** | **Yes — see below** |
| Embeds and internals | `/browse/embed`, `/tiles/`, `/*/*/*/widget_preview`, `*/alt`, `*/edit`, `/views/INLINE/rows.json?*method=clustered2*`, `/api/collocate*` | No |
| Auth | `/login`, `/reset_password/` | No |

**Group structure and precedence — [VERIFIED].** The snapshot contains exactly
**one** `User-agent` group (`*`), carrying `Crawl-delay: 1` and **54 `Disallow`
lines with zero `Allow` lines**. Allow-versus-Disallow precedence therefore does
not arise *in this snapshot* — there is nothing to take precedence over. That is
a fact about this file on this date, not a general property, which is exactly
why the digest below matters: an `Allow` line in a future revision would change
the analysis and must re-open it.

There is **no** blanket `Disallow: /` and no second group.

**Route-level check — [VERIFIED].** Each candidate path evaluated against all 54
rules, with `*` as wildcard and `$` as anchor:

| Path | Result |
| --- | --- |
| `/resource/83eb-xbyy.json` | no rule matches |
| `/resource/83eb-xbyy.csv` | no rule matches |
| `/api/views/83eb-xbyy.json` | no rule matches |
| `/api/odata/v4/83eb-xbyy` | **`Disallow: /api/odata/`** |
| `/OData.svc/83eb-xbyy` | **`Disallow: /OData.svc/`** |

**What this does and does not establish.** It establishes that the exact route we
would use is not disallowed by this snapshot. It establishes **nothing** about
whether we are authorised to use it. Robots is one input among several, and the
absence of a prohibition is not a grant. §7a is the rest of the question, and it
is unfinished.

**The correction this forced.** An earlier draft said robots "disallows only
faceted `/browse` patterns" and that "`/api/` is not disallowed". Both were
wrong, and OData is the route the vendor's own documentation promotes for this
data. **Any earlier statement, artifact or documentation in this repository that
assumed OData was permitted is superseded by this section.** An audit for
OData-derived material found none: every occurrence of the string in the tree is
prose describing the prohibition, and the one committed sample was retrieved from
`/resource/`, recorded in `docs/sources/evidence/README.md` with its digest.
**[VERIFIED]**

The recorded `max_requests_per_minute` should be **60 or lower** to honour the
crawl delay.

---

## 7a. What must be established before the first request — **[UNVERIFIED]**

Robots clears one obstacle. These are the others, and none is done. This section
gates the bounded run in §13; it is not a formality.

- [ ] **Applicable API terms.** Socrata operates the platform, EPA publishes the
      data. Whose terms govern an anonymous SODA request, and do they constrain
      automated or bulk retrieval? Not established.
- [ ] **Licence scope over submitted content** — §4, whether EPA's public-domain
      assertion reaches partner- and CB-submitted values.
- [ ] **Attribution and redistribution constraints** beyond the licence text in §3.
- [ ] **Rate limits. [VERIFIED: not discoverable from the endpoint.]** A request
      to `/resource/83eb-xbyy.json?$limit=1` returns no `X-RateLimit-*` and no
      `Retry-After` — only `X-Socrata-Region` and `X-Socrata-RequestId`. The
      applicable limit must come from the vendor's published documentation, read
      by a person. Inferring it from one successful request is how a bounded run
      becomes an incident.
- [ ] **Re-confirm the route against a fresh robots snapshot** immediately before
      the run, comparing the digest to
      `a6c856352c621a97f9fcfb2b212d4fc530169b319c9e7b49fc2e6299d736c7a2`
      (retrieved 2026-08-22T00:40:01Z). A changed digest re-opens §7 entirely.
- [ ] **Re-confirm no OData-derived artifact** has entered fixtures, caches,
      generated output or provenance records. Clean as of this packet.

**A caution about one metadata field.** The asset carries `"rights": ["read"]`.
**[VERIFIED]** That is Socrata's portal permission model — what an anonymous
visitor may do on the site — and it is **not** a licence grant. It must not be
cited as one.

---

## 8. Update cadence and change monitoring

- `rowsUpdatedAt` read as 2026-08-21T16:29:50Z, the day before this packet.
  **[VERIFIED]** That is one observation. It shows the dataset was updated on
  that date; it does **not** establish a cadence, and an earlier draft of this
  packet inferred "at least daily" from it, which the single reading does not
  support. **Cadence: [UNKNOWN] until several observations exist.**
- EPA publishes no stated SLA or cadence for this asset. **[UNKNOWN]**
- **Monitoring plan:** poll `api/views/83eb-xbyy.json` and compare
  `rowsUpdatedAt`; re-acquire only when it advances. This is one small request
  rather than a re-download, and it makes "did the source change?" answerable
  without a crawl. Also diff the `columns` array — a schema change upstream
  should raise a job, not be silently absorbed.
- **Terms monitoring:** re-fetch the licence URL and the `custom_fields.License`
  pointer on the same schedule; a changed licence must lapse the review.

---

## 9. Deletion and correction

- **Deletion:** rows disappear from EPA's list when a certification lapses or is
  revoked. Our copy must therefore carry `date_certified` **and the retrieval
  date**, and a model absent from a later retrieval must be marked as no longer
  appearing — never silently retained as current. **[REVIEWER to confirm the
  publication rule]**
- **Correction:** EPA's correction path is `certification@energystar.gov`.
  **[VERIFIED contact]** Our own corrections must follow the editorial-override
  route in ADR-0002 so a correction is auditable rather than an edit.
- **Caching:** the licence permits retention. Rule 10 requires it: raw artifacts
  are kept, addressed by digest, so any published value can be traced to bytes.

---

## 10. The thirteen proof conditions

From `docs/source-onboarding.md` Stage 3. **`READY` below means the platform
capability exists and has been exercised on fixtures — not that the condition is
satisfied for this source.** Nothing can be satisfied for this source before
review, because condition 2 gates the acquisition that every other condition
needs evidence from.

| # | Condition | State | Note |
| --- | --- | --- | --- |
| 1 | Real external artifact through a supported provider adapter | **BLOCKED** | Needs condition 2. `VENDOR_API`/`BULK_FILE` are supported methods |
| 2 | Rights metadata complete, named human reviewer and review date | **BLOCKED** | **This packet exists to unblock it.** `reviewed_by` is empty |
| 3 | Immutable raw evidence, addressed by content digest | READY | `packages/acquisition` storage is content-addressed |
| 4 | Field locators preserved | READY | JSON extractor emits `json_pointer` locators |
| 5 | Extraction with no source-specific branch in platform code | READY | Schema-driven extractor; the mapping is configuration |
| 6 | Identifiers normalized deterministically | **RISK** | Model numbers here are messy; see risk R-04 |
| 7 | Entities resolved with no vertical-specific platform code | **RISK** | Outdoor/indoor/furnace triples are a genuine modelling problem; see R-03 |
| 8 | Conflicts retained and explainable | READY | Append-only fact versioning |
| 9 | Verification state generated and stored as an event | READY | `packages/provenance` |
| 10 | Incremental refresh deduplicates unchanged bytes | READY | Content-addressed writes |
| 11 | Retrieval history visible after deduplication | READY | Retrieval records are separate from content |
| 12 | Provenance coverage measured | READY | `packages/provenance` reports it |
| 13 | Cost per useful canonical record measured | **NOT DESIGNED** | See §12 |

---

## 11. Proposed canonical schema

A sketch for the reviewer and for the modelling work that follows approval. Not
implemented.

```text
manufacturer        ← energy_star_partner (legal partner name)
                      + manufacturer_type
brand               ← outdoor_unit_brand_name / indoor_unit_brand_name
                      (a partner may own several brands; brand ≠ manufacturer)
product_family      ← series_name
system              ← the certified COMBINATION, which is the actual unit of
                      certification here: (outdoor unit, indoor unit,
                      optional furnace). pd_id identifies it.
  outdoor_unit      ← model_number
  indoor_unit       ← indoor_unit_model_number
  furnace           ← furnace_model_number (nullable)
system_type         ← product_type ∈ {HP - Split System,
                      HP - Mini or Multi Split, HP - Single Package}
capacities          ← cooling_capacity_btu_h,
                      heating_capacity_at_{47,17,5}_f_btu_h
efficiency          ← seer2_btu_wh, eer2_btu_wh, hspf2_btu_wh, cop_at_5_f
certification       ← date_certified, cold_climate,
                      meets_peak_cooling_requirements,
                      meets_most_efficient_criteria, tax_credit_eligible
identifiers         ← pd_id (EPA), energy_star_model_identifier (CB),
                      ahri_reference_number (AHRI), upc
availability        ← date_available_on_market, markets
provenance          ← source_key, artifact digest, retrieval timestamp,
                      json_pointer locator per field
```

**The important modelling decision:** the row is a *certified combination*, not
a product. One outdoor unit appears in many rows paired with different indoor
units, each with its own ratings. Collapsing to "the outdoor unit's SEER2" would
invent a fact that the source does not contain. **[REVIEWER]**

---

## 12. Source risk register

| id | Risk | Severity | Evidence | Mitigation |
| --- | --- | --- | --- | --- |
| R-01 | Partner-submitted content inside a public-domain compilation may not itself be public domain | **High** | §4 | Human rights review before ingestion. Publish facts, not prose |
| R-02 | Certification-mark misuse implying EPA endorsement | **High** | §5 | No marks, no logos, dated factual phrasing only |
| R-03 | The certified unit is a combination, not a product; naive modelling fabricates facts | **High** | §11 | Model the combination as the entity |
| R-04 | Model-number normalisation across 281,828 rows will collide or over-split | Medium | Condition 6 | Measure before publishing; retain conflicts (rule 3) |
| R-05 | Named view performs no filtering and may silently widen | Medium | §1a **[VERIFIED]** | Declare against the parent with our own explicit filter |
| R-06 | Warranty disclaimer travels with the data | Medium | §3 | Carry the disclaimer to every published surface |
| R-07 | Lapsed/revoked certifications silently retained as current | Medium | §9 | Retrieval-dated publication; absence handled explicitly |
| R-08 | `ahri_reference_number` used as a bridge into the prohibited AHRI directory | **High** | §6 | Enforced in code; see `prohibited-sources.md` |
| R-09 | Anonymous Socrata throttling makes a full pull unreliable | Low | §7 | App token obtained by a person, or bulk CSV |
| R-10 | Cost per useful record undefined, so "is this a business?" is unanswerable | Medium | Condition 13 | Define the denominator before the first full pull |
| R-11 | Portal root now redirects; documentation may rot | Low | §7 **[VERIFIED]** | Use asset URLs only |

---

## 13. What happens next

1. A human reads this packet and the linked primary sources.
2. That human records their decision in `docs/sources/proposed/energy-star-heat-pumps.yaml`
   — setting `rights_classification`, `reviewed_by` (**their own name**),
   `reviewed_at`, `next_review_at`, and `acquisition_policy.approved`.
3. Only then does the declaration move into `verticals/hvac/sources/`, where the
   loader can see it and the gates can evaluate it.
4. **The status transitions, which nothing automates.** `UNDER_REVIEW` is not in
   `ACQUIRABLE_STATUSES`, so the declaration does nothing until a person changes
   it. Going straight to `ACTIVE` would skip the state whose entire purpose is
   "acquired, not yet published":

   ```text
   UNDER_REVIEW → APPROVED → bounded acquisition into quarantine → validation → ACTIVE
   ```

5. **What `APPROVED` authorises, exactly.** Controlled fetching. Nothing else.
   It does **not** authorise:
   - publication to any surface — web, REST, MCP, bulk export;
   - downstream indexing, entity resolution into the canonical store, or
     inclusion in a dataset snapshot;
   - customer access of any kind;
   - **use as corroborating evidence** for any other source. An APPROVED source
     is unvalidated by definition, and corroboration from unvalidated data is
     confidence manufactured out of nothing.

   The gates already separate these: `evaluateAcquisitionGate` accepts
   `APPROVED`, while `evaluateSourcePublishGate` requires `ACTIVE`. The list
   above is what that separation is *for*, written down so nobody has to infer
   it from a status enum.

6. **The bounded run writes to quarantine, not to the store.** A sample, not
   281,828 rows, landing on a non-publishing path. The run must record:
   request parameters and the exact URL; response status and headers; row count;
   observed schema against §11; the source-policy snapshot the gate produced;
   content digests of every artifact; and the validation outcome.

7. **`APPROVED` → `ACTIVE` only after that artifact proves the real acquisition
   path behaved** within the documented rights and governance constraints —
   §7a resolved, the gate refusing what it should, and the observed data
   matching what the packet predicted. Promotion is a decision made *about
   evidence that now exists*, not about an expectation.

Until step 2, the file in `docs/sources/proposed/` is deliberately outside the
loader's reach. It cannot be ingested by any code path, because it is not
anywhere the registry looks.
