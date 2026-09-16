# ENERGY STAR certified products — source qualification, 2026-09-16

A documented, publisher-supported alternative to the undocumented DOE CCMS Solr
endpoint, re-measured while checking whether CCMS has a data.gov catalogue entry.

> **Correction.** An earlier draft of this record presented ENERGY STAR as newly
> discovered. It was not. The repository has carried it as a proposed source,
> deferred because *"partner-submitted field rights remain unknown"*, with a
> detailed review packet at
> [`energy-star-air-source-heat-pumps-review-packet.md`](energy-star-air-source-heat-pumps-review-packet.md).
> What is new here is the measured access posture and one piece of rights
> evidence. See
> [the 2026-09-16 first-source decision sheet](../owner-actions/ua-001-first-source-decision-20260916.md)
> for the three-way comparison and the one open legal question.

Nothing here is activated. This record holds the ENERGY STAR measurements; the
three-way comparison and the recommendation live in the decision sheet linked
above.

## How this was found, and the CCMS negative that came with it

The open question in
[the DOE inquiry draft](doe-ccms-access-inquiry-draft.md) was whether CCMS has a
documented distribution. The earlier attempt to check could not reach the
data.gov catalogue API, so the question was left open.

It is now answered, and the answer is a clean negative:

- Every data.gov API route tried returns `{"detail":{},"message":"Not Found"}`
  with a non-CKAN envelope: `/api/3/action/*`, `/api/action/*`, `/api/1/*` and
  `/api/` itself. `catalog.data.gov/robots.txt` still carries literal
  placeholder text (`# TODO: add disallow routes`, `# sitemap url should get
  replaced by proxy .profile`), so the catalogue appears to be mid-rebuild.
- The HTML search drops its query and redirects to the catalogue root, so it
  cannot be used to search either.
- The one route `robots.txt` does advertise — the sitemap — works. **All 112
  shards were enumerated: 559,455 URLs.** No DOE CCMS dataset exists in it. The
  only `ccms` match is an unrelated workers-compensation case-management system.

So CCMS has no data.gov catalogue entry. That does not mean DOE publishes no
extract by another route, so it strengthens the case for sending the inquiry
rather than replacing it.

The same enumeration surfaced something more useful.

## What ENERGY STAR offers

Published by the U.S. Environmental Protection Agency on a Socrata instance at
`data.energystar.gov`, with `provenance: official`.

**It answers the objection that stopped CCMS.** The CCMS edge returns 403 to
every non-browser user agent tested, which is why browser impersonation was the
only route and why the owner refused it for production. ENERGY STAR has no such
problem, measured today with a descriptive, honest agent
(`data-foundry-research (source qualification)`):

| Check | Result |
| --- | --- |
| `robots.txt` | 200; only `/browse?*` query-parameter variants disallowed. `/api/` and `/resource/` are not. `Crawl-delay: 1` |
| Dataset metadata (`/api/views/<id>`) | 200, JSON |
| Row query (`/resource/<id>.json`) | 200, JSON |
| Documented distributions | CSV export, JSON and XML query endpoints, column metadata — all linked from the data.gov entry |
| Freshness | `rowsUpdatedAt` corresponds to 2026-09-16, the day of measurement |

No impersonation, no undocumented endpoint, no cache-busted front-end bundle to
reverse. The access method question that blocks CCMS does not arise.

## Coverage — stated carefully, because the naive number is wrong

31 HVAC-relevant datasets carry stable Socrata identifiers. Row counts for the
21 core "Certified" datasets, measured today one request per second:

| Dataset | ID | Rows |
| --- | --- | --- |
| Air-Source Heat Pumps | `w7cv-9xjt` | 282,665 |
| Heat Pumps | `83eb-xbyy` | 282,665 |
| Ducted Heat Pumps | `3m3x-a2hy` | 265,019 |
| Mini-Split Heat Pumps | `akti-mt5s` | 17,646 |
| Light Commercial HVAC | `e4mh-a2u3` | 12,541 |
| Geothermal Heat Pumps | `acvd-5wvz` | 4,977 |
| Furnaces | `i97v-e8au` | 3,252 |
| Water Heaters | `pbpq-swnu` | 1,260 |
| Ventilating Fans | `8dv7-nngq` | 1,131 |
| Commercial Water Heaters | `xmq6-bm79` | 737 |
| Boilers | `6rww-hpns` | 650 |
| Gas (Storage and Tankless) Water Heaters | `6sbi-yuk2` | 605 |
| Heat Pump Water Heaters | `v7jr-74b4` | 600 |
| Dehumidifiers | `mgiu-hu4z` | 550 |
| Room Air Conditioners | `5xn2-dv4h` | 515 |
| Commercial Boilers | `3393-mxju` | 384 |
| Room Air Cleaners V3.0 | `gaa3-swy6` | 244 |
| Smart Thermostats | `7p2p-wkbf` | 117 |
| Solar Water Heaters | `xs5y-vwyz` | 55 |
| **Central Air Conditioners** | `tyr2-hhgu` | **0** |
| **Mini-Split Air Conditioners** | `qj64-j3bn` | **0** |

