# Agent-usability benchmark — measured, not argued

**Question:** for a realistic agent task, is one Data Foundry call materially
better than the agent working the free sources itself?

Every baseline figure below was produced by calling the real endpoint on
2026-09-17. Data Foundry targets are **projected**, and labelled as such — they
are the size of the answer object, not a measured product. Nothing here claims
an improvement that was not computed from a real response.

---

## Baselines, measured

| Agent task | Calls | Schemas | Bytes retrieved | What the agent must still reason over |
| --- | --- | --- | --- | --- |
| **A. Duty on HTS 8507.60.00 from China** | 2 | 1 + hierarchy | **503,140** | 679 Ch.99 lines, **479 with prose rates**, **91 mentioning China**; base rate inherited from a parent line |
| **B. Is CVE-2021-44228 exploited, how likely** | 3 | 3 | **1,815,326** | KEV has no per-CVE endpoint, so the **entire 1,713-entry catalogue** is pulled to check one CVE |
| **C. Apple latest revenue + net income** | 1 | 1 | **3,789,099** | **505 concepts**, **8 containing "Revenue"** — the agent must pick, and can pick wrong |
| **D. Open recalls + economy for a VIN** | 3 | 3 (2 JSON, **1 XML**) | 12,868 | three make/model conventions (`HONDA`/`HONDA`/`Acura`), two serialisations |
| **E. Has this provider changed / is it excluded** | 1 | 1 | 1,144 | **unanswerable** — NPPES returns current state only, no history field |

## Projected Data Foundry targets

One call, one schema, an answer object of roughly 0.5–2 KB in every case. The
reduction is therefore ~**250×** (A), ~**900×** (B), ~**1,900×** (C) and ~**6×**
(D) on bytes, and 3→1 on calls and schemas for B and D. For E the change is not
efficiency at all — it is answering a question that currently has no answer.

**These targets are arithmetic on the answer payload, not benchmarks of a built
system.** They should be re-measured once an endpoint exists.

## The test that actually separates these

Bytes at inference time flatter every candidate, because **a developer can
cache**. The durable question is what remains expensive *after* caching:

| Candidate | Survives caching? | Why |
| --- | --- | --- |
| A. Tariff | **Yes** | Prose→number extraction, hierarchy inheritance, origin matching and exclusion logic run **per question**, not per refresh |
| C. SEC | **Yes** | Concept disambiguation is semantic normalisation, needed on every query |
| D. Vehicle | Partly | Cross-convention entity resolution persists; volume is small |
| B. Security | **No** | Cache KEV once daily and the 1.8 MB collapses to a dictionary lookup. The join is three fields |
| E. Provider | N/A | Value is accumulated history, which cannot be backfilled |

**This reverses my own earlier reasoning in both directions, and both reversals
are in this table.** I previously cut the security join because "the free
sources are good and the join is a morning's work" — judged as a *developer*
task that was right, and judged as an *agent* task it was wrong by 1.8 MB. But
applying this prompt's own `still_reject` rule — "Data Foundry adds negligible
reduction in machine work" — it fails on durability once cached. The measurement
rescued it; the caching test sends it back.

---

# Finalists

## F1 — US Import Duty & Tariff Stack ★ leading candidate

**Agent job.** "What will I actually pay to import this, from this country,
today?"

**Raw sources.** `hts.usitc.gov/reststop` (search, exportList), Chapter 99, CBP
CSMS, Federal Register.

**Current raw workflow.** Fetch the line; walk up the `indent` hierarchy for the
inherited base rate; pull all 679 Chapter 99 lines (486 KB); scan 91
China-mentioning prose entries; parse "the duty provided in the applicable
subheading plus 25%" into a number; apply exclusions.

**Proposed tools.** `compute_duty_stack(hts, origin, date)`,
`resolve_hts(query)`, `get_changes_since(date)`, `get_evidence(component_id)`.

**Measured baseline.** 2 calls, 503,140 bytes, 479 prose lines in scope.
**Projected target.** 1 call, ~1.5 KB, zero prose parsing at inference.

**Precomputed value.** The prose→rate extraction, hierarchy inheritance, origin
matching and stacking — all of which recur per question and survive caching.

**Rights.** US Government work, expected public domain. `hts.usitc.gov` serves
no `robots.txt` (MEASURED). **One counsel confirmation required before launch.**

