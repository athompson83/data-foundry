# Self-service machine-data revenue — candidate screen and finalists

**Recommendation: build the US Import Duty & Tariff Stack API first.**

This supersedes the candidate selection in
[`first-paid-slice-decision-20260917.md`](first-paid-slice-decision-20260917.md).
That document applied a stricter test — it treated "a free source exists" as
close to disqualifying and looked for an independent buyer before building.
Under a self-service convenience model that test is wrong, and the correction is
adopted here: **developers demonstrably pay to avoid integration work against
free data.** The buyer-interview gate still applies to the EMS hypothesis, which
is a different business shape.

Everything marked MEASURED below was retrieved directly on 2026-09-17. Search
volume is marked UNKNOWN throughout: no keyword tool is available here, and
inventing numbers would be worse than omitting them.

---

## The test this screen applies

A candidate survives only if a developer would rather pay than integrate. The
disqualifier is not "free data exists" — it is "the free path is already easy,
reliable, machine-friendly and complete for the job."

## Fast screen — 54 candidates across 18 domains

Scored 1–5 on demand evidence (D), source awkwardness (A), rights clarity (R),
and self-service fit (S). ▲ = advanced to deep review.

| # | Domain | Candidate | D | A | R | S | |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Trade/customs | **US HTS duty stack + Ch.99 remedies** | 5 | 5 | 4 | 5 | ▲ |
| 2 | Trade/customs | HS code semantic classification | 4 | 4 | 4 | 5 | |
| 3 | Trade/customs | UN Comtrade flows | 2 | 3 | 3 | 3 | |
| 4 | Trade/customs | US Census trade statistics | 2 | 3 | 5 | 3 | |
| 5 | Securities | **SEC XBRL company facts** | 5 | 5 | 5 | 5 | ▲ |
| 6 | Securities | SEC insider transactions (Forms 3/4/5) | 4 | 4 | 5 | 4 | |
| 7 | Securities | 13F institutional holdings | 4 | 4 | 5 | 4 | |
| 8 | Securities | SEC full-text filing search | 3 | 4 | 5 | 4 | |
| 9 | Securities | GLEIF LEI → parent/child graph | 3 | 2 | 4 | 4 | |
| 10 | Aviation | **FAA aircraft registry (tail number)** | 4 | 5 | 4 | 5 | ▲ |
| 11 | Aviation | FAA airmen certificates | 2 | 4 | 2 | 3 | |
| 12 | Aviation | BTS on-time performance history | 3 | 4 | 5 | 3 | |
| 13 | Aviation | FAA NOTAMs | 3 | 5 | 4 | 3 | |
| 14 | Healthcare | **NPI provider registry, enriched** | 4 | 2 | 4 | 5 | ▲ |
| 15 | Healthcare | CMS Medicare provider utilization | 3 | 3 | 5 | 3 | |
| 16 | Healthcare | Hospital price transparency files | 5 | 5 | 3 | 3 | |
| 17 | Healthcare | LEIE exclusions list | 3 | 3 | 5 | 4 | |
| 18 | Pharma | openFDA drug NDC + labels | 3 | 2 | 4 | 4 | |
| 19 | Pharma | Drug recalls / enforcement | 3 | 2 | 4 | 4 | |
| 20 | Pharma | RxNorm / DailyMed crosswalk | 3 | 4 | 4 | 3 | |
| 21 | Security | **NVD CVE + CISA KEV + EPSS join** | 4 | 3 | 4 | 5 | ▲ |
| 22 | Security | CPE / package → CVE mapping | 4 | 5 | 4 | 4 | |
| 23 | Security | Certificate transparency logs | 3 | 4 | 4 | 3 | |
| 24 | Legal/IP | USPTO trademark status | 4 | 4 | 5 | 4 | |
| 25 | Legal/IP | USPTO patent assignments | 3 | 4 | 5 | 3 | |
| 26 | Legal/IP | Federal court dockets (CourtListener) | 4 | 3 | 3 | 3 | |
| 27 | Legal/IP | Federal Register / regulations.gov | 2 | 2 | 5 | 3 | |
| 28 | Business | SAM.gov entity registration | 3 | 4 | 4 | 4 | |
| 29 | Business | State business registries (50-state) | 5 | 5 | 2 | 4 | |
| 30 | Business | Nonprofit Form 990 financials | 3 | 2 | 4 | 3 | |
| 31 | Govcon | Grants.gov + USAspending join | 3 | 3 | 5 | 3 | |
| 32 | Govcon | Federal contract awards history | 3 | 3 | 5 | 3 | |
| 33 | Energy | EIA series | 2 | 2 | 5 | 3 | |
| 34 | Energy | NREL EV charging stations | 3 | 1 | 4 | 4 | |
| 35 | Energy | Utility rate schedules | 4 | 5 | 3 | 3 | |
| 36 | Energy | ENERGY STAR certified products | 2 | 3 | 2 | 3 | |
| 37 | Environment | EPA ECHO enforcement | 3 | 3 | 5 | 3 | |
| 38 | Environment | AirNow / AQS air quality | 3 | 2 | 4 | 4 | |
| 39 | Weather | NWS forecast/alerts | 3 | 1 | 5 | 4 | |
| 40 | Weather | NOAA historical climate normals | 3 | 3 | 5 | 3 | |
| 41 | Vehicles | NHTSA VIN + recalls + EPA economy | 4 | 3 | 4 | 5 | |
| 42 | Vehicles | Commercial carrier safety (FMCSA) | 3 | 3 | 4 | 4 | |
| 43 | Geo | Census geocoder / TIGER | 3 | 2 | 5 | 4 | |
| 44 | Geo | US postal / ZIP crosswalks | 4 | 2 | 4 | 5 | |
| 45 | Property | County assessor / parcel data | 5 | 5 | 2 | 4 | |
| 46 | Property | Building permits (municipal portals) | 3 | 5 | 3 | 3 | |
| 47 | Property | FEMA flood zones | 3 | 3 | 5 | 4 | |
| 48 | Education | College Scorecard / IPEDS | 2 | 1 | 5 | 3 | |
| 49 | Education | K-12 school directory | 2 | 2 | 5 | 3 | |
| 50 | Labor | BLS series | 2 | 2 | 5 | 3 | |
| 51 | Labor | O*NET occupation taxonomy | 2 | 2 | 4 | 3 | |
| 52 | Food | USDA FoodData Central | 3 | 2 | 4 | 4 | |
| 53 | Telecom | FCC broadband availability | 2 | 4 | 4 | 3 | |
| 54 | Telecom | FCC license (ULS) | 2 | 4 | 4 | 3 | |