**Do not quote the sum.** It is 875,613 and it is not a coverage figure:

- Two datasets return **0 rows** while reporting `publicationStage: published`
  with 48 columns. Whatever happened to the air-conditioner data, it is not
  available at these identifiers today, and any plan that assumes AC coverage
  from this source is wrong until that is explained.
- *Air-Source Heat Pumps* and *Heat Pumps* report **identical** row counts and
  identical update timestamps, but have **different column counts** (48 vs 50).
  That is consistent with overlapping views of one population, but it is not
  proof, so they must not simply be added. The distinct record count is **not
  established** and must be measured before any coverage claim is made.

## Field shape

Sampled from Light Commercial HVAC — 36 columns, of which the product-relevant
ones are:

`energy_star_partner`, `brand_name`, `model_name`, `model_number`, `type`,
`split_system_or_single_package`, `cooling_capacity_kbtu_h`,
`heating_section_type`, `eer2_rating_btu_wh`, `seer2_rating_btu_wh`,
`indoor_unit_model_number`, `furnace_model_number`, `refrigerant_type`,
`refrigerant_with_gwp`, `date_available_on_market`, `date_qualified`, `markets`,
`energy_star_model_identifier`, `pd_id`.

Brand, model, equipment class, efficiency ratings, refrigerant and certification
dates — the canonical shape the vertical needs.

## The material difference the owner must weigh

**ENERGY STAR is not a substitute for CCMS. It is a different population.**

- **CCMS** is the mandatory DOE compliance certification database: manufacturers
  must certify models subject to federal conservation standards. It is intended
  to be near-complete for regulated equipment.
- **ENERGY STAR** is a voluntary labelling programme. A model appears only if the
  manufacturer sought and earned the label, which is set above the federal
  minimum.

So ENERGY STAR is, by design, a **subset biased toward higher-efficiency
models**. A product that claims to cover "certified HVAC equipment" from ENERGY
STAR alone would be making a coverage claim it cannot support. That is a
product-positioning decision, not a technical one, and it belongs to the owner.

## Rights — open, and not to be assumed

**Superseded 2026-09-16, later the same day.** The top-level `licenseId` is
`None` and `license` is empty — but that is incomplete. Each dataset's federal
Common Core metadata **affirmatively attaches** a licence, identically on all six
datasets checked:

```
"Common Core": {
  "License":   "https://edg.epa.gov/EPA_Data_License.html",
  "Publisher": "U.S. Environmental Protection Agency",
  "Contact Email": "certification@energystar.gov"
}
```

That is stronger than "rights unstated". It still does not settle the matter,
because the licence is scoped to *"data produced by the U.S EPA"* while most
fields are partner- or certification-body-submitted. The following must not be
treated as settled:

1. Works of the U.S. federal government are generally not subject to domestic
   copyright, but that is a general principle, not a licence grant read off this
   dataset, and it does not by itself authorise commercial republication of this
   specific compilation.
2. **"ENERGY STAR" is a registered certification mark** with published rules on
   how it may be used. Republishing certification *values* and using the *mark*
   or the programme name in a commercial product are separate questions, and the
   second one has real constraints.
3. Any accuracy or legal-significance disclaimers the programme requires must be
   identified and carried through, as with CCMS.

The access-method objection is resolved. **The rights question is not**, and it
needs its own cell in the decision sheet rather than inheriting CCMS's.

## Recommendation

Treat ENERGY STAR as the **leading candidate for first activation**, ahead of
CCMS, on one ground only: its acquisition method is documented, robots-permitted
and stable, so it does not require the undocumented browser-dependent endpoint
the owner has already refused for production.

Do not activate it yet. Three things are needed first, in this order:

1. **Rights determination** on the two questions above — federal-work status for
   the compilation, and certification-mark usage.
2. **Coverage measurement** — the distinct record count, and an explanation for
   the two empty air-conditioner datasets.
3. **A decision on positioning** given that ENERGY STAR is a higher-efficiency
   subset rather than the regulated population.

The DOE inquiry should still go out. If DOE offers a supported CCMS extract, the
two sources are complementary — the regulated population plus the voluntary
label — rather than alternatives.
