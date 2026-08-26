# Project Checklist

## Project State

- Product: Data Foundry
- Lifecycle stage: MVP implementation / pre-deployment
- Current milestone: Integrate and deploy the first lawful, revenue-capable HVAC vertical
- Current release target: Cloudflare-hosted public web, metered API, MCP, and exports backed by canonical Postgres
- Last updated: 2026-08-26
- Detailed sources: [`README.md`](README.md), [`docs/owner-actions/cloudflare-deployment.md`](docs/owner-actions/cloudflare-deployment.md), [`docs/source-onboarding.md`](docs/source-onboarding.md), and the vertical documents under [`verticals/hvac/`](verticals/hvac/)

Status vocabulary is limited to `NOT_STARTED`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `DEFERRED`, and `SUPERSEDED`. Open-PR work is not treated as complete on `main`.

## Foundation

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FOUNDATION-001 | Foundation | Canonical schema, migrations, provenance, query model, acquisition, extraction, normalization, resolution, and storage architecture | DONE | Synthetic HVAC sources run end to end with evidence-backed canonical output and deterministic checks | `tests/e2e/factory-proof.test.ts`; `README.md`; migrations `0001`–`0011` on `main` | None | 2026-08-23 |
| FOUNDATION-002 | Foundation | REST, MCP, and export surfaces use the canonical query layer | DONE | Surface-boundary and parity tests pass on `main` | `apps/api`; `apps/mcp`; `services/export-builder`; `tests/contract/surface-parity.test.ts` | None | 2026-08-23 |
| FOUNDATION-003 | Foundation | Cloudflare Worker composition root | DONE | Worker composes API/query/database runtime without an in-memory production fallback | `apps/edge`; ADR-0006; PR #11 merged in `6db77e0` ancestry | None | 2026-08-23 |
| FOUNDATION-004 | Foundation | API tenancy schema | DONE | Tenant, credential, and usage foundations exist with migration verification | `db/migrations/0011_api_tenancy.sql`; PR #12 merged as `6db77e0` | None | 2026-08-23 |
| FOUNDATION-005 | Foundation | Repository governance and session handoff standard | IN_PROGRESS | Canonical control standard, executive checklist, and current handoff are merged into `main` and referenced by `AGENTS.md` | This migration branch | Merge of governance PR | — |
| FOUNDATION-006 | Foundation | Canonical Cloudflare and database topology | BLOCKED | Account, zone/routes, Hyperdrive, production Postgres, and bindings are configured and evidenced | `docs/owner-actions/cloudflare-deployment.md` | Owner-controlled Cloudflare/domain/credential setup; no runtime credentials available in the current environment | — |
| FOUNDATION-007 | Foundation | Repository protection and security configuration | BLOCKED | Active `main` ruleset, required checks, security scanning, and Vercel disconnection are verified | `docs/owner-actions/repository-governance.md`; ADR-0005 | Provider settings and account-level decisions described in the runbook | — |

## MVP

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MVP-001 | MVP | Rights-grant model supports different lawful uses and access tiers | BLOCKED | Owner approves the rights model and partner-field ownership decision; implementation and tests enforce it | PR #16 proposes ADR-0010; `docs/owner-actions/rights-model-decision.md` exists on PR #14 | Product/legal decisions; no lawyer review recorded | — |
| MVP-002 | MVP | First real HVAC source approved and ingested | BLOCKED | At least one real source passes rights review, acquisition, extraction, normalization, evidence, quality, and publication gates | `verticals/hvac/RIGHTS.md`; source review packets under `docs/sources/` | Rights approval and real-source acquisition are incomplete | — |
| MVP-003 | MVP | Scheduled refresh policy and runner | IN_PROGRESS | Cadence policy is merged, wired to an execution trigger, and records last successful acquisition and failures | PR #13 implements policy only | Runner and deployment trigger remain unimplemented | — |
| MVP-004 | MVP | Privacy-safe API usage schema and vertical accounting | IN_PROGRESS | Route closed vocabulary, vertical-total accounting, authority corrections, and migrations are merged and verified | PR #14 | Review/merge of PR #14 | — |
| MVP-005 | MVP | API authentication and asynchronous usage metering | IN_PROGRESS | Scoped API keys and queue-backed idempotent usage persistence are merged and verified on deployed Cloudflare infrastructure | PR #15 | PR #14 dependency; queue/DLQ/Hyperdrive provisioning; live integration proof | — |
| MVP-006 | MVP | Public multi-industry web surface | IN_PROGRESS | Human pages, crawl controls, quality gates, sitemaps, and web runtime are merged and deployed | PR #17 | PR review/merge and Cloudflare deployment topology | — |
| MVP-007 | MVP | RapidAPI/public API distribution and billing path | NOT_STARTED | Product offering, plans/quotas, customer onboarding, billing/metering reconciliation, public docs, and marketplace integration are verified end to end | Revenue direction discussed; no implementation on `main` | MVP-004, MVP-005, production API route, pricing decisions | — |
| MVP-008 | MVP | Security and privacy baseline | IN_PROGRESS | Authn/authz, rights, secret handling, data minimization, retention/erasure, dependency review, and abuse controls are verified for the release candidate | `SECURITY.md`; `DATA_RIGHTS.md`; privacy tests; `docs/owner-actions/data-retention-and-erasure.md` | Rate limiting/abuse protection and production evidence incomplete | — |
| MVP-009 | MVP | Accessibility, SEO, analytics, and observability baseline | IN_PROGRESS | Relevant public pages meet accessibility/SEO criteria; errors, usage, and critical runtime health are observable without leaking sensitive data | SEO and observability work in PR #17; logging in current services | Web merge/deploy; analytics and production monitoring evidence | — |

