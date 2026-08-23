# HVAC source landscape — twelve candidates assessed

> **STATUS: RESEARCH ONLY. NOTHING APPROVED. NOTHING INGESTED.**
>
> No candidate here has been moved to `APPROVED`, no records have been fetched
> from any of them, and nothing in this document authorises either. The owner
> decision governing this work is `source_research_scope:
> RESEARCH_AND_PROPOSE_ONLY` with `real_source_ingestion_authorized: false`.
>
> Only documentation was retrieved: terms of use, licence texts, `robots.txt`,
> dataset metadata. No product record was downloaded from any candidate.

**Assessment date: 2026-08-23.** Every URL below was retrieved on that date.
Terms change; this document expires the moment one of them does.

Labels follow the ENERGY STAR packet: **[VERIFIED]** (read in the primary
source, quoted), **[INFERRED]** (a reasoned conclusion that a reviewer must
confirm), **[UNKNOWN]** (not established), **[REVIEWER]** (a decision for a
named human).

---

## The rules this assessment was held to

Stated up front because several conclusions below turn on them, and because two
candidates would have passed a looser reading.

1. **`robots.txt` is not legal permission, and a licence is not technical
   permission.** These are separate questions with separate answers, and
   candidate 3 is the case that proves it: openly licensed data on a host that
   refuses all crawlers.
2. **The existence of an API is not permission to redistribute what it
   returns.** Candidate 5 grants API access and forbids the business model.
3. **One observed timestamp is not a cadence.** Where a publisher states an
   update frequency it is quoted; where only an observation exists it is
   recorded as an observation with its date, and nothing is inferred from it.
4. **Data rights and image rights are assessed separately.** The right to state
   a specification is never the right to republish a photograph (AGENTS.md rule
   9).
5. **Silence is refusal — and that is a different field from `[UNKNOWN]`.**
   Where terms do not address commercial use, redistribution or derivation, the
   value recorded in `rights_policy` is `false`, not "probably". The
   **assessment label** `[UNKNOWN]` in the tables below is a separate statement:
   it says this review did not establish an answer. Both block acquisition. They
   are kept apart because one is a recorded permission and the other is a
   recorded gap in the record, and collapsing them would let "we did not look"
   read as "we checked and it said no".
6. **No fictional, placeholder or undocumented sources.** One candidate URL
   assumed at the start of this work returned 404 and was discarded rather than
   written up; the dataset was then located through the publisher's own API.

---

## The twenty assessment fields

Every candidate is assessed against these. They extend the six questions in
`docs/source-onboarding.md` with the fields the research rules above require.

| # | Field | Why it is separate |
|---|---|---|
| 1 | Publisher (legal entity) | Rights are held by an entity, not a website |
| 2 | Host assessed | Terms attach to hosts; a portal and its CDN can differ |
| 3 | Source type | Drives `authority_rank` and fact selection |
| 4 | Access path | The exact URL that would be fetched |
| 5 | Access mechanism | Bulk file / documented API / HTML pages |
| 6 | Terms document | Exact URL and title of what was read |
| 7 | Named licence | A named licence beats prose every time |
| 8 | Commercial use | |
| 9 | Redistribution | Distinct from 8: many licences permit one and not the other |
| 10 | Derivative normalization | The one most often missed, and the one the platform does |
| 11 | **Resale / sublicensing of access** | **Distinct from 9, and the field the metered API turns on** |
| 12 | Attribution required, and exact text | An obligation nobody wrote down cannot be honoured |
| 13 | Image rights | Assessed independently of every field above |
| 14 | Personal data present | A blocker, not a caveat |
| 15 | `robots.txt` — complete relevant directives | Read in full for the access path in 4 |
| 16 | Documented update cadence | What the publisher *states* |
| 17 | Observed last update | A single observation, explicitly not field 16 |
| 18 | Volume | Records, with the date observed |
| 19 | Field coverage against the HVAC dictionary | Whether it can answer the vertical's questions |
| 20 | Independence | Whether it is a distinct observation or a copy of another candidate |

---

## Ranked comparison

Ranked by whether the source can lawfully back **a paid API**, which is the
revenue model — not by data quality. Several rich sources rank low.

