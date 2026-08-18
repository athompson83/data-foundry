# Data Foundry

A repeatable, AI-native data foundry that converts messy, lawfully acquired source data into canonical, evidence-backed vertical knowledge products for human pages, REST APIs, MCP tools and bulk exports.

First vertical: **HVAC**.

> `AGENTS.md` contains the non-negotiable engineering rules and architecture boundaries. Product strategy, monetization, niche scoring and the private audit ledger are maintained out-of-band. Public ADRs in `docs/decisions/` record architectural decisions that materially affect the codebase.

## Current status

**Phase 1 factory proof is complete. Phase 2 real-source validation is next.**

The repository now contains the end-to-end platform path required to prove the factory architecture with synthetic HVAC fixtures:

```text
source registry / rights review
        ↓
acquisition adapters
        ↓
raw evidence artifact storage
        ↓
extraction with source locators
        ↓
normalization
        ↓
entity resolution
        ↓
canonical entities / facts / relationships
        ↓
field-level provenance and trust explanations
        ↓
canonical query model
        ↓
shared REST / MCP / export serialization contracts
```

The first vertical is intentionally still `DRAFT`: its four current publishers are synthetic fixtures on reserved example domains. The platform machinery is real; commercial viability is not considered proven until real sources have passed rights review and the same pipeline succeeds against genuinely messy external data.

## Repository map

```text
packages/
├── canonical-schema/   Core object model, confidence brands, job state machine, rights types
├── source-registry/    Source rights/health contracts and fail-closed publication gate
├── acquisition/        Swappable acquisition providers and raw artifact storage
├── extraction/         JSON / CSV / HTML / PDF extraction with field-level locators
├── normalization/      Deterministic identifiers, units, vocabularies and mappings
├── canonical-store/    Entities, aliases, versioned facts, relationships and evidence
├── provenance/         Lineage, coverage, verification policy and trust explanations
└── query-model/        Single read model for future web / REST / MCP / export consumers

services/
└── ingest-worker/      End-to-end ingestion and resolution pipeline

verticals/
├── _template/          Configuration template for future verticals
└── hvac/               Phase 1 HVAC proof: schemas, sources, normalizers and fixtures

db/migrations/          Portable Postgres migrations
schemas/canonical/      Generated JSON Schema exports
tooling/                Migration, schema-generation and vertical-validation tooling
tests/                  Cross-package contract, integration and end-to-end tests
docs/decisions/         Public architecture decision records
```

## What is proven today

The current implementation demonstrates:

- source declarations with explicit rights, attribution, image and acquisition policy;
- a fail-closed publication gate before canonical publication;
- provider-neutral acquisition interfaces, including HTTP, Cloudflare Browser Run, Crawl4AI and fixture adapters;
- content hashing and immutable raw-evidence metadata;
- structured extraction from JSON, CSV, HTML and PDF sources;
- deterministic normalization of identifiers, units and vocabularies;
- exact-identifier entity resolution ahead of fuzzy/semantic behavior;
- auditable resolution candidates and judgments, including retained conflicts;
- append-only fact versioning with evidence required in the same write transaction;
- authority-aware fact selection that retains losing claims and explains why a value won;
- a conservative `Source verified` policy based on evidence, authority, conflicts, rights and dated support rather than LLM confidence;
- gated editorial correction that changes displayed values without masquerading as source verification;
- field-level provenance and coverage reporting;
- a canonical query layer for entities, facts, search, filters, relationships and comparisons;
- one shared serializer contract for future REST, MCP and bulk-export surfaces;
- an idempotent Phase 1 factory proof using the HVAC fixture set.

## What is intentionally not here yet

The project is not a customer-facing SaaS application yet. In particular, the repository does not currently ship:

- a production web frontend;
- a REST routing/auth service;
- a deployed MCP server;
- billing or API-key management;
- production dataset exports;
- real commercial HVAC sources;
- a generally available multi-vertical catalog.

Those surfaces should be built only after the remaining high-priority integrity findings are closed and one or more real sources have passed rights review and end-to-end ingestion.

## Quick start

Requires Node 22+ and pnpm 9 through Corepack.

```bash
corepack enable
pnpm install

pnpm typecheck
pnpm test
pnpm migrate:check
pnpm schemas:check
pnpm verticals:validate
pnpm build
```

Working against a database:

