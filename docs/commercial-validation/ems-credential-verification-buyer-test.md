# Buyer test — EMS clinician credential verification

**Status: discovery only.** Nothing here is a product. No source is activated, no
state or certification registry is automated, and Data Foundry does not provide
this service today. Nobody may be told otherwise.

This document holds the materials for 5–8 warm one-to-one discovery
conversations, the evidence behind the hypothesis, and the gate that decides
whether anything gets built.

**Deliberately not in this file:** prospect names, contact details, relationship
descriptions, individual interview notes, private organisational information,
and anything an interviewee shares in confidence. Those stay out of the
repository. This file holds only the instrument and the reasoning.

---

## 1. The hypothesis, and how it already changed

The question is whether EMS organisations have an unresolved gap between the
credential data **stored in their system** and the **current authoritative
status** of that credential.

Two classes, deliberately kept separate:

| | Class A — state authorisation | Class B — clinical certification |
| --- | --- | --- |
| What | State EMT/paramedic licence | AHA BLS / ACLS / PALS and equivalents |
| Failure | Suspension, restriction or revocation occurring **before** the stored expiry date | Expired, invalid or non-genuine card |
| Evidence so far | **Theoretical.** A structural gap exists; no observed loss | **Observed.** The only real-world failure encountered so far was in this class, and it carried a financial consequence |

**Do not lead with Class A.** The state-licence story is the tidier hypothesis
and the weaker one. The only loss anyone has actually described was Class B.
Lead with credential verification generally and let the interviewee say which
class hurts.

### What the first conversation established — and why it is not evidence

Interview #0 was the owner's own organisation. It is **context, not an
independent data point**, and the scorecard does not count it.

- The system alerts on expiry, and the expiry date is **entered by staff from
  the certificate the member provides**. It does not query the issuing
  authority. Tracking, not verification.
- Single-state operation, so the multi-state thesis does not apply there.
- The administrative burden was described as **a few hours a month**.
- The one real failure involved a **Class B clinical certification**, not a
  state licence, and had a financial consequence.

Two of those cut against the business and are recorded here for that reason.

---

## 2. Evidence behind the hypothesis

Retrieved 2026-09-17. Each claim is labelled by how it is known.

**The national registry is explicitly not authoritative.** NREMT states that in
some states an individual may hold a lapsed, expired or inactive NREMT
credential *and* a valid state licence, and that to verify a licence to practise
you must contact the State EMS Office. There are roughly fifty such offices,
each with its own lookup. **[VERIFIED — NREMT]**

**The multi-state aggregator is partial and manual.** EMS Compact Quick Verify
shows home-state licence details and compact privilege status, but covers
**member states only**, depends on each state's integration with the National
EMS Coordinated Database, is a **single-person web lookup with no API or bulk
access**, requires the individual's 12-digit National EMS ID, and may lag
up to 24 hours. **[VERIFIED — EMS Compact]**

**Florida publishes a public verification portal.** The DOH MQA search portal
provides licence verification. Whether it permits automated or commercial
access is **an open rights question, deliberately not investigated yet.**
**[VERIFIED that it exists — UNKNOWN whether automatable]**

**AHA verification exists, free, and is manual.** Employers may verify a card by
scanning its QR code, by phoning AHA, or through the employer tab at the AHA
eCard site, which accepts **up to 20 eCard codes per batch**. Cards are valid
two years. **[VERIFIED — AHA]**

**The consequence is real.** Industry sources describe a missed expiry as
leaving a clinician "technically unqualified to be on a shift," with exposure
including fines, litigation, voided insurance and regulator sanctions.
**[VERIFIED that the claim is made — the frequency and cost are UNKNOWN]**

**Incumbent behaviour is unknown.** ESO, Vector Solutions and comparable systems
document expiry alerting. Whether any of them independently queries an issuing
authority **could not be determined from published material and must not be
inferred from its absence.** This is the single most important thing the
interviews decide. **[UNKNOWN]**

---

## 3. Ten-minute conversation script

Open by making the frame honest:

> "I'm not selling anything and there's no product to show you. I'm trying to
> understand how agencies actually handle this, and you'd know better than most."

Ask about the current workflow **before** describing any solution. Do not lead
the participant toward agreeing a problem exists.

1. Walk me through how you know everyone working today is currently authorised.
2. What system holds the credential information?
3. Does that system query the issuing authority itself, or does it track what
   staff enter from the certificate?
4. How would you find out about a suspension or restriction that happened
   **before** the expiry date in your system?
5. Same question for AHA cards — how do you know a BLS or ACLS card is genuine
   and still valid?
