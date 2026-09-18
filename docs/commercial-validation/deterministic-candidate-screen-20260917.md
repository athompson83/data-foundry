# Deterministic-answer screen — FAA aircraft registry survives

**First candidate to pass the single-answer test on measurement rather than
assertion.** Screening order applied as specified: determinism first, bytes
last.

---

## Precondition 1 — EGRESS_BLOCKED is not RIGHTS_UNRESOLVED

Retested per host. The distinction is real and separates the candidates:

| Host | Reachable from this egress? | Classification |
| --- | --- | --- |
| `www.usitc.gov` | **No** — 403 to curl *and* a real browser | EGRESS_BLOCKED |
| `www.sec.gov` (policy pages) | **No** — 403, "Request Rate Threshold Exceeded" | EGRESS_BLOCKED |
| **`www.faa.gov`** | **Yes** — robots.txt, policies, dataset page all **200** | **readable** |
| `api.fcc.gov` | No — 403 | EGRESS_BLOCKED |
| `tsdrapi.uspto.gov` | No — 401 (key required) | needs credential |
| `data.sec.gov`, `usaspending.gov`, `crt.sh` | Yes | readable |

So the last two Phase 1 failures were **environmental, not legal** — and FAA is
the case where that distinction pays off: its terms are readable from here.

## Precondition 2 — the single-answer test, applied first

| Candidate question | One defensible answer? | Verdict |
| --- | --- | --- |
| "What duty applies to HTS X from country Y?" | No — 85% defers to legal notes; one needs a CBP determination | rejected (legal interpretation) |
| "What was company X's revenue in FY Y?" | No — coexisting concepts disagree 69% of the time | rejected (accounting judgment) |
| "Is CVE-X exploited in the wild?" | Yes | survives determinism, fails durability (cache KEV once) |
| **"What aircraft is registered to N-number X?"** | **Yes — registry fact** | **survives** |
| "Which providers changed this month?" | Yes, but history must be accumulated | deferred (slow start) |

## The determinism test, measured

Downloaded the FAA Releasable Aircraft Database (73,108,402 bytes) and checked
the claim rather than asserting it:

| Check | Result |
| --- | --- |
| Master records | **316,721** |
| Distinct N-numbers | **316,721** |
| N-numbers with more than one record | **0** |
| `MFR MDL CODE` → `ACFTREF.CODE` resolves | **316,721 / 316,721 = 100.00%** |
| `ENG MFR MDL` → `ENGINE.CODE` resolves | 277,100; **39,621 blank; zero orphans** |
| `STATUS CODE` | 21-value enum (`V`=310,225 …) |

**Exactly one record per N-number, and every non-blank join key resolves.** No
fuzzy matching, no entity resolution, no judgment. A blank engine key is
*absence*, which the API can report as absence rather than guess.

Compare: tariff needed legal prose the source does not publish; SEC needed an
accounting choice worth $39B on one company-year. This needs neither.

## Why the raw path is bad for an agent

There is **no official JSON API**. `registry.faa.gov/aircraftinquiry` returns
**31,529 bytes of HTML** per lookup; `/api/` 302s away.

To answer one question from authoritative data an agent must:

| Step | Cost |
| --- | --- |
| Download archive | **73,108,402 bytes** |
| Decompress and read 3 files | **209,561,538 bytes** (`MASTER` 194.5 MB, `ACFTREF` 14.9 MB, `ENGINE` 0.23 MB) |
| Parse rows | **415,532** |
| Joins at query time | 2 |

A Data Foundry answer is one call returning roughly 1 KB. That is a ~200,000×
reduction in bytes moved — but the reduction is *not* the argument. The argument
is that the question has one answer, which is what the previous two candidates
lacked.

Refresh is **daily at 23:30 central**, and the archive ships `DEREG.txt`
(278 MB of deregistered aircraft), so history and change detection are available
without inference.

## The finding that scopes the product

From FAA's own dataset page:

> "The FAA has established a procedure in accordance with **49 U.S.C. § 44114(b)**
> by which private aircraft owners can request certain **personally identifiable
> information, such as names and addresses, be withheld** from broad
> dissemination or display on a publicly available FAA website."

Measured: owner `NAME` and `STREET` are populated on **311,688 of 316,721**
rows — only 5,033 are blank — and **129,932 (41.0%)** of registrants are typed
Individual. **Withholding is not pre-applied at scale in the download.**

So republishing owner identity would create a continuing obligation to honour
withholding requests against a cached copy — recurring adjudication, which the
low-touch requirement excludes.

**Scope decision: exclude owner name and address.** Serve the aircraft facts —
make, model, series, year, engine, airworthiness class and date, status,
Mode S hex, registration and expiration dates, deregistration history. Those
are the deterministic fields, they carry no PII obligation, and they are what
machine use cases (ADS-B correlation by Mode S hex, fleet and maintenance
tooling) actually consume. `robots.txt` disallows only `/fast-41-cpp-tasks/`,
so the download path is not excluded — absence of prohibition, not a grant, and
the owner should still confirm commercial redistribution.

## Honest weaknesses

- **Demand evidence is thinner than the rejected candidates had.** Tariff had a
  $49/mo competitor and four scrapers; SEC had $49/$199. Here: several Apify
  scrapers (~$0.10/run + $0.01/record) and free web lookups. Real, but smaller.
  Not yet screened at step 5.
- **Excluding owner data removes the field some buyers want most.** That is the
  price of low-touch operation, and it should be tested before building.
- **Rights are absence-of-prohibition, not an explicit grant.** Better than the
  last two — the terms are at least *readable* — but still owner-confirmable.

## What changed in my method

Three candidates failed because I measured efficiency before asking whether the
question had one answer. Applied in the specified order, tariff and SEC are both
rejected in a single step at criterion 1, before any byte is counted — and the
survivor is one I had previously ranked **third** and dismissed partly because
free consumer web lookups exist. Under an agent test, a 31 KB HTML page behind
a form is not machine access.

No endpoint built, no source activated, nothing deployed. The archive was
downloaded once for measurement and is not retained in the repository.
