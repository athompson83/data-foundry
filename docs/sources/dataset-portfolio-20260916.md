# Dataset portfolio — candidates beyond HVAC, 2026-09-16

A parallel discovery workstream. **Nothing here is activated, acquired, or
approved**, and no candidate may be ingested or published until its rights
decision is recorded.

## How to read the evidence labels

This session produced three errors from treating availability as authorisation,
so the labels are strict:

- **[MEASURED]** — observed today by direct request with the honest agent
  `data-foundry-research (dataset qualification)`. The value is what came back.
- **[INFERRED]** — reasoning from documentation, naming conventions or general
  knowledge. **Not evidence.** Must be measured before it can be relied on.
- **[UNVERIFIED]** — not checked at all.

**A `200` is not permission. A permissive `robots.txt` is not a grant.** Every
rights posture below is a research note, not a clearance.

## What was measured

Reachability with an honest user agent, today:

| Endpoint | Result |
| --- | --- |
| `vpic.nhtsa.dot.gov` VIN decode | **200** — 154 fields, 45 populated for a test VIN |
| `vpic.nhtsa.dot.gov` GetAllMakes | **200** — **12,363** makes |
| `api.nhtsa.gov` recallsByVehicle | **200** — 24 recalls for one model year |
| `api.gleif.org` lei-records | **200** — **3,431,742** records |
| `clinicaltrials.gov/api/v2` | **200** |
| `services.nvd.nist.gov` CVE 2.0 | **200** |
| `data.sec.gov` submissions | **200** — 164 KB for one filer |
| `api.crossref.org/works` | **200** — **186,660,866** works |
| `world.openfoodfacts.org` product | **200** |
| `fueleconomy.gov` (EPA) | **200** — XML |
| `saferproducts.gov` CPSC recalls | **200** |
| `api.eia.gov` | **200** |
| `api.fda.gov` drug/ndc, device/recall, food/enforcement | **200** on retest — an earlier 500 on `drug/event` was transient. Responses carry a `meta.disclaimer` |
| `api.openalex.org` | **429** — rate limited without a polite-pool identifier |
| `api.nal.usda.gov` FoodData | **429** — on the shared `DEMO_KEY` |
| `www.sec.gov/files/...` | **403** — SEC requires a declared UA with contact |
| `mobile.fmcsa.dot.gov` | **404** — on a placeholder key |

`robots.txt` **bodies**, read rather than status-checked:

| Host | Body | Consequence |
| --- | --- | --- |
| `api.gleif.org` | `User-agent: *` / `Disallow:` (empty) | Nothing disallowed |
| `clinicaltrials.gov` | **`Disallow: /api/`**, `Allow: /api/int/`, `/api/seo/`, `Crawl-delay: 1` | **The public v2 API path is disallowed to crawlers** |
| `data.energystar.gov` | Only `/browse?*` query variants | `/api/`, `/resource/` not disallowed |
| `data.gov.au` | **`Disallow: /`** | Entire host |
| `www.regulations.doe.gov` | **403 on `robots.txt` itself** | Policy unreadable without impersonation |
| `vpic.nhtsa.dot.gov`, `services.nvd.nist.gov`, `data.sec.gov`, `api.crossref.org` | 404 — no file | No prohibition; also no grant |

Licence text, read:

- **Open Food Facts** — **ODbL** for the database, **DbCL** for contents, CC-BY-SA
  for images. **[MEASURED]** ODbL is **share-alike**: a derived database may carry
  a copyleft obligation. Material to a commercial product.
- **Crossref** — per-work `license` arrays, e.g. `content-version: "tdm"` with a
  publisher URL. **[MEASURED]** Licences vary **per record**, so rights are not a
  dataset-level property here.

## The thesis, measured rather than asserted

The prompt asks for cases where agents must reconcile identifiers across sources.
US vehicle data is the cleanest measured example I found:

| Source | Agency | Make | Model | Format |
| --- | --- | --- | --- | --- |
| vPIC VIN decode | NHTSA | `HONDA` | `Accord` | JSON |
| Recalls API | NHTSA | `HONDA` | `ACCORD` | JSON |
| Fuel economy | EPA | `Acura`, `Aston Martin` | — | **XML** |

**Three identifier conventions, two formats, two agencies, no shared key** — and
two of those are the *same agency*. An agent asked "what are the open recalls and
the fuel economy for this VIN?" must decode at NHTSA, string-match into NHTSA
recalls across a casing difference, then string-match again into EPA against a
third convention. That is normalization value that exists whether or not a
competitor sells it. **[MEASURED]**

