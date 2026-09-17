# US Import Duty & Tariff Stack API — validation

**Verdict: NO_GO for the product as scoped.**

This reverses my own recommendation from the two preceding documents. The
validation gate did its job: the rate arithmetic turned out to be *easier* than
I claimed, and the part that decides whether a customer owes the money turned
out to be *not computable* from the available data at all.

Two independent no-go criteria fire. Either alone is sufficient.

---

## Phase 1 — Rights: UNRESOLVED (not RIGHTS_CLEAR)

I could not obtain the authoritative terms, and I will not infer them.

| Source | Result |
| --- | --- |
| `www.usitc.gov/documents/terms_of_use.htm` | **403** (curl and WebFetch) |
| `www.usitc.gov/robots.txt` | **403 Access Denied** (Akamai edge) |
| `www.usitc.gov/documents/hts_external_guide.pdf` | **403** |
| `hts.usitc.gov/reststop/terms` | **404** |
| `hts.usitc.gov/help` | 200, but a JS shell containing no terms text |

`www.usitc.gov` is wholly unreachable from this environment. The terms could
likely be read by presenting a browser User-Agent, and **I did not do that** —
this repository already set that precedent for `www.regulations.doe.gov`,
recording its policy as "unreadable without impersonation" rather than
impersonating.

**The "public domain" claim circulating in search results traces to
`lookuphts.com` — a competitor's marketing blog.** That is precisely the kind of
inference Phase 1 forbids, and it is not evidence.

**Unexamined third-party layer.** The HTS incorporates the WCO's Harmonized
System nomenclature at the 6-digit level. The WCO operates a paid platform for
official HS nomenclature and Explanatory Notes, which at minimum indicates a
commercial licensing posture over some of that material. Whether the 6-digit
descriptions as enacted into US law carry any residual WCO condition is a real
question I could not answer from primary sources, and it is exactly the
"third-party material" the brief asks about.

There is a strong *argument* that the HTS is an uncopyrightable government
edict. That is a legal conclusion, not a finding, and it is not mine to make.

## Phase 2 — Deterministic computation: rates PASS, applicability FAILS

Prototype run over **8,604 lines** across 9 chapter ranges (01–03, 22, 61, 72,
84, 85, 87, 9403, 9903). No production endpoint was built and no acquisition was
activated; this is local analysis of data already retrieved.

**Hierarchy resolution works and matters.** 4,223 of 8,604 lines — **49%** —
inherit their base rate from an ancestor. Not an edge case.

**Rate parsing is largely deterministic:**

| | Deterministic | Unresolved |
| --- | --- | --- |
| Base schedule (7,967 lines) | **97.7%** | 187 |
| Chapter 99 (637 lines) | **99.2%** | 5 |

My first pass reported Chapter 99 at 29.2%. **That was my parser's failure, not
the source's** — my grammar demanded the word "plus" while the source also
writes `+`, and demanded `/unit` while the source also writes `0.9¢ each`. I
fixed the grammar and re-measured rather than banking a flattering number.
Residual unresolved cases are genuine and correctly refused: a duty "upon the
value of the non-U.S. content", cross-references to other headings, and a
source-side typo (`"inthe applicable subheading+ 25%"`).

**This weakens my own earlier pitch.** I sold "prose → number extraction" as the
durable moat. At 99.2% mechanical, it is a weekend of regex work, not a moat.

### The finding that decides it

Knowing a Chapter 99 line reads "+25%" is worthless without knowing **whether it
applies**. Of the 573 Chapter 99 lines carrying a rate:

| Applicability signal | Count | Share |
| --- | --- | --- |
| Deferred to a "U.S. note" / subdivision **not in the API** | **490** | **85%** |
| Gated by cross-referenced exclusion headings | 83 | 14% |
| Requires a **CBP factual determination** about the shipment | 1 | — |
| Fully self-contained in the line itself | **12** | **2%** |

Representative:

> `9903.01.01` — "Except for products described in headings 9903.01.02,
> 9903.01.03, 9903.01.04 and 9903.01.05, articles the product of Mexico, **as
> provided for in U.S. note 2(a) to this subchapter**"

> `9903.01.16` — "…as provided for in subdivision (m) to note 2 to this
> subchapter **and determined by CBP to have been transshipped to evade
> applicable duties**"

The governing U.S. Notes are **not retrievable through the API**:
`reststop/notes?chapter=99` returns **404**, and the chapter 9900–9902 export
returns 4 records containing no legal-note text. They live in the PDF/legal
publication on `www.usitc.gov` — which returns **403** here.

So the product's whole value — the stacked total — rests on a legal text the
data source does not expose, plus, in at least one case, a determination about a
physical shipment that no dataset can contain.

**No-go criterion met: "correct duty computation requires frequent human customs
interpretation."** Not occasionally: for 85% of rated remedy lines.

## Phase 3 — Agent efficiency: not decisive

The earlier measured baseline stands (2 calls, 503,140 bytes, 679 Chapter 99
lines). I did not run the paired comparison, because Phase 2 removed the thing
being compared: an answer we cannot compute correctly is not made acceptable by
being cheap to fetch. Efficiency was never the blocker.

## Phase 4 — Market: demand is real, and that is not enough

Paid competitors at **$49/mo** (ustariffrates.com Pro), plus tariffsapi.com,
gingercontrol.com, a RapidAPI listing, and 4+ Apify scrapers of the same source.
Competitors run per-HTS-code SEO pages that rank. Demand is genuine.

But the competitor description that matters is the one saying this work "breaks
every time CBP issues a CSMS update." Read against Phase 2, that is not a
complaint about scraping — it is the signature of **maintaining a hand-curated
applicability layer**. Those vendors are almost certainly employing customs
interpretation. That is the opposite of low-touch, and it is the business model
this mission explicitly excludes.

## Verdict

**NO_GO.** Rights are materially unresolved, and correctness requires
interpretation the data does not carry.

### What would change the answer

1. **Rights.** The owner retrieves USITC's terms from an ordinary browser and
   confirms commercial redistribution of normalized derivatives, including any
   WCO-derived layer. Cheap, and it should be done regardless — it also
   unblocks any future tariff work.
2. **Applicability.** A machine-readable source for the Chapter 99 U.S. Notes.
   If one exists, the analysis above reverses quickly: rate parsing is already
   99% solved and the hierarchy resolver works.
3. **Scope.** A narrower product that returns HTS records, resolved base rates
   and *candidate* Chapter 99 headings with their note references — explicitly
   refusing to total them. Honest and buildable, but close to what USITC already
   publishes, and it is not what the paying customers are buying.

### What is not affected

The prototype is reusable: the hierarchy resolver and the rate grammar are the
transferable assets, and both work. Nothing was acquired into production,
no source was activated, no endpoint exists, and no rights were exercised.
