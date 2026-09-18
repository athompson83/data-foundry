# FAA Aircraft Registry Agent API — phases 5 and 6

**Date:** 2026-09-17
**Candidate:** FAA Aircraft Registry Agent API — aircraft facts only, owner name and
address excluded.
**Core query:** given N-number X, return the current registered aircraft facts with
normalised manufacturer/model/engine data and provenance.

## Decision: NO_GO

Two NO_GO criteria fire on measured evidence, and they are the same finding seen from
two sides:

1. **Every paid comparable monetises owner identity**, which this product excludes.
2. **A free, keyless, publicly hosted, PII-redacting equivalent already exists** and
   answers the same 11 of 12 benchmark questions this product would.

The engineering case is sound — the data is deterministic, the edge cases are
representable, the refresh is automatable and the serving cost is negligible. That is
the problem. The work is cheap enough that it has already been done and given away,
and the field that carries the money is the one the product refuses to sell.

### This is not the "free source data" error again

A prior screen was corrected for rejecting candidates merely because free source data
existed. That correction stands and is not being re-litigated. The rejection here is
different in kind and rests on two things a free *source* would not establish:

| | Free source data | What was measured here |
| --- | --- | --- |
| What exists free | The raw FAA files | A finished, hosted, agent-native API |
| Machine work remaining | Download 73 MB, parse 5 files, 2 joins | One MCP call, 0.27 s |
| Effect on this product | None — the product is the processing | The product's whole output |

The measured competitor is not a data dump. It is the proposed MVP, already running.

---

## Phase 5 — demand validation

### Competitor map

Every price and usage figure below was read from the live listing on 2026-09-17.

#### Paid, FAA-registry-specific

