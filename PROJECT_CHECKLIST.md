# Project Checklist

## Project State

- Product: Data Foundry
- Lifecycle stage: MVP implementation / pre-deployment
- Current milestone: Integrate and deploy the first lawful, revenue-capable HVAC vertical
- Current release target: five Cloudflare Workers (edge, web, usage-consumer, acquisition-worker, mcp-worker) plus bulk exports, backed by canonical Postgres and R2 evidence storage
- Last updated: 2026-08-30
- Detailed sources: [`README.md`](README.md), [`docs/owner-actions/cloudflare-deployment.md`](docs/owner-actions/cloudflare-deployment.md), [`docs/source-onboarding.md`](docs/source-onboarding.md), and the vertical documents under [`verticals/hvac/`](verticals/hvac/)

Status vocabulary is limited to `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`, and `SUPERSEDED`. Open-PR work is not treated as complete on `main`.

## Foundation

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FOUNDATION-001 | Foundation | Canonical schema, migrations, provenance, query model, acquisition, extraction, normalization, resolution, and storage architecture | DONE | Synthetic HVAC sources run end to end with evidence-backed canonical output and deterministic checks | `tests/e2e/factory-proof.test.ts`; `README.md`; migrations `0001`–`0011` on `main`; driver-managed resolution transaction with executor-affinity, failure-rollback, and unresolved-record rollback tests in the integration candidate | None | 2026-08-23 |
| FOUNDATION-002 | Foundation | REST, MCP, and export surfaces use the canonical query layer | DONE | Surface-boundary and parity tests pass on `main` | `apps/api`; `apps/mcp`; `services/export-builder`; `tests/contract/surface-parity.test.ts` | None | 2026-08-23 |
| FOUNDATION-003 | Foundation | Cloudflare Worker composition root | DONE | Worker composes API/query/database runtime without an in-memory production fallback | `apps/edge`; ADR-0006; PR #11 merged in `6db77e0` ancestry | None | 2026-08-23 |
| FOUNDATION-004 | Foundation | API tenancy schema | DONE | Tenant, credential, and usage foundations exist with migration verification | `db/migrations/0011_api_tenancy.sql`; PR #12 merged as `6db77e0` | None | 2026-08-23 |
| FOUNDATION-005 | Foundation | Repository governance and session handoff standard | IN_PROGRESS | Canonical control standard, executive checklist, and current handoff are merged into `main` and referenced by `AGENTS.md` | This migration branch | Merge of governance PR | — |
| FOUNDATION-006 | Foundation | Canonical Cloudflare and database topology | BLOCKED | Account, zone/routes, Hyperdrive, production Postgres, R2, Queue/DLQ, Cron, and bindings are configured and evidenced | Five tracked Wrangler templates enforce no workers.dev/preview URLs and invocation-log privacy; repository/deployment manifest topology checks; `docs/owner-actions/cloudflare-deployment.md` | Exact ignored deployment manifests, provider resources, credentials, deployment IDs, and live proof remain external | — |
| FOUNDATION-007 | Foundation | Repository protection and security configuration | BLOCKED | Active `main` ruleset, required checks, security scanning, and Vercel disconnection are verified | `docs/owner-actions/repository-governance.md`; ADR-0005 | Provider settings and account-level decisions described in the runbook | — |

