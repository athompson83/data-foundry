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
for all four surfaces: `apps/web`, `apps/api`, `apps/mcp` plus its deployable
`apps/mcp-worker` adapter, and `services/export-builder`. They read through
`packages/query-model`; customer
surfaces bind each request to an exact ADR-0010 rights surface, so public web,
search indexing, direct API, RapidAPI, MCP and bulk permissions never imply one
another.

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
than raw database aggregates or fiat. The integrated implementation is on
protected `main`, but no production deployment is recorded or verified. The
2026-08-31 no-resource observation is historical: the authoritative
2026-09-02T14:46Z refresh shows the zone active/full, the standard usage model,
and exactly the ordinary 14-day Queue/DLQ pair, but zero Data Foundry Workers,
routes, Hyperdrives, or R2 buckets. It supersedes an earlier same-day raw-bucket
observation. The configured Vercel data hostname
returns 404. Exact deployment IDs and runtime probes remain
owner/platform evidence — see the [redacted reconciliation record](docs/evidence/alpha-lab-provider-reconciliation-20260831.md)
and Deployment below.

**Every source is synthetic.** The rights machinery genuinely runs, but it
currently validates controlled fixture declarations rather than a real
publisher's terms. `verticals/hvac/README.md` records the Phase 2 exit condition
that changes, and `docs/source-onboarding.md` is the procedure.

Current identity is evidence-backed too. Migration 0023 keeps each staged alias
identity as immutable history, records append-only curated or current-source-
record claims in `entity_alias_claims`, and exposes only the claim-backed
`current_entity_aliases` view to resolution and search. It deliberately creates
no claim for a legacy alias: `entity_aliases.source_id` was display/provenance
metadata and cannot be promoted into authority after the fact. Retiring or
reopening an alias advances its authority epoch, so a claim from an older epoch
cannot silently become current again. Migration 0025 additionally requires an
exact immutable `ALIAS` evidence row linked to each source-record claim before
that alias enters the current view; claim-only and unlinked legacy rows remain
hidden, and their sources cannot bypass a surface's rights evaluation.

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

Requires Node 22+ and pnpm 9 (via corepack).

```bash
corepack enable
pnpm install

pnpm typecheck        # tsc --strict across every package, test and script
pnpm test             # vitest: unit, contract and PGlite migration tests
pnpm migrate:check    # apply migrations to a throwaway database and verify
pnpm mcp:compile:check # verify executable MCP/runtime metadata parity
pnpm web:compile:check # verify web runtime JSON and generated TS registry parity
pnpm build            # regenerate JSON Schema exports, then typecheck
```

Working against a database:

```bash
pnpm migrate                                  # apply to .data/pglite (local, persisted)
# Supply DATA_FOUNDRY_MIGRATION_DATABASE_URL securely, then run pnpm migrate
```

Real-database operations default to `data_foundry`; they never silently write
to a shared `public` schema. Direct real-Postgres migration and live ingestion
are restricted to the private `data_foundry` schema. `DATA_FOUNDRY_SCHEMA=public`
fails before source attestation, migration, or application-driver setup; a
historical public installation requires a separately reviewed migration plan,
not a live runtime switch.
Before a direct migration, set the non-secret `DATA_FOUNDRY_RELEASE_SHA` to the
exact 40-character checked-out release SHA. The runner refuses a generic
`POSTGRES_URL` as a migration source, requires the dedicated migration
credential through the approved secret interface, uses certificate-verified
TLS, rejects connection-string query overrides, requires a clean worktree, and
loads the migration corpus from the attested Git object rather than mutable
files on disk.

## The two foundational contract packages

Every other package depends on these two and they depend on nothing downstream,
so they are documented here in more detail than the rest.

### `@data-foundry/canonical-schema`

The single source of truth for the core model (doc 04). Zod schemas plus inferred
TypeScript types for every canonical object: `verticals`, `sources`,
`source_artifacts`, `source_records`, `entities`, `entity_aliases`, `facts`,
`entity_alias_claims`, `fact_evidence`, `relationships`, `relationship_evidence`,
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
| `source_records_current_source_key_uniq` | One current immutable revision per logical `(source_id, source_record_key)`; superseded revisions retain their evidence lineage |
| `entity_alias_claims` append-only triggers | Alias authority cannot be rewritten or inferred from legacy display metadata; a claim must cite the alias's current authority epoch |
| `current_entity_aliases` view | Resolution and search see only open curated claims or claims from a current `FINALIZED` source-record revision |
| `ingestion_jobs_failed_shape` | `FAILED` jobs carry retry metadata; others do not |