Cut for a reason worth stating: **College Scorecard, NREL EV stations, NWS,
USAspending and ProPublica's 990 API were all cut because their free path is
genuinely easy** — I called each one and got clean JSON first try. That is the
free-competitor rule doing its job, rather than a blanket "free exists" veto.

---

# Finalists

## F1 — US Import Duty & Tariff Stack API ★ recommended

**Exact product.** Given an HTS code and a country of origin, return the
complete current duty stack as computable numbers: MFN base rate, plus every
applicable Chapter 99 measure (Section 301, Section 232, IEEPA), with effective
dates and a provenance citation for each component.

**Who searches for it.** Ecommerce and D2C developers computing landed cost,
customs brokers' software teams, ERP and 3PL integrators, freight-tech
startups, and AI agents answering "what will this cost to import."

**Evidence of demand.** MEASURED: at least four independent paid products —
`ustariffrates.com` (Pro **$49/mo**, API access), `tariffsapi.com`,
`gingercontrol.com` (landed-cost API), and a `tariff-rate` listing on RapidAPI.
At least **four separate Apify scrapers** target the same USITC source, which is
the "developers repeatedly reimplementing the same acquisition logic" signal.
Competitors publish **per-HTS-code SEO landing pages** (e.g. `/hts/9903.05.76`)
— evidence the SEO→API funnel works in this niche. One vendor describes the
build as work that "takes a quarter and breaks every time CBP issues a CSMS
update." Search volume UNKNOWN.

**Free alternatives.** USITC's own site and its `reststop` API. MEASURED: it
returns 200 and real JSON, and `exportList` gives bulk by chapter.

**Paid alternatives and pricing.** $49/mo observed at the entry professional
tier; per-run/per-record scraper pricing on Apify (~$0.10/run + $0.01/record).

