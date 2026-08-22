# DOE CCMS — assessment as a secondary verification source

> **STATUS: NOT REVIEWED. NOT APPROVED. NOT ACQUIRED.**
>
> This is an assessment of whether the DOE Compliance Certification Management
> System is usable as a **corroboration** source. It is not a rights review, and
> CCMS needs its own — it does not inherit the EPA one. Labels as in the
> ENERGY STAR packet: **[VERIFIED]**, **[INFERRED]**, **[UNKNOWN]**,
> **[REVIEWER]**.

Prepared: 2026-08-22

## 1. Identity

| | |
| --- | --- |
| **System** | Compliance Certification Management System (CCMS), Public Database **[VERIFIED]** |
| **Operator** | U.S. Department of Energy, Appliance & Equipment Standards Program (CMEI) **[VERIFIED]** |
| **Relevant product class** | *Air Conditioners and Heat Pumps - Central* **[VERIFIED]** |
| **Landing page** | `https://www.regulations.doe.gov/certification-data/CCMS-4-Air_Conditioners_and_Heat_Pumps_-_Central.html` **[VERIFIED]** |
| **Related classes** | Central Multi-Split; Central, Appendix M1; Room; Portable; Package Terminal; Single Package Vertical; Computer Room **[VERIFIED]** |

## 2. What the database actually is — **[VERIFIED, verbatim]**

From the page itself:

> Please note: The Compliance Certification Database houses information
> submitted by importers and U.S. manufacturers of covered products and
> equipment subject to those standards. The appearance of a model on this web
> site is not an indication that DOE has determined that the model is compliant
> with DOE energy conservation standards. Each importer must submit a valid
> certification report for each model it imports, even if the model already
> appears on this web site.

and:

> This web site is updated approximately every two weeks.

**This is the single most important fact about CCMS as a corroboration source.**
It is a filing cabinet of manufacturer and importer submissions, and DOE says
outright that presence in it is *not* a determination of compliance. It
corroborates **that a party filed a claim**, not **that the claim is true**.

That is still worth something — but less than it first appears, and the
distinction matters enough to state precisely.

**Agreement between these two sources is agreement between two filings, not two
independent observations.** Both databases hold content submitted by
manufacturers and importers. The same party very likely submitted both, from the
same test report. Two copies of one claim agreeing tells you the copying worked;
it does not tell you the claim is true, and treating it as corroboration would
manufacture confidence out of a shared upstream.

**Disagreement, by contrast, is genuinely informative** — one filing contradicts
the other, and whichever is stale or wrong, something needs looking at.

So the asymmetry is the design: a disagreement raises a flag; an agreement earns
nothing beyond "both filings say the same thing", and must be recorded in those
words. Only where provenance shows genuinely separate submitters or separate
test reports may matching records be called independent evidence — and neither
dataset currently exposes enough to establish that. **[REVIEWER]**

## 3. Rights posture — **[VERIFIED policy, REVIEWER decision]**

DOE web policies (`https://www.energy.gov/web-policies`), verbatim:

> Government information at DOE websites is in the public domain. Public domain
> information may be freely distributed and copied, but it is requested that in
> any subsequent use the Department of Energy be given appropriate
> acknowledgement. When using DOE websites, you may encounter documents,
> illustrations, photographs or other information resources contributed or
> licensed by private individuals, companies or organizations that may be
> protected by U.S. and foreign copyright laws.

Two differences from the EPA position, both material:

1. **Acknowledgement is requested.** Not a licence condition, but where EPA asks
   for nothing, DOE asks for credit. Attribution should be configured as
   required for CCMS-derived facts. **[REVIEWER]**
2. **DOE expressly warns about third-party contributed content.** CCMS is,
   by DOE's own description, a database *of* third-party submissions. The
   caveat and the content coincide exactly here, which is a stronger version of
   the same question raised for ENERGY STAR in §4 of that packet — and a reason
   CCMS cannot ride on the EPA review. **[REVIEWER]**

## 4. Delivery mechanisms — **[PARTIALLY VERIFIED]**