**Acquisition.** Scheduled `exportList` by chapter + CSMS polling. Fits the
existing runner. Not yet activated — correctly gated.

**Free alternatives.** USITC's own site and API: real, but does not answer the
question. **Paid alternatives.** ustariffrates.com Pro **$49/mo**,
tariffsapi.com, gingercontrol.com, a RapidAPI listing, 4+ Apify scrapers.

**Why still pay.** The free source returns prose; the product is a number with
provenance.

**Price.** $19 / $79 / $249 monthly, metered per computation.
**Discovery.** Per-HTS-code pages (a competitor already ranks this way), MCP,
RapidAPI, OpenAPI + llms.txt. **Effort.** Small-medium on current architecture.

**Strongest failure reason.** Correctness liability. A wrong rate costs money
and can create a customs problem; measures change by executive action faster
than a crawl may catch. Ship as an evidence-backed reference with per-component
citations and an explicit "not customs advice" disclaimer, never a guaranteed
landed cost.

## F2 — SEC XBRL normalised fundamentals

**Agent job.** "What were this company's revenue and net income last quarter?"
**Measured baseline.** 1 call, **3,789,099 bytes**, 505 concepts, 8 revenue-like
names. **Projected target.** 1 call, ~1 KB, one canonical concept per metric
with the source tag cited. **Precomputed value.** Concept disambiguation and
point-in-time history — durable, and directly a hallucination-reduction
argument. **Rights** clean (public domain; declared-UA and rate limits apply).
**Paid comparator** `sec-api.io` at $49/$199. **Failure reason:** the most
crowded category, and normalisation choices are opinions someone will dispute.

## F3 — Vehicle identity, recalls and economy

**Agent job.** "Any open recalls for this VIN, and what does it really cost to
run?" **Measured baseline.** 3 calls, 3 schemas, one of them **XML**, 12,868
bytes, three make/model conventions. **Projected target.** 1 call, ~1 KB, one
resolved vehicle. **Precomputed value.** Cross-agency entity resolution.
**Rights:** US federal, `[INFERRED — per-source verification required]`.
**Failure reason:** bytes are small, so the win is convenience rather than
efficiency, and free VIN tools are plentiful.

## F4 — Provider registry with history

**Agent job.** "Did anything about this provider change, and are they excluded?"
**Measured baseline.** NPPES answers the *current* state in 1,144 bytes and
**cannot answer the change question at all** — there is no history field.
**Projected target.** `get_historical_state` / `get_changes_since` over
accumulated snapshots. **Precomputed value.** History that does not exist
upstream. **Failure reason:** history cannot be backfilled, so the product is
weak until it has been running for months — the slowest path to a first dollar
of the five.

## F5 — Vulnerability triage join (NVD + KEV + EPSS)

**Agent job.** "Is this CVE exploited in the wild, and how likely?"
**Measured baseline.** 3 calls, 3 schemas, 3 hosts, **1,815,326 bytes**,
dominated by KEV having no per-CVE endpoint. **Projected target.** 1 call,
~0.5 KB. **Best measured efficiency of all five.** **Failure reason, and it is
decisive:** it does not survive caching. One daily KEV pull reduces the whole
advantage to a dictionary lookup, and EPSS terms need their own check. Recorded
as a finalist because the measurement is real and reversed my prior reasoning —
not recommended, because the durable value is thin.

---

## Ranking

| | Measured byte reduction | Survives caching | Willingness-to-pay evidence | Verdict |
| --- | --- | --- | --- | --- |
| F1 Tariff | ~250× | **Yes** | $49/mo comps, SEO funnel proven | **Lead** |
| F2 SEC | ~1,900× | **Yes** | $49/$199 comps | Strong second |
| F3 Vehicle | ~6× | Partly | category exists | Third |
| F4 Provider | n/a | n/a | comps exist | Slow start |
| F5 Security | ~900× | **No** | crowded | Measured well, rejected on durability |

F1 leads because it is the only candidate that combines durable per-question
computation with observed willingness to pay at the target price and a proven
organic discovery channel. F2 has the largest measured reduction and would be
the pick if crowding were less severe.

## What this does not establish

No endpoint exists, so every Data Foundry figure is a projection from the answer
payload. No customer has been contacted and no revenue exists. Rights for F1 are
unconfirmed and gate it entirely. The measured baselines are single observations
from one network location on one day, not distributions.