## Beta

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BETA-001 | Beta | Browser and API end-to-end coverage against Preview | NOT_STARTED | Real search/entity/docs flows, API auth, error states, mobile/tablet layouts, console, and network behavior pass in isolated deployment | No deployed Preview recorded | MVP surfaces and canonical infrastructure | — |
| BETA-002 | Beta | Live Cloudflare Queue and database integration proof | NOT_STARTED | At-least-once delivery, duplicates, retries, DLQ, and persistence are verified against real isolated provider resources | PR #15 documents test-double limitation | Queue, DLQ, Hyperdrive, and isolated database | — |
| BETA-003 | Beta | Operational runbooks and recovery | IN_PROGRESS | Deploy, migration, rollback, backup/restore, incident, data-erasure, and key-revocation paths are executable and tested | Existing owner-action runbooks cover portions | Canonical production topology and recovery test | — |
| BETA-004 | Beta | Critical findings and stale branches closed | IN_PROGRESS | Relevant open PRs/findings are resolved; merged or obsolete branches contain no unique work and are cleaned safely | Open PRs #13–#17; multiple stale remote branches | Merge/supersede decisions and branch-by-branch unique-work inspection | — |

## Production

| ID | Phase | Description | Status | Acceptance criteria | Evidence | Dependencies / blocker | Completed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PROD-001 | Production | Production database, migrations, backup, and recovery | NOT_STARTED | Exact production target, migration set, backup, restore test, and recovery point are evidenced | No production database evidence in repository | FOUNDATION-006 and approved migrations | — |
| PROD-002 | Production | Production Cloudflare deployment | NOT_STARTED | Exact candidate SHA and deployment IDs are live; health/readiness and critical workflows pass | Nothing deployed according to `main` and PR #17 | MVP completion and Cloudflare topology | — |
| PROD-003 | Production | Production security, privacy, legal, and billing readiness | BLOCKED | Security review, retention/erasure, rights approvals, terms/privacy, abuse protection, billing, and settlement configuration are complete | `SECURITY.md`, rights and owner-action docs identify gaps | Legal/business decisions and technical MVP work | — |
| PROD-004 | Production | Monitoring, alerting, analytics, and operations | NOT_STARTED | Health, errors, queue failures, database availability, usage/billing, and public traffic have actionable monitoring and alerts | No production evidence | Production infrastructure | — |
| PROD-005 | Production | Stale code, infrastructure, issue, and branch cleanup | IN_PROGRESS | Obsolete paths and redundant infrastructure are removed after proof; completed findings/issues are closed; merged branches are deleted safely | Vercel disconnect/removal remains; branch inventory recorded in `PROGRESS.md` | Merge status and provider verification | — |
| PROD-006 | Production | Product Owner declares Data Foundry shipped and live | NOT_STARTED | Product Owner explicitly changes pre-shipping authority after successful production verification | Not declared | PROD-001–PROD-005 | — |

## Required User Actions

| ID | Action | Why owner-only | Blocks | Safe work meanwhile | Recommended choice |
| --- | --- | --- | --- | --- | --- |
| UA-001 | Approve the rights-grant model and partner-submitted field ownership decisions | These are product/legal rights decisions that cannot be inferred safely from implementation | Real-source publication and paid API release | Merge independent technical foundations; prepare implementation tests | Adopt the use-case × access-tier matrix proposed in PR #16, subject to counsel review |
| UA-002 | Provide or authorize canonical Cloudflare account, domain/zone, and production database connectivity through protected platform configuration | Account/zone ownership and secret-bearing credentials are unavailable to the repository | Preview/production deployment | Finish and merge code; use local and non-secret dry-run validation | Reuse one canonical Cloudflare account/project topology and one canonical Postgres/Supabase project with native isolation |
| UA-003 | Complete provider/account actions in the repository-governance runbook that remain inaccessible to the active tool surface | Rules/security settings and Vercel disconnection require account-level provider access | Safe protected release | Continue local and PR verification | Apply the documented zero-approval, required-check `main` ruleset; disconnect the obsolete Vercel integration |

## Deferred

| Item | Status | Reason | Revisit trigger |
| --- | --- | --- | --- |
| Automated mutation testing platform | DEFERRED | Current work uses targeted manual mutations; introducing a new platform is not required for the immediate release path | Mutation coverage becomes unreliable or regression volume justifies automation |
| Dedicated graph database or search cluster | DEFERRED | `AGENTS.md` scope control rejects these without measured need | Postgres/query evidence proves the current architecture insufficient |

## Superseded

| Item | Status | Superseded by | Evidence |
| --- | --- | --- | --- |
| Vercel as Data Foundry deployment target | SUPERSEDED | Cloudflare Workers | ADR-0005 and ADR-0006 |