**Why pay us instead of the free source.** Because the free source does not
answer the question. MEASURED, by calling it:
- Duty rates are **prose, not numbers**: Chapter 99 lines return
  `general = "The duty provided in the applicable subheading plus…"`. Computing
  a rate requires extraction, not a field read.
- The schedule is **hierarchical**: lines carry an `indent` level and inherit
  rates from ancestors. A line reading `Free` at indent 5 is meaningless alone.
- `special` packs every preference program into one string that must be parsed.
- The source schema contains a **literal typo** — both `additionalDuties` and
  `addiitionalDuties` appear as field names. Every integrator hits this.
- Stacking base + 301 + 232 + IEEPA with origin logic and exclusions is the
  actual product, and it is nowhere in the raw feed.

**Source set.** `hts.usitc.gov/reststop` (search + exportList), Chapter 99
(MEASURED: 679 lines in 9903–9904), CBP CSMS bulletins for change detection,
Federal Register for measure effective dates.

**Commercial rights status.** US Government works, expected public domain.
`hts.usitc.gov` serves no `robots.txt` (MEASURED — the path returns the SPA).
No prohibition, and equally no explicit grant: **one counsel confirmation on
commercial redistribution is required before launch.** This is the same standard
UA-001 applied and must not be skipped because the data is federal.

**Acquisition mechanism.** Scheduled `exportList` pulls by chapter range, plus
CSMS polling for intra-revision changes. Fits the existing acquisition runner;
artifacts to R2; no browser automation needed.

**Refresh frequency.** USITC revisions several times a year, but Chapter 99
measures change by executive action with little notice — realistically daily
polling. High churn is a feature: it is what makes access recurring.

**Minimum useful endpoints.** `GET /hts/{code}`; `GET /hts/search?q=`;
`GET /duty?hts=&origin=` (the product); `GET /changes?since=`.

**MCP tools.** `lookup_hts_code`, `compute_duty_stack`, `list_recent_changes`.

**SEO/discovery.** A page per HTS code with current stack and change history —
roughly 20k indexable pages of genuinely useful content. A competitor already
ranks on exactly this pattern.

**Marketplace.** RapidAPI has a live paid tariff category.

**Suggested pricing.** $19 / $79 / $249 per month, metered on duty computations.

**Infrastructure cost.** Small — the full schedule is on the order of 20k lines;
this fits comfortably in the existing Postgres and edge cache.

**Support burden.** Low-to-moderate. Most questions are "why this rate," which
the provenance citation answers without a human.

**Engineering effort.** Small-to-medium on current Data Foundry. The rate
extraction and stacking rules are the real work; acquisition, evidence, REST,
MCP and metering already exist.

**Strongest reason it could fail.** **Correctness liability.** A wrong duty rate
costs the customer money and can create a customs problem. Measures change by
executive action faster than a scheduled crawl may catch, and misreading an
exclusion is a silent error. Mitigation is to ship it as an evidence-backed
*reference* — every component citing its HTS line and effective date, with an
explicit "not customs advice" disclaimer — never as a guaranteed landed cost.
If that framing will not sell, this candidate is wrong for us.

## F2 — SEC XBRL company financial facts API

**Product.** Normalized company fundamentals from XBRL with stable identifiers
and point-in-time history. **Demand: MEASURED** — `sec-api.io` charges
**$49/mo** (personal) and **$199/mo** (business) to wrap free public-domain SEC
data, which is this whole thesis in one data point.

> **Correction (2026-09-17).** An earlier revision of this document claimed
> `data.sec.gov` returns **403** to this environment and that "SEC blocks
> datacenter traffic". **That was wrong**, and it was my measurement error: the
> 403 came from the *format* of my User-Agent, not from the network. Retested
> reproducibly — a UA containing a parenthetical URL returns 403 (2/2), no UA
> returns 403, and a plain `DataFoundryResearch/1.0` returns **200** (2/2). SEC
> is reachable. The real friction is size and semantics, measured below, and it
> is a stronger argument than the one it replaces.

