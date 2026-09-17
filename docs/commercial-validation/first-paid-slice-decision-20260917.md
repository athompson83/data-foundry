# First paid data slice — decision

**Decision: CONTINUE_TARGETED_VALIDATION.**

Not `VALIDATED_FOR_SCOPED_PILOT`, because no candidate has an independent
buyer. Not `REJECT_CURRENT_HYPOTHESIS`, because nothing has been tested hard
enough to reject.

This reviews the existing research rather than restarting it: the dataset
portfolio, the UA-001 source qualification record, PR #46's standing direction,
and PR #49's buyer-test instrument. No new candidate list was generated and no
interview material was recreated.

---

## 1. The evidence, separated by kind

### Independent buyer statements: **zero**

PR #49's scorecard is explicit, and every count is `0`:

| Criterion | Threshold | Count |
| --- | --- | --- |
| Independent organisations describing materially similar pain | ≥ 3 | **0** |
| Systems predominantly track rather than verify | majority | **0 independent** |
| Meaningful financial/operational/administrative consequence | ≥ 3 | **0** |
| Concrete interest in an automated capability | ≥ 2 | **0** |
| Credible buyer willing to discuss paid-pilot requirements | ≥ 1 | **0** |

### Founder context, correctly excluded

Interview #0 was the owner's own organisation. PR #49 already records it as
context rather than evidence and excludes it from the scorecard. Two of its
observations **cut against** the business and are preserved as such:

- burden described as **"a few hours a month"** — PR #49's own instruction is to
  treat that as evidence *against*;
- **single-state operation**, so the multi-state thesis does not apply there.

The one real failure it produced was a **Class B clinical certification (AHA)**,
not the tidier state-licence story.

### Observed technical gaps — real, and verified

`[VERIFIED]` in PR #49, retrieved 2026-09-17: NREMT is explicitly not
authoritative for licence-to-practise; EMS Compact Quick Verify is member-states
only, single-person web lookup, **no API or bulk access**; AHA employer
verification is free, manual, **20 eCard codes per batch**.

Independently re-measured today for the portfolio's strongest candidate — three
federal endpoints, two agencies:

| Source | Make | Model | Format |
| --- | --- | --- | --- |
| NHTSA vPIC decode | `HONDA` | `CR-V` | JSON |
| NHTSA recalls | `HONDA` | `ACCORD` | JSON |
| EPA fuel economy | `Acura`, `Aston Martin` | — | **XML** |

Three naming conventions and two serialization formats across two agencies.
That is reconciliation work, not API forwarding.

### Unsupported assumptions, named as such

- That incumbents (ESO, Vector) do **not** query an issuing authority. PR #49
  labels this `UNKNOWN` and forbids inferring it from marketing silence. It is
  the single most important open question.
- That the Florida MQA portal — or any state portal — **permits automated or
  commercial access**. `UNKNOWN`, deliberately not investigated.
- That anyone will **pay**. No price has been discussed with anyone, and none
  may be quoted.

## 2. Contradictions worth keeping

1. **The strongest pain evidence and the strongest data evidence are in
   different candidates.** EMS has one observed failure with a financial
   consequence and zero buyers. US Vehicle Intelligence has measured
   multi-source normalization value and zero buyers. Neither is complete.
2. **The observed EMS failure is in the class the hypothesis did not predict.**
   The theorised gap is Class A (state licence); the only real loss was Class B
   (AHA card). PR #49 already corrected the script for this.
3. **EMS is where the founder's experience is.** That is a reason it was
   noticed, not evidence that it is the best market. Treated here as one
   experiment, per the standing direction in PR #46.

## 3. Proposed slice — one, held weakly

**US Vehicle Intelligence — VIN → open-recall reconciliation.**

Offered as the *single* candidate to validate next, and no more strongly than
the evidence supports: its technical differentiation is measured, its buyer is
entirely hypothetical.

| | |
| --- | --- |
| **Machine-readable output** | Given a VIN: decoded vehicle identity joined to open NHTSA recall campaigns and EPA fuel-economy figures, each field carrying its source, retrieval timestamp and stored-artifact reference |
| **Buyer (hypothesised)** | Fleet operators, used-vehicle marketplaces, insurers — organisations already checking VINs in bulk |
| **Purchasing reason (hypothesised)** | One call with provenance, instead of three endpoints across two agencies with three naming conventions and two formats |
| **Free alternative** | The same three federal APIs, free and public. **This is the central risk.** |
| **Competitors** | Commercial VIN-decode APIs exist and charge per lookup `[INFERRED — not verified]` |
| **Work removed (measured)** | The join itself: `HONDA`/`HONDA`/`Acura` casing, `CR-V`/`ACCORD` model conventions, JSON vs XML — plus freshness and evidence-linked provenance |

**Value beyond forwarding a free API** rests on the cross-source join, verified
history and change detection, not on the raw decode. If validation shows buyers
want only a decode, this slice fails its own test and should be dropped.

**Rights position — unresolved, and public availability is not clearance.**
The portfolio's own closing rule applies: *"Every candidate above is a research
note. None has a recorded rights decision, none has an authorised acquisition
method."* US federal works are `[INFERRED]`, not verified per source. Required
before any build: a per-source rights determination covering **commercial
redistribution**, not merely access; robots/terms/rate-limit review per host
(`vpic.nhtsa.dot.gov` and `api.crossref.org` return no `robots.txt` — no
prohibition, but equally no grant); and a documented acquisition method. UA-001
established the general shape of this: the ENERGY STAR blocker is a **counsel
question**, not an engineering one, and the same will be true here.

## 4. Why not EMS as the slice

Not rejected — it is a live experiment with a correctly built instrument. But it
cannot be the proposed slice while independent interviews stand at zero, the
rights question for state portals and AHA is uninvestigated, and the incumbent
question is `UNKNOWN`. PR #49's own stop conditions include "the burden is
consistently trivial", and the only burden figure on record is "a few hours a
month".

Building it now would be choosing a market because of the founder's background
rather than because of evidence.

## 5. Next action

**One action, and it is not engineering: run PR #49's existing instrument.**

Complete **5–8 independent discovery conversations** using the script already
written, excluding the owner's own organisation, and record outcomes against the
existing scorecard. The gate decides:

- **≥ 3 independent organisations with materially similar pain, and ≥ 1 credible
  paid-pilot buyer** → re-run this decision with EMS as the candidate.
- **Below that** → EMS stops, and the next validation target is the vehicle
  slice above, which needs its own buyer conversation before any acquisition.

In parallel, and cheap: **one rights determination** for NHTSA vPIC and the
NHTSA recalls API covering commercial redistribution. It is a counsel question,
it gates the alternative candidate, and it can run while interviews happen.

Interview records stay outside the repository. No outreach has been sent, no
price quoted, no availability promised, and nothing here describes a product
Data Foundry offers today.
