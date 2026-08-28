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

The **ingestion half** of the north-star workflow in `AGENTS.md` is implemented
and tested end to end for one vertical: source approval, acquisition,
extraction, normalization, deterministic entity resolution, canonical storage
with provenance, and publication into the query layer.
`tests/e2e/factory-proof.test.ts` runs four sources through the worker and
checks the canonical result against golden records.

The last step — "web / API / MCP / exports generated" — has code implementations
for all four surfaces: `apps/web`, `apps/api`, `apps/mcp`, and
`services/export-builder`. They read through `packages/query-model`; customer
surfaces bind each request to an exact ADR-0010 rights surface, so public web,
search indexing, direct API, MCP and bulk permissions never imply one another.

Rule 5 is enforced by a boundary test in each, and it is worth being exact
about what each one proves. `apps/api` and `apps/mcp` import nothing beneath
the query layer at all. `services/export-builder` does: it calls
`resolveFactSelectionPolicy` from `packages/canonical-store` to record the
policy it applied in the manifest, and takes an injected `CanonicalStore` to
write the snapshot row — an export is the one surface here that writes. Its
boundary test pins exactly which of its files may do that, so widening it is a
decision rather than a drift.

`tests/contract/surface-parity.test.ts` holds REST and MCP to the same answer
over one query model and one policy. The export builder is not in that test;
its projection is checked against the shared mapper in its own
`test/boundary.test.ts`, which is what discharges ADR-0004.

Two limitations the package list does not show:

**The human-page surface has a first implementation.**
`apps/web` is the free, public, multi-vertical site: a parent index of every
industry plus a child site per industry, entity pages with surface-safe cited
evidence, and a plain `<form>` search UI with no client-side JavaScript required. See
[ADR-0011](docs/decisions/ADR-0011-web-frontend-and-multi-industry-sites.md)
for the parent/child architecture and the free-web/paid-API revenue split it
implements. A vertical is exposed only while it is `ACTIVE` and has an exact
`PUBLIC_WEB`-authorized entity. A page may render public-only claims, but it is
`noindex` and absent from sitemaps unless `SEARCH_INDEX` independently covers
the exact rendered facts, attributions and relationships. The quality-gate evaluator
(`apps/web/src/gates.ts`) decides indexability from authorized evidence rather
than raw database aggregates or fiat. Nothing here is deployed yet — see
Deployment below.

