# Owner actions — the revenue path, end to end

**Status check first, because it matters for how to read this document:**
protected `main` contains privacy-safe usage accounting,
auth/Queue metering, the accepted ADR-0010 rights matrix, the public
multi-industry site, the thin RapidAPI origin adapter, the deployable
authenticated MCP Worker, and the Cron/R2 acquisition and rights-readiness
paths. Those capabilities are merged repository code, but the platform is not
yet deployed and no real HVAC source has an effective reviewed
publication/commercial bundle. Historical PR descriptions are not status
authority; the live 40-character `origin/main` and its fresh verification gates
  are. PR #22 remains the closeout candidate for exact alias-evidence linkage,
  fresh request snapshots, and migration `0026`'s bounded authorization probes;
  those hardenings are not protected-main capabilities until that candidate
  passes and merges.

This document describes the end-to-end revenue path those changes enable and
states plainly what is implemented, proposed, operational, legal or still a
business decision. Nothing described as a dashboard, marketplace, billing
relationship or live deployment can be verified from repository code alone.

## Revenue channels

| | Channel | Role | Status |
|---|---|---|---|
| 1 | **Public web / pay per crawl** | Discovery, SEO, ads/AI-crawler monetization | Rights-bound Worker implemented; deployment and Cloudflare enrollment remain |
| 2A | **API marketplace (RapidAPI initially)** | Low-friction developer discovery, checkout, plans and marketplace billing | Thin origin adapter implemented; marketplace enrollment/listing and deployment remain |
| 2B | **Direct Data Foundry API** | Higher-margin customers, larger volumes, negotiated terms | Auth, metering, and invoice-eligible usage implemented; pricing, contracts, and collection remain business decisions |
| 3 | **MCP / agent access** | Agent-native retrieval | Six-tool MCP contract and Cloudflare Streamable HTTP Worker implemented; deployment and commercial packaging remain |
| 4 | **Bulk / enterprise data** | Dataset snapshots, custom enrichment, enterprise licensing | Export surface exists; commercial rights and contracts remain separate decisions |

All channels must read the same canonical truth through the same query layer.
They may differ in access control, permitted sources, commercial terms and
presentation, but may not independently re-decide facts.

## Channel 1 — public web and pay per crawl

Per `docs/owner-actions/cloudflare-deployment.md` item 4, pay per crawl is a
Cloudflare zone setting rather than Worker billing code. `apps/web` is the
public, discoverable asset a crawler or search engine reaches.

Owner actions:

1. Deploy an exact protected-main SHA after its fresh release gates pass, setting
   `PUBLIC_ORIGIN` to the exact HTTPS origin and binding canonical Postgres.
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

### What the reconciled usage and auth work provides

- Usage accounting ties an event to the authenticating
  key, tenant, vertical and closed route vocabulary rather than a raw request
  target.
- The edge authenticates requests before routing and awaits durable Queue
  acceptance before returning metered success. A missing/rejected enqueue is an
  opaque retryable 503. Only the later idempotent Postgres persistence remains
  asynchronous and outside response latency/availability.
- Source refreshes use immutable revisions and
  `source-record-evidence@3`, whose fingerprint includes the exact resolved
  entity/manufacturer targets, alias claims and locators, facts, resolution
  audit, and relationship dispositions/endpoints. Migration 0023 derives
  current aliases from append-only claims and authority epochs without
  manufacturing authority for legacy aliases. An identifier-less refresh still
  finalizes a zero-claim successor, so the old revision, identity and
  relationships cannot remain commercially visible merely because their
  historical rows are retained.
- Migration 0025 admits a source-record alias to resolution/search only when
  the exact append-only claim has an exact immutable `ALIAS` evidence link.
  That contributing source therefore participates in the requested surface's
  rights AND; claim-only or unlinked legacy spellings stay hidden.
