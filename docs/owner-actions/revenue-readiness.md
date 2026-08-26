# Owner actions — the revenue path, end to end

**Status check first, because it matters for how to read this document:**
ADR-0007, ADR-0008, ADR-0009 and `db/migrations/0012_usage_accounting_corrections.sql`
are proposed in PR #14 (`claude/df-usage-schema`); the auth/metering
implementation described below (`apps/edge/src/auth.ts`, `apps/usage-consumer`,
`packages/usage-events`) is proposed in PR #15 (`claude/df-edge-auth-metering`).
The rights-grant model needed to distinguish public web, free API, paid API,
MCP/LLM and redistribution rights is proposed in PR #16. The public multi-industry
site is proposed in PR #17. **None of those four PRs is merged to `main` as of
this writing.**

This document describes the end-to-end revenue path those changes enable and
states plainly what is implemented, proposed, operational, legal or still a
business decision. Nothing described as a dashboard, marketplace, billing
relationship or live deployment can be verified from repository code alone.

## Revenue channels

| | Channel | Role | Status |
|---|---|---|---|
| 1 | **Public web / pay per crawl** | Discovery, SEO, ads/AI-crawler monetization | Public site in PR #17; Cloudflare pay-per-crawl is owner enrollment |
| 2A | **API marketplace (RapidAPI initially)** | Low-friction developer discovery, checkout, plans and marketplace billing | Planned; depends on rights + auth/metering + deployment |
| 2B | **Direct Data Foundry API** | Higher-margin customers, larger volumes, negotiated terms | Auth/metering drafted; direct billing not built |
| 3 | **MCP / agent access** | Agent-native retrieval | MCP surface exists; commercial entitlement model depends on rights-grant implementation |
| 4 | **Bulk / enterprise data** | Dataset snapshots, custom enrichment, enterprise licensing | Export surface exists; commercial rights and contracts remain separate decisions |

All channels must read the same canonical truth through the same query layer.
They may differ in access control, permitted sources, commercial terms and
presentation, but may not independently re-decide facts.

## Channel 1 — public web and pay per crawl

Per `docs/owner-actions/cloudflare-deployment.md` item 4, pay per crawl is a
Cloudflare zone setting rather than Worker billing code. `apps/web` is the
public, discoverable asset a crawler or search engine reaches.

Owner actions:

1. Deploy the public Worker after PR #17 is merged and production data exists.
2. Keep normal search-engine crawlers allowed if organic search is part of the
   acquisition strategy.
3. Enroll the zone in pay per crawl if available and economically sensible.
4. Treat ads, affiliate/lead-generation and crawler revenue as optional revenue
   on top of the primary discovery function of the public site.

## Channel 2 — paid API access

### Common origin: Cloudflare, not a second API implementation

`apps/edge` remains the canonical production origin for paid REST access. A
marketplace must proxy to that origin; it must not receive a forked API, copied
dataset or independently maintained route implementation.

Target topology:

```text
                          Data Foundry canonical API
                                   |
                            Cloudflare Worker
                             /             \
                            /               \
                  Direct customers       RapidAPI
                  Data Foundry keys       marketplace
                  direct billing          billing/discovery
```

This preserves one deployment, one query layer, one rights resolver and one
usage event model.

### What PR #14 and PR #15 provide

- PR #14 corrects usage accounting so an event is tied to the authenticating
  key, tenant, vertical and closed route vocabulary rather than a raw request
  target.
- PR #15 authenticates requests before routing and asynchronously records usage
  through a queue/consumer path so metering cannot become response latency or
  availability.

These are prerequisites for both direct and marketplace access even though a
marketplace may be the system that actually charges a subscriber.

### Marketplace strategy — RapidAPI first, not RapidAPI only

RapidAPI is the recommended first marketplace channel because it can provide
API discovery, developer onboarding, subscription plans, quotas and billing
without Data Foundry first building a complete subscription/invoicing stack.
It is a distribution and billing layer over the Cloudflare origin, not the
platform of record.

The intended request path is:

```text
RapidAPI subscriber
        |
        | marketplace authentication + plan
        v
RapidAPI gateway
        |
        | hidden Data Foundry bearer key
        | RapidAPI proxy-secret header
        v
Cloudflare / apps/edge
        |
        | authenticate normal Data Foundry key
        | verify marketplace proxy secret
        | resolve surface/use-case rights
        | record usage for analytics/reconciliation
        v
canonical QueryModel
```

Implementation rules:

1. **Reuse the existing API-key system.** Give RapidAPI a dedicated Data Foundry
   service key/tenant or equivalent scoped credential. Do not create a second
   credential architecture unless the existing model proves insufficient.
2. **Verify the marketplace proxy secret.** A caller that bypasses RapidAPI must
   not be able to claim marketplace treatment merely by naming the channel.
3. **Never expose the origin credential to subscribers.** The marketplace
   injects it as a hidden header.
4. **Record marketplace usage, but do not invoice it internally.** Marketplace
   usage events exist for operations, abuse analysis, reconciliation and unit
   economics; RapidAPI is the billing authority for those calls.
5. **Keep direct and marketplace billing mutually exclusive.** The eventual
   commercial model needs an explicit billing source/channel so one request
   cannot become both a marketplace charge and a direct invoice item.
6. **Do not duplicate plans in core fact/query logic.** Plan/entitlement logic
   belongs at the access/commercial boundary. The query layer receives only the
   permitted use-case context needed for rights enforcement.
