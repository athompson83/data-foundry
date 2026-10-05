# Revenue Plan — First paid machine request

## Objective
Ship one rights-approved differentiated dataset through direct paid API/MCP access. Do not add infrastructure unless required for this transaction.

## Governing rule
Revenue-path work has priority over feature expansion. Before implementing any item, inspect the repository and provider state and reuse what already exists. Do not duplicate billing, analytics, auth, SEO, deployment, or testing infrastructure. Run the smallest relevant local tests first; use hosted CI only when it adds evidence.

## MVP → Beta → Production

### MVP — prove the transaction
- [ ] Confirm source rights and buyer value
- [ ] finalize direct pricing/invoicing
- [ ] deploy ordinary paid API/MCP route
- [ ] provision external machine credential
- [ ] meter usage
- [ ] collect payment
- [ ] preserve request/usage/payment receipt
- [ ] publish machine-readable docs and SEO/AEO discovery.

### Beta — prove repeatability
- [ ] Admit a bounded non-owner cohort only after the MVP transaction path passes.
- [ ] Measure activation, conversion, failures, support burden, unit cost and retention/reuse signal.
- [ ] Fix only defects or friction supported by observed evidence; record deferred feature requests separately.

### Production — scale only after proof
- [ ] Establish production monitoring, billing reconciliation, support/refund/cancellation handling and rollback/recovery appropriate to this product.
- [ ] Expand SEO/AEO and acquisition only around validated demand and truthful product capabilities.
- [ ] Approve additional scope only when the revenue evidence identifies the next constraint.

## Revenue success criterion
**External non-owner machine authenticates, receives value-added data, usage is metered, and payment is collected.**

## Stop / adjust criteria
- No new major feature family before the success criterion is met.
- Do not create a new database/project/service when an existing governed resource can satisfy the requirement.
- Do not increase CI spend for redundant evidence.
- If customer/buyer evidence contradicts the offer, change the offer before expanding the architecture.

## Required evidence
Record the exact commit/deployment, customer class (never secrets/PII), acquisition source, transaction result, metering/entitlement result, product outcome, variable cost, failure points, and next constraint in the repository's existing progress/checklist artifacts.