- Candidate migration `0026` supplies the composite evidence indexes used by
  the closeout query layer's bounded ordered probes. Canonical surface
  search/facets bind authorized UUID sets through constant-size
  JSONB parameters and preflight both entity and fact candidate ceilings before
  either rights batch begins. Evidence/dependency rowsets have their own hard
  ceiling, while the iterative derivation frontier independently caps nodes,
  edges and actual dependency-path depth and uses bounded index probes instead
  of a global recursive hash/sort. A shortcut edge cannot hide a longer chain,
  and a corrupt cycle reaches the same bounded refusal before contribution
  expansion. Public landing counts use one entity-only rights-bound aggregate;
  they do not scan or authorize an unrelated fact graph. Overflow
  refuses the entire result through the surface's opaque unavailable contract;
  it never truncates rights-safe totals or facets, and deterministic public-web
  capacity refusal does not invite automatic retry.
- Migration 0024 distinguishes complete snapshots from incremental refreshes.
  Only an explicit complete stream may retire an omitted record, and it records
  exact artifact evidence; incremental absence carries no deletion authority.
  Unknown legacy stream membership is withheld until a rights-admitted reingest.

These are prerequisites for both direct and marketplace access even though a
marketplace may be the system that actually charges a subscriber.

### Credential provisioning is access control, not source clearance

`pnpm credentials:provision` creates one fail-closed credential for one tenant
and one vertical. It accepts exactly these access/billing pairs:

- `API_PAID/DIRECT` for the direct paid API;
- `RAPIDAPI/RAPIDAPI` for the marketplace origin; or
- `MCP/NONE` for authenticated, analytics-only MCP access.

No pair is inferred. The command does not mint `API_FREE/DIRECT`, create a
subscription, set a price, or make a usage row invoiceable beyond its closed
classification. Direct and MCP keys are delivered only to a new absolute
owner-only file outside the worktree from a POSIX runtime; RapidAPI delivery is
piped to the repository-pinned Wrangler entry point as the edge Worker's
`RAPIDAPI_API_KEY`, with an explicit empty env file preventing implicit caller
`.env` loading. Production marketplace hostnames must be canonical public DNS
names, never reserved or `workers.dev`. Only a named legacy null/null row may be
classified, using explicit `--classify-existing`.

Most importantly, a key is not a grant. Provisioning creates no rights cell,
terms evidence, source approval, legal conclusion or publication permission.
The surface still fails closed unless every contribution resolves its exact
ADR-0010 bundle.

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
        | marketplace proxy-secret proof
        v
Cloudflare / apps/edge
        |
        | verify exact marketplace hostname + proxy proof
        | inject server-held RAPIDAPI_API_KEY
        | authenticate RAPIDAPI/RAPIDAPI service tenant
        | resolve surface/use-case rights
        | record usage for analytics/reconciliation
        v
canonical QueryModel
```

Implementation rules:

1. **Reuse the existing API-key system.** Give the edge Worker a dedicated
   `RAPIDAPI/RAPIDAPI` Data Foundry service key/tenant. Keep that key only as the
   Worker's `RAPIDAPI_API_KEY` secret; RapidAPI and subscribers never receive it.
2. **Verify the marketplace proxy secret.** A caller that bypasses RapidAPI must
   not be able to claim marketplace treatment merely by naming the channel.
   Give that channel its own hostname/route on the same edge Worker; keep the
   direct API on a different hostname so classification remains unambiguous.
3. **Never expose or forward the origin credential.** RapidAPI sends its own
   proxy proof. On the exact configured marketplace hostname, the Worker ignores
   caller `Authorization` and selects its server-held marketplace credential.
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
   definitions the API actually serves and checked for drift in CI. The current
   public artifact is `openapi/data-foundry-hvac-rapidapi-v1.openapi.json`; it
   intentionally omits the private Data Foundry origin bearer while preserving
   exact route and response-schema parity with the direct contract.

### Rights are the hard gate for marketplace publication

A marketplace listing is commercial redistribution/access. It cannot be treated
as merely another hostname.

ADR-0010 exists because one source may be permitted on the public web while
prohibited in a paid API or sublicensed access. Before a vertical is listed on
RapidAPI, every contribution must resolve the exact `RAPIDAPI` AND-bundle.

At minimum the rights system must distinguish:

- `PUBLIC_WEB`
- `SEARCH_INDEX`
- `API_FREE`
- `API_PAID`
- `RAPIDAPI`
- `MCP`
- `BULK_EXPORT`
- `PARTNER_DELIVERY`, `MODEL_TRAINING`, and `MODEL_EVALUATION` where applicable

Absence of permission remains refusal. A free RapidAPI tier does not become
`API_FREE`, and direct `API_PAID` permission does not imply `RAPIDAPI`; the
marketplace bundle separately requires service, sale, normalized redistribution
and sublicense permission on the marketplace channel.

### Mechanical source-readiness report

The report requires an explicit canonical UTC instant with millisecond
precision. It evaluates a conservative source-wide `DATA` / `NORMALIZED_FACT`
scope through the canonical rights engine for `PUBLIC_WEB`, `SEARCH_INDEX`,
`API_FREE`, `API_PAID`, `RAPIDAPI`, `MCP`, and `BULK_EXPORT`. A narrower
field-scoped grant does not make the whole source ready, and no neighboring
surface implies another.

Run without rights evidence to inventory sources and get deterministic
`UNKNOWN` for every surface:

```powershell
pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z hvac
pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z --json hvac
```

Use a live database only by naming the environment variable that contains the
connection string. Never put the connection string on the command line; the
report prints the variable name, not its value:

```powershell
pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z --database-env DATA_FOUNDRY_DATABASE_URL hvac
```

An offline snapshot is accepted only when its strict v1 schema, explicit
`generatedAt`, exact `asOf`, provenance label, canonicalization identifier and
SHA-256 canonical digest validate. The digest proves integrity, not legal
authority, and output remains visibly `SNAPSHOT_BACKED`. A validated snapshot is
qualified evidence for the instant it declares, not a claim about live-current
database state; named-environment live database mode is the live-current mode.

```powershell
pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z --rights-snapshot .\rights-snapshot.json --json hvac