## Thirty candidates

**Vehicles and transport**
1. NHTSA vPIC — VIN decode, 12,363 makes **[MEASURED]**
2. NHTSA recalls / complaints / safety ratings **[MEASURED reachable]**
3. EPA fuel economy **[MEASURED reachable]**
4. FMCSA carrier safety (SAFER) **[UNVERIFIED — needs a real key]**
5. FAA aircraft registry **[UNVERIFIED]**
6. Mobility Database — GTFS feed registry **[MEASURED 302]**

**Health and life sciences**
7. openFDA — drug/device/food events, recalls, NDC **[MEASURED 200]**
8. ClinicalTrials.gov v2 **[MEASURED 200; robots disallows `/api/`]**
9. NPPES NPI registry **[MEASURED 200]**
10. RxNorm / NLM terminologies **[UNVERIFIED]**
11. CMS provider and hospital quality **[UNVERIFIED]**
12. DailyMed SPL **[UNVERIFIED]**

**Finance and legal entities**
13. GLEIF LEI — 3.43 M records **[MEASURED]**
14. SEC EDGAR / `data.sec.gov` **[MEASURED]**
15. UK Companies House **[UNVERIFIED]**
16. OpenFIGI **[UNVERIFIED]**
17. EIA energy data **[MEASURED 200]**

**Research, IP and reference**
18. OpenAlex **[MEASURED 429]**
19. Crossref — 186.7 M works **[MEASURED]**
20. USPTO PatentsView **[UNVERIFIED]**
21. Wikidata **[UNVERIFIED]**

**Security and software supply chain**
22. NVD / CVE **[MEASURED 200]**
23. CISA KEV **[UNVERIFIED]**
24. npm / PyPI registry metadata **[UNVERIFIED]**
25. OSV vulnerability database **[UNVERIFIED]**

**Consumer products, food and environment**
26. Open Food Facts **[MEASURED — ODbL]**
27. USDA FoodData Central **[MEASURED 429]**
28. CPSC recalls **[MEASURED 200]**
29. FCC equipment authorization **[UNVERIFIED]**
30. EPA ECHO / Facility Registry **[UNVERIFIED]**

## Ten finalists

Ranked by the combination the prompt asks for: agent demand, rights clarity,
supported access, and normalization value that survives a competitor having the
raw feed.

### F1 — US Vehicle Intelligence *(strongest, and the best-evidenced)*
- **Sources** NHTSA vPIC, NHTSA recalls/complaints/ratings, EPA fuel economy
- **Access** Documented JSON APIs, no key for vPIC/recalls; EPA is XML **[MEASURED]**
- **Rights** US federal works **[INFERRED — must be verified per source]**
- **Volume** 12,363 makes; 154 decode fields **[MEASURED]**
- **Normalization value** The three-convention mismatch above **[MEASURED]**
- **Agent queries** "Open recalls for this VIN"; "compare real-world economy across trims"; "which of my fleet's VINs have unrepaired safety recalls"
- **Competitors** Commercial VIN-decode APIs exist and charge per lookup **[INFERRED]**
- **Monetization** Direct paid API; per-VIN or per-seat; fleet/insurance/marketplace
- **Risk** Free official APIs exist, so value must be the *join*, freshness and provenance — not the raw decode

