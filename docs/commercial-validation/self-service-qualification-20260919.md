# Bounded self-service product qualification — 2026-09-19

**Outcome: no candidate is selectable today. Product-specific implementation
stops here; the precise disqualifiers are recorded per candidate below, with
the measurements behind them. This is not commercial validation of anything.**

Scope and method follow the 2026-09-19 owner directive: at most three candidates
from the existing unresolved shortlist were deep-tested; the broad survey was not
repeated; PR #51's NO_GO closures (tariff, SEC, FAA registry) were not reopened
because no new evidence resolves their recorded failures; every demand figure is
a labelled proxy; nothing was purchased and no source was acquired beyond a
handful of read-only API calls from this execution environment.

All measurements were taken 2026-09-19 from a remote container whose egress
reaches some publishers and not others. An HTTP 403 from a policy page is an
**environmental access failure**, not a permission and not a prohibition; it is
recorded as such. Raw outputs: the vehicle benchmark script and its JSON
(`docs/evidence/vehicle-join-benchmark-20260919.py`,
`docs/evidence/vehicle-join-benchmark-20260919.json`).

## Reconciled starting point

- Hosted database (project `fgxinxaqkwoqyywdgobs`, schema `data_foundry`, migration
  `0033`) holds **0 sources, 0 tenants, 0 API keys, 0 usage events, 0 entities**
  (read-only count, 2026-09-19).
- Every candidate ever studied is `NO_GO`, deferred or unselectable per the
  2026-09-17 records; the checklist still cites the partly superseded
  first-paid-slice decision as the commercial authority.
- Implemented self-service machinery: API-key auth, tiers, RapidAPI origin
  adapter, queue-backed metering, per-request rights enforcement, OpenAPI,
  prelaunch pricing page. **Missing:** any per-period request allowance or hard
  stop (ADR-0007 declined it "until asked"), per-subscriber marketplace identity,
  any payment provider, checkout, webhook or subscription lifecycle, evaluation
  cap, funnel measurement, self-service key issuance.

## Candidates tested

| # | Candidate | Depth | Result |
| --- | --- | --- | --- |
| 1 | US Vehicle Intelligence — VIN decode + open recalls + EPA fuel economy (NHTSA vPIC, NHTSA recalls API, fueleconomy.gov) | deep | **NOT SELECTABLE** — rights evidence unreadable from this egress; the join needs a human-maintained model-name mapping or shifts ambiguity to the customer; XML extraction gap |
| 2 | ENERGY STAR certified HVAC products (EPA / Socrata) | deep on access and value; rights untouched | **NOT SELECTABLE** — the two owner-directed approvals (counsel on partner-submitted fields; acquisition-method authorisation) are still open; value over the free SODA API is modest and unmeasured with customers |
| 3 | GLEIF Legal Entity Identifier records | screen | **NO_GO** — CC0 data behind an excellent free JSON:API; no value survives the fair comparison |

### 1. US Vehicle Intelligence

**Customer question.** "Given a VIN, what is this vehicle, which recalls are open
against it, and what is its EPA fuel economy — in one call, normalised, with
evidence and change detection on recalls."

**Inputs / outputs / scope.** Input: a 17-character VIN (or year/make/model).
Outputs: decoded attributes (make, model, year, body class, fuel), recall
campaigns with dates and remedy status, EPA combined/city/highway figures for the
matching model variants. Minimum useful scope: model years 2010+ for makes
present in all three sources. Acquisition: three federal HTTP APIs (vPIC JSON,
recalls JSON, fueleconomy.gov **XML**). Refresh: recalls daily, fuel economy per
model-year release, vPIC on demand. Maintenance burden: the cross-source model
name mapping (below). Reason to pay: one normalised call instead of five with
two naming schemes and an XML parser.

**Benchmark (12 vehicles, 2015–2020, 11 makes; script and JSON in `docs/evidence/`).**

| Measure | Result |
| --- | --- |
| vPIC decode | 12/12 returned make, model, year (11/12 with check-digit warning `ErrorCode 1` because the test VINs are synthetic; decode still resolves from WMI/VDS) |
| Recalls by make/model/year | 11/12 returned (`Count` 1–22); **1/12 HTTP 400** because vPIC says `Silverado` and the recalls API names `SILVERADO 1500` / `SILVERADO 2500` |
| Fuel economy model match after case-folding the make | **6/12 exact** (`Accord`, `Corolla`, `Jetta`, `Prius`, `528i`, `Sonata`); **5/12 fuzzy-only** (`Model 3` → 6 range variants; `Grand Cherokee` → 2WD/4WD/SRT/Trackhawk; `Tucson` → AWD/FWD; `Silverado` → 6 cab/drive variants; `CX-5` → 2WD/4WD); **1/12 no match** (`F-150` is `F150 Pickup …` upstream) |
| Free path cost for the twelve | 70 HTTP calls, 241,122 bytes, three schemas, one XML |
| Per-vehicle free path | 1 JSON call for decode, 1 JSON call for recalls, 2–4 XML calls (make menu → model menu → options → vehicle record) |