- The landing page exposes **Print** and **Download** controls. **[VERIFIED]**
- The page is a JavaScript shell (8,766 bytes); the data arrives from an
  application endpoint. **[VERIFIED]**
- The download endpoint and its formats could **not** be established from this
  environment: `/certification-data/ccms-min/main.js` returns **HTTP 403** to
  this client. **[VERIFIED failure — the mechanism itself remains UNKNOWN]**
- No public API is documented on the page. **[VERIFIED absence on that page;
  existence elsewhere UNKNOWN]**

## 5. robots.txt could not be read — **[VERIFIED failure]**

`https://www.regulations.doe.gov/robots.txt` returns **HTTP 403** to this
client.

This is disqualifying on its own for now, and the platform already behaves
correctly about it: `robots_policy.snapshot_hash` and `snapshot_at` are required
fields, and they cannot be truthfully filled in. Fail closed. A source whose
robots directives we cannot read is a source we do not crawl — and the fact that
a plain read is refused is itself information about how this host treats
automated clients.

**Whoever reviews CCMS must resolve this first**, from an environment that can
read it, and record the snapshot.

## 6. Corroboration design — comparable fields

Assuming both sources were approved, these are the join and comparison
candidates. **[INFERRED from the ENERGY STAR schema; the CCMS field list is
UNKNOWN pending §4]**

| Purpose | ENERGY STAR | CCMS |
| --- | --- | --- |
| Join key candidate | `model_number` (outdoor), `indoor_unit_model_number` | manufacturer + model number **[INFERRED]** |
| Join key candidate | `ahri_reference_number` | AHRI reference **[UNKNOWN whether present]** |
| Brand/manufacturer | `energy_star_partner`, `outdoor_unit_brand_name` | submitting manufacturer/importer |
| Efficiency | `seer2_btu_wh`, `eer2_btu_wh`, `hspf2_btu_wh` | SEER2/EER2/HSPF2 under the applicable appendix |
| Capacity | `cooling_capacity_btu_h`, heating at 47/17/5 °F | rated capacities |

## 7. Discrepancy and timing risks

| id | Risk | Note |
| --- | --- | --- |
| C-01 | **Different questions.** ENERGY STAR = met a voluntary efficiency specification. CCMS = a compliance certification was filed. A model can legitimately appear in one and not the other | Never model absence from CCMS as contradicting ENERGY STAR |
| C-02 | **Different test procedures / appendices.** CCMS splits *Central* from *Central, Appendix M1*. Ratings from different appendices are not comparable | Compare only within a matched appendix, or not at all |
| C-03 | **Update skew.** CCMS ≈ every two weeks **[VERIFIED]**; ENERGY STAR `rowsUpdatedAt` read as 2026-08-21 on a single observation, cadence **[UNKNOWN]**. If ENERGY STAR moves faster, a fresh disagreement is probably skew rather than conflict | Establish the ENERGY STAR cadence by observation first. Until then, require a disagreement to persist across two CCMS cycles before treating it as a conflict |
| C-04 | **Model-number formatting differs between submitters.** The join is the hard part | Measure join yield on a sample before designing anything on top of it |
| C-05 | **Neither is "the truth".** DOE disclaims compliance determination; EPA disclaims warranty | Publish both with attribution and let the disagreement be visible (rule 3) |
| C-06 | **Shared submitters make agreement uninformative.** Both databases hold manufacturer/importer filings, plausibly of the same test report | Never record matching values as corroboration. Record them as "two filings agree". Act on disagreement, not on agreement |

## 8. Conclusion

**CCMS is a legitimate corroboration candidate and is not usable today.** Three
things block it, in order:

1. robots.txt cannot be read from here (§5) — fail closed.
2. The download mechanism is unestablished (§4).
3. It has no rights review of its own, and cannot borrow ENERGY STAR's — the
   third-party-content caveat is stronger here, not weaker (§3).

Until all three are resolved by a person, **no CCMS record may be combined with,
published beside, or republished alongside ENERGY STAR data.**