# Export a credential-free snapshot from live DB evidence. Every clock and the
# provenance label is explicit; the tool never guesses the current time.
pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z --database-env DATA_FOUNDRY_DATABASE_URL --snapshot-out .\rights-snapshot.json --snapshot-provenance "owner-qualified production rights export" --generated-at 2026-08-28T12:05:00.000Z --json hvac
```

The accepted owner decision leaves ENERGY STAR deferred. It is absent from the
runtime registry and from this report by default. It can be included only for a
decision packet, where the report keeps it non-ready and names missing publisher
mapping, terms evidence, named-reviewer, activation and exact surface grants:

```powershell
pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z --include-source energy-star-heat-pumps --json hvac
```

Legacy `GREEN`/`AMBER` classifications and source-declaration booleans appear as
inventory/risk metadata and additional hard stops only. They never manufacture
an `ALLOW`. The generated offline schema is
`schemas/source-readiness-snapshot-v1.schema.json`; `pnpm schemas:check` rejects
schema drift.

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

## Channel 3 — MCP / agent access

`apps/mcp-worker` is the deployable Cloudflare adapter around the pure six-tool
contract in `apps/mcp`. It uses current MCP 2026-07-28 per-request Streamable
HTTP through the pinned official SDK, with only a bounded legacy `initialize`
handshake. Tool behavior still comes from the canonical QueryModel; the Worker
does not implement a second data path.

Access is one key, one vertical, and exactly `MCP/NONE`. Direct and RapidAPI
credentials are refused. `NONE` means Data Foundry does not treat the analytics
row as invoice eligible; it does not mean anonymous access. Queue records carry
only fixed MCP operation keys and never tool names, arguments, JSON-RPC ids,
entity ids, raw targets, bodies, or plaintext credentials.

The bearer key is a Data Foundry credential, not a standards-based MCP OAuth
token. No authorization server has been selected, so OAuth interoperability is
a later product/security decision rather than a claim made by this release.
Commercial launch still needs a deployed MCP hostname, exact source grants for
the MCP rights bundle, customer terms/packaging, and a live client smoke test.

## Required execution order

The next work should proceed in this order because later steps depend on the
semantics established earlier:

1. **Rights model — integrated.** ADR-0010 is accepted and implemented with
   sparse, fail-closed, surface-specific grants; no migration manufactured an
   `ALLOW`.
2. **Usage-accounting corrections — integrated.** The combined schema preserves
   route privacy, tenant/vertical attribution and database integrity.
3. **Auth and asynchronous metering — integrated.** API keys fail closed and
   the request path awaits privacy-safe Queue acceptance without awaiting later
   Postgres persistence.
4. **Public web — integrated.** Only `ACTIVE`, `PUBLIC_WEB`-eligible verticals
   render. Indexing and sitemaps additionally require `SEARCH_INDEX` to cover
   the exact facts, attributions and relationships rendered on the public page;
   a neighboring or disjoint grant never qualifies it.
5. **RapidAPI and MCP adapters — integrated.** RapidAPI stays a thin authenticated
   proxy over `apps/edge`; MCP stays a thin Streamable HTTP adapter over
   `apps/mcp`. Both have independent closed billing/access classifications;
   the credential provisioner creates access only and cannot create a rights
   grant.
6. **Scheduled acquisition and readiness — integrated.** The hourly
   `apps/acquisition-worker` uses durable versioned run receipts, exact stored
   `ACQUIRE`/`STORE`/`CACHE` checks before transport and again at the
   post-transport `PRE_PERSISTENCE` boundary, bounded publisher/provider
   responses, immutable R2 evidence, and a fenced recoverable lease on the one
   logical slot row. Unexpected orchestration failures that escape expected
   terminal handling release still-owned claims; crash recovery rotates the
   token only after expiry, and stale attempts cannot terminalize. The readiness
   command requires canonical `--as-of` and qualified DB/snapshot evidence.
7. **Deploy the canonical Cloudflare stack.** Provision production Postgres,
   Hyperdrive, all five Workers, R2, usage Queue/DLQ, routes and secrets. Every
   exact production manifest must name the same canonical Cloudflare
   `account_id`; prove health/readiness and perform live smoke tests.
8. **Rights-clear the first real vertical.** Synthetic HVAC fixtures prove the
   machinery, not the commercial dataset. No marketplace listing goes live
   until the actual contributing sources are cleared for the listed use cases.
9. **Create the first RapidAPI listing.** Start with one vertical, a deliberately
   small free allowance and paid tiers sized from observed Cloudflare/database
   cost and expected value. Verify the marketplace's current fee and payout
   terms at launch rather than hard-coding an old percentage into architecture.
10. **Package and expose MCP only for cleared data.** Issue a dedicated MCP key,
   verify current/legacy-handshake behavior and revocation on the deployed
   hostname, and keep its analytics outside internal invoices.
11. **Measure before expanding.** Track signups, activation, paid conversion,
   requests per account, costly endpoints, support load, churn and gross margin.
   Publish additional marketplace verticals only when their source rights and
   data quality are ready.
12. **Add first-party billing when justified by evidence.** Preserve the direct
    API route from day one so successful customers can later move to a higher-
    margin channel without changing the underlying product.

## Definition of revenue-ready for a vertical

A vertical is not revenue-ready merely because its tests pass. Before any paid
API or marketplace listing is enabled, all of the following must be true:

- real source data exists and has completed rights review;
- the exact commercial use case resolves `ALLOW` (or satisfied `CONDITIONAL`)
  with every condition enforceable and honored;
- attribution obligations are carried through the response/documentation;
- API contract and OpenAPI/listing docs match the deployed routes;
- production auth rejects invalid, revoked, expired and wrong-scope keys;
- marketplace bypass attempts are rejected;
- usage events are idempotent and attributable to channel + vertical without
  recording sensitive raw request targets;
- health/readiness checks pass against production storage;
- unit cost per request is measured enough to set a non-destructive plan limit;
- customer terms do not grant rights Data Foundry does not itself possess.

RapidAPI enrollment, the marketplace proxy secret, plans, payout setup, a live
route, and a real subscriber request remain external. MCP likewise still needs
a hostname, bindings, exact grants, packaging, and live-client proof; its custom
bearer credential is not OAuth.

## What ties the channels together

`apps/web` is the discovery layer. RapidAPI is a low-friction developer
marketplace. The direct API is the higher-control, higher-margin path. MCP and
bulk products extend the same canonical data into agent and enterprise use
cases. The foundry is therefore not an HVAC API project; it is the repeatable
system that can produce many separately marketable vertical data products
without forking ingestion, provenance, rights, query or deployment logic.