| Product | Price | Total users | Monthly users | What it sells |
| --- | --- | --- | --- | --- |
| [apify/parseforge](https://apify.com/parseforge/faa-aircraft-registry-scraper) | $0.009 / result | 29 | **0** | Bulk-file parse, all 7 files, owner included |
| [apify/jungle_synthesizer](https://apify.com/jungle_synthesizer/faa-aircraft-registry-crawler) | $0.10 / run + $0.01 / record | 6 | **0** | "HNW lead generators targeting corporate-jet proprietors" |
| [apify/scrapesage](https://apify.com/scrapesage/faa-aircraft-registry-scraper) | $3.22 / 1,000 records | 2 | **1** | Owner leads with a derived "lead score (0–100)" |
| [apify/scrapemint](https://apify.com/scrapemint/aircraft-owner-leads) | $10.00 / 1,000 rows | 2 | **1** | "Owner name and mailing address… aviation marketing list vendors charge hundreds of dollars for exactly this data" |

**Measured monthly active users across all four: 2.** All four sell owner identity.
Not one sells the non-PII aircraft-facts slice this product proposes.

#### Paid, adjacent (aviation data platforms)

| Product | Published pricing | Scope |
| --- | --- | --- |
| [AeroDataBox](https://aerodatabox.com/pricing/) | Direct $19 / $99 / $499 per month; RapidAPI $8 / $40 / $200; API.Market $7.50–$187.50 | Global flight + aircraft data, registration history included |
| [SkyLink](https://github.com/SkyLink-API/aircraft-registration-lookup-api) | RapidAPI, 1,000 free requests/month | 615,000+ worldwide aircraft by tail or ICAO24 |
| [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/v4/) | From $0.002 / query, per 15-result set, volume discounts to 94% | Flight tracking; owner endpoint is PII |

These prove willingness to pay **for aviation data APIs at $8–$99/month** — but for
global, multi-source coverage, not for a US-registry subset. A US-only, non-PII slice
priced into the same band is strictly dominated by AeroDataBox's $19 tier.

#### Free, and substantially equivalent — measured live

[`cyanheads/faa-aircraft-registry-mcp-server`](https://github.com/cyanheads/faa-aircraft-registry-mcp-server),
Apache-2.0, on npm, hosted publicly at `faa-aircraft-registry.caseyjhand.com/mcp`.

```
initialize          HTTP 200, 0.508 s, protocol 2025-06-18, server v0.1.8
faa_lookup_registration N1013A   HTTP 200, 0.641 s, 1,796 bytes
  -> 1999 BOEING 767-36N, GE CF6-80C2B7F, Mode S A00B2D, status "Valid registration (V)"
  -> "Owner (ownerRedacted=true): withheld — owner PII is redacted on this deployment."
```

It exposes five tools and one resource; resolves active, deregistered and reserved
records; decodes every coded field to both raw code and label; refreshes daily against
the FAA's nightly re-release; and **redacts owner PII by default, fail-safe** — the
same scoping decision this candidate treated as its distinguishing product judgement.

npm downloads, last 30 days (2026-08-18 → 2026-09-16): **463**.
That is more monthly activity than all four paid FAA products combined.

Other free equivalents measured: [`api.adsbdb.com`](https://api.adsbdb.com) answers
N1013A and N100 in 332–464 bytes with no key (but returns 404 for N10000 — it covers
aircraft observed on ADS-B feeds, not the whole registry, and it *does* republish owner
names), [`arla.njf.dev`](https://github.com/njfdev/Aircraft-Registration-Lookup-API)
(MIT, "a public, free API"), and [`@squawk/icao-registry`](https://github.com/neilcochran/squawk)
(400 npm downloads/month).

### Repeated developer implementation — real, and pointing the wrong way

Independent projects that download and join the same files: `alexwoolford/faa-registry-mirror`
(Rust, SCD-2 history), `neilcochran/squawk` (TypeScript), `ClearAerospace/faa-aircraft-registry`
(Python, on PyPI), `nkzarrabi/hangarbay` (Python, zero-dependency), `cyanheads/…-mcp-server`
(MCP), `Drooling-sheep/cirrus-registration-data` (weekly dashboards), plus io-aero's
documented pipeline.

This is genuine demand evidence: people keep needing this and keep building it. It is
**not** evidence of paid demand, and the community's own answer says why. On
[Pilots of America, "API for FAA aircraft database"](https://www.pilotsofamerica.com/community/threads/api-for-faa-aircraft-database.125423/)
(13 replies), the responses are uniform:

> "You can download the entire database from that site, so there's no need for an api."

> "You can also easily automate a daily download refresh of the data."

The single mention of money is a joke offer to *build* one — "Heck, I'll slap an API for
that together in a couple days if you're willing to pay me" — not an offer to buy one.

### Downstream machine use cases

Found and documented by the competitors themselves: ADS-B/transponder correlation (Mode S
hex is the join key), aviation insurance underwriting, FBO / maintenance / avionics /
parts outreach, broker ownership tracking, ESG emissions research, OSINT, journalism.

Of these, the ones that pay today — insurance outreach, broker tracking, lead
generation, journalism about who owns what — want the owner. The ones that want aircraft
facts alone (ADS-B enrichment, fleet dashboards) are already served free by the
ADS-B ecosystem and the MCP server above.

No keyword or search-volume tool was available in this environment; no search volumes
are estimated or asserted anywhere in this document.

---

## Phase 6 — update mechanics, schema stability, edge cases and economics

Measured against the 2026-09-16 23:30-central release
(`ReleasableAircraft.zip`, 73,108,402 bytes; 533,016,265 bytes unpacked; 7 files).

### Refresh cadence — automatable

FAA states the download is "refreshed daily at 11:30 pm central time"; the N-number
inquiry page states "Data Updated Each Federal Working Day At Midnight". Both are
consistent with what the snapshot shows: the newest `LAST ACTION DATE` in the file is
`20260916`, the day before retrieval.

Change volume, from `LAST ACTION DATE` recency:

| Window | Records | Per day |
| --- | --- | --- |
| 1 day | 271 | 271 |
| 7 days | 1,056 | 151 |
| 30 days | 4,696 | 157 |
| 365 days | 49,376 | 135 |

One operational wrinkle, measured: `HEAD` on the zip returns `Content-Length: 3124` and
`Last-Modified: Wed, 18 Sep 2013 17:14:00 GMT` — an interstitial, not the file. Cheap
change detection via `Last-Modified` is unavailable; the full 73 MB must be fetched
(2.13 GB/month). An `ETag` is returned and may be usable. This is a cost, not a blocker.

### Schema stability — additive, publisher-documented

FAA documents its own layout changes on the download page: three fields added
2012-11-05 (Kit Manufacturer, Kit Model, Mode S hex), `Doc Type` appended to the
Document Index 2024-07-30, and Aircraft Certificate Expiration Date added to the Master
file. Every documented change appends to the end of a record, so a header-name parser is
unaffected. The layout document (`ardata.pdf`, dated 2025-05-08) ships **inside the
archive**, so the schema and every enum travel with the data.

*Limit of this evidence:* historical snapshots could not be compared directly.
`web.archive.org` is **EGRESS_BLOCKED** from this environment (HTTP 403, "Blocked by
egress policy"), so schema stability here is publisher-documented, not independently
measured across releases.

### Edge cases — all deterministic, none needing human adjudication

| Case | Measured | Deterministic representation |
| --- | --- | --- |
| Status enum | 21 distinct values in MASTER, every one defined in `ardata.pdf` | Code + label |
| Blank engine key | 39,621 (12.51%) | `engine: null`, `engineKeyPresent: false` — absence, never a guess |
| Join integrity | `MFR MDL CODE` → ACFTREF **316,721 / 316,721 (100.00%)**, 0 orphans; `ENG MFR MDL` → ENGINE 277,100 non-blank, **0 orphans** | Hard joins, no fuzzy matching |
| Duplicate N-numbers | **0** of 316,721 | One record per question |
| **N-number reassignment** | 82,972 live N-numbers (26.2%) also appear in DEREG; **82,859 (99.9%)** carry a serial absent from every prior DEREG row | The answer is "current registration as of <release date>" — time-qualified, still single-valued |
| Deregistration history depth | 383,422 DEREG rows over 301,098 N-numbers; max 9 prior records for one number | Ordered by `CANCEL-DATE` |
| Reserved numbers | 126,877, **0 overlap with MASTER** | Disjoint record type |
| Simultaneous records | 49,834 N-numbers in both DEREG and RESERVED — FAA's own UI reports "has Reserved/Multiple Records" | `recordType` array, not a single value |
| Pending number change | 1,089 reservations with `N-NUM-CHG` set | Flag passed through |
| Expiry vs status | Only **70 of 316,721 (0.02%)** carry a past expiration date; 36 are status `N`, 4 status `V` | Both fields served; no reconciliation invented |

**The NO_GO criterion "requires frequent manual interpretation" does not fire.** Every
case above is a field, an enum or a join — mechanical. Reassignment is the interesting
one: it makes the core question time-scoped rather than ambiguous, which is a schema
decision, not an adjudication.

### Owner PII — no suppression workflow needed, demonstrated

Withholding under 49 U.S.C. § 44114(b) is **not** pre-applied in the file: `NAME` and
`STREET` are populated on 311,688 of 316,721 rows (98.41%), and 41.02% of registrants
are Individuals.

The product avoids the resulting continuing obligation by never ingesting those columns.
This was demonstrated rather than asserted — the loader built for the benchmark produces:

```
master    316,721 rows  [n_number, serial_number, mfr_mdl_code, eng_mfr_mdl, year_mfr,
                         type_registrant, region, last_action_date, cert_issue_date,
                         certification, type_aircraft, type_engine, status_code,
                         mode_s_code, fract_owner, air_worth_date, expiration_date,
                         unique_id, kit_mfr, kit_model, mode_s_code_hex]
owner-identity columns present: NONE
```

### Economics — measured, and fatal in the other direction

| Item | Measured |
| --- | --- |
| Acquisition | 73,108,402 bytes/day = **2.13 GB/month**, free from FAA |
| Build | **11.0 s** to construct the 5-table non-PII mirror (925,831 rows) |
| Storage | **93,908,992 bytes (90 MiB)** SQLite, all five tables indexed |
| Serving | **278 bytes** per answer; 1,000,000 answers/month = 278 MB egress |

The entire product fits inside the free tier of essentially any host. That is exactly
why the incumbent gives it away and why a customer's alternative to paying is one `npx`
command plus a nightly cron.

### Support burden

Low in absolute terms — the predictable questions are "why is the engine blank"
(12.51% of records, answered by `engineKeyPresent: false`), "why does this N-number show
two record types" (49,834 cases), "why does this tail number show a different aircraft
than last year" (82,859 cases), and "where is the owner" (the scope decision). Each has a
fixed documented answer.

But support burden is only meaningful against revenue, and at the price this can
command against a free hosted equivalent, **any** founder-answered ticket is
uneconomic.

---

## Agent-efficiency benchmark

Twelve machine questions, four paths, measured on 2026-09-17. Owner identity is excluded
from every path's answer and is not counted as value. Reproduce with
`docs/evidence/faa-agent-benchmark.py <archive dir> --live`.

- **A — raw FAA HTML**: `registry.faa.gov/AircraftInquiry`, measured live
- **B — raw FAA bulk archive**: download + parse + join, measured
- **C — proposed Data Foundry API**: the non-PII mirror, measured; modelled as one HTTP
  JSON call. **No endpoint was deployed.**
- **D — free incumbent MCP server**: measured live

| Q | Question | A bytes | A ok | C bytes | C ok | D bytes | D ok |
| --- | --- | ---: | :-: | ---: | :-: | ---: | :-: |
| Q1 | What aircraft is registered as N1013A? | 31,522 | yes | 370 | yes | 1,610 | yes |
| Q2 | What engine does N10000 have? *(blank engine key)* | 31,506 | yes | 307 | yes | 1,242 | yes |
| Q3 | Is N10025 a valid registration? *(status edge case)* | 32,003 | yes | 360 | yes | 1,371 | yes |
| Q4 | Make/model/seats for N1013A *(ACFTREF resolution)* | 31,522 | yes | 370 | yes | 1,610 | yes |
| Q5 | When does N100 expire? | 31,529 | yes | 374 | yes | 1,572 | yes |
| Q6 | What airframe was N10003? *(deregistered)* | 21,518 | yes | 47 | yes | 567 | yes |
| Q7 | What is N1000C? *(reserved, never registered)* | 25,185 | yes | 43 | yes | 496 | yes |
| Q8 | Mode S hex for N1013A *(ADS-B correlation)* | 31,522 | yes | 370 | yes | 1,610 | yes |
| Q9 | Year of manufacture for N100 | 31,529 | yes | 374 | yes | 1,572 | yes |
| Q10 | Engine count and seats for N10000 | 31,506 | yes | 307 | yes | 1,242 | yes |
| Q11 | Has N100 ever carried a different airframe? *(history)* | 31,529 | **NO** | 374 | **NO** | 1,572 | **NO** |
| Q12 | What is N99AQ? *(valid format, unassigned)* | 21,526 | yes | 45 | yes | 304 | yes |
| | **total** | **352,397** | **11/12** | **3,341** | **11/12** | **14,768** | **11/12** |

Per answer: **A 29,366 bytes / ~490 ms · C 278 bytes / 0.2 ms local · D 1,231 bytes / ~295 ms.**
C is 105× lighter than A. D is 24× lighter than A. C is 4.4× lighter than D — and that
gap is response formatting, not capability: D returns a rendered markdown block
*alongside* its structured content.

Path B, for completeness: 73,108,402 bytes compressed once, 533,016,265 unpacked,
925,831 rows across 5 files, 2 joins, 11.0 s to first answer.

**What the benchmark establishes:** the GO criterion "materially reduces machine work
compared with FAA's raw interfaces" is **met** — and met identically by a free
incumbent, which is why it cannot carry a price.

**Where all three fail identically (Q11):** none returns prior registrations for a
currently-registered N-number. That is the one unserved slice, and it is discussed under
pricing below.

Two things the benchmark corrected about FAA's raw HTML path, against my own earlier
claim (see corrections):

- The HTML **already contains the resolved joins** — `BOEING`, `767-36N`,
  `CF6-80C2B7F`, `Fixed Wing Multi-Engine` all appear in the N1013A page. An agent using
  the HTML path does not perform the two joins; FAA performs them.
- The HTML represents a blank engine key as **"Unknown"**, not as a guess.

The HTML path's real deficiencies are narrower than stated before: 29 KB of markup per
answer, no machine contract, and it will not tell you what airframe a deregistered
N-number carried — for N10003 it returns only the sentence "N10003 is Deregistered".

---

## Pricing test

| Tier | Viable on cost? | Viable against the market? |
| --- | --- | --- |
| $9–$29/mo hobby/developer | Yes — serving costs are ~$0 | **No.** The alternative is a free hosted MCP endpoint, or `npx` + cron for $0 |
| $49–$99/mo small SaaS | Yes | **No.** AeroDataBox sells global flight + aircraft data with registration history at $19 direct / $8 on RapidAPI |
| Usage-based | Yes | **No.** The FAA-specific paid floor is $0.009/record — and that price *includes* the owner field this product omits |

Per the instruction not to finalise pricing before demand and competitor pricing are
measured: both are now measured, and the finding is that **no price is supportable**, not
that a particular price is right. The defensible price against a free, hosted,
PII-redacting equivalent is $0.

**The one unserved slice, and why it does not rescue the candidate.** Registration
*history* and a *change feed* (Q11, and the proposed `get_registry_changes`) are served
by nobody measured here — the raw data exists in DEREG (383,422 rows, up to 9 prior
records per N-number) and in a nightly diff (~157 actions/day). But the buyers who
demonstrably pay for change detection are the lead-gen buyers: scrapesage sells exactly
this as "a monitoring mode to surface only newly-registered aircraft… fresh purchase
intent signals," and its value is the new owner's name and address. Stripped of owner
identity, the change feed loses the buyer that pays for it. The single differentiator
maps onto the single market the product refuses to serve. That is a clean reason to
stop, not a narrow miss.

---

## Criteria scorecard

### GO criteria

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Credible evidence of recurring machine demand | **MET** — 8+ independent implementations, 892 npm downloads/month across three free packages, recurring forum questions |
| 2 | A paid comparable validates willingness to pay, or equivalent developer activity supports self-service demand | **FAILED** — every FAA-specific paid product sells owner identity; 2 monthly actives across all four. Adjacent paid APIs (AeroDataBox) validate payment for *global* aviation data, not this subset |
| 3 | The non-PII API materially reduces machine work vs FAA's raw interfaces | **MET** — 105× fewer bytes than the HTML path, 11/12 questions answered |
| 4 | Update process automatable, no recurring human adjudication | **MET** — daily file, header-named parse, 11.0 s rebuild |
| 5 | Schema/status edge cases representable deterministically | **MET** — 21 documented status codes, 0 join orphans, 0 duplicate N-numbers, absence modelled explicitly |
| 6 | Serving economics support low-cost self-service pricing | **MET on cost, FATAL in effect** — 90 MiB and 278 bytes/answer is why the incumbent is free |
| 7 | Customer can discover, pay, obtain access and consume without founder involvement | **MET in principle** — and irrelevant while criterion 2 fails |

### NO_GO criteria

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Demand is primarily for owner identity rather than aircraft facts | **FIRES** — 4 of 4 paid comparables sell owner identity; the only one positioned on aircraft facts alone (parseforge, 29 users) has **0** monthly users |
| 2 | Free APIs already provide substantially equivalent machine access with similar freshness and reliability | **FIRES** — measured live: same daily FAA release, same PII redaction, 11/12 benchmark questions, 0.27 s, keyless, Apache-2.0, self-hostable |
| 3 | N-number history or status semantics require frequent manual interpretation | does not fire |
| 4 | FAA update mechanics too brittle for low-touch operation | does not fire |
| 5 | Support burden overwhelms low-price self-service economics | does not fire on volume; fires trivially at a $0 supportable price |

---

## Corrections to my own earlier claims

1. **The raw FAA HTML path is less hostile than I said.** PR #51 framed answering from
   authoritative data as requiring the 73 MB archive and two joins. Measured: the HTML
   page already carries the joined make, model and engine, and renders a blank engine key
   as "Unknown". The bulk path's advantages are byte count, a machine contract, and
   deregistered-airframe detail — not the joins.
2. **"No official JSON API exists" was true but incomplete as an argument.** A free
   third-party JSON/MCP equivalent does exist, is hosted, and was not found during the
   determinism screen because that screen measured the source, not the market.
3. **The non-PII scoping decision was not a differentiator.** I presented excluding owner
   identity as a product judgement that scoped the candidate. The free incumbent already
   does it, fail-safe, by default.
4. **The benchmark's first two runs were wrong in my favour and were fixed before
   publication.** An unnormalised N-number key made path C look 7× lighter than it is
   (47 bytes of "not found" for every question), and three token checks scored the free
   incumbent as incomplete when it was correct — it omits engine fields rather than
   writing "Unknown", and it validates N-number format, which path C as modelled does not.
   Corrected figures are the ones above.

## What would reverse this

- A measured paid buyer for aircraft facts **without** owner identity — not an
  inference from adjacent aviation APIs.
- The free hosted equivalent disappearing *and* the npm package being withdrawn. The
  hosted endpoint going away alone changes little: the package is Apache-2.0.
- A rights position that lets the product carry owner identity with the withholding
  obligation honoured mechanically rather than by recurring adjudication. That was
  rejected earlier for good reason and is not reopened here.

## Boundaries observed

No source activated. No production endpoint built — path C was measured against a local
SQLite file. Nothing deployed. No outbound sales, no customer contacted, no revenue. No
owner-PII product design: the loader provably has no owner column. This validation did
not mark PR #51 ready; the owner authorised that separately, once it had concluded.
The FAA archive was downloaded once for measurement and is not retained in the
repository.

## Review coverage on the merged head

Recorded so absence is not mistaken for review: **neither automated reviewer ran.**
`chatgpt-codex-connector` reported "You have reached your Codex usage limits for code
reviews." CodeRabbit posted `Review skipped: manual review required for this OSS
repository` — it does not review repositories with fewer than 10 stars. Both are
`success` states and neither blocks the merge, but neither is an independent review of
this record.

Repository CI on the merged head classified the diff **documentation-only** (the scope
job's `*.md|docs/*` selector), so the executable checks were correctly not required.
They were instead run locally against the same tree: `pnpm typecheck` clean, `pnpm lint`
clean, and `pnpm test` **226 files / 3,583 tests passed**.

## Reproduction

| Script | Produces |
| --- | --- |
| `docs/evidence/faa-registry-phase56.py <dir>` | Every Phase 6 count in this document |
| `docs/evidence/faa-agent-benchmark.py <dir> --live` | The four-path benchmark table |

Both read an unpacked `ReleasableAircraft.zip`
(`https://registry.faa.gov/database/ReleasableAircraft.zip`).

## Egress status of sources consulted

| Host | Reachable from this environment |
| --- | --- |
| `www.faa.gov`, `registry.faa.gov` | Yes — 200 |
| `apify.com`, `rapidapi.com`, `pypi.org`, `registry.npmjs.org`, `api.npmjs.org` | Yes — 200 |
| `faa-aircraft-registry.caseyjhand.com`, `api.adsbdb.com` | Yes — 200 |
| `github.com` (direct HTTP) | 400/403 to `curl`; readable via the fetch tool |
| `web.archive.org` | **EGRESS_BLOCKED** — 403 "Blocked by egress policy" |
| `pypistats.org` | 429 rate-limited, not blocked |

`EGRESS_BLOCKED` is recorded as an environment fact, not as a rights finding.
