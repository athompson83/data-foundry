# AU Energy Rating — fallback slice, documented not implemented

**Status: qualified as a fallback and second-source candidate. Not implemented,
and not to be implemented** unless ENERGY STAR is rejected, materially delayed,
or owner demand validation supports AU/NZ first.

Per owner direction: keep this rights-clear, but **do not make it the first
commercial product solely because licensing is easier.** This document exists so
that decision stays available without being taken by default.

## Why it is a fallback and not a first choice

Its licence is the best of the three candidates and its blockers are elsewhere.

| | Position |
| --- | --- |
| **Licence** | **CC-BY 3.0 Australia**, `license_id: cc-by`, with an explicit `license_url` on both datasets. A genuine commercial grant permitting redistribution with attribution. **[MEASURED 2026-09-16]** |
| **Acquisition** | **Blocked.** `data.gov.au/robots.txt` is `User-agent: * / Disallow: /` for the entire host, and this platform sets `robots_policy.respect_robots: true`. **[MEASURED]** |
| **Schema** | **Blocked.** AS/NZS star ratings and kW capacities against the dictionary's US DOE `seer2`/`eer2`/`hspf2`/BTU-h — different test procedures, not different units. **[VERIFIED in the source landscape]** |
| **Market** | AU/NZ, not US |
| **Cadence** | **Unknown.** Dated files observed 2026-08-23 and 2026-09-16; two observations establish no frequency. **[MEASURED]** |
| **Platform** | A registration-system closure 28 Sept – 5 Oct 2026 with replacement 6 Oct is recorded in the repository but **could not be re-verified** — `energyrating.gov.au` does not serve this environment. |

**Licensing being easier does not make it closer to revenue.** It carries two
blockers ENERGY STAR does not have, and one of them is a schema problem that no
permission can fix.

## The minimum viable AU/NZ slice, if it is ever chosen

Scoped deliberately narrow — one equipment class, one market, one claim.

**Slice:** air conditioners registered for the Australian market, from the
*Labelled Products* dataset (`ac_YYYY_MM_DD.csv`, 155 columns, ~6 MB
**[MEASURED]**), plus the *Non Labelled Products* air-conditioner file for
registered-but-unlabelled models.

**Fields** (a subset of the 155, chosen because they are identifiers, status or
native AS/NZS measures — no cross-standard conversion):

- Identity — `Brand`, `Model_No`, `Family Name`, `PartNumber`,
  `Registration Number`, `Submit_ID`
- Status and validity — `SubmitStatus`, `GrandDate`, `ExpDate`,
  `Availability Status`, `Sold_in`, `Country`
- Native measures — `Star2010_Cool`, `Star2010_Heat`, `Rated Total Cool
  Capacity W`, `Rated Heating Capacity watts`, `EER`, `COPtestAvg`,
  `Refrigerant`, `Phase`
- Climate-zone performance — `Residential TCSPF_cold/mixed/hot`,
  `Residential HSPF_cold/mixed/hot`
- Physical — `Height`, `Width`, `Depth`, `indoor_sound_level`,
  `outdoor_sound_level`

**Explicitly excluded:** any field converted into a US metric. The AS/NZS star
rating and TCSPF are reported as themselves or not at all.

**The claim the product may make:** *"Australian registered air-conditioner
models with their AS/NZS registration status and native efficiency ratings, as
filed with the Australian regulator."* Nothing about US equipment, nothing about
SEER2/EER2 equivalence, no implication of broader coverage.

**Agent queries it would serve:** "Is this model still registered and
unexpired?"; "which models in this capacity band meet a given star rating in the
cold climate zone?"; "what changed in the register since my last sync?"

## What has to happen first, in order

1. **Written DCCEEW permission** for automated retrieval, or a publisher-provided
   path outside `data.gov.au`. Nothing proceeds without this — the licence does
   not address it, and the platform honours `robots.txt`.
2. **A schema decision** on carrying AS/NZS measures as first-class canonical
   fields rather than converting them. This is a real dictionary change, not
   configuration.
3. **A market decision** — does a first paying customer want AU/NZ data?
4. **Re-verification of the platform-replacement timing**, which could not be
   checked from here.
5. **The same eight rights cells** any source needs: `ACQUIRE`, `STORE`,
   `CACHE`, `NORMALIZE`, `DERIVE`, plus the three `API_PAID` cells.

## Attribution, if it proceeds

CC-BY 3.0 AU requires attribution. The proposed form, for review rather than as
a settled obligation: *"Contains data sourced from the Australian Government
Department of Climate Change, Energy, the Environment and Water, Energy Rating
register, licensed under CC BY 3.0 AU"*, with the retrieval date and the exact
resource. Attribution wording is a decision, not an engineering default.