### F2 — Global Legal Entity Identity
- **Sources** GLEIF LEI golden copy; `data.sec.gov`; Companies House
- **Access** `api.gleif.org` 200, `robots.txt` disallows nothing **[MEASURED]**
- **Rights** GLEIF publishes LEI data openly **[INFERRED — licence page 404'd today, must be re-found]**
- **Volume** 3,431,742 records; golden copy stamped `2026-09-16T08:00:00Z` **[MEASURED]**
- **Normalization value** The record already carries `bic`, `mic`, `ocid`, `spglobal` cross-identifiers — an entity-resolution spine rather than a flat list **[MEASURED]**
- **Agent queries** "Resolve this counterparty name to an LEI and its parent"; "which subsidiaries file with the SEC"
- **Competitors** Well served commercially (OpenCorporates, S&P) — high intensity **[INFERRED]**
- **Monetization** Resolution API; cross-walk as the product

### F3 — Vulnerability → Package Impact
- **Sources** NVD CVE, CPE, OSV, npm/PyPI metadata
- **Access** NVD 200, no robots file **[MEASURED]**; others **[UNVERIFIED]**
- **Rights** NIST public domain **[INFERRED]**
- **Normalization value** CPE-to-package matching is the known pain point; agents currently reimplement it
- **Agent queries** "Does this lockfile contain a known-exploited CVE?"; "which advisories changed this week for my dependency set"
- **Competitors** Very high — Snyk, GitHub Advisory, Socket **[INFERRED]**
- **Verdict** Strong demand, crowded. Only worth it if the linkage is materially better

### F4 — Clinical Trials ↔ Publications
- **Sources** ClinicalTrials.gov v2, OpenAlex, Crossref
- **Access** CT.gov 200 **but `robots.txt` disallows `/api/`** **[MEASURED]** — a gate to resolve, exactly like AU
- **Rights** **[UNVERIFIED]**; Crossref licences vary per work **[MEASURED]**
- **Volume** Crossref 186.7 M works **[MEASURED]**
- **Normalization value** Linking trials to resulting publications is genuinely unsolved
- **Verdict** High value, but the robots gate must be cleared first — do not repeat the AU mistake

### F5 — US Healthcare Provider Identity
- **Sources** NPPES NPI, CMS quality, state licensure
- **Access** NPPES 200 **[MEASURED]**
- **Rights** **[UNVERIFIED]**
- **Normalization value** NPI-to-practice-to-quality joins; addresses are notoriously dirty
- **Competitors** Several commercial providers **[INFERRED]**

### F6 — Drug Identifier Spine
- **Sources** openFDA NDC, RxNorm, DailyMed
- **Access** `drug/ndc`, `device/recall`, `food/enforcement` all **200** **[MEASURED]**; responses carry a `meta.disclaimer` that travels with the data, as EPA's does
- **Normalization value** NDC ↔ RxCUI ↔ UNII ↔ SPL reconciliation is a classic agent tax
- **Rights** **[UNVERIFIED]**

### F7 — Food Product and Nutrition
- **Sources** USDA FoodData Central, Open Food Facts
- **Rights** **OFF is ODbL — share-alike [MEASURED]**. A derived database may inherit copyleft, which may be incompatible with a closed commercial product. **This is a rights blocker to resolve first, not a footnote.**
- **Verdict** Deprioritise unless counsel clears ODbL for the intended use

### F8 — Public Transit Feeds
- **Sources** Mobility Database (GTFS registry), agency feeds
- **Access** 302 **[MEASURED]** — needs a proper follow
- **Normalization value** Hundreds of agency feeds, per-agency quirks, no single schema-validated source
- **Rights** Per-feed, highly variable **[UNVERIFIED]** — likely the hardest part

### F9 — SEC Company Facts (XBRL)
- **Sources** `data.sec.gov` company facts / submissions
- **Access** 200 on `data.sec.gov`; **403 on `www.sec.gov`** without a declared UA **[MEASURED]**
- **Normalization value** XBRL tag variance across filers is real normalization work
- **Rights** US federal **[INFERRED]**; SEC publishes access rules that must be honoured **[UNVERIFIED]**

### F10 — Regulated Facility Compliance
- **Sources** EPA ECHO, Facility Registry Service
- **Rights** Likely the same EPA licence posture as ENERGY STAR **[INFERRED]** — which this session established is *not* a settled question for mixed-origin data

## Which could onboard quickly after the first pipeline proves out

**F1**, **F2** and **F9** — all JSON over HTTPS, stable identifiers, no
authentication needed for the measured endpoints, and no per-record licence
variance. They exercise the factory rather than the architecture.

**F4**, **F7** and **F8** each need a rights or policy decision *before* any
engineering, and should not be scheduled as if they were configuration work.

## Factory validation — what to measure on the second source

Per the direction, effort is the metric, not records:

1. Lines of **source-specific** code required, versus configuration.
2. Whether a new provider needed a new transport, or reused one.
3. Whether the canonical schema absorbed the fields, or needed extension.
4. Whether rights cells were expressible without new operations or channels.

**Repeated source-specific code is the signal that the abstraction is wrong.**
Do not generalise before two real onboardings have shown the same seam twice.

## Rule this portfolio must not break

Every candidate above is a **research note**. None has a recorded rights
decision, none has an authorised acquisition method, and several have measured
blockers (`Disallow: /api/` on ClinicalTrials.gov, ODbL on Open Food Facts).
The first real source still has to clear its own gates, and this list does not
shorten that path for any of them.