| # | Candidate | Type | Commercial | Redistribute | **Resale/sublicence** | robots (access path) | Verdict |
|--:|---|---|---|---|---|---|---|
| 1 | **EPA ENERGY STAR certified products** | US federal | ✅ public domain | ✅ | ✅ | `Crawl-delay: 1`; asset path not disallowed | **Lead candidate** |
| 2 | **DOE CCMS** | US federal | ✅ [INFERRED] | ✅ [INFERRED] | ✅ [INFERRED] | only `/@search` disallowed | **Fallback / disagreement detector** |
| 3 | AU DCCEEW — Labelled Products | AU federal | ✅ CC BY 3.0 AU | ✅ | ✅ | **`Disallow: /` — whole host** | Blocked technically, not legally |
| 4 | AU DCCEEW — Non-Labelled Products | AU federal | ✅ CC BY 3.0 AU | ✅ | ✅ | **`Disallow: /` — whole host** | As 3; not independent of it |
| 5 | **EU EPREL API** | EU institution | ⚠️ qualified | ⚠️ qualified | ❌ **forbidden** | no `robots.txt` served | **Incompatible with a paid API** |
| 6 | EPA ENERGY STAR Product Finder API | US federal | ✅ | ✅ | ✅ | as 1 | Same publisher as 1 — **not independent** |
| 7 | CEC MAEDbS | US state | [UNKNOWN] | [UNKNOWN] | [UNKNOWN] | **no `robots.txt` (404)** | Access-controlled; needs written permission |
| 8 | NRCan searchable product list | CA federal | [UNKNOWN] | [UNKNOWN] | [UNKNOWN] | **no `robots.txt` (404)** | No documented export or licence |
| 9 | UK MCS Product Directory | UK scheme | [UNKNOWN] | [UNKNOWN] | [UNKNOWN] | `ClaudeBot: Disallow: /`; `ai-train=no` | Rights expressly reserved |
| 10 | NEEP ccASHP list | US NGO | ❌ **"non-commercial use only"** | ❌ | ❌ | — | **Disqualified** |
| 11 | AHRI Directory | Certification body | — | — | — | — | **Already prohibited in code** |
| 12 | Manufacturer catalogues | Commercial | — | — | — | — | **Already prohibited in code** |

Candidates 10–12 are recorded because ruling them out is the finding. 11 and 12
are enforced by `packages/source-registry/src/prohibited-sources.ts`; 10 is new
here.

---

## The finding that changes the plan

**A source can be lawful for the free front end and unlawful for the paid API.**
They are different rights, and until now this repository has treated "may we
publish it" as one question.

The free web surface consumes data to *display* it; the metered API
*redistributes* it to a paying customer, and several licences that permit the
first explicitly forbid the second. Field 11 exists because of this, and EPREL
is the case that forced it: the same terms that grant a worldwide licence and an
API key forbid the thing the API is for.

`rights_policy` has no field for it. Every source declared today records
`redistribution_allowed` and stops, which cannot express "publish on the web
page, but do not sell API access to it". **[REVIEWER]** — this is a schema gap,
not a paperwork gap, and it is the one finding here that requires a code change
before any source ships.

---

## Detailed assessment — the top five

### 1. EPA ENERGY STAR certified products — *lead candidate*

| | |
|---|---|
| Publisher | U.S. Environmental Protection Agency (ENERGY STAR programme) **[VERIFIED]** |
| Host | `data.energystar.gov` (Socrata) **[VERIFIED]** |
| Type | `REGULATORY_FILING` — the EPA hosts the register; partners and certification bodies submit the values. The draft declared `GOVERNMENT`, which is in neither `SOURCE_TYPES` nor the database CHECK; corrected, and `tooling/test/proposed-sources.test.ts` now reads the drafts so it cannot recur **[VERIFIED]** |
| Access | Socrata dataset asset / SODA API **[VERIFIED]** |
| Licence | US federal public domain — *"all data produced by the U.S EPA is by default in the public domain and is not subject to domestic copyright protection under 17 U.S.C. § 105"* **[VERIFIED]** |
| Commercial / redistribute / derive / resell | Yes, for EPA-produced content **[VERIFIED]** |
| Attribution | **Not required by the licence** **[VERIFIED]** |
| Volume | 281,828 rows (heat pumps dataset `83eb-xbyy`), observed **[VERIFIED]** |
| Personal data | None identified **[INFERRED]** |

