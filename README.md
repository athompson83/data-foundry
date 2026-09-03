<div align="center">

# Data Foundry

**An AI-native pipeline that converts lawfully acquired source data into canonical, evidence-backed vertical knowledge products.**

![Stage](https://img.shields.io/badge/stage-foundation%20%2F%20source%20validation-D97706?style=flat-square)
![First vertical](https://img.shields.io/badge/first%20vertical-HVAC-D97706?style=flat-square)
![Surfaces](https://img.shields.io/badge/surfaces-web%20%7C%20REST%20%7C%20MCP%20%7C%20exports-D97706?style=flat-square)
![Runtime](https://img.shields.io/badge/runtime-Node%2022%20%2B%20Cloudflare-D97706?style=flat-square&logo=cloudflare&logoColor=white)

</div>

> [!IMPORTANT]
> Data Foundry publishes only what its source rights, evidence, quality, and surface-specific authorization permit. A source approved for one surface is not automatically approved for public web, search indexing, REST, RapidAPI, MCP, or bulk export.

## What Data Foundry does

```text
Approve source → Acquire → Extract → Normalize → Resolve entities
→ Store canonical facts with evidence → Evaluate rights and quality
→ Publish authorized web, API, MCP, or export projections
```

The first vertical is HVAC. The architecture is designed to repeat across industries without weakening provenance, rights, identity, or quality controls.

## Product surfaces

| Surface | Purpose |
| --- | --- |
| Public web | Human-readable, evidence-backed entity and industry pages |
| REST API | Versioned machine access through the canonical query model |
| MCP | Agent-facing tools that return the same governed knowledge |
| Bulk exports | Reproducible snapshots with manifests and applied policy |
| Ingestion worker | Source approval, acquisition, extraction, normalization, resolution, and publication |

All read surfaces use the canonical query layer. Export is the bounded exception that may write snapshot metadata through an explicitly tested composition root.

## Current evidence boundary

The ingestion pipeline and all four customer-facing surface implementations exist in the repository. Controlled fixtures exercise the full path, including source declarations, rights evaluation, canonical storage, provenance, and parity checks.

> [!WARNING]
> Synthetic or fixture sources do not establish commercial source rights or production revenue readiness. A real source must complete [`docs/source-onboarding.md`](docs/source-onboarding.md), and deployment/readiness claims require current provider and database evidence—not code presence.

## Architecture

```text
packages/canonical-schema/   Object model, confidence, job state, rights gates
packages/rights-engine/      Fail-closed, surface-specific authorization
packages/source-registry/    Source declarations, health, and publish gates
packages/acquisition/        Governed source adapters and artifact capture
packages/extraction/         Source artifacts to source-native records
packages/normalization/      Typed canonical candidates
packages/canonical-store/    Entities, facts, relationships, aliases, and evidence
packages/provenance/         Field-level lineage and trust reporting
packages/query-model/        Shared read model for web, REST, MCP, and exports
apps/web/                    Public multi-vertical web surface
apps/api/                    REST API
apps/mcp/                    MCP contracts
apps/mcp-worker/             Deployable MCP adapter
services/export-builder/     Authorized snapshot and manifest generation
```

See [`AGENTS.md`](AGENTS.md) for non-negotiable boundaries and [`docs/decisions/`](docs/decisions/) for architecture decisions.

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

Local persisted database:

```bash
pnpm migrate
```

Real-database operations are restricted to the private `data_foundry` schema. Do not point migrations or ingestion at a shared `public` schema or another application’s database.

## Generated artifacts

Canonical JSON Schemas, runtime registries, OpenAPI projections, vertical metadata, and deployment artifacts are generated from controlled sources. Do not hand-edit generated outputs. Use the repository’s compile/check commands so drift is detected before review.

## Rights and trust principles

- Decide rights before fetching a byte.
- Store field-level evidence and source lineage, not unsupported assertions.
- Keep entity identity claims append-only and evidence-backed.
- Fail closed when rights, source health, deployment evidence, or database state is unknown.
- Keep customer surfaces consistent through one query model while evaluating each surface’s rights separately.
- Never present a repository test or dry-run artifact as proof of a live provider deployment.
- Preserve tenant, key, usage, and export auditability without leaking credentials or private source material.

## Delivery path

```text
Synthetic factory proof → First lawfully onboarded source → Private canary
→ Verified production topology → Revenue-ready surface → Additional verticals
```

Use the current checklist, progress, source-readiness, and provider-reconciliation records for exact status. This README explains the system; it does not certify a deployment.