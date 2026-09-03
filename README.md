<div align="center">

# Data Foundry

**An AI-native pipeline for turning lawfully acquired source data into canonical, evidence-backed vertical knowledge products.**

![Stage](https://img.shields.io/badge/stage-foundation%20%2F%20source%20validation-D97706?style=flat-square)
![First vertical](https://img.shields.io/badge/first%20vertical-HVAC-D97706?style=flat-square)
![Surfaces](https://img.shields.io/badge/surfaces-web%20%7C%20API%20%7C%20MCP%20%7C%20exports-D97706?style=flat-square)
![Runtime](https://img.shields.io/badge/runtime-Node%2022%20%2B%20Cloudflare-D97706?style=flat-square&logo=cloudflare&logoColor=white)

</div>

> [!IMPORTANT]
> Data Foundry publishes only what its source rights, evidence, quality, and surface-specific authorization permit. A grant for one surface never authorizes a neighboring surface.

Data Foundry converts approved source material through acquisition, extraction, normalization, entity resolution, canonical storage, provenance, rights evaluation, and authorized publication. The first vertical is **HVAC**. The 20-document strategy foundation pack referenced by repository decisions is held out-of-band; everything required to build, test, and understand the implementation is in this repository.

## Current evidence boundary

The ingestion half of the north-star workflow is implemented and tested end to end against controlled synthetic sources. Code implementations exist for human pages, REST, MCP, and bulk exports, but fixture success does not establish commercial source rights or a verified production deployment.

`apps/api` and `apps/mcp` import nothing beneath `packages/query-model`. `services/export-builder` deliberately reaches `packages/canonical-store` to record the applied selection policy and write snapshot metadata. `tests/contract/surface-parity.test.ts` holds REST and MCP to the same answer over one query model and one policy. **The export builder is not in that test**; its projection is checked through its own boundary tests.

## Independent rights surfaces

These are entitlements, not presentation labels. Each is evaluated independently against every provenance contribution.

| Rights surface | Authorized intent |
| --- | --- |
| `PUBLIC_WEB` | Public human-readable display |
| `SEARCH_INDEX` | Search-engine indexing of the exact rendered material |
| `API_FREE` | Free direct-customer API service |
| `API_PAID` | Paid direct API service, sale, and normalized redistribution |
| `RAPIDAPI` | Marketplace service, sale, redistribution, and sublicensing |
| `MCP` | Agent/LLM retrieval through MCP |
| `BULK_EXPORT` | Bulk offering and normalized redistribution |
| `PARTNER_DELIVERY` | Partner delivery and sublicensing |
| `MODEL_TRAINING` | Model-training use |
| `MODEL_EVALUATION` | Model-evaluation use |

## Repository inventory

The following is the README inventory contract checked against `pnpm-workspace.yaml`. Keep it as the first fenced `text` block.

```text
packages/canonical-schema/   Core object model, confidence scores, job state machine, rights gate
packages/rights-engine/      Fail-closed rights grants and surface-specific permission resolution
packages/source-registry/    Source rights/health contracts + the publish gate
packages/acquisition/        Provider adapters obtaining artifacts, behind the rights and politeness gate
packages/extraction/         Artifacts into source-native records
packages/normalization/      Source-native records into typed canonical candidates
packages/canonical-store/    Entities, facts, relationships and evidence over Postgres/PGlite
packages/provenance/         Field-level lineage, coverage reporting, the human-readable trust surface
packages/query-model/        The single canonical query layer web, REST and MCP read through
packages/api-keys/           Minting and verifying API credentials. Web Crypto only
packages/access-auth/        Shared DB bearer-key, tenant and one-vertical authorization
packages/usage-events/       The usage-event contract shared by the edge producer and its queue consumer
packages/private-canary/     Closed synthetic canary control, target-probe, and receipt contracts
services/ingest-worker/      DISCOVERED -> PUBLISHED job runner wiring the stages together
services/export-builder/     Bulk CSV and JSONL exports, rights-gated and reviewer-guarded
apps/api/                    Read-only REST surface over the query layer
apps/mcp/                    MCP tool contract over the same query layer
apps/mcp-worker/             Cloudflare Streamable HTTP adapter, MCP/NONE auth and analytics handoff
apps/edge/                   Cloudflare Worker: composition root, auth, transport, no routing
apps/acquisition-worker/     Cloudflare Cron Worker: rights-gated acquisition and immutable R2 evidence
apps/usage-consumer/         Cloudflare Queue consumer: idempotent usage-event persistence
apps/private-canary/         Route-less service-bound synthetic canary consumer of the dedicated private DLQ, never the shared usage DLQ
apps/web/                    Cloudflare Worker: the free public site — parent index + one child site per industry
verticals/hvac/              The first vertical: configuration, fixtures and golden records
db/migrations/               Plain, portable Postgres DDL for every canonical table
schemas/canonical/           JSON Schema exports, generated from the Zod definitions
tooling/scripts/             Migration runner, schema generator, vertical runtime compiler, readiness report
tooling/validators/          Vertical configuration validator (CI gate)
docs/decisions/              ADRs
```

## Quick start

Requires Node.js 22 or newer and pnpm 9 through Corepack.

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
pnpm migrate:check
pnpm mcp:compile:check
pnpm web:compile:check
pnpm build
```

For a local persisted database:

```bash
pnpm migrate
```

Real-database operations default to the private `data_foundry` schema and must never silently write to a shared `public` schema. Direct migration requires the dedicated migration credential, certificate-verified TLS, a clean worktree, and the exact 40-character `DATA_FOUNDRY_RELEASE_SHA`.

## Generated and governed artifacts

Canonical JSON Schemas, vertical runtime registries, OpenAPI projections, web/MCP artifacts, and deployment manifests are generated from controlled sources. Do not hand-edit generated output. Use the corresponding compile/check command so drift is detected before review.

A source cannot publish merely because an adapter can fetch it. Start with [`docs/source-onboarding.md`](docs/source-onboarding.md), record the precise rights decision and evidence, and evaluate each required rights surface separately. Every currently committed source remains synthetic.

## Provider and deployment evidence

The latest committed provider reconciliation at **2026-09-02T14:46Z** records the Cloudflare zone as active/full under the standard usage model and shows exactly the ordinary 14-day Queue/DLQ pair, but **zero Data Foundry Workers, Worker routes, Hyperdrives, or R2 buckets**. The configured Vercel data hostname returned 404. These are point-in-time provider observations, not deployment authorization.

The ordinary target topology contains five Workers: edge, public web, usage consumer, acquisition worker, and MCP worker. The temporary private-canary gate is different: it builds **six route-less private-canary Worker artifacts** consisting of **five reduced target Workers** plus one no-database harness. CI distinguishes the **five ordinary Worker templates and the six route-less private-canary templates**.

The private-canary queue topology is isolated from ordinary usage metering. All five dedicated queues use 14-day retention:

- `data-foundry-private-canary-usage-events`
- `data-foundry-private-canary-usage-events-dlq`
- `data-foundry-private-canary-events`
- `data-foundry-private-canary-dlq`
- `data-foundry-private-canary-quarantine`

They do not replace or repurpose the ordinary `data-foundry-usage-events` and `data-foundry-usage-events-dlq` pair.

Repository migrations `0027` and `0028` remain **pending hosted** authorization/application. The latest committed hosted record still reports 26 applied migrations and **57 search-path warnings**. Do not replay already-ledgered migrations or present repository migration files as evidence that the hosted database changed.

**Repository state alone designates no Worker release candidate.** Historical revisions are provenance only. Any candidate must contain the reviewed runtime changes, six-artifact gate, tests, and aligned documentation, then pass exact-head verification. **Any later commit, including documentation-only, creates a new release SHA and requires fresh exact-SHA checks** before designation or provider action.

## CI and operating controls

The repository verifies strict TypeScript, unit/contract/E2E behavior, PGlite and real-Postgres migration behavior, generated schemas and runtime artifacts, vertical configuration, acquisition policy, surface parity, Cloudflare topology, private-canary artifacts, source readiness, and documentation contracts.

Key commands include:

```bash
pnpm schemas:check
pnpm openapi:check
pnpm cloudflare:topology:check
pnpm cloudflare:artifacts:check
pnpm verticals:validate
pnpm acquisition:check
```

Repository checks prove code and configuration properties. They do not prove provider deployment, live database state, source rights, customer traffic, revenue, or restore readiness.

## Security, licensing, and data rights

The MIT license covers platform code and synthetic fixtures created for this repository. It does not grant rights to third-party source artifacts, images, normalized records, exports, or API responses. Those remain governed by upstream terms and recorded rights decisions. See [`DATA_RIGHTS.md`](DATA_RIGHTS.md) and [`SECURITY.md`](SECURITY.md).

Never commit provider credentials, database secrets, customer keys, private source material, or production manifests. Every customer-facing request must remain tenant-, vertical-, key-, and rights-aware, with evidence and usage records sufficient for audit without leaking protected content.

## Start here

1. [`AGENTS.md`](AGENTS.md)
2. [`PROJECT_CHECKLIST.md`](PROJECT_CHECKLIST.md)
3. [`PROGRESS.md`](PROGRESS.md)
4. [`docs/source-onboarding.md`](docs/source-onboarding.md)
5. [`docs/owner-actions/cloudflare-deployment.md`](docs/owner-actions/cloudflare-deployment.md)
6. [`docs/owner-actions/revenue-readiness.md`](docs/owner-actions/revenue-readiness.md)
7. [`docs/decisions/`](docs/decisions/)