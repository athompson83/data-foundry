# ENERGY STAR — counsel packet

**Purpose.** One narrow question, with only the material needed to answer it.
Prepared 2026-09-16 on owner direction to proceed with counsel review of ENERGY
STAR as the preferred US first-source candidate.

**Status.** Nothing is activated. The source declaration remains an unloaded
draft at `UNDER_REVIEW` / `UNREVIEWED`, outside the registry loader's path. No
data has been acquired, stored or published.

---

## The question

> **Does the EPA Standard Open Data License, as attached by EPA to each of these
> published datasets, permit commercial republication and transformation of the
> partner- and certification-body-submitted product values those datasets
> contain?**

That is the whole question. Two things are deliberately **excluded** from it and
handled separately in §6: use of the ENERGY STAR certification mark, and the
`ahri_reference_number` field.

---

## 1. The licence, as EPA attaches it

Each dataset's federal Common Core metadata carries, identically across all six
datasets checked on 2026-09-16:

```json
"Common Core": {
  "License":        "https://edg.epa.gov/EPA_Data_License.html",
  "Publisher":      "U.S. Environmental Protection Agency",
  "Contact Email":  "certification@energystar.gov",
  "Program Code":   "020:033",
  "Bureau Code":    "020:00"
}
```

Retrieved from `https://data.energystar.gov/api/views/<dataset-id>`. Datasets
checked: `83eb-xbyy`, `e4mh-a2u3`, `i97v-e8au`, `acvd-5wvz`, `7p2p-wkbf`,
`6rww-hpns`.

## 2. The licence text, verbatim

From `https://edg.epa.gov/EPA_Data_License.html`, re-read 2026-09-16 and
unchanged from the version recorded in the review packet:

> Unless otherwise specified, all data produced by the U.S EPA is by default in
> the public domain and is not subject to domestic copyright protection under
> 17 U.S.C. § 105.
>
> Additionally, please be advised that although these data have been processed
> successfully on a computer system at the U.S. EPA, no warranty expressed or
> implied is made regarding the accuracy or utility of the data on any other
> system or for general or scientific purposes, nor shall the act of
> distribution constitute any such warranty. It is also strongly recommended
> that careful attention be paid to the contents of the metadata file associated
> with these data to evaluate data set limitations, restrictions or intended
> use. The U.S. EPA shall not be held liable for improper or incorrect use of
> the data.

**The two phrases the question turns on** are *"Unless otherwise specified"* and
*"data produced by the U.S EPA"*.

## 3. Why field origin is the crux

17 U.S.C. § 105 removes copyright from works of the **U.S. Government**. It does
not speak to third-party content that a government agency republishes. Much of
what these datasets contain is submitted to EPA rather than produced by it, and
the datasets' own column labels are the evidence:

| Field group | Apparent origin | Evidence |
| --- | --- | --- |
| `energy_star_partner`, `manufacturer_type` | **Partner** | Column names a partner as the record's origin. **Verified** |
| `energy_star_model_identifier` | **Certification body** | Labelled *"CB Model Identifier"*. **Verified label**; meaning inferred |
| `ahri_reference_number` | **AHRI**, via partner | Identifier minted by a private trade association. **Verified field** |
| Brand and model fields (`brand_name`, `model_number`, `indoor_unit_model_number`, `furnace_model_number`) | **Partner** | Manufacturer-supplied identifiers. Inferred |
| Performance ratings (`seer2_rating_btu_wh`, `eer2_rating_btu_wh`, capacities) | **Partner / CB** | Test results submitted for certification. Inferred |
| `pd_id` (ENERGY STAR Unique ID) | **EPA** | EPA's own record key. Inferred |
| `tax_credit_eligible`, `meets_most_efficient_criteria`, `cold_climate` | **EPA** | Derived by EPA from its own published criteria. Inferred |
| `date_certified` | **EPA or CB** | Unknown which party stamps it |

An agency can license only what it holds. If the submitted values are not
EPA-produced, the licence's own wording may not reach them.