```bash
pnpm migrate                                  # local persisted PGlite
POSTGRES_URL=postgres://... pnpm migrate      # hosted / real Postgres
```

## Core contracts

### `@data-foundry/canonical-schema`

The dependency root for the shared model. It defines Zod schemas and inferred TypeScript types for verticals, sources, artifacts, records, entities, aliases, facts, evidence, relationships, resolution state, redirects, snapshots, media and ingestion jobs.

It also owns five distinct confidence brands — `ExtractionConfidence`, `IdentityConfidence`, `FactConfidence`, `RelationshipConfidence` and `EntityQualityScore` — so unrelated confidence concepts cannot be accidentally averaged or substituted for one another.

This package should remain independent of downstream workspace packages.

### `@data-foundry/source-registry`

Owns source rights, acquisition policy, image policy, provenance-retention policy, health and publication eligibility.

`evaluateSourcePublishGate()` fails closed and returns all blockers at once. A source may be useful for internal analysis while still being barred from public/commercial publication.

### `@data-foundry/canonical-store`

Owns canonical persistence and fact-selection behavior. Facts and relationships require evidence, fact versions are retained rather than rewritten in place, and conflicts remain auditable.

### `@data-foundry/query-model`

The single customer-facing read model. Future web, REST, MCP and export services should depend on this layer rather than independently reconstructing canonical truth.

The shared wire serializer already carries editorial-correction state and machine-readable selection warnings so those trust signals cannot silently disappear at one interface boundary.

## Database conventions

Migrations are hand-written portable Postgres rather than ORM-generated DDL. The same files are exercised against PGlite and a real PostgreSQL 16 service in CI.

Key conventions:

- status-like columns use `TEXT` + `CHECK` rather than PostgreSQL enum types;
- migrations are immutable once applied and tracked in `schema_migrations` with checksums;
- migrations use `NNNN_snake_case_name.sql` and run in filename order;
- evidence foreign keys use restrictive deletion where history must outlive convenience;
- critical invariants are enforced as close to the storage boundary as practical.

## Generated artifacts

`schemas/canonical/*.schema.json` is generated from the Zod source by:

```bash
pnpm schemas:generate
```

Do not hand-edit generated schemas. CI runs `pnpm schemas:check` so external consumers cannot silently drift away from the implemented model.

## CI

`.github/workflows/ci.yml` currently runs two GitHub Actions jobs on pushes and pull requests:

### Verify

1. strict TypeScript typecheck;
2. unit, contract, integration and end-to-end tests;
3. PGlite migration apply/re-apply checks;
4. canonical JSON Schema freshness;
5. vertical configuration and rights validation.

### Real PostgreSQL

The identical migration files are applied and re-applied against PostgreSQL 16 to catch SQL that only works in PGlite.

A separate hosting/deployment integration is not considered part of repository CI until a deployable application exists.

## Vertical model

Verticals extend the platform through configuration rather than application forks. A vertical defines:

- entity types and schemas;
- fact properties;
- relationship predicates;
- alias/identifier semantics;
- normalization rules;
- source registry entries;
- filter metadata;
- SEO/indexability rules;
- MCP intents;
- quality rules;
- fixtures/golden records;
- rights notes and public methodology.

The target architecture is that a new vertical becomes primarily **configuration + source adapters + fixtures**, not another application codebase.

## Public repository boundaries

The MIT `LICENSE` applies to the software repository. It does **not** automatically grant rights to third-party source data, images, artifacts, normalized datasets or future commercial exports. See `DATA_RIGHTS.md`.

Private product strategy, competitive scoring and unresolved security/audit inventories are intentionally maintained outside the public repository.

Security issues should be reported privately according to `SECURITY.md`, not opened publicly with exploit details.

## Near-term milestones

Before building the customer-facing application, the current priority is:

1. close remaining high-priority audit/integrity findings;
2. make deterministic resolution and artifact lifecycle behavior robust across rebuilds;
3. onboard 1–3 real sources with documented commercial/derivative/redistribution rights;
4. measure acquisition cost, change frequency, extraction drift and provenance quality on real data;
5. then build the generated human frontend, REST API, remote MCP server and bulk-data publishing surfaces.

The next important proof is not another abstract package: it is taking legitimately usable, genuinely messy real-world source data through this entire pipeline without weakening the rights, provenance or trust guarantees.