## MVP

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MVP-001 | MVP | Rights-grant model supports different lawful uses and access tiers | IN_PROGRESS | Accepted rights architecture and implementation are integrated into the release candidate without implying source clearance | Accepted ADR-0010; `packages/rights-engine`; migrations 0014/0016; exact effective surface matrices; provenance AND; exact historical fact selection with current publication rights; recursive historical-contributor and bulk-export controls; no migration-created `ALLOW`; canonical `sources:readiness --as-of` with named live DB or validated qualified snapshot | Candidate verification/merge remains; source-specific legal/rights review remains independently required | — |
| MVP-002 | MVP | First real HVAC source approved and ingested | BLOCKED | At least one real source passes rights review, acquisition, extraction, normalization, evidence, quality, and publication gates | `verticals/hvac/RIGHTS.md`; source review packets under `docs/sources/`; rights-aware `sources:readiness` output identifies exact missing operation/channel cells while keeping the proposed ENERGY STAR source deferred | Rights approval and real-source acquisition are incomplete | — |
| MVP-003 | MVP | Scheduled refresh policy and runner | IN_PROGRESS | Cadence policy is integrated, wired to Cron, rights-gated at every acquisition boundary, stores immutable R2 evidence, and records durable run/failure state | `apps/acquisition-worker`; migrations 0017/0019/0020; versioned four-checkpoint receipts; fenced same-row retry/crash recovery; non-owner claim observations and diagnostic reads omit the fencing token; post-transport revocation negative; direct/provider size, page, cursor, diagnostic, cumulative-artifact, and no-partial-write controls; acquisition compiler, PostgreSQL, topology, and artifact checks | Candidate verification/merge remains; no live Cron/R2/Hyperdrive execution for this candidate is evidenced | — |
| MVP-004 | MVP | Privacy-safe API usage schema and vertical accounting | IN_PROGRESS | Route closed vocabulary, vertical-total accounting, authority corrections, access/billing channel isolation, and migrations are integrated and verified | migrations 0012/0015/0018; `packages/usage-events`; direct-invoice exclusion tests | Final integrated candidate verification/merge | — |
| MVP-005 | MVP | API authentication and asynchronous usage metering | IN_PROGRESS | Scoped API keys and queue-backed idempotent usage persistence are merged and verified on deployed Cloudflare infrastructure | `apps/edge`; `apps/usage-consumer`; ADR-0009; durable queue-acceptance and idempotent-consumer tests | Candidate integration/merge; queue/DLQ/Hyperdrive provisioning and live integration proof | — |
| MVP-006 | MVP | Public multi-industry web surface | IN_PROGRESS | Human pages, crawl controls, quality gates, evidence links, sitemaps, and web runtime are integrated and deployed | `apps/web`; ADR-0011; generated runtime and dispatch/SEO tests; explicit production `PUBLIC_CACHE_MODE=no-store`, cache-isolated composition, shared request-wide sitemap scan budget, atomic capacity refusal, canonical shard parsing, and fixed-worker authorization controls | Final integrated verification and Cloudflare deployment; switching to public cache requires live purge, provider-bypass, and stale-object proof, and sitemap routes require a live provider rate-limit rule | — |
| MVP-007 | MVP | RapidAPI/public API distribution and billing path | IN_PROGRESS | Canonical API adapter, marketplace-origin authentication, OpenAPI contract, billing-channel isolation, product offering, and marketplace integration are verified end to end | `apps/edge/test/rapidapi.test.ts`; generated `openapi/data-foundry-v1.openapi.json`; direct-invoice exclusion test | Final candidate verification/merge; RapidAPI enrollment, proxy secret, plans, payout, live route, and real subscriber proof | — |
| MVP-008 | MVP | Security and privacy baseline | IN_PROGRESS | Authn/authz, rights, secret handling, data minimization, retention/erasure, dependency review, and abuse controls are verified for the release candidate | `SECURITY.md`; `DATA_RIGHTS.md`; privacy tests; non-owner acquisition-capability redaction; bounded sitemap work; `docs/owner-actions/data-retention-and-erasure.md` | Provider rate limiting/abuse protection and production evidence incomplete | — |
| MVP-009 | MVP | Accessibility, SEO, analytics, and observability baseline | IN_PROGRESS | Relevant public pages meet accessibility/SEO criteria; errors, usage, and critical runtime health are observable without leaking sensitive data | SEO and observability work in PR #17; logging in current services | Web merge/deploy; analytics and production monitoring evidence | — |
| MVP-010 | MVP | Deployable MCP / agent-access surface | IN_PROGRESS | The six generic canonical-query tools run through MCP 2026-07-28 Streamable HTTP with exact one-vertical custom-bearer `MCP/NONE` auth, live rights freshness, privacy-safe Queue analytics, generated runtime parity, and no local-only runtime in the Cloudflare bundle | `apps/mcp`; `apps/mcp-worker`; `packages/access-auth`; migration 0018; `verticals/hvac/mcp.yaml`; MCP Worker and Cloudflare artifact tests | Final candidate verification/merge; MCP is not OAuth, and this candidate has no evidenced deployment pending hostname, Hyperdrive/Queue, exact grants, packaging, and live-client proof | — |