**`robots.txt`, read in full on 2026-08-23** **[VERIFIED]**: 34 `Disallow`
directives, every one of them a `/browse`, `/catalog` or `/page` URL carrying a
query parameter (`&category=`, `&q=`, `&sortBy=`, `&view_type=` and similar).
They target the faceted-browse UI. **No directive covers the dataset asset or
API paths**, and `User-agent: *` carries `Crawl-delay: 1`. The access path is
permitted; the crawl delay is a hard floor for `max_requests_per_minute`.

**What is already done:** a full rights review packet exists at
`docs/sources/energy-star-air-source-heat-pumps-review-packet.md`, with thirteen
proof conditions. **Condition 2 — "rights metadata complete, named human
reviewer and review date" — is the only structural blocker, and it is a
signature, not research.**

**The unresolved rights question is real, not a formality.** §4 of that packet
asks who produced which field. EPA's public-domain notice covers *EPA-produced*
content; the certified values are submitted by partners and certification
bodies. Whether a submitted value inherits the federal public-domain status is
the question, and it is exactly the kind a rights review exists for a human to
answer. **[REVIEWER]**

**Image rights: separate and unresolved.** The ENERGY STAR mark is a registered
trademark with published usage rules forbidding any implication of endorsement.
Public-domain *data* says nothing about the *mark*. **[REVIEWER]**

**Independence:** independent of everything except candidate 6, which is the same
publisher through a different door.

---

### 2. DOE Compliance Certification Management System (CCMS) — *fallback and disagreement detector*

| | |
|---|---|
| Publisher | U.S. Department of Energy, Appliance & Equipment Standards Programme **[VERIFIED]** |
| Host | `www.regulations.doe.gov` **[VERIFIED]** |
| Access | Product-lookup export, `CCMS-4-Air_Conditioners_and_Heat_Pumps_-_Central` **[VERIFIED]** |
| Documented cadence | *"This web site is updated approximately every two weeks."* **[VERIFIED, verbatim]** |

**`robots.txt`, read in full** **[VERIFIED]**:

```
User-agent: *
Disallow: /@search

Sitemap: https://www.regulations.doe.gov/product-lookup/sitemap.xml
```

One directive, covering an internal search endpoint. The product-lookup path is
not merely permitted — it is **published in the site's own sitemap**.

**The important limitation is DOE's own, verbatim** **[VERIFIED]**:

> The appearance of a model on this web site is not an indication that DOE has
> determined that the model is compliant with DOE energy conservation standards.

**This is a register of filings, not of determinations.** It corroborates *that
a party filed a claim*, not *that the claim is true*. Since ENERGY STAR is also
built from submissions, agreement between candidates 1 and 2 is very likely
agreement between two copies of one manufacturer filing — which tells you the
copying worked. `docs/sources/doe-ccms-corroboration-assessment.md` works this
through: **disagreement is informative, agreement earns nothing** and must be
recorded in those words rather than as corroboration.

Note this is the only candidate that **states** a cadence rather than exhibiting
one. Every other entry in field 16 is `[UNKNOWN]`.

---

### 3. Australian DCCEEW — Energy Rating, Labelled Products

| | |
|---|---|
| Publisher | Australian Government Department of Climate Change, Energy, the Environment and Water **[VERIFIED]** |
| Host | `data.gov.au` (CKAN) **[VERIFIED]** |
| Licence | **Creative Commons Attribution 3.0 Australia** (`license_url: http://creativecommons.org/licenses/by/3.0/au/`) **[VERIFIED]** |
| Commercial / redistribute / derive / resell | ✅ all four, with attribution **[VERIFIED]** |
| Access | `.../resource/0973a476-.../download/ac_2026_08_23.csv`, plus a published data dictionary **[VERIFIED]** |
| Dataset age | `metadata_created: 2013-04-17` **[VERIFIED]** |

