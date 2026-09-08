# Customer policies — review draft

Status: **not approved, not published, grants no data rights**. This packet makes
the remaining decisions concrete. Approval belongs to the operator's named
business/rights reviewer. Product configuration must not reference this draft as
an approved policy. Fill the decision record below and publish the approved
version at stable HTTPS addresses before setting `availability: available`.

## Proposed service terms

Data Foundry supplies equipment lookup, specifications and supporting source
evidence through the channels and coverage stated in the dataset documentation.
The contracting service operator is **[legal entity and service address]**.
Contact **[verified support address]** for account, data-quality or service issues.
These terms take effect on **[approved date/version]**.

Your subscription grants access to the selected API plan while your account and
subscription remain eligible. Dataset-specific permitted uses, attribution,
storage and redistribution conditions are listed in the approved dataset rights
appendix. Access alone does not grant permission to republish raw source
documents or images, resell an entire dataset, or use a separately restricted
publication channel. A source URL is evidence of origin, not a data license.

Use the service only through authorized credentials. Protect your keys and
report suspected compromise promptly. Do not bypass access controls or limits,
share a subscription credential publicly, interfere with service availability,
or submit personal, confidential or sensitive records as lookup arguments.
We may suspend compromised credentials or access that violates these conditions.

Coverage varies by source, manufacturer, model, geography and date. Missing
data is unknown, not zero. Equipment variants and rating standards can differ.
Preserve units, rating context and provenance when using a returned value.
The API does not determine installation sizing, code compliance, equipment
safety, replacement compatibility or independent certification. Verify decisions
with the relevant manufacturer documentation and qualified professional.

The documented refresh objective is a target during launch validation. It is
not a contractual uptime or freshness SLA. We retain the last valid version
during processing failures and report its verification date; access may be
withdrawn when source rights expire, are revoked or become disputed. Historical
evidence retention does not itself grant continuing customer access.

For RapidAPI subscriptions, use the marketplace to subscribe, manage billing
and cancel. The exact subscribed plan controls the renewal price, request
allowance and cancellation behavior. Initial plans require hard limits with no
automatic overages. Data Foundry does not issue a second direct invoice for
marketplace requests. Billing corrections and refunds follow the applicable
marketplace procedure and the approved refund policy **[policy/version]**.
Do not promise a cancellation effective date until it is verified in the live
subscriber flow. RapidAPI documents that older subscribers can remain on their
original plan when a provider edits a plan. [Marketplace monetization](https://docs.rapidapi.com/docs/monetizing-your-api-on-rapidapicom)

Report a suspected error using the request ID, endpoint, time, non-sensitive
model identifier and selected fact/evidence ID. We review the evidence and may
correct, annotate, retract or preserve a disputed claim. Corrections retain an
audit trail; they do not silently overwrite historical evidence. Proposed
support response target: acknowledge ordinary issues within two business days;
activate only when the operator can staff it.

**Reviewer must complete before publication:** liability and warranty wording,
any service credits/refund commitments, governing law, dispute process, notice
of material changes and mandatory customer protections. No arbitrary liability
cap, jurisdiction or waiver is inserted by this engineering draft.

## Proposed privacy notice

The service operator **[legal entity/contact]** is responsible for its customer
and service records. Its approved privacy contact is **[verified address]**.
This notice applies to Data Foundry's API, marketplace integration, support and
MCP analytics; the marketplace also processes information under its own notice.

We process account identifiers, organization/account names, contact details when
provided, credential hashes and prefixes, credential status, and metering records
needed to operate access and support usage reconciliation. Metering records
contain account/key references, timestamp, route category, request outcome,
row count, duration and channel classification. Application metering and
production error logging exclude lookup arguments, concrete model targets,
authorization headers and arbitrary exception contents. Infrastructure-provider
request logging must be reviewed separately before this notice is approved.

We use these records to deliver authorized service, administer subscriptions,
investigate abuse and failures, handle corrections and support, and meet the
operator's documented accounting and legal obligations. The legal bases and
jurisdictions for those purposes are **[reviewed controller decision]**.
Data Foundry application code does not store marketplace payment-card details;
the marketplace handles the initial subscription/payment channel.

Planned service providers are the existing Cloudflare infrastructure, the
canonical Postgres/Supabase database and RapidAPI/PayPal for marketplace
subscriptions and payout. Record the actual enabled providers, data locations,
contractual safeguards, subprocessors and transfer arrangements before approval.
Do not list an optional provider as active merely because its integration exists.

Account closure stops access and revokes keys. It does not automatically erase
contact, usage or accounting records. The approved retention schedule must list
each data category, retention trigger and duration, reason for retention,
erasure/anonymisation method, backup handling and any legal hold. The current
repository has no approved schedule, so it must not promise one to customers.

Contact **[privacy address]** to request access, correction, closure or erasure.
The operator will verify the request proportionately, determine which records
and downstream copies are affected, and explain any records it must retain.
Complete the applicable response period and escalation/complaint information
for the operator's actual jurisdictions before publication. Pseudonymisation
alone must not be represented as proven erasure or anonymity.

## Approval record

| Decision | Proposed reviewable result / required input |
|---|---|
| Service operator | Legal entity, business address and applicable jurisdictions |
| Rights appendix | Named human-approved source/slice; allowed fields and customer uses, attribution, caching and redistribution limits for this channel |
| Terms | Approved final text covering the incomplete commercial/legal clauses above |
| Privacy | Approved final notice matching enabled providers and telemetry |
| Retention/erasure | Category-by-category durations, triggers, legal bases, holds, downstream copies and backup treatment; see the existing retention decision packet |
| Support | Verified monitored email and staffed response expectation |
| Publication | Approver, date, immutable policy version and stable public HTTPS URLs |

Engineering then configures `terms_policy`, `privacy_policy` and
`support_contact` in `verticals/hvac/product.yaml`, implements the approved
retention schedule, verifies the deployed notices, and captures marketplace
subscription/cancellation evidence. No outbound customer message or agreement
acceptance is authorized by this draft.