## Beta

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BETA-001 | Beta | Browser, REST, marketplace, and MCP end-to-end coverage against Preview | NOT_STARTED | Real search/entity/docs flows, API/MCP auth, wrong-channel and rights negatives, error states, mobile/tablet layouts, console, and network behavior pass in isolated deployment | No deployed Preview recorded | MVP surfaces and canonical infrastructure | — |
| BETA-002 | Beta | Live Cloudflare Queue and database integration proof | NOT_STARTED | At-least-once delivery, duplicates, retries, DLQ, and persistence are verified against real isolated provider resources | PR #15 documents test-double limitation | Queue, DLQ, Hyperdrive, and isolated database | — |
| BETA-003 | Beta | Operational runbooks and recovery | IN_PROGRESS | Deploy, migration, rollback, backup/restore, incident, data-erasure, and key-revocation paths are executable and tested | Existing owner-action runbooks cover portions | Canonical production topology and recovery test | — |
| BETA-004 | Beta | Critical findings and stale branches closed | IN_PROGRESS | Relevant open PRs/findings are resolved; merged or obsolete branches contain no unique work and are cleaned safely | Reconciled integration worktree contains the intended source, usage, rights, web, RapidAPI, Task 9, and MCP slices | Final candidate review/merge, then branch-by-branch unique-work inspection | — |

## Production

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PROD-001 | Production | Production database, migrations, backup, and recovery | NOT_STARTED | Exact production target, migration set, backup, restore test, and recovery point are evidenced | No production database evidence in repository | FOUNDATION-006 and approved migrations | — |
| PROD-002 | Production | Production Cloudflare deployment | NOT_STARTED | Exact candidate SHA and deployment IDs are live; health/readiness and critical workflows pass | No production deployment of this integration candidate is recorded or verified; live Cloudflare account state was unavailable for inspection | MVP completion and Cloudflare topology | — |
| PROD-003 | Production | Production security, privacy, legal, and billing readiness | BLOCKED | Security review, retention/erasure, rights approvals, terms/privacy, abuse protection, billing, and settlement configuration are complete | `SECURITY.md`, rights and owner-action docs identify gaps | Legal/business decisions and technical MVP work | — |
| PROD-004 | Production | Monitoring, alerting, analytics, and operations | NOT_STARTED | Health, errors, queue failures, database availability, usage/billing, and public traffic have actionable monitoring and alerts | No production evidence | Production infrastructure | — |
| PROD-005 | Production | Stale code, infrastructure, issue, and branch cleanup | IN_PROGRESS | Obsolete paths and redundant infrastructure are removed after proof; completed findings/issues are closed; merged branches are deleted safely | Vercel disconnect/removal remains; branch inventory recorded in `PROGRESS.md` | Merge status and provider verification | — |
| PROD-006 | Production | Product Owner declares Data Foundry shipped and live | NOT_STARTED | Product Owner explicitly changes pre-shipping authority after successful production verification | Not declared | PROD-001–PROD-005 | — |

## Required User Actions

| ID | Action | Why owner-only | Blocks | Safe work meanwhile | Recommended choice |
| --- | --- | --- | --- | --- | --- |
| UA-001 | Complete source-specific legal/rights review and record exact grants for the first real HVAC source | ADR-0010 is accepted, but engineering cannot invent permissions or legal clearance for a source | Real-source publication and paid/marketplace release for that source | Integrate and deploy synthetic-data-capable platform foundations; keep every absent grant fail-closed | Review each required operation/channel cell with counsel or an authorized reviewer; record evidence without inferring neighboring rights |
| UA-002 | Provide or authorize canonical Cloudflare account, domain/zone, and production database connectivity through protected platform configuration | Account/zone ownership and secret-bearing credentials are unavailable to the repository | Preview/production deployment | Finish and merge code; use local and non-secret dry-run validation | Reuse one canonical Cloudflare account/project topology and one canonical Postgres/Supabase project with native isolation |
| UA-003 | Complete provider/account actions in the repository-governance runbook that remain inaccessible to the active tool surface | Rules/security settings and Vercel disconnection require account-level provider access | Safe protected release | Continue local and PR verification | Apply the documented zero-approval, required-check `main` ruleset; disconnect the obsolete Vercel integration |

## Deferred

| Item | Status | Reason | Revisit trigger |
| --- | --- | --- | --- |
| Automated mutation testing platform | DEFERRED | Current work uses targeted manual mutations; introducing a new platform is not required for the immediate release path | Mutation coverage becomes unreliable or regression volume justifies automation |
| Dedicated graph database or search cluster | DEFERRED | `AGENTS.md` scope control rejects these without measured need | Postgres/query evidence proves the current architecture insufficient |
| Proposed ENERGY STAR heat-pump source | DEFERRED | Partner-submitted field rights remain unknown; owner prohibited signing, promotion, acquisition, publication, contact, and outreach in this work package | Owner explicitly reopens the source after appropriate human rights review authority is available |

## Superseded

| Item | Status | Superseded by | Evidence |
| --- | --- | --- | --- |
| Vercel as Data Foundry deployment target | SUPERSEDED | Cloudflare Workers | ADR-0005 and ADR-0006 |