**This is the best licence of any candidate, and it is blocked anyway.**

`data.gov.au/robots.txt`, read in full on 2026-08-23 **[VERIFIED]**:

```
User-agent: *
Disallow: /
```

The entire host, every path, every agent — including the CSV download above.
This platform sets `robots_policy.respect_robots: true`, so a permissive licence
and a total crawl prohibition produce **no approved automated acquisition path
under the current policy**. The publisher's own portal,
`energyrating.gov.au`, refused the connection outright when its `robots.txt` was
requested (no HTTP response) **[VERIFIED]**, so there is no second door either.

Stated that way deliberately. `robots.txt` is a technical directive and this
platform's policy is to honour it; neither fact establishes that automated
retrieval would be *unlawful*, and the route to yes below is written permission,
which would change the policy answer without changing the licence at all.
**[REVIEWER]**

Rule 1 in action: **the licence answers "may we use it", `robots.txt` answers
"may we take it", and here they disagree.**

**Field coverage is the second problem.** The dataset carries AS/NZS star
ratings and kilowatt capacities. The HVAC dictionary is built on US DOE metrics
— `seer2`, `eer2`, `hspf2`, BTU/h, nominal tonnage. These are **different test
procedures, not different units**, and converting between them would be
inventing facts the source does not contain.

**Cadence: unknown.** The CKAN record carries no stated update frequency. The
resource observed on 2026-08-23 was named `ac_2026_08_23.csv` and reported
`last_modified: 2026-08-23T08:04:39`. That is **one observation on one day**, and
per rule 3 it establishes nothing about frequency.

**Route to yes:** written permission from DCCEEW for automated retrieval, or a
publisher-provided path outside `data.gov.au`. **[REVIEWER]**

---

### 4. EU EPREL — *the instructive rejection*

| | |
|---|---|
| Publisher | European Commission services in charge of the Energy labelling product registry **[VERIFIED]** |
| Host | `eprel.ec.europa.eu` **[VERIFIED]** |
| Terms | *EPREL API — Terms and Conditions*, in force 3 June 2024 **[VERIFIED]** |
| API key | Required, "provided separately" **[VERIFIED]** |
| `robots.txt` | **None served** — the host returns the SPA shell for `/robots.txt` **[VERIFIED]** |

Article 3 §1 **[VERIFIED, verbatim]**:

> You acknowledge that the Commission services in charge of the Energy labelling
> product registry, (EPREL), hold all rights, titles and interests in and to the
> API and/or data, including any copyrights and/or database rights deriving
> therefrom.

Article 4 §1 grants the right *"to reproduce, share and distribute the Data for
commercial and non-commercial purposes in your aggregated purposes, to add value
in your services and benefit from the use of data,* **but not commercialize or
sell the data per se**" **[VERIFIED, verbatim]**, and explicitly permits
*"comparison tools"*.

Article 4 §2 then forbids **[VERIFIED, verbatim]**:

> a. sell the data on their own to gain benefit from the data themselves without
> adding value with your service […] you can use and aggregate data in your
> processes, **but not sell those data as it is**, even when complementary
> parameters are associated to each record;
>
> b. apply legal terms or technological measures that legally or physically
> restrict others from doing anything EPREL permits, including, but not limited
> to, redistribution, resale or **sublicense access to the Data**;

**A metered API that returns EPREL records to paying customers is selling the
data as it is, and gating it behind an API key is restricting what EPREL
permits.** "Even when complementary parameters are associated to each record"
closes the obvious workaround: enriching a record does not convert resale into
value-add.

The free front end is a different matter — Article 4 §1(v) names comparison
tools specifically. **This single source is why field 11 exists.**

Two further obligations a reviewer must weigh even for front-end use
**[VERIFIED, verbatim]**: where data is stored locally you must not *"fail to
ensure that the Data is kept up to date and corrections, restrictions or deletion
of the Data are reflected"* — a positive propagation duty, engaging
`docs/owner-actions/data-retention-and-erasure.md` — and on termination for
breach you must *"immediately and irrevocably delete any copies of such data"*.

