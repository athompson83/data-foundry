# Data Foundry

A repeatable, AI-native data foundry: it converts messy, lawfully acquired source
data into canonical, evidence-backed vertical knowledge products, served through
human pages, a REST API, MCP and bulk exports.

First vertical: **HVAC**.

> `AGENTS.md` holds the ten non-negotiable rules and the architecture boundaries.
> The 20-document foundation pack that this repository implements is **not published**
> here (it covers product strategy, monetization and niche selection). ADRs and
> `AGENTS.md` cite it by path as `docs/foundation/NN-*.md`; those files are held
> out-of-band. Everything needed to build, test and understand the code is in-repo.
> This README describes the code — what exists, where it lives, and how to run it.

## What is here today

This is **Wave 1: the contracts layer**. It defines the shared model that every
later package is written against, and nothing else. Acquisition, extraction,
normalization, resolution, query model, verticals and services are separate waves
and do not exist yet.

```text
packages/canonical-schema/   Core object model, confidence scores, job state machine, rights gate
packages/source-registry/    Source rights/health contracts + the publish gate
db/migrations/               Plain, portable Postgres DDL for every canonical table
schemas/canonical/           JSON Schema exports, generated from the Zod definitions
tooling/scripts/             Migration runner, JSON Schema generator
tooling/validators/          Vertical configuration validator (CI gate)
docs/decisions/              ADRs
```

## Quick start

Requires Node 22+ and pnpm 9 (via corepack).

```bash
corepack enable
pnpm install

pnpm typecheck        # tsc --strict across every package, test and script
pnpm test             # vitest: unit, contract and PGlite migration tests
pnpm migrate:check    # apply migrations to a throwaway database and verify
pnpm build            # regenerate JSON Schema exports, then typecheck
```

Working against a database:

```bash
pnpm migrate                                  # apply to .data/pglite (local, persisted)
POSTGRES_URL=postgres://... pnpm migrate      # apply to Supabase / real Postgres
```

## The two contract packages

### `@data-foundry/canonical-schema`

The single source of truth for the core model (doc 04). Zod schemas plus inferred
TypeScript types for every canonical object: `verticals`, `sources`,
`source_artifacts`, `source_records`, `entities`, `entity_aliases`, `facts`,
`fact_evidence`, `relationships`, `relationship_evidence`,
`resolution_candidates`, `resolution_judgments`, `entity_redirects`,
`dataset_snapshots`, `media_assets`, `ingestion_jobs`.

It also owns three things that everything else depends on:

- **Five branded confidence scores.** `ExtractionConfidence`,
  `IdentityConfidence`, `FactConfidence`, `RelationshipConfidence` and
  `EntityQualityScore` are nominally distinct types. They cannot be assigned to
  each other or averaged into one number. See ADR-0001.
- **The ingestion job state machine** (doc 02) as a discriminated union plus a
  legal-transition table. `FAILED` is a side state carrying retry metadata, not a
  terminal delete.
- **Rights classification** (`GREEN` / `AMBER` / `RED` / `UNREVIEWED`) and
  `canPublish()`, which returns `false` for `RED` and `UNREVIEWED` — AGENTS.md
  rule 1, as a function call.

This package **imports nothing from other workspace packages** and knows nothing
about UI, HTTP, Cloudflare, acquisition providers or any specific vertical. Its
only runtime dependency is `zod`. Keep it that way: everything depends on it, and
it depends on nothing downstream.

### `@data-foundry/source-registry`

Source rights, acquisition policy, image policy, provenance retention and health.
Depends only on `canonical-schema`.

`evaluateSourcePublishGate()` is the gate AGENTS.md rule 1 demands. It fails
closed and reports *every* blocker at once, so fixing a source is one pass rather
than whack-a-mole. `evaluateSourceActivationGate()` implements doc 13's weaker
"cannot become ACTIVE without…" checklist — a source can be legitimately active
for internal analysis while remaining unpublishable.

## Database conventions

Hand-written SQL, no ORM. Every migration must be **plain, portable Postgres**
that applies unchanged to both PGlite (local dev and CI) and hosted
Supabase/Postgres. CI proves this by applying the same files to both.

