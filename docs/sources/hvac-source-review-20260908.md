# HVAC first-source review — 8 September 2026

Status: documentation research only. No candidate is approved, acquired,
contacted, or published. ENERGY STAR remains deferred. This addendum supersedes
the August landscape's positive **inferences** about DOE redistribution; an
inference is not a grant. The August inventory remains a historical reference.

## Fresh primary-source observations

| Candidate | Current publisher documentation | Implication for the first offer | Unresolved gate |
| --- | --- | --- | --- |
| DOE CCMS | Reports are submitted by manufacturers and their representatives; the public database includes current basic models submitted within the past year and updates approximately every two weeks. Search and download are described. DOE disclaims accuracy and says public listing has no legal significance. | Evaluate one central air conditioner/heat-pump equipment slice; keep basic-model and individual-model identities distinct. Do not describe this as complete installed-equipment coverage, independent certification, or daily upstream updates. | Exact structured endpoint, field/identifier coverage, third-party rights, permitted automated acquisition and paid redistribution are unapproved. |
| DOE website policy | Government information is public domain, but contributed or licensed private materials can be protected and require permission for reproduction. | A government host does not itself establish a resale licence for submitted equipment values. | Named reviewer must establish the precise rights basis for the fields and transformations used. |
| Australian Energy Rating | Official overview describes registered products for Australia/New Zealand and links labelled/non-labelled data on data.gov.au. Some product details can remain confidential until sale. The registration system announces a 28 September–5 October 2026 closure and replacement platform on 6 October. | Potential structured alternative if the initial buyers need AU/NZ coverage. Anticipate metadata/link changes; registration-system closure does not prove a data-API outage. | Current exact-resource licence, technical access permission, refresh and downstream marketplace rights. Previous host crawl restriction is not cleared by the overview page. |

Sources, read 2026-09-08: [DOE database](https://www.regulations.doe.gov/certification-data/products.html),
[DOE policies](https://www.energy.gov/web-policies),
[Energy Rating data overview](https://www.energyrating.gov.au/about-us/gems-regulator/registered-appliance-and-equipment-data).
Only these documentation observations were refreshed here. No product rows or
raw dataset were downloaded. No observed record count or extraction success is claimed.

Other August candidates keep their **unverified historical** disposition until
freshly reviewed: EPREL paid redistribution restriction; NEEP non-commercial
restriction; CEC, NRCan and MCS unresolved permissions; AHRI and manufacturer
catalogue prohibition enforced in code. ENERGY STAR and its Product Finder API
remain explicitly deferred and are not fallback acquisition targets.

## Review packet required before selecting a source

The reviewer records a dated, signed decision with an expiry/review date and an
immutable reference to each relied-on licence, permission, contract and terms
version. Missing cells remain denied. Engineering does not sign this decision.

| Decision | Required content |
| --- | --- |
| Source identity | Legal publisher, exact endpoint/resource IDs, domains, equipment slice, geography, whether data are independently observed or publisher submissions |
| Acquisition | Automation permission, credentials method, robots/rate-limit requirements, conditional GET support, bounded format/size, permitted check frequency |
| Processing | Extraction, normalization, identity matching, derived values and retained evidence permissions; no unapproved AI training |
| Paid channel | Explicit basis for distributing the selected values through RapidAPI to subscribers, including subscriber reuse restrictions |
| Other surfaces | Independent decisions for public web, search indexing, direct free API, direct paid API, MCP, bulk; image permissions independent and default off |
| Coverage | Actual field inventory, model vs basic-model semantics, units and test standards, current/discontinued scope, missingness and duplicate rates |
| Operations | Upstream cadence, source-reported timestamp semantics, retention/reprocessing rights, revocation handling, cost and acquisition support contact |
| Approval | Named human, role/authority, evidence IDs, allowed fields/operations/channels, conditions, effective/expiry dates, ongoing review owner |

## Bounded candidate acceptance

After approval, acquire a representative sample using the permitted adapter.
Start with one equipment category and one primary source. The sample must span
at least 50 representative models (or the complete smaller slice), including
multiple manufacturers, unit variants, missing fields, duplicate identifiers,
revised records and discontinued/removed records where the source supplies them.
This is an acceptance target, not a claim that such records are already held.

Check exact-model retrieval, manufacturer scoping, supported specification
completeness, evidence coverage for every published fact, source timestamps,
rights refusal, and changed/unchanged processing. Review ambiguous identifiers;
do not silently resolve collisions. Store fixtures only where retention permits.

Use source-specific conditional checks every 12 hours only when permitted.
Record source publication frequency separately. Measure detection-to-publication
lag against the initial two-hour target. Require two real successful cycles and
an induced failure/recovery before advertising measured freshness.

The source plus acquisition/AI allocation is $75/month within the $300 total
operating ceiling. Estimate requests, bytes, R2 growth, processing CPU and
database writes from the approved sample before committing to recurring cost.
One-time legal or contract expenses require separate owner treatment.

## Selection status

No source has cleared the packet. DOE and AU data are review candidates, not
selected sources. Continue synthetic platform validation while the named human
review, exact endpoint qualification and three buyer integrations are pending.
