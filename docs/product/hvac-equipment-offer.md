# HVAC Equipment Specifications & Evidence API

Status: initial product contract and buyer-validation packet. This document
does not claim real-source coverage, an active RapidAPI listing or a sale.

## Buyer and useful request

Initial buyer: a software or equipment-catalog developer who already has model
identifiers and needs trustworthy structured specifications and their evidence.
The useful journey is model lookup → scoped identity confirmation → supported
specification enrichment → source evidence inspection → repeat integration.

Do not sell installation sizing, code compliance, replacement compatibility or
independent equipment certification. Those claims require distinct evidence and
workflows. Exact source coverage and limitations must accompany the listing.

## Initial data dictionary

Publish only the subset supported and permitted by the selected source. Missing
values remain missing; never infer a rating, compatible replacement or model
variant from a name. Existing canonical schemas remain the serialization contract.

| Concept | Meaning and acceptance |
| --- | --- |
| Canonical entity ID | Stable platform identity; redirects explain reviewed merges |
| Manufacturer | Source-supported organization identity; preserve its evidence and original spelling |
| Model identifiers | Original string, configured normalized alias, alias type and source/manufacturer scope; basic model and individual model are distinct |
| Equipment category | A configured source-to-canonical mapping; unsupported categories stay out of the initial slice |
| Specifications | Only approved typed fields and units, such as source-supported capacity or refrigerant; no fabricated completeness |
| Efficiency ratings | Value, unit/test standard and applicable equipment configuration; SEER/SEER2 and HSPF/HSPF2 must not be treated as interchangeable |
| Evidence | Published fact identity, source/publisher, immutable artifact reference/hash and locator, retrieval time, selection/conflict explanation; delivery is surface-rights filtered |
| Freshness | Upstream-reported update time when supplied; last successful verification; last actual data change; canonical publication time. Never relabel a failed processing attempt as verification |
| Limitations | Geography, model coverage, upstream cadence, omissions, unresolved conflicts and rights-driven withdrawals |

## Three design-partner trials

> **Superseded as a launch prerequisite, 2026-09-19.** Under the self-service
> direction, design-partner trials, interviews and outreach are optional
> learning, never a gate: launch evidence is an unrelated customer who
> voluntarily subscribes, consumes useful data and renews, measured from the
> product's own funnel. The section is kept as reusable material for the
> optional path; nothing in it is required before publication.

Recruit three independent integrations only after explicit outreach authorization.
Suggested segments: equipment catalogue/PIM developer, HVAC service-software
developer, and product-data integration consultancy. No person or organization
has been contacted by this work.

Each trial uses a permitted representative sample and 20–50 buyer-selected model
lookups. Record matched, ambiguous, unavailable and unsupported cases separately.
Measure time to first useful request, fields the buyer actually consumes, evidence
usefulness, weekly repeat use, willingness to pay and expected request volume.
Success requires each partner to run an integration against the contract, with
documented results; positive interview feedback alone is insufficient.

Draft outreach, unsent:

> We are preparing an equipment lookup API for HVAC software and catalogues.
> It returns supported specifications with source evidence and explicit coverage
> limits. We are looking for developers to test a small model-lookup integration
> and help identify missing fields. Would a short technical evaluation be useful
> for your current workflow? We can share the permitted sample and API examples
> once the source review is complete.

Interview prompts: What model strings do you receive? Which fields save manual
work? What happens when a model is ambiguous or missing? How often must the data
be checked? Which source evidence must your application show? At the proposed
price and measured coverage, would you deploy and renew?

## Introductory marketplace experiment

| Plan | Monthly hypothesis | Included requests | Overage |
| --- | ---: | ---: | --- |
| Evaluate | Free | 100 | Hard stop |
| Developer | $49 | 5,000 | Hard stop |
| Growth | $149 | 25,000 | Hard stop |
| Scale | $299 | 75,000 | Hard stop |

Do not advertise these as available until the provider listing and entitlement
journey are verified. The listing URL is configuration, never a guessed URL.
Confirm the provider's request-counting behavior for errors and quota refusals.
RapidAPI currently deducts 25%, with PayPal payout fees additional; reverify at
enrollment. [RapidAPI payout policy](https://docs.rapidapi.com/docs/payouts-and-finance)
(read 2026-09-08). Marketplace usage must remain excluded from direct invoicing.

## Launch evidence and economics

An owner-controlled external subscription must pay, issue an authorized request,
integrate usefully and have a working support path. *(2026-09-19: an
owner-controlled or sandbox subscription proves the mechanics only; first
revenue means an unrelated customer pays and consumes — see the
[qualification record](../commercial-validation/self-service-qualification-20260919.md).)* Verify cancellation, quota
refusal, wrong-origin/proxy negatives and payout reconciliation. Test purchases
or internal tenants do not establish external revenue.

Track gross monthly recurring revenue, platform deductions, payout fees, source
cost, compute/storage/database allocation, support cost, active integrations and
first-renewal retention. A $600 gross target leaves $450 after a 25% marketplace
deduction, before payout fees and operating costs. The $300 operating ceiling
is a budget, not measured current spend. Do not expand verticals before activation,
renewal and contribution margin support it.