### Source-record and identity currentness

Migrations 0021–0024 make refresh behavior explicit without deleting history.
One logical source record has one current immutable revision; the old revision,
its evidence and its alias claims remain auditable after supersession. The
`source-record-evidence@3` fingerprint covers the exact resolved entity and
manufacturer targets, accepted alias values and locators, fact projections,
resolution audit, and relationship disposition/endpoints/writer. An exact
replay is a no-op, while any target, evidence or mapping-semantic change creates
a successor revision.

A refresh with no usable strong identifier still finalizes a successor revision
so the prior record does not remain falsely current, but it writes no canonical
claims and creates no phantom manufacturer. Its old source-only alias claims
therefore cease to be current. Stored entities and historical aliases remain
for audit; a customer surface with no current `FINALIZED` entity-evidence
support withholds that entity. Relationships likewise require current
`FINALIZED` relationship evidence and surface-authorized endpoints, so a stale
edge cannot survive solely because its historical row remains stored.

Every mapping stream must also declare `refresh_mode: full_snapshot` or
`incremental`. Only a successfully stored complete artifact set may retire an
omitted record, and migration 0024 records the exact same-source artifact
evidence for that retirement. Incremental absence has no deletion meaning.
Legacy rows whose stream cannot be proven become non-current until a
rights-admitted reingest; the migration never guesses membership.

### What this project owns in a database

The dedicated migration credential points the migrator at whatever database an
operator names, and that database may already belong to something else.
`partitionOwnedTables` in
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
OK: Data Foundry-owned tables are present; migrations are ordered and idempotent.
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

- `pnpm typecheck` — strict TypeScript over packages, tests and tooling
- `pnpm test` — unit, contract and PGlite migration suites
- `pnpm migrate:check` — migrations apply in order, create every expected table,
   and re-run as a clean no-op
- `pnpm schemas:check` — generated JSON Schema exports and the readiness snapshot
  schema match their sources
- `pnpm openapi:check` — the legacy/direct contracts and the public
  `openapi/data-foundry-hvac-rapidapi-v1.openapi.json` marketplace projection
  match the same canonical REST route and schema source; the RapidAPI document
  deliberately contains no private origin-bearer security scheme
- `pnpm cloudflare:topology:check` — CI runs this repository-only check over the
  five ordinary Worker templates and the six route-less private-canary templates,
  preserving the Queue, Cron, R2, Hyperdrive, route, identity-isolation, and
  secret-free topology contracts
- `pnpm cloudflare:deployment:check` — an operator pre-deploy command that
  validates the five ignored exact-deployment manifests before a dry run or
  deploy, including one well-formed canonical `account_id` shared by all five;
  CI intentionally has no such production manifests and does not run it
- `pnpm cloudflare:private-canary:full-deployment:check` — an operator-only,
   fail-closed check for the six ignored route-less private-canary manifests;
   it requires one account, five distinct role-specific Hyperdrives for the
   reduced target Workers, and the `apps/private-canary` harness without
   Hyperdrive; it also requires a dedicated private-canary
   synthetic-metering Queue/DLQ pair and control ingress/DLQ/quarantine chain
   separate from ordinary usage, no route or `workers.dev` exposure, and no
   extra service-binding environment or local connection configuration. The
   three deployment-mode canary checks also load the five ignored ordinary
   deployment manifests as name-collision controls; those ordinary manifests
   are not canary deployment inputs.
- `pnpm verticals:validate` — vertical configs are well-formed and every source
   declaration carries complete rights metadata
- `pnpm verticals:compile:check` — the edge runtime artifact matches the
   vertical config it was compiled from
- `pnpm acquisition:check` — the Cron/R2 acquisition runtime matches the
  enabled source declarations and committed generated artifact
- `pnpm mcp:compile:check` — the MCP Worker runtime advertises exactly the six
   executable generic tools and current compiled vertical metadata
- `pnpm web:compile:check` — the web surface's own compiled artifact (it
   additionally bundles `seo.yaml`, which the edge runtime artifact does not)