- Status/enum columns are `TEXT` + `CHECK`, not `CREATE TYPE ... AS ENUM`. The
  Zod schemas are the source of truth for allowed values; a CHECK is trivially
  widened by a later migration, an enum type is not.
- Everything is `IF NOT EXISTS`, and the runner keeps a `schema_migrations`
  ledger with checksums. Editing an applied migration is a hard error — add a new
  one.
- Migrations are named `NNNN_snake_case_name.sql` and applied in filename order,
  each in its own transaction.

Several platform rules are enforced in the schema rather than left to
application discipline:

| Constraint | Enforces |
|---|---|
| `sources_active_requires_rights` | A source cannot be `ACTIVE` without a rights decision (rule 1) |
| `facts_single_open_version_key` | At most one open `ACTIVE` version per `(entity, property)` |
| `fact_evidence` FKs `ON DELETE RESTRICT` | Evidence outlives convenience (rule 10) |
| `media_assets_cache_requires_rights` | No caching imagery into R2 without cleared rights (rule 9) |
| `source_records_source_key_uniq` | One record per `(source_id, source_record_key)` |
| `ingestion_jobs_failed_shape` | `FAILED` jobs carry retry metadata; others do not |

## Generated artifacts

`schemas/canonical/*.schema.json` is **generated** from the Zod definitions by
`pnpm schemas:generate`. Do not hand-edit; CI fails if the committed output is
stale. It exists for consumers that cannot import TypeScript: OpenAPI generation,
MCP tool definitions, the Phase 2 Python/Splink work, and external dataset users.

## CI

`.github/workflows/ci.yml` runs, on every push and pull request:

1. `pnpm typecheck` — strict TypeScript over packages, tests and tooling
2. `pnpm test` — unit, contract and PGlite migration suites
3. `pnpm migrate:check` — migrations apply in order, create every expected table,
   and re-run as a clean no-op
4. `pnpm schemas:check` — generated JSON Schema exports match the Zod source
5. `pnpm verticals:validate` — vertical configs are well-formed and every source
   declaration carries complete rights metadata
6. A second job applies the identical migrations to a real `postgres:16` service,
   which is what keeps "portable Postgres" honest rather than aspirational

## Licensing and data rights

The MIT licence in `LICENSE` covers **platform code only** — `packages/`,
`services/`, `tooling/`, `db/`, `schemas/` and the documentation describing
them, plus the synthetic HVAC fixtures we wrote ourselves.

It does **not** license data acquired from third-party publishers: source
artifacts, images, normalized records, exports and API responses are governed
by the upstream terms and by the rights classification recorded against each
source. Running this code against a publisher's site does not create a licence
to that publisher's content.

`DATA_RIGHTS.md` states the split in full, including the gate every dataset has
to pass before it can be published commercially. `SECURITY.md` covers private
vulnerability reporting — please do not file security problems as public
issues.

## Conventions

- ESM only (`"type": "module"`), `NodeNext` module resolution. Relative imports
  are written with a `.js` extension, as TypeScript's ESM mode requires.
- `tsconfig.base.json` is strict, with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` on.
- Workspace packages export TypeScript source directly (`"exports": "./src/index.ts"`).
  There is no build step for the contract packages; consumers bundle from source.
- Field names are `snake_case` throughout the model, matching the SQL columns, so
  a row and its parsed object are the same shape.
- Timestamps crossing a package boundary are ISO-8601 strings, never `Date`.

## Adding to the model

1. Add or change the Zod schema in `packages/canonical-schema/src/objects/`.
2. Register it in `src/registry.ts` — otherwise it silently stops being exported.
3. Add a new numbered migration in `db/migrations/`. Never edit an applied one.
4. `pnpm schemas:generate` and commit the output.
5. `pnpm typecheck && pnpm test && pnpm migrate:check`.

Verticals extend the model through configuration — entity types, fact properties,
relationship predicates and alias types are all vertical-defined `snake_case`
identifiers, not platform enums. Adding a field or a filter never requires
touching shared platform code (AGENTS.md rule 4).