Article 7 §1 also records that information *"has been provided directly by the
suppliers, who are solely responsible for its accuracy"* — the same
filings-not-determinations caveat as candidates 1 and 2.

**Verdict: not usable to back the paid API. Possibly usable for the free
comparison surface, subject to legal advice.** **[REVIEWER]**

---

### 5. NEEP Cold Climate ASHP Product List — *disqualified*

| | |
|---|---|
| Publisher | Northeast Energy Efficiency Partnerships **[VERIFIED]** |
| Host | `ashp.neep.org` / `neep.org` **[VERIFIED]** |

Terms of Use **[VERIFIED, verbatim]**:

> NEEP is the exclusive owner (licensee) of all right, title and interest in the
> Content on its Site.

> access and use the Site and to display, copy, print, and download the Content
> for **personal, non-commercial use only**.

> You may not use the Content for any other purpose without prior written
> permission of NEEP.

**Disqualified on the terms alone.** This is the clearest "no" of the twelve,
and it needed one page to establish.

There is a second, independent disqualifier worth recording because it
generalises: the product list is **operated in partnership with AHRI**
**[VERIFIED]**. AHRI is already prohibited in
`packages/source-registry/src/prohibited-sources.ts`. A downstream of a
prohibited source is not a way around the prohibition, and it fails field 20 as
well — corroboration between NEEP and AHRI would be one dataset agreeing with
itself.

---

## The rest, briefly

**6. ENERGY STAR Product Finder API** — same publisher and same underlying
certification data as candidate 1. Rights identical. **Fails independence: it is
a second door onto the first candidate**, and treating agreement between them as
corroboration would manufacture confidence from nothing.

**7. CEC MAEDbS** — no `robots.txt` (404 on 2026-08-23). The login page carries
**[VERIFIED, verbatim]**: *"The Modernized Appliance Efficiency Database System
(MAEDBS) is the property of the California Energy Commission (Commission) and may
only be accessed by authorized users. Unauthorized access, use, disruption,
modification, or destruction of this system is strictly prohibited and may be
subject to criminal prosecution."* A request for the appliance search path
redirected to that login **[VERIFIED]**. Whether the public search sits outside
that notice is a legal question, and the presence of criminal-prosecution
language makes it one to answer **before** any request, not after. **[REVIEWER]**