**The counter-argument, stated fairly:** the submitted values are overwhelmingly
*facts* — model numbers, measured efficiency ratings, capacities, dates — and
facts are not copyrightable in US law. What thin copyright a compilation attracts
lives in selection and arrangement, which here are EPA's and fall under § 105.
Engineering is not qualified to decide whether that disposes of the question, and
is not asserting that it does.

## 4. What Data Foundry proposes to republish

From the Light Commercial HVAC dataset (36 columns), the product-relevant subset:

`energy_star_partner`, `brand_name`, `model_name`, `model_number`, `type`,
`split_system_or_single_package`, `cooling_capacity_kbtu_h`,
`heating_section_type`, `eer2_rating_btu_wh`, `seer2_rating_btu_wh`,
`indoor_unit_model_number`, `furnace_model_number`, `refrigerant_type`,
`refrigerant_with_gwp`, `date_available_on_market`, `date_qualified`, `markets`,
`pd_id`.

`ahri_reference_number` is **excluded pending a separate decision** (§6).

## 5. Proposed transformations

- **Normalization to a canonical schema** — mapping source column names to
  canonical field names; no change to values.
- **Unit and type canonicalisation** — parsing dates to ISO-8601, numerics to
  typed values. No unit conversion across test procedures.
- **Entity linkage** — grouping records by manufacturer and model family so an
  agent can query across them.
- **Provenance attachment** — every value carries its source dataset, the
  retrieval timestamp and the publisher.

**No value is recomputed, derived into a new rating, or presented as anything
other than what the source recorded.**

## 6. Intended commercial use, and what is excluded

**Intended:** a paid machine-facing API and agent (MCP) interface, sold by
subscription, returning normalized certification records with provenance; and
bulk export to subscribers.

**Excluded by decision, not by oversight:**

1. **No use of the ENERGY STAR certification mark.** EPA conditions use of the
   marks on an active Partnership Agreement, which Data Foundry does not hold.
   No logo, no mark artwork, no use of "ENERGY STAR" in any product name, domain
   or marketing claim. The official dataset title may be cited **as a title
   only**. *This is a trademark matter and is deliberately kept separate from the
   data-use question above — please treat it as a distinct issue.*
2. **No implication of EPA endorsement or approval**, of Data Foundry or of any
   product. Customer-facing wording is *"Manufacturer-reported, as filed with US
   regulators"* with dated provenance, never framed as Data Foundry
   certification, verification or a regulator determination.
3. **EPA's warranty disclaimer travels.** Accuracy risk is carried by Data
   Foundry and must not be presented as warranted by EPA.
4. **`ahri_reference_number` is excluded** pending its own decision. Observing
   the field in an EPA dataset is not a licence to the AHRI directory it
   identifies, and querying or reconstructing that directory is already
   prohibited in code.

## 7. What counsel is *not* being asked

- Whether the acquisition method is authorised. That is a separate open question
  — the review packet records the SODA method as *proposed, not authorised*,
  with terms, rate limits and redistribution constraints unverified, and notes
  that robots not disallowing a route is not a grant. It is being pursued on its
  own track.
- Whether to select ENERGY STAR commercially. That is the owner's call.

## 8. Supporting material

- `docs/sources/energy-star-air-source-heat-pumps-review-packet.md` — the
  canonical review packet: dataset identity, licence pointer, verbatim text,
  field-origin analysis, trademark rules, delivery mechanisms.
- `docs/sources/energy-star-certified-products-qualification-20260916.md` —
  measured access posture and coverage.
- `docs/owner-actions/ua-001-first-source-decision-20260916.md` — the three-way
  candidate comparison and what remains open.

## 9. Recording the answer

Whatever counsel concludes, the answer is recorded before anything is activated.
A favourable answer unblocks **source onboarding**, not publication: the
declaration must still be promoted and configured, and at minimum eight rights
cells recorded — `ACQUIRE`, `STORE` and `CACHE` before transport, `NORMALIZE`
and `DERIVE` in the pipeline, and `SERVE_API_ACCESS`, `SELL_API_ACCESS`,
`REDISTRIBUTE_NORMALIZED` on `DIRECT_CUSTOMER_API` for a paid API.