**Every source is synthetic.** The rights machinery genuinely runs, but it
currently validates controlled fixture declarations rather than a real
publisher's terms. `verticals/hvac/README.md` records the Phase 2 exit condition
that changes, and `docs/source-onboarding.md` is the procedure.

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
packages/usage-events/       The usage-event contract shared by the edge producer and its queue consumer
services/ingest-worker/      DISCOVERED -> PUBLISHED job runner wiring the stages together
services/export-builder/     Bulk CSV and JSONL exports, rights-gated and reviewer-guarded
apps/api/                    Read-only REST surface over the query layer
apps/mcp/                    MCP tool contract over the same query layer
apps/edge/                   Cloudflare Worker: composition root, auth, transport, no routing
apps/usage-consumer/         Cloudflare Queue consumer: idempotent usage-event persistence
apps/web/                    Cloudflare Worker: the free public site — parent index + one child site per industry
verticals/hvac/              The first vertical: configuration, fixtures and golden records
db/migrations/               Plain, portable Postgres DDL for every canonical table
schemas/canonical/           JSON Schema exports, generated from the Zod definitions
tooling/scripts/             Migration runner, schema generator, vertical runtime compiler, readiness report
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
pnpm web:compile:check # verify web runtime JSON and generated TS registry parity
pnpm build            # regenerate JSON Schema exports, then typecheck
```

Working against a database:

```bash
pnpm migrate                                  # apply to .data/pglite (local, persisted)
POSTGRES_URL=postgres://... pnpm migrate      # apply to Supabase / real Postgres
```

## The two foundational contract packages

Every other package depends on these two and they depend on nothing downstream,
so they are documented here in more detail than the rest.

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

### What this project owns in a database

`POSTGRES_URL` points the migrator at whatever database you name, and that
database may already belong to something else. `partitionOwnedTables` in
`tooling/scripts/migrate.ts` decides the ownership boundary. Its manifest is
`EXPECTED_TABLES` — every table a migration creates — plus `schema_migrations`,
the ledger the runner itself creates and writes a row to on every apply. Both
halves are ours; only the first half can be reported *missing*, because only the
first half is created by a migration.

`schema_migrations` is the one name here that other tools also use, so the
ledger **proves** it is ours rather than being trusted on its name. The runner
records `data-foundry:schema_migrations:v1` as a comment on the table when it
creates it, and reads that back before any write: an unmarked ledger, one marked
by another project, or one whose columns do not match aborts the run
(`assertLedgerIsOurs`) instead of being adopted, counted, and written to.
Matching columns are not accepted as proof — shape shows two ledgers are
*compatible*, never that they are the same one — and the marker is never written
onto a table the runner merely found, since stamping a table to establish
permission to write to it is circular. A ledger created before marking existed
is adopted deliberately, by a human running the statement the refusal names.

Anything else found in `public` is **out of scope** — reported by name so you
can see it was noticed, and never counted as evidence about this schema:

```text
OK: 19 Data Foundry tables, migrations are ordered and idempotent.
```

Applying to a shared database names any unowned tables it finds *before* it
writes, so an operator sees we are adding beside another project's tables rather
than to them. What that notice claims is exactly what is true — **no migration
references them** — and a test asserts no migration ever names an object outside
the manifest. It deliberately does not promise more: the earlier wording said
"nothing below modifies them" while listing `schema_migrations`, which the
runner then wrote to on the very next line. A count that included other people's
tables would likewise have reported their schema as a fact about ours.

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
6. `pnpm verticals:compile:check` — the edge runtime artifact matches the
   vertical config it was compiled from
7. `pnpm web:compile:check` — the web surface's own compiled artifact (it
   additionally bundles `seo.yaml`, which the edge runtime artifact does not)
8. A second job applies the identical migrations to a real `postgres:16` service,
   which is what keeps "portable Postgres" honest rather than aspirational

## Adding a real source

`docs/source-onboarding.md` is the procedure: what to decide before fetching a
byte, what the declaration has to record, and what counts as proof afterwards.
`pnpm sources:readiness` reports where a vertical actually stands against it.

## Deployment

Three Cloudflare Workers, per
[ADR-0006](docs/decisions/ADR-0006-cloudflare-is-the-deployment-target.md) and
[ADR-0011](docs/decisions/ADR-0011-web-frontend-and-multi-industry-sites.md):

- **`apps/edge`** — the metered, paid REST surface. One vertical per
  deployment (`VERTICAL_SLUG`), because a `QueryModel` carries exactly one
  vertical's field metadata and the metered API is deliberately siloed per
  industry.
- **`apps/web`** — the free, public, crawlable site. ONE deployment serves
  every vertical: a parent index of every industry plus a child site per
  industry, because that is the surface search engines and agents are meant to
  discover through, and siloing it per industry would fragment exactly the
  discoverability it exists for.
- **`apps/usage-consumer`** — the queue consumer that persists metering events
  idempotently after the edge Worker has accepted and handed them off.

The edge and web Workers are both composition roots — the only packages in their surface permitted to
reach below the query layer — plus a `fetch` adapter that translates and
decides nothing.

```bash
pnpm verticals:compile        # emit apps/edge/generated/<slug>.runtime.json
pnpm verticals:compile:check  # CI gate: fails when the artifact drifts
pnpm web:compile              # emit apps/web/generated/<slug>.web-runtime.json + index.json
pnpm web:compile:check        # CI gate: fails when the artifact drifts
```

Neither Worker has a filesystem, so a vertical's filter metadata and
fact-selection policy — and, for `apps/web`, `seo.yaml` and the per-entity-type
`critical` property list its quality gates run against — are compiled to a
committed JSON artifact and bundled. Both Workers import their artifact, never
parse YAML, and refuse to serve a vertical their bundle does not carry rather
than serving its data through another vertical's field metadata.

A Worker with no database bound **refuses to serve** rather than falling back to
an empty in-memory database, which is what `createDriverFromEnv` would otherwise
do. A test reads the source to prove the fallback is never imported, and a
second suite builds the actual artifact with `esbuild` and proves PGlite
contributes zero bytes to it — a source scan cannot see past the dynamic
`import()` `createPgliteDriver` uses, so the build itself is what has to answer.

Every request is authenticated and scope-checked (`apps/edge/src/auth.ts`)
before it reaches a route, and a successful request is metered asynchronously:
a usage event naming the matched route **template** — never the concrete
target — is published to a Cloudflare Queue and persisted idempotently by
`apps/usage-consumer`, without the request's success ever depending on that
persistence succeeding. `db/migrations/0011_api_tenancy.sql` has the schema;
this increment is measurement only — no pricing, plans, invoices or
subscriptions.

Deploying needs an account, Hyperdrive bindings, routes for each Worker and the
usage-metering queues, none of which live in this repository —
[docs/owner-actions/cloudflare-deployment.md](docs/owner-actions/cloudflare-deployment.md)
records what and why, including what pay per crawl actually is and is not, and
[docs/owner-actions/revenue-readiness.md](docs/owner-actions/revenue-readiness.md)
lays out the free-web/paid-API revenue split end to end.

`vercel.json` still disables Vercel Git deployments. It remains deploy
suppression, not adoption: ADR-0005's fix — disconnecting the integration in the
Vercel dashboard — has not been done, so deleting the file would let failing
deployments resume.

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
