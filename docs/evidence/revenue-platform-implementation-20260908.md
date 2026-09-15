# Revenue platform implementation ledger

Approved plan: ../superpowers/plans/2026-09-08-recurring-revenue-platform.md

## Baseline

- Base main: 0ae6c7aeb2dee70ce380663cb438d5e1d047b634, live rechecked 2026-09-08.
- Isolated worktree: revenue-platform-20260908; branch codex/revenue-platform-20260908.
- Original local-test checkout preserved. Its four pre-existing modified files
  were copied into isolation for integration; none was discarded or reset.
- Frozen pnpm dependency install passed. No provider or credential mutation.
- GitHub: README-only PR29 open, zero open issues at startup.

## Implemented candidate

- Transactional acquisition outbox; opaque ingestion queue; independent recovery
  dispatch; database-clock claims, leases and fences; immutable artifact parts;
  source/receipt/hash/UTF-8 validation; atomic canonical promotion; 304 verification.
- Production structured ingestion compiles source and normalization configuration
  without filesystem/PDF imports. Source targets are explicit; unsupported
  multi-target or oversized inputs refuse rather than silently truncate.
- Processing identity covers deterministic production source/dependency/migration
  bytes as well as configuration. Same-artifact replacement retires obsolete work
  only after publication covers its verification time; changed-artifact retirement
  requires an audited operator action. Active leases and raw evidence are retained.
- Shared identifier normalization for ingestion/query; synthetic laboratory
  vertical; independent surface bundle inclusion and unchanged query interfaces.
- Buyer-oriented /hvac routes, old-path redirects, filters/pagination, coverage,
  proposed prices, listing and approved-policy/contact gates, working TS/Python
  clients, and rights-filtered selected-fact evidence across REST/MCP.
- Closed production telemetry; operator recovery, key revocation and account
  closure; UUID-normalized idempotency and immutable audit including TRUNCATE;
  durable operational incidents and fixed-recipient email, disabled by default.
- Six runtime roles, 59 functions, 286 grants, 33 migrations; thirteen core
  artifacts plus a separate isolated synthetic ingestion profile. Existing
  receipt-only canary capabilities remain restricted.
- README PR29 presentation incorporated; original operational text preserved at
  ../reference/platform-reference-20260903.md. Source/offer/policy/adapter and
  operational packets accompany the accepted plan.

## Verification record

Run from the isolated implementation worktree using pinned pnpm9.15.4:

- `corepack pnpm test -- --reporter=dot` — 3,434 tests passed in 219 files
  (346.35 seconds on Windows Node24.19.0), after final processing-identity and
  retirement repairs. The protected hosted gate uses its pinned Node22 runtime.
- `corepack pnpm run typecheck` — passed after integration.
- `corepack pnpm run schemas:check` — 20 canonical schemas and readiness schema current.
- `corepack pnpm run migrate:check` —31 ordered/idempotent migrations,51 tables.
- `corepack pnpm run openapi:check` and all web/API/MCP/acquisition/ingestion
  runtime compile checks — current; `verticals:validate` admits HVAC only.
- Fourteen schema/type/runtime/topology checks passed; thirteen core and the
  separate synthetic ingestion Worker builds passed. Production dependency audit
  (`corepack pnpm audit --prod --json`) reported zero known advisories across
  69 production dependencies at this check; this is not a security guarantee.
- Current `source-readiness.ts --as-of <observed UTC instant> --json hvac`
  control reports DRAFT, zero real sources/publishers, four synthetic sources,
  rights evidence NONE and ready=false. No source was promoted.
- Early broad grant/export/operator regression run:111 tests passed before the
  final alert inventory expansion; the final candidate repeats applicable checks.
- Final bounded ingestion suite:26 tests; operational alert suite:12; compiler
  identity suite:4; operator/replacement-retirement suites:23. Identifier/customer runs and actual browser/example evidence are
  detailed in [their handoff](identifier-and-buyer-verification-20260908.md).
- Six-role pipeline control and negative capabilities run on real local
  PostgreSQL16 are recorded in [the native control](ingestion-postgres-control-20260908.md).