**Friction: MEASURED** — one company's `companyfacts` is **3,789,099 bytes**
carrying **505 distinct concepts**, of which **8 contain "Revenue"**. An agent
answering "what was revenue" must download 3.8 MB and then choose among
ambiguous concept names — a token cost and a hallucination surface at once.
Rights are clean (public domain; declared-UA and rate-limit conditions apply).
**Failure mode:** the most crowded category here.

## F3 — FAA aircraft registry API

**Product.** Tail number → aircraft, airworthiness, registration history.
**Demand/awkwardness: MEASURED** — there is no official API; the registry is a
**73 MB ZIP** (`ReleasableAircraft.zip`, HTTP 200). Multiple Apify scrapers sell
against it. **Failure mode:** several free web lookups already exist
(TailProfile, TailNumberLookup), so this competes on API access rather than on
the answer; and registered-owner data is personal information whose commercial
redistribution needs its own review.

## F4 — Enriched US healthcare provider (NPI) API

**Product.** NPI lookup joined to Medicare enrollment, PECOS and LEIE exclusion
flags, with change history. **Demand:** paid players sell exactly this
enrichment. **Free alternative is strong — MEASURED:** the official NPPES API
returned 200 and clean JSON, and NLM offers a second free API. So the base
lookup is not the product; only the cross-source join is. **Failure mode:** the
free path is good enough for most callers, which is the free-competitor rule
biting for real.

## F5 — Vulnerability intelligence join (NVD + KEV + EPSS)

**Product.** One call returning a CVE with exploit-in-the-wild status and
exploitation probability. **MEASURED:** NVD 2.0 returned **394,865** CVEs; CISA
KEV is a 1.7 MB JSON file. **Failure mode:** the weakest of the five. The free
sources are well maintained and already machine-friendly, and the join is a
morning's work for the customer — this is close to the case the free-competitor
rule says to reject.

---

## Scoring against the weighted model

| Criterion (weight) | F1 Tariff | F2 SEC | F3 FAA | F4 NPI | F5 Vuln |
| --- | --- | --- | --- | --- | --- |
| Existing online demand (20) | 18 | 20 | 12 | 13 | 10 |
| Self-service purchase fit (15) | 15 | 14 | 13 | 13 | 12 |
| Recurring machine usage (15) | 14 | 13 | 8 | 10 | 11 |
| Lawful data access (10) | 8 | 9 | 6 | 8 | 9 |
| Data Foundry value add (10) | 10 | 8 | 7 | 5 | 4 |
| Organic discoverability (10) | 10 | 7 | 7 | 6 | 5 |
| Low support burden (5) | 4 | 4 | 4 | 4 | 4 |
| Speed to launch (5) | 4 | 3 | 4 | 4 | 4 |
| Gross margin (5) | 5 | 4 | 5 | 5 | 5 |
| Competitive room (5) | 4 | 2 | 4 | 3 | 2 |
| **Total (100)** | **92** | **84** | **70** | **71** | **66** |

F1 wins on value-add and discoverability. F2 has the strongest raw demand
evidence and the single best proof of willingness to pay, but the least
competitive room.

## The smallest thing that can accept money

One vertical, four endpoints, one price. Not a data graph.

1. Counsel confirmation on commercial redistribution of USITC HTS content.
   **This gates everything and is not an engineering task.**
2. Ingest the full schedule plus Chapter 99 through the existing acquisition
   runner; store artifacts in R2 with provenance.
3. Normalize: resolve `indent` inheritance, extract prose rates into computable
   numbers, parse `special` programs, handle the `addiitionalDuties` typo.
4. Ship `GET /duty?hts=&origin=` plus the three supporting endpoints, metered
   through the existing usage path, with self-service keys and Stripe.
5. Publish per-HTS-code pages from the same canonical layer for discovery.
6. List on RapidAPI as a second channel; expose the MCP tools for agents.

Steps 2–6 use the existing architecture. No new framework, no enterprise
features, no CRM, no outbound.

## What this document does not establish

No customer has been contacted and no revenue exists. Demand here is inferred
from competitors' published prices and from repeated independent
reimplementation of the same acquisition logic — which is real evidence of
willingness to pay, but is not the same as someone paying us. Search volume is
UNKNOWN. The rights question in step 1 is open and is the one thing that can
invalidate the recommendation outright.
