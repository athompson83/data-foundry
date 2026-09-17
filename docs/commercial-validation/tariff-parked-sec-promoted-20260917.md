# Tariff flip checks: both fail — parked. SEC promoted.

Only the two checks capable of reversing the tariff NO_GO were run. Both fail.
No further tariff research follows this document.

---

## Flip check 1 — USITC terms: FAIL (unresolved)

Retried in a **real browser** (Playwright + Chromium), not a spoofed
User-Agent, after importing the egress CA into the browser NSS store so TLS
verification stayed on.

| Target | Real browser result |
| --- | --- |
| `www.usitc.gov/documents/terms_of_use.htm` | **403 Access Denied** (Akamai) |
| `www.usitc.gov/terms_use.htm` | **403** |
| `www.usitc.gov/` | **403** |
| `hts.usitc.gov/` | 200, renders fully |

**This corrects my earlier reasoning.** I had declined to read the terms on the
grounds that doing so would require impersonating a browser. That was the wrong
diagnosis: an actual browser is blocked too. The block is **network-level
against this egress**, not User-Agent filtering. Nothing about presenting a
different client string would have helped, and my principled refusal was
answering a question that was not being asked.

The authoritative terms therefore remain **unretrieved from here**. Rights are
materially unresolved. They are almost certainly readable from an ordinary
consumer connection, which is why this stays a question for the owner rather
than a permanent unknown.

## Flip check 2 — machine-readable Chapter 99 notes: FAIL

The HTS SPA does expose a file endpoint, found by observing the page's own
network calls:

```
https://hts.usitc.gov/reststop/file?release=currentRelease&filename=<name>
```

It serves `General Notes`, `General Note 1`–`6`, `Preface`, `Change Record`,
`China Tariffs`, `Notice to Exporters`, and — the one that matters —
`Chapter 99`.

| Request | Result |
| --- | --- |
| `filename=Chapter 99` | **HTTP 200, 14,004,204 bytes, PDF 1.6** |
| `filename=Chapter 99 Notes` | 503 |
| `filename=NoSuchFileXYZ` (control) | 503 |

The control confirms the PDF hit is real. Extracted: **2,747,280 characters**,
containing `U.S. Notes`, `note 2(a)` and `subdivision (` — so this **is** the
governing text that 85% of rated Chapter 99 lines defer to.

**And it exists only as a PDF of legal prose.** There is no JSON, XML or CSV of
the notes; `reststop/notes` returns 404 and the structured export carries
tariff lines only.

The GO condition required the notes "in an authoritative **machine-readable**
form". A 14 MB PDF whose applicability rules are nested subdivisions of
statutory prose is not that. Turning it into applicability logic is legal-text
interpretation — precisely the NO_GO clause.

## Decision

**NO_GO confirmed. Tariff research is permanently parked.** Not "revisit
later": both flip checks were the designated reversal path, and both failed.

What was worth keeping is already committed: the hierarchy resolver and rate
grammar in `docs/evidence/tariff-determinism-prototype.py` (base schedule 97.7%,
Chapter 99 99.2% deterministic). Both are domain-independent enough to be
useful elsewhere.

---

# SEC agent-native financial facts — promoted

Measured against the real `companyfacts` for Apple (CIK 0000320193),
**3,789,099 bytes**, on 2026-09-17.

## What the raw path actually costs an agent

| Measurement | Value |
| --- | --- |
| Bytes for one company | **3,789,099** |
| `us-gaap` fact rows in that one file | **25,046** |
| Distinct concepts | 505 |
| Concepts containing "Revenue" | **8** |
| Three-company comparison | ~**11.4 MB** |

## The two traps that produce confidently wrong answers

**1. A revenue time series spans three concepts.** Apple's annual revenue is
not in one place:

| Concept | Years covered |
| --- | --- |
| `SalesRevenueNet` | 2007–2017 |
| `Revenues` | 2016–2018 |
| `RevenueFromContractWithCustomerExcludingAssessedTax` | 2017–2025 |

An agent asked for "revenue 2015–2024" that picks a single concept returns a
**silently truncated series** — no error, no gap marker, just a shorter answer
that looks complete.

**2. Annual and quarterly facts share one concept and unit.** Rows whose period
ends in 2023, by duration: **six 3-month, two 6-month, two 9-month, three
12-month**. "Annual revenue" is not a field; it is a duration filter the agent
must compute. Picking the largest, or the first, is wrong in different ways.

## A hypothesis of mine that the data did not support

I expected restatements to be a headline problem. Measured: of 21 distinct
10-K periods for the main revenue concept, **11 were reported in more than one
filing, and 0 disagreed on value**. Duplicates exist and must be deduped, but
for this company and concept there is no restatement conflict to resolve.
Recorded as a negative rather than quietly dropped — it weakens one of the
arguments I would otherwise have made for this candidate.

## Why this is not a proxy of SEC endpoints

The product is a canonical series, not a passthrough: one concept-resolved,
duration-filtered, deduped time series per metric, each point carrying the
`accn`, `form` and `filed` date it came from. The SEC file is the input; the
concept-continuity decision is the output. A caller that proxied SEC would still
face both traps above.

This also survives the caching test that eliminated the security-join candidate:
concept unioning and duration semantics are resolved **per question**, not once
per refresh.

## What has not been done

No endpoint exists, no source has been activated, nothing is deployed. Rights
for SEC look clean on their face (public-domain federal works, with declared-UA
and rate-limit conditions) but have **not** been through the Phase 1 gate that
tariffs just failed, and they must be before any build. On current evidence the
main commercial risk is crowding, not correctness — the inverse of tariffs.