- `pnpm cloudflare:artifacts:check` — dry-runs and individually scans all six
   route-less private-canary Worker artifacts: five reduced target Workers
   (with synthetic Hyperdrive only for the credential-free dry run) plus the
   private-canary harness (without Hyperdrive). It fails closed if any entrypoint
   or manifest cannot bundle, and is repository provenance rather than provider
   deployment evidence.
- A second job applies the identical migrations to a real `postgres:16` service,
  then runs source-record/snapshot reconciliation, credential-provisioning
  concurrency, and scheduled-acquisition transaction/fencing controls, which
  keep portable SQL, advisory-lock provenance, and idempotent operational writes
  honest rather than aspirational

## Adding a real source

`docs/source-onboarding.md` is the procedure: what to decide before fetching a
byte, what the declaration has to record, and what counts as proof afterwards.
`pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z hvac` reports the
seven-surface posture at an explicit instant. Without live DB or validated
snapshot evidence, every surface is `UNKNOWN`; see the revenue-readiness runbook.

## Deployment

The ordinary production topology has five Cloudflare Workers, per
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
- **`apps/acquisition-worker`** — hourly Cron runner for configuration-compiled
  source targets. It claims durable run state in Postgres, rechecks exact stored
  `ACQUIRE`/`STORE`/`CACHE` permission before provider construction, before
  transport, and again after transport immediately before persistence or
  `NOT_MODIFIED` freshness. Each logical slot has one row and a server-timed
  20-minute execution lease; recovery rotates an opaque fencing token so an
  expired owner cannot persist or terminalize after a retry takes ownership.
  Direct publisher responses and provider control-plane JSON are streamed under
  finite byte ceilings before immutable raw evidence enters the canonical R2
  bucket.
- **`apps/mcp-worker`** — authenticated MCP 2026-07-28 Streamable HTTP. One
  vertical per deployment, backed by the six generic tools in `apps/mcp` and
  an exact `MCP/NONE` key that is distinct from direct and RapidAPI keys.

The edge, web and MCP Workers are read-surface composition roots; the acquisition
Worker is the scheduled write-side composition root; the usage consumer owns
only accepted-event persistence. Pure `apps/api` and `apps/mcp` contracts still
cannot reach beneath the canonical query layer.

The temporary private-canary topology is deliberately different from the
ordinary production topology. Its repository artifact gate builds six route-less
private-canary Worker artifacts: five reduced target Workers —
`data-foundry-private-canary-edge`, `data-foundry-private-canary-web`,
`data-foundry-private-canary-usage-consumer`,
`data-foundry-private-canary-acquisition-worker`, and
`data-foundry-private-canary-mcp-hvac` — plus the
`data-foundry-private-canary` harness. The five targets receive one
role-specific Hyperdrive each only in their deployment manifests; the harness
has no Hyperdrive and service-binds only to those dedicated target names. The
reduced profiles must never reuse ordinary Worker names, because a deploy could
otherwise replace ordinary Cron, R2, Queue, or future configuration.

The temporary path uses five dedicated queues, all with 14-day retention:
synthetic metering flows from `data-foundry-private-canary-usage-events` to
`data-foundry-private-canary-usage-events-dlq`, while control flows from
`data-foundry-private-canary-events` to
`data-foundry-private-canary-dlq` and then
`data-foundry-private-canary-quarantine`. Those queues are distinct from the
unchanged ordinary `data-foundry-usage-events` and
`data-foundry-usage-events-dlq` pair; only the ordinary usage consumer consumes
the ordinary usage queue.

The latest dated provider inventory distinguishes resources from live wiring:
there is no Data Foundry Worker, Worker route, Hyperdrive configuration, or R2
bucket. Only the ordinary 14-day Queue/DLQ pair exists; it proves neither a
Worker binding nor a deployed runtime. Both the raw-artifact and private-canary
receipt buckets still require provisioning.

**Repository state alone designates no Worker release candidate.** The historical
`df4a665`, `64bb05b`, and `effa3ec` revisions are provenance only. Before any
provider action, the exact merged/reviewed SHA must contain the runtime changes,
six-artifact gate, tests, and aligned documentation, then pass exact-head
validation. Repository migrations `0027`–`0028` extend the historical hosted
`0001`–`0026` chain and remain pending hosted authorization/application; the dated hosted record still
truthfully reports 26 applied migrations and 57 search-path warnings. That
repository attestation does not authorize a deployment, hosted migration, or
provider mutation. Any later commit, including documentation-only, creates a
new release SHA and requires fresh exact-SHA checks before designation or
provider action.