**Fair comparison.** The strongest free substitute is the same three official
APIs, keyless, no documented quota, with community wrappers already popular
(npm, 30 days to 2026-09-16, download counts as **proxies**: `vin-validator`
19,795; `@shaggytools/nhtsa-api-wrapper` 12,733; `vin-decoder` 1,238; PyPI
counts unavailable — `pypistats.org` returned 429). The proposed value is the
join and its normalisation. The benchmark shows the join is **not deterministic
on names alone**: half of the vehicles resolve only to a *set* of upstream
variants. A product that picks one variant silently is a fuzzy match (forbidden
by rule 7 and the directive); a product that returns all variants with an
explicit ambiguity flag is deterministic but hands the customer back the work
the price was supposed to remove; a curated mapping table is recurring human
adjudication, which the directive names as a rejection criterion. The recalls
naming failure is the same problem in a second source.

**Rights.** `www.nhtsa.gov/robots.txt` and `www.nhtsa.gov/web-policies` return
**403 from this egress**; `www.fueleconomy.gov/robots.txt` did not connect;
`vpic.nhtsa.dot.gov/api/` (200) shows no terms text. US federal works are not
subject to domestic copyright, but the rights model requires immutable, readable
terms evidence recorded by a named reviewer for at least eight cells (`ACQUIRE`,
`STORE`, `CACHE`, `NORMALIZE`, `DERIVE`, `SERVE_API_ACCESS`, `SELL_API_ACCESS`,
`REDISTRIBUTE_NORMALIZED`). That evidence cannot be produced from here; it can
be produced from an ordinary browser, and that is the owner-side step if this
candidate is ever revisited. No prohibition was found either.

**Ingestion limits.** The pipeline accepts `json|csv|html|pdf` only
(`packages/extraction/src/schema.ts`); fueleconomy.gov's web service is XML, so
the fuel-economy leg needs a new extraction format before any real-source cycle.
Per-artifact size is not a problem (largest observed record 13,678 bytes).

**Disqualifiers (precise).** (a) Rights evidence unreadable from the execution
environment; (b) cross-source model identity is one-to-many for ~half of
vehicles and requires either silent fuzzy matching or a human-maintained
mapping; (c) XML extraction capability absent. (b) is the substantive one: it
survives a change of environment.

### 2. ENERGY STAR certified HVAC products

**What changed since 2026-09-16.** Refresh cadence was "unknown"; on 2026-09-19
every ENERGY STAR dataset in the catalogue (28 results for `hvac`, and the four
previously examined ids) reports `rowsUpdatedAt` / `X-SODA2-Truth-Last-Modified`
of **2026-09-18**, which is consistent with a daily republish. This is **one
observation**, not a cadence; it is recorded so the next reviewer measures a
second point rather than assuming. `data.energystar.gov` returns 200 for
`/resource/` JSON with `Crawl-delay: 1` and disallows only `/api/odata/`,
`/OData.svc/` and browse/search facets; no rate-limit headers are exposed.

**Fair comparison.** The free substitute is the SODA API itself: JSON,
`$where`-filterable on `model_number`, 1,000-row pages, daily updates, six HVAC
datasets. Data Foundry's value would be cross-dataset normalised identifiers,
evidence links, de-listing/change history and the exclusion of the AHRI
reference field. That is real but modest, and it has never been measured with a
customer. Demand proxies: none found (RapidAPI search pages are client-rendered
and expose no metrics to this egress; no relevant npm package).

**Rights (unchanged, owner-gated).** Counsel review of whether the EPA Standard
Open Data License reaches partner- and CB-submitted fields, and the
acquisition-method authorisation, are both open (`UA-001`, owner direction
2026-09-16). YAML still records `commercial_use_allowed: false`,
`redistribution_allowed: false`, `status: UNDER_REVIEW`. Engineering cannot
create an ALLOW.

**Disqualifiers (precise).** (a) Two owner-side approvals outstanding — this
candidate cannot move without them regardless of engineering; (b) value over the
free API unmeasured. (a) is not new and was not re-litigated here.

### 3. GLEIF LEI records (screen)

`api.gleif.org/api/v1/lei-records` returned 200 with `total: 3,434,832` and a
golden-copy publish date of 2026-09-18. The data is CC0; the API is a documented,
free JSON:API with delta files. **No value survives the fair comparison**: any
normalisation Data Foundry could add is already provided upstream. NO_GO at
screen; no further work.

## Consequence for this session

Per the directive, product-specific implementation stops. The work that is
independently useful and already authorised — and that any eventual product
needs before a self-service transaction can exist — is:

1. The **per-period request allowance with a hard stop** that the pricing page
   already promises and that ADR-0007 deferred "until asked" (the directive now
   asks: 5,000 included requests, hard stop, 100-request evaluation). Product-
   independent; see ADR-0014 and migration `0034`.
2. Correcting active guidance that made interviews, three design-partner
   integrations, founder outreach or manual invoicing prerequisites for a
   self-service launch (work package 1 of the directive).
3. The provider read-back and route-less deployment gate (PR #55), which
   customer exposure depends on.

What this session did **not** do: enrol RapidAPI, build Stripe, ingest any real
source, deploy any Worker, or publish any listing. The commercial status is
**NO PRODUCT SELECTED**, which precedes `SELF_SERVICE_READY_NO_EXTERNAL_REVENUE`.

## Supersession

This record supersedes `self-service-revenue-candidates-20260917.md` and
`first-paid-slice-decision-20260917.md` as the current word on candidate
selection. It does not reopen `tariff-parked-sec-promoted-20260917.md`,
`sec-canonical-facts-validation-20260917.md` or
`faa-registry-phase56-validation-20260917.md`, whose NO_GO conclusions stand.
The EMS credential hypothesis (`CONTINUE_TARGETED_VALIDATION`) is a different
business shape (interview-gated, not self-service) and is outside this pass.