- The [isolated database restoration control](local-postgres-restore-20260908.md)
  restored 51 tables/483 rows and matched canonical results, migration history,
  sequence state and semantic schema/role/ACL metadata. The source was unchanged
  and the temporary restore target/dump were removed. This database-only synthetic
  drill does not certify provider backups, R2 recovery or production RPO/RTO.
- Current native31 upgrade proof in a separately created loopback cluster:
  frozen199-grant baseline to286, complete postcondition verifier passed,
  same-count ACL substitution refused atomically, application ledger unchanged.
  Repository migration digest:
  `65e1cad2a788d7157dd8d54a2bead120c36267557bf2a91fa85fc0e9ed912bc2`.
  Upgrade SQL checksum:
  `f649bd60780b0f8590e2ec14c8236dfdb39a802a2a4839ac556067d936d6d102`.
  This pure-planner local control used the uncommitted tree, not a claimed
  exact-SHA provider export. Re-export from clean reviewed HEAD for hosted use.

The implementation PR records the final candidate SHA, complete local test
result, security review, required hosted checks and merge result. No repository
or local test alone designates a provider release candidate. Reconcile any later
SHA or migration/runtime change before provider action.

## Remaining acceptance

Real source/legal review, three buyer trials and authorized outreach, two real
scheduled refresh cycles, verified email failure/recovery, independent provider
outage/storage/DLQ/spend monitors, approved retention/erasure implementation,
TLS/provider binding/canary proof, isolated restoration and rollback, actual
marketplace subscription/limits/cancellation/reconciliation, supported MCP client,
public cutover and first external payment remain outstanding.

Current source qualification is bounded to16 artifacts,1MiB each,4MiB total,
1,000 records,10,000 promotion candidates and one acquisition target per source.
Partitioned large-source staging and HTML/PDF production qualification require
additional implementation before admitting such a source. Bulk Parquet/delivery,
Stripe direct subscriptions and paid MCP remain successive releases after the
first marketplace channel, per the accepted plan.

## Evidence boundary

Repository and local fixtures do not prove current provider resources, real-source
permissions, deployed refresh, marketplace billing or revenue. The historical
Alpha Lab/provider evidence is not presented as a fresh observation.

## PR30 follow-up verification

The first hosted run34240733749 at854683c984508e1728dd5256839127b1128d9e10
passed real PostgreSQL and failed the ordinary job because the tracked TypeScript
example was absent from tsconfig. The follow-up includes and typechecks that
example. Migration0032 preserves view grants while projecting all current alias
source claims. Production promotion considers only affected entity/property
pairs, including omitted records, removed fields and dependent facts; the10,000
pair limit remains per delivery. Search pages are noindex and absent from sitemaps.

- Full follow-up run: 3,447 passed, one failed,220 files,324.25 seconds. The single
  failure expected0031 in the now0032 deployment runbook. After that assertion
  repair, the documentation and typecheck coverage suites passed26/26. No second
  full run is claimed.
- All14 type/schema/runtime/topology checks passed; all13 core builds and the
  separate synthetic ingestion profile passed.
- Source membership, unrelated-catalog scaling, omission/field fallback and
  search-page regressions are included in that full run.
- The older31-migration native evidence above remains historical. Exact Git
  packet evidence and hosted run34254514199 belong to PR30's immutable repaired
  head `2ba6ad8b4833253f1ba782071b7b2cdaf63d70ac`.

PR30's delayed304 finding (comment3959304808) is repaired in the subsequent
candidate: a NOT_MODIFIED run may select only an exact-scope FETCHED run whose
completion and freshness both precede the304 claim. Migration0033 reasserts the
same fence in the database terminal guard and pins its function search path.
Regressions cover both the scheduler completion path and a raw terminal update
after an overlapping matching FETCHED run. Focused acquisition, migration,
packet and runtime-grant controls passed; the final sequential suite passed
3,450/3,450 in220 files in397.90 seconds, followed by all14 configuration checks
and all14 Worker build profiles. Hosted run34254514199 passed the full protected
job in13m50s and real PostgreSQL in1m14s; PR30 merged as
`eed284599ab9a2bf1892039705eb294a0e99fbd1`. No provider change, public release
or paid customer is represented by this repository evidence.
