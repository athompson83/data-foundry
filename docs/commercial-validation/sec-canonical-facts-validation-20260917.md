# SEC Canonical Financial Facts API — validation

**Verdict: NO_GO.**

Two criteria fire independently. The second is the important one, and it
reverses what I claimed when I promoted this candidate.

---

## Phase 1 — Rights: UNRESOLVED (RIGHTS_CONDITIONAL at best)

| Target | Result |
| --- | --- |
| `data.sec.gov` companyfacts API | **200** — reachable, used throughout below |
| `www.sec.gov/developer` (Fair Access guidelines) | **403** |
| `www.sec.gov/privacy` | **403** |
| `www.sec.gov/os/accessing-edgar-data` | **403** |
| `www.sec.gov/robots.txt` | **403** |

Blocked in a real browser as well as by curl. The 403 body is itself an SEC
statement, and is primary-source evidence of a *condition* even though the
condition's text is unreadable:

> **"SEC.gov | Request Rate Threshold Exceeded"** — "Automated access to our
> sites must comply with SEC.gov's Privacy and Security Policy. Please visit
> www.sec.gov/developer for more developer resources and **Fair Access
> guidelines**."

One User-Agent form — carrying an email-shaped contact token — returned 301
rather than 403, which matches SEC's documented declared-contact requirement.
**I did not use a fabricated contact address to read their policy pages.**
Probing once to find the gate is one thing; systematically accessing under an
invented identity is another.

So: SEC imposes explicit conditions on automated access, and the conditions are
not readable from here. That is conditional, not clear.

### A systemic finding, not a per-candidate one

This is the **second consecutive candidate** blocked at Phase 1 by the same
thing: US federal sites behind CDN bot management return 403 to this egress.
USITC did it, SEC does it. It is not a property of either dataset. Any future
federal-source candidate will hit it too, and **the owner can resolve it in
minutes from an ordinary connection**. It should be settled once, generically,
rather than rediscovered per candidate.

## Phase 2 — Semantic correctness: FAIL

28 companies across technology, banking, energy, pharma, retail, consumer,
industrial, auto and telecom. **129 MB of companyfacts, 849,545 `us-gaap` fact
rows**, 438–945 concepts per company. 16 metrics tested.

### Concept multiplicity is real but concentrated

| Metric | Companies with data | Needing >1 concept | Share |
| --- | --- | --- | --- |
| revenue | 28 | 27 | **96%** (GE: 5 concepts) |
| cash | 28 | 27 | **96%** |
| shares_outstanding | 28 | 27 | **96%** |
| net_income | 28 | 23 | **82%** |
| operating_cash_flow | 28 | 17 | 60% |
| stockholders_equity | 28 | 16 | 57% |
| capex | 25 | 7 | 28% |
| operating_income, assets, liabilities, eps_basic, eps_diluted, gross_profit, rnd, inventory, income_tax | — | **0** | **0%** |

**144 of 403 metric-company pairs (35.7%)** need more than one concept. Nine of
sixteen metrics are perfectly stable and canonicalise trivially — which also
means they are trivially served by the existing `companyconcept` endpoint.

### The finding that kills it

Multi-concept is almost never a clean historical handoff:

| | Count |
| --- | --- |
| Sequential **migration** (old concept ends, new begins) | **9** |
| **Coexistence** (concepts overlap in time) | **135** |

And where they coexist, **they disagree**. Of 52 annual revenue periods where
more than one concept reports for the same fiscal year end across 8 companies:

- concepts **agree**: 16
- concepts **disagree**: **36** — a **69.2%** disagreement rate

The disagreements are not rounding:

| Company / FY end | Concept | Value |
| --- | --- | --- |
| MSFT 2017-06-30 | `RevenueFromContractWithCustomerExcludingAssessedTax` | **$96,571,000,000** |
| | `SalesRevenueNet` | $89,950,000,000 |
| | `SalesRevenueGoodsNet` | $57,190,000,000 |
| WMT 2008-01-31 | `Revenues` | $377,023,000,000 |
| | `SalesRevenueNet` | $373,821,000,000 |

Those are three legitimately different measures — total revenue, net sales,
product-only sales — reported for the same year. A canonical "revenue" that
applies a priority rule silently picks one and can be **$39 billion** away from
another defensible answer.

Same pattern elsewhere: Apple's cash coexists as
`CashAndCashEquivalentsAtCarryingValue` and
`CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents` (restricted cash
in or out); shares outstanding coexists as point-in-time, cover-page and
weighted-average measures. These are not taxonomy drift. They are different
questions.

### This reverses what I said when I promoted the candidate

I wrote that an agent picking one concept "returns a silently truncated
series", and implied canonicalisation was the fix. The measurement says
something worse and different: **canonicalisation is itself the hazard.** The
truncation risk is real, but collapsing coexisting concepts into one number
produces a confidently wrong *value*, not merely a short series — and it does so
69% of the time on the single most-requested metric.

Per the no-go criteria: "a stable canonical mapping cannot be built without
frequent accounting judgment." 135 of 144 multi-concept cases require exactly
that, per company and per question, on the metrics people actually ask for.
Serving it would need recurring human adjudication, which the mission excludes.

## Phases 3–5 — not run

Phase 2 removed the object being measured. A canonical series whose value
depends on an accounting judgment cannot have its efficiency benchmarked as
though it were a fact, and competitor pricing cannot rescue a number we should
not be publishing. Demand evidence stands unchanged (`sec-api.io` at $49/$199).

## What would be defensible instead

Not recommended now, recorded so the analysis is not lost:

- **A disambiguation service rather than a canonical value.** Return every
  candidate measure for a metric, each labelled with its exact concept, period
  semantics, unit and accession — explicitly refusing to collapse them. Honest,
  deterministic, and it directly addresses the real agent failure. It is also
  much thinner than "one canonical number", and close to a filtered view of
  `companyfacts`.
- **The nine stable metrics only.** Deterministic, but they are the easy ones
  and the existing `companyconcept` endpoint already serves them.

## Three candidates, three reversals

Tariff, security-join and now SEC each looked strong on first inspection and
each failed on measurement — twice because my own framing was wrong rather than
because the data was hostile. The pattern worth carrying forward: **the
expensive part is never the format, it is whether the question has one correct
answer.** Tariffs failed because applicability lives in legal prose; SEC fails
because "revenue" is not one number. A candidate should be screened on that
question first, before any efficiency measurement.

No endpoint was built, no source activated, nothing deployed.