6. How many clinicians, and how many credential records each?
7. **Who does the checking, and how many hours a month?** *(Ask early. See the
   warning below.)*
8. Which states? Do you use NREMT or Compact Quick Verify — what do they solve,
   and what is left over?
9. What evidence do you keep proving the verification happened?
10. Has your record ever disagreed with the issuing source? What happened, and
    what did it cost?

Close, then stop talking:

> "If that checking happened automatically with dated evidence, would it replace
> something you pay for, save real hours, or mostly duplicate what you have?"

### Kill questions — ask them plainly

- Does your system already verify current status against the authoritative
  source automatically?
- Does Quick Verify already cover your whole roster and your actual need?
- Would you decline to buy this from a new vendor regardless of quality?
- Is the burden small enough that automating it isn't worth much?

### The burden warning

If most organisations answer question 7 with "a few hours a month," **treat that
as evidence against the business and say so.** A real gap that is cheap to live
with is not a business. This instrument is designed to surface that answer, not
to survive it.

---

## 4. Outreach language (generic — no names in this file)

Email or message:

> **Subject:** Quick question about credential checking
>
> Hi [name] — [how you know each other].
>
> I'm looking into how EMS agencies verify that clinicians are currently
> licensed and hold valid AHA cards — specifically whether anyone catches a
> problem that happens *between* renewal dates.
>
> I'm not selling anything and I don't have a product to show you. I'm trying to
> learn how it actually works in practice.
>
> Ten minutes on the phone in the next couple of weeks?
>
> [name]

Short form where texting is the normal relationship:

> "Hey [name] — researching how agencies verify licences and AHA cards between
> renewals. Not selling anything, no product. Got 10 min sometime?"

**Not authorised:** mass outreach, campaign automation, contact scraping, saying
a product exists, quoting prices, offering a pilot before discovery confirms the
problem, or collecting any real employee credential data during discovery.

---

## 5. Interview capture template

Keep completed copies **outside this repository.**

```
Interview #            Date:                 Independent? Y / N
Role:                                        Roster size:
States:                                      Credential types tracked:

System of record:
  Queries issuing authority?   YES / NO / UNKNOWN / "not sure"
  Evidence for that answer:

Class A (state licence) gap described?       Y / N / N-A
Class B (clinical cert)  gap described?      Y / N / N-A

Reverification cadence:        Who performs it:        Hours per month:
Automated portion:             Manual portion:

NREMT / Quick Verify used?     What it solves:         What it leaves open:

Evidence retained for audit:

Discrepancy ever found?        What happened:          Consequence:

Products evaluated or bought:                          Spend:

Reaction once the workflow was described:
Economic buyer (if not this person):
What that buyer would need to see:

CONTRADICTIONS — record verbatim, do not reconcile:
```

---

## 6. GO / NO_GO scorecard

Interview #0 is excluded: it is the owner's own organisation.

| Criterion | Threshold | Count |
| --- | --- | --- |
| Independent organisations describing materially similar pain | **≥ 3** | 0 |
| Systems predominantly track rather than verify authoritative status | majority | 0 independent |
| Meaningful financial, operational or administrative consequence | ≥ 3 | 0 |
| Concrete interest in an automated capability after description | **≥ 2** | 0 |
| Credible buyer willing to discuss paid-pilot requirements | **≥ 1** | 0 |

**Stop if any of these holds:**

- The burden is consistently trivial across organisations.
- Existing systems already perform authoritative verification adequately.
- AHA or state verification cannot be lawfully automated.
- Organisations regard the risk as too small to purchase against.
- Interest stays theoretical and no one moves toward requirements.

---

## 7. What happens only after the gate passes

In this order. Nothing here starts early.

1. **Source qualification, limited to the states an interested buyer actually
   operates in.** Identify the authoritative registry per state; establish
   whether automated access exists; check terms, robots policy, statutory
   restrictions, rate limits and commercial-use implications; prefer an official
   API or bulk file over any browser-based acquisition. Acquisition stays off
   until each required source passes that gate. The same applies to AHA.
2. **Competitive verification.** Investigate the exact products interviewees
   name, and establish by testing or documentation — not by marketing copy —
   whether they perform authoritative verification.
3. **Pilot design.** One organisation, only its states, 60 days, paid. Pricing
   is set from measured burden and existing spend, **not anchored in advance.**
   Deliverable: authoritative roster verification, detected status changes, and
   dated evidence of each check.

**A clean roster is not a failed pilot.** Verifying that nothing is wrong, with
evidence, is the product working. Do not design a pilot whose success depends on
finding a problem.