7. **Generate marketplace documentation from the canonical API contract.** The
   OpenAPI/listing description must be derived from the same route/filter
   definitions the API actually serves and checked for drift in CI.

### Rights are the hard gate for marketplace publication

A marketplace listing is commercial redistribution/access. It cannot be treated
as merely another hostname.

PR #16 exists because a source can legally be permitted on a public comparison
page while prohibited in a paid API or sublicensed access. Before a vertical is
listed on RapidAPI, every fact that can reach that listing must resolve to a
permitted grant for the actual use being made.

At minimum the rights system must distinguish:

- `WEB_ITEM_PAGE` / `WEB_SEARCH_COMPARE`
- `API_FREE`
- `API_PAID`
- `LLM_RETRIEVAL`
- `BULK_EXPORT`
- `REDISTRIBUTION` / `SUBLICENSE` where applicable

Absence of permission remains refusal. A free RapidAPI tier does not make the
surface non-commercial or automatically convert `API_PAID` rights into
`API_FREE` rights; the grant recorded for that exact use case controls.

### Marketplace product shape

Publish one marketplace product per vertical rather than one generic Data
Foundry listing. The buyer searches for the problem/domain, not the internal
platform name. Examples should therefore be shaped like “HVAC Equipment
Specifications & Comparison API,” while all products share the same foundry
architecture underneath.

Keep higher-control offerings direct initially:

- bulk CSV/JSONL snapshots;
- custom datasets and enrichment;
- enterprise redistribution rights;
- large-volume or negotiated contracts;
- customer-specific SLAs;
- multi-vertical enterprise access.

### Direct API strategy

Do not block launch on building Stripe Billing. Direct API access should exist
technically once auth/metering is deployed, but commercial self-service billing
can wait until marketplace demand demonstrates what pricing and customer
behavior actually require.

Build direct billing when one or more of these are true:

- meaningful recurring marketplace revenue makes the marketplace fee material;
- customers ask for volumes or terms that do not fit marketplace plans;
- enterprise customers require direct contractual relationships;
- MCP/bulk/custom products need consolidated first-party billing.

Until then, marketplace billing is a deliberate market-validation shortcut,
not a permanent exclusivity decision.

## Required execution order

The next work should proceed in this order because later steps depend on the
semantics established earlier:

1. **Resolve and implement the rights model (PR #16).** Approve the rights-grant
   design, preserve fail-closed defaults, and add enforcement contexts for web,
   free API, paid API, MCP/LLM and export use cases.
2. **Land the usage-accounting corrections (PR #14 or successor).** Reconcile
   it with the rights changes if either branch touches shared schema/runtime
   assumptions; rerun full migration and contract evidence on the combined tree.
3. **Land auth and asynchronous metering (PR #15 or successor).** Rebase/replay
   it onto the corrected schema instead of merging a branch that targets stale
   assumptions.
4. **Land the public web surface (PR #17 or successor).** Re-run its rights and
   query-boundary tests against the final combined rights model; public web must
   pass the correct web use-case rather than rely on the old global gate.
5. **Deploy the canonical Cloudflare stack.** Provision production Postgres,
   Hyperdrive, API Worker, usage queue/consumer, public Worker, routes and
   secrets; prove health/readiness and perform live smoke tests.
6. **Rights-clear the first real vertical.** Synthetic HVAC fixtures prove the
   machinery, not the commercial dataset. No marketplace listing goes live
   until the actual contributing sources are cleared for the listed use cases.
7. **Add the marketplace adapter.** Dedicated marketplace tenant/key, proxy
   secret validation, channel/billing-source classification, OpenAPI export and
   contract tests. This should be a thin adapter around the deployed API, not a
   new product core.
8. **Create the first RapidAPI listing.** Start with one vertical, a deliberately
   small free allowance and paid tiers sized from observed Cloudflare/database
   cost and expected value. Verify the marketplace's current fee and payout
   terms at launch rather than hard-coding an old percentage into architecture.
9. **Measure before expanding.** Track signups, activation, paid conversion,
   requests per account, costly endpoints, support load, churn and gross margin.
   Publish additional marketplace verticals only when their source rights and
   data quality are ready.
10. **Add first-party billing when justified by evidence.** Preserve the direct
    API route from day one so successful customers can later move to a higher-
    margin channel without changing the underlying product.

## Definition of revenue-ready for a vertical

A vertical is not revenue-ready merely because its tests pass. Before any paid
API or marketplace listing is enabled, all of the following must be true:

- real source data exists and has completed rights review;
- the exact commercial use case resolves ALLOW/allowed with every condition
  enforceable and honored;
- attribution obligations are carried through the response/documentation;
- API contract and OpenAPI/listing docs match the deployed routes;
- production auth rejects invalid, revoked, expired and wrong-scope keys;
- marketplace bypass attempts are rejected;
- usage events are idempotent and attributable to channel + vertical without
  recording sensitive raw request targets;
- health/readiness checks pass against production storage;
- unit cost per request is measured enough to set a non-destructive plan limit;
- customer terms do not grant rights Data Foundry does not itself possess.

## What ties the channels together

`apps/web` is the discovery layer. RapidAPI is a low-friction developer
marketplace. The direct API is the higher-control, higher-margin path. MCP and
bulk products extend the same canonical data into agent and enterprise use
cases. The foundry is therefore not an HVAC API project; it is the repeatable
system that can produce many separately marketable vertical data products
without forking ingestion, provenance, rights, query or deployment logic.