**8. NRCan searchable product list** — no `robots.txt` (404). No documented bulk
export or API located, and no licence statement on the product-list application.
Separately, NRCan *does* publish under the Open Government Licence – Canada on
`open.canada.ca`, but a search of that catalogue returned **aggregate statistics**
("Household Appliances", "Energy consumption of home appliances – EnerGuide
label"), not a product-model registry **[VERIFIED]**. The open licence is on the
wrong data; the right data has no stated licence.

**9. UK MCS Product Directory** — `robots.txt` read in full **[VERIFIED]**. The
default agent is `Allow: /`, but the file carries Cloudflare content signals
`Content-Signal: search=yes, ai-train=no, use=reference` under an explicit
header stating that *"ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS
RESERVATIONS OF RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790"*,
and it disallows `ClaudeBot`, `GPTBot`, `CCBot`, `Google-Extended`, `Amazonbot`,
`Applebot-Extended`, `Bytespider` and `meta-externalagent` outright. No bulk
export, no API, no licence statement located. **Rights expressly reserved; not a
candidate.**

**10–12** are covered above and in `docs/sources/prohibited-sources.md`.

---

## Recommendation

**First source: EPA ENERGY STAR certified products (candidate 1).**

It is the only candidate that is simultaneously public domain, permitted by
`robots.txt` on the exact path that would be fetched, large enough to be a real
product, already worked through to a thirteen-condition packet, and free of the
resale restriction that eliminates the best-licensed alternative. Its blocker is
a named human reading the packet and signing it.

**Fallback and disagreement detector: DOE CCMS (candidate 2).** US federal, one
irrelevant `robots` directive, a **stated** update cadence, and an explicit
publisher warning about what presence in it means. It should be onboarded as a
**disagreement detector**, not as corroboration — with the asymmetry written into
the source declaration so no later reader has to rediscover it.

**Neither before the schema gap in field 11 is closed**, because both would
otherwise be declared with a `redistribution_allowed` flag that cannot express
what this research found.

---

## Owner decisions required

None of these can be made from the repository, and none is made here.

1. **Sign or reject the ENERGY STAR packet.** Condition 2 is a signature. Until
   a named human fills `reviewed_by`, nothing proceeds. *Blocks everything.*
2. **Resolve packet §4** — whether partner- and certification-body-submitted
   values inherit EPA's public-domain status. A legal determination.
3. **Decide the ENERGY STAR trademark posture** (packet §5), separately from the
   data question.
4. **Decide whether the paid API and the free front end get separate rights
   fields.** This document says they must. It is a schema change and a code
   change, and it should land before the first real source, not after.
5. **Decide whether to write to DCCEEW** for an exemption to `Disallow: /`. The
   best licence of the twelve is behind it.
6. **Decide whether to seek EPREL front-end-only clearance** — permitted for
   comparison tools, forbidden for the API, and the split needs legal sign-off.
7. **Decide whether to approach CEC** for written MAEDbS permission, given the
   criminal-prosecution language.
8. **Decide the product framing** — see below.

---

## Should HVAC remain the first vertical?

**Yes — but the product it was designed to be cannot be built from lawful
sources, and continuing without saying so would be the mistake.**

The vertical's own configuration is the evidence.
`verticals/hvac/normalizers/fact-selection.yaml` resolves the most contested
property in the vertical, `seer2`, by preferring `CERTIFICATION_BODY` over the
manufacturer, with an explicit rationale: a certified rating is a measurement
made under a defined test procedure, and a manufacturer's figure is a nominal or
marketing value. The fixture that demonstrates it names `ahri-directory-export`
as the winning source.

**AHRI is prohibited in code.** So is every major manufacturer. The obvious
substitute, NEEP, is non-commercial *and* AHRI-derived. What remains lawful —
ENERGY STAR and DOE CCMS — are registers of **manufacturer and importer
filings**, and DOE says in its own words that appearing in one is not a
determination of anything.

So the authoritative tier the vertical was architected around is unavailable
across every candidate assessed here. The reason generalises — certification
data is the commercial product of the certification body, which is precisely why
it is licensed rather than published — but this assessment covers twelve
candidates, not the world, and it cannot establish that no lawful
certification-body source exists. **None of the assessed candidates provides
one**, which is enough to act on and not the same claim. **[REVIEWER]**

Three things follow.

**The vertical is still the right first one.** The lawful sources are large,
free, machine-readable, and genuinely useful; equipment models have stable
identifiers and real conflicts to resolve; and the rights work is already
furthest along here.

**The product must be described honestly.** It is a registry of *what
manufacturers have certified to regulators*, with the filing's own provenance
attached — not a certified-ratings directory. That is a defensible and
differentiated product. Describing it as the second one would be a claim the
data cannot support, and rule 1 is not only about publication rights.

**`fact-selection.yaml` needs revisiting before any real source lands.** Its
`authoritative_by_property` entries prefer a source type this platform is
forbidden to acquire. That is not urgent while the only data is fixtures, and it
becomes wrong on the day real data arrives. **[REVIEWER]**

---

## What was not established

Recorded so the gaps are not mistaken for clean results.

- **Field coverage for candidates 3, 4, 7, 8, 9 was not measured against the
  HVAC dictionary.** Establishing it would mean downloading records, which is
  not authorised.
- **Cadence is `[UNKNOWN]` for every candidate except DOE CCMS.** Only DOE states
  one. Nothing was inferred from observed timestamps.
- **Image rights are `[UNKNOWN]` for candidates 3–9.** None was assessed for
  photographs, because none was reached as a plausible candidate; only the
  ENERGY STAR trademark question was worked through.
- **Personal data was not affirmatively cleared for any candidate.** These are
  product registries and are unlikely to carry it, but "unlikely" is
  `[INFERRED]` and the field asks for evidence.
- **No candidate's terms were reviewed by a lawyer.** This is an AI assessment.
  It is not a rights review, and recording it as one is the specific failure the
  whole procedure exists to prevent.