```bash
pnpm verticals:compile        # emit apps/edge/generated/<slug>.runtime.json
pnpm verticals:compile:check  # CI gate: fails when the artifact drifts
pnpm mcp:compile              # emit apps/mcp-worker/generated/<slug>.runtime.json
pnpm mcp:compile:check        # CI gate: executable tool/runtime metadata parity
pnpm acquisition:compile      # emit apps/acquisition-worker/generated runtime
pnpm acquisition:check        # CI gate: scheduled source/runtime parity
pnpm web:compile              # emit apps/web/generated/<slug>.web-runtime.json + index.json
pnpm web:compile:check        # CI gate: fails when the artifact drifts
```

No Worker has a filesystem, so a vertical's filter metadata and
fact-selection policy — and, for `apps/web`, `seo.yaml` and the per-entity-type
`critical` property list its quality gates run against — are compiled to a
committed JSON artifact and bundled. The API, MCP and web Workers import their artifact, never
parse YAML, and refuse to serve a vertical their bundle does not carry rather
than serving its data through another vertical's field metadata.

A Worker with no database bound **refuses to serve** rather than falling back to
an empty in-memory database, which is what `createDriverFromEnv` would otherwise
do. A test reads the source to prove the fallback is never imported, and a
second suite builds the actual artifact with `esbuild` and proves PGlite
contributes zero bytes to it — a source scan cannot see past the dynamic
`import()` `createPgliteDriver` uses, so the build itself is what has to answer.

Every REST or MCP request is authenticated and scope-checked through
`packages/access-auth` before it reaches a route/tool, and accepted consumption
is durably handed off before success: a usage event naming the matched route
**template** — never the concrete target — must be accepted by Cloudflare Queue
or the caller receives an opaque retryable 503. `apps/usage-consumer` persists
the accepted event idempotently later; only that Postgres write stays off the
response path. `db/migrations/0011_api_tenancy.sql` has the schema;
this increment is measurement only — no pricing, plans, invoices or
subscriptions. MCP events are explicitly `MCP/NONE`: useful for analytics, but
never eligible for internal invoicing. RapidAPI events are likewise excluded
from direct invoices because the marketplace is their billing authority.

`pnpm credentials:provision` is the fail-closed operator path for creating a
one-vertical credential. It admits exactly `API_PAID/DIRECT`,
`RAPIDAPI/RAPIDAPI`, or `MCP/NONE`; it does not infer a pair and does not mint a
free/direct key. Direct and MCP plaintext keys may be delivered only to a new,
absolute, owner-only (`0600`) file outside the worktree from a POSIX runtime.
RapidAPI delivery is piped directly to Wrangler as `RAPIDAPI_API_KEY` using the
validated edge production manifest only after the independently supplied
Cloudflare account identity and an existing deployed Worker are proved. The
database stores only a hash and
non-secret metadata; the command refuses to overwrite an output and can
classify a named legacy null/null row only through explicit
`--classify-existing`. Creating a
tenant or credential changes access control only: it creates no rights cell,
grant, source approval, billing plan, invoice or legal permission.

The later ordinary production deployment needs one canonical Cloudflare account
named by the same exact `account_id` in all five ignored production manifests,
Hyperdrive bindings, Queue delivery for the usage consumer, Cron for the
acquisition Worker, and the usage-metering queues, none of which live in this
repository. It is separate from the temporary six-artifact private-canary path.
That current workstream adds no public hostname, Worker route, custom domain, or
`workers.dev` endpoint; its private control queues are separate from shared
usage metering and require provider-side binding evidence. Public routing is a
separately authorized later production action —
[docs/owner-actions/cloudflare-deployment.md](docs/owner-actions/cloudflare-deployment.md)
records what and why, including what pay per crawl actually is and is not, and
[docs/owner-actions/revenue-readiness.md](docs/owner-actions/revenue-readiness.md)
lays out the free-web/paid-API revenue split end to end.

`vercel.json` still disables Vercel Git deployments. It remains deploy
suppression, not adoption. The configured Vercel project has disconnected Git
and serves a 404 at the data hostname, so it is not a deployment or rollback
path. A Vercel GitHub App repository-selection check remains behind an owner
sudo/passkey prompt. Keep the file until that independent check proves the App
no longer has Data Foundry repository access.

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
