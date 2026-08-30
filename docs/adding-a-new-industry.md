# Adding a new industry (child site)

AGENTS.md rule 4: a new industry is a **configuration and data change**, never
a fork of the platform. This checklist keeps that true and separates structural
readiness, public-web readiness and commercial/API readiness so one does not get
mistaken for another.

`verticals/_template/` is the starting point for every step that edits a file.

## 1. Scaffold the vertical

```bash
cp -r verticals/_template verticals/<slug>
```

Fill in, in this order:

1. **`vertical.yaml`** — slug, name, entity types, relationship predicates,
   alias types, entity-resolution parameters.
2. **`entities/<type>.yaml`** per entity type — properties, `critical: true`
   flags, identity rules and quality rules.
3. **`relationships.yaml`** and **`filters.yaml`** — one canonical filter model
   drives web, REST/OpenAPI and SEO behavior.
4. **`normalizers/*.yaml`** — extraction/normalization rules, controlled
   vocabularies and fact-selection policy.
5. **`mcp.yaml`** — one server identity and the exact six generic executable
   tools from `apps/mcp`. The names, titles and summaries must match; add
   vertical behavior through fields/configuration, not domain-specific tools.
6. **`acquisition.yaml`** — only enabled, reviewed source targets intended for
   scheduled execution. A proposed/deferred source stays outside this file.
   For `DIRECT_HTTP`, `VENDOR_API`, `SITEMAP`, `BULK_FILE`, and `RSS`, set the
   required `max_direct_http_response_bytes` to the smallest documented positive
   ceiling that fits the expected artifact, up to 16 MiB. The direct adapter
   rejects a larger declared or streamed body and never silently truncates it.
   Do not set that field for `BROWSER_RUN` or `CRAWL4AI`; their remote service
   JSON is independently streamed under a fixed 4 MiB ceiling before parsing.
   Browser Run additionally defaults its upstream and local crawl-record limit
   to 100 (hard maximum 1,000), permits at most 100 paginated result responses,
   refuses repeated cursors, and caps cumulative artifact bodies at 16 MiB.
   Polling defaults to 60 attempts (hard maximum 600); job identifiers, cursors,
   result metadata, and cumulative diagnostics also have finite local bounds.
   A limit refusal fails the whole transport before artifact persistence; it
   never returns or stores a partial crawl.

Validate continuously:

```bash
pnpm verticals:validate
```

## 2. Write `seo.yaml`

This file makes the vertical's pages exist and controls when they are eligible
to be indexed. `verticals/hvac/seo.yaml` is the worked example and
`verticals/_template/seo.yaml` is the annotated skeleton.

`min_critical_fact_coverage` and `min_total_facts` should both be set. Coverage
without a floor can pass sparse stubs; a floor without coverage can pass pages
padded with unimportant properties.

Every page class must declare an explicit `route_kind`; an entity detail names
`entity_type`, while a relationship page names `subject_entity_type`. Do not
make dispatch depend on whether an unrelated optional field happens to exist.

## 3. Sources — proposed first, rights before publication

`docs/source-onboarding.md` is the full procedure. A proposed source starts
unreviewed and fail-closed. Real acquisition and commercial publication require
an explicit rights decision; synthetic fixtures only prove the machinery.

The rights model must answer the actual intended use, not merely whether a
source is generically “commercially usable.” A source may be allowed for a
public comparison page and prohibited for paid API or marketplace access.

Before activation, record/review the grants required by the surfaces this
vertical will use, including as applicable:

- `PUBLIC_WEB` page display;
- `SEARCH_INDEX` indexing (independent of public display);
- `API_FREE` access;
- `API_PAID` access;
- `RAPIDAPI` marketplace access;
- `MCP`/LLM retrieval;
- `BULK_EXPORT`;
- redistribution/sublicense.

Unknown or absent permission remains refusal. Run
`pnpm sources:readiness -- --as-of 2026-08-28T12:00:00.000Z <vertical-slug>`;
without live DB or a validated snapshot, all seven surfaces report `UNKNOWN`.
The command is a readiness signal, not permission manufactured by a successful
build.

## 4. Compile the runtime artifacts

Workers have no runtime filesystem. The compilers emit committed runtime JSON,
and the web compiler also emits a static TypeScript registry so every bundled
vertical is visible to the Worker bundler:

```bash
pnpm verticals:compile
pnpm mcp:compile
pnpm acquisition:compile
pnpm web:compile
```

Add the slug to `BUNDLED_VERTICALS` in `compile-vertical-runtime.ts` only when
the vertical has an edge/API deployment, and to `BUNDLED_WEB_VERTICALS` in
`compile-web-runtime.ts` only when the public Worker should carry it. Add it to
`BUNDLED_MCP_VERTICALS` in `compile-mcp-runtime.ts` only when an MCP deployment
is intended. Add scheduled targets through the acquisition compiler only when
exact acquisition rights and source governance allow them. The lists are
intentionally independent: an industry can be public without being sold by
API/MCP, or sold by API before its public pages are eligible. Run the matching
compiler(s). Bundling a runtime is not publication permission; database
presence, exact surface grants and page-quality gates still decide what can be
returned or indexed.

```bash
pnpm verticals:compile:check
pnpm mcp:compile:check
pnpm acquisition:check
pnpm web:compile:check
```

`pnpm openapi:generate` emits one canonical edge contract per edge bundle as
`openapi/data-foundry-<slug>-v1.openapi.json` (and retains the existing HVAC
path during migration). Run it whenever `BUNDLED_VERTICALS` changes; the CI
drift check covers every generated contract.

## 5. Ingest and verify

Run the ingest worker against fixtures first. The HVAC factory proof is the
reference pattern. Then run:

```bash
pnpm test
pnpm migrate:check
```

Add a live quality-gate test for the vertical so indexability decisions are
proved against real query-model behavior rather than copied assumptions.

## 6. Decide publication surfaces independently

A vertical can be ready for one surface and not another.

- **Public web (`apps/web`)** — the vertical must be `ACTIVE` and have exact
  `PUBLIC_WEB`-eligible data before any child route is exposed. Indexing and
  sitemap inclusion additionally require `SEARCH_INDEX` to cover every exact
  fact, attribution and relationship rendered on that page; disjoint grants on
  different claims do not combine into permission.
- **Direct REST API (`apps/edge`)** — receives its commercial vertical deployment
  and Data Foundry authentication only when API-use rights pass.
- **MCP (`apps/mcp-worker`)** — gets its own one-vertical deployment and exact
  `MCP/NONE` credential only when the LLM/agent retrieval use case is cleared.
  Direct/RapidAPI credentials are not interchangeable with it. `NONE` means
  analytics-only billing authority, not anonymous access.
- **Bulk export** — is independently gated by export/redistribution rights.
- **Scheduled acquisition (`apps/acquisition-worker`)** — is independently
  gated by exact stored `ACQUIRE`/`STORE`/`CACHE` decisions and uses Cron,
  migrations `0017`, `0019`, and `0020`, immutable versioned receipts through
  `PRE_PERSISTENCE`, fenced recoverable execution leases, bounded transports,
  and immutable R2 evidence. Its source YAML and schedule never create
  permission. A new vertical must prove that a caught same-slot retry reuses one
  run row and that an expired owner cannot persist after token rotation.

Do not infer “paid gets everything the website gets.” The rights resolver, not
pricing, decides which facts each surface may expose.

## 7. Marketplace publication (RapidAPI initially)

Marketplace publication is an optional distribution step after the canonical
Cloudflare API exists. It does **not** create a new vertical implementation.

For a marketplace-ready vertical:

1. Confirm the exact `RAPIDAPI` bundle for every contribution. Direct
   `API_FREE` or `API_PAID` permission does not imply marketplace permission;
   the marketplace bundle includes service, sale, normalized redistribution
   and sublicense decisions on the RapidAPI channel.
2. Confirm every required attribution/condition can travel through API responses
   and marketplace documentation.
3. Generate the marketplace OpenAPI/listing contract from the same canonical
   route/filter definitions used by `apps/api`; add or run the drift check.
4. Route the marketplace to the existing Cloudflare Worker using a hidden,
   dedicated Data Foundry marketplace credential.
5. Require the marketplace proxy secret so callers cannot bypass the marketplace
   and self-assert a marketplace plan/channel.
6. Record marketplace calls internally for operations and unit economics, but
   classify them as marketplace-billed so they can never also enter direct
   invoicing.
7. Use one listing per vertical, named around the buyer problem/domain rather
   than the internal “Data Foundry” platform name.
8. Start with conservative request allowances until real Cloudflare/database
   unit cost and support load are measured.
9. Verify current marketplace fee, payout and logging terms at launch rather
   than hard-coding a percentage into the product architecture.

Marketplace publication is complete only after an end-to-end request from a
real marketplace test subscriber reaches Cloudflare, passes rights/auth checks,
returns the canonical response, records one idempotent usage event and cannot be
double-billed internally.

## 8. Direct commercial expansion

The marketplace is intended to validate demand quickly, not become the only
commercial channel. Keep these offerings direct unless there is a reason to do
otherwise:

- large-volume contracts;
- custom enrichment;
- bulk datasets;
- enterprise redistribution rights;
- multi-vertical access;
- negotiated SLAs.

Build first-party self-service billing only when marketplace traction or direct
customer demand makes the additional control/margin worth the implementation
cost.

## 9. Deployment verification

`docs/owner-actions/cloudflare-deployment.md` contains the production-resource
checklist. A new vertical is not considered live because CI is green; verify the
exact deployed SHA, production health/readiness, real database access, auth,
rights behavior and usage-event persistence independently for web, direct REST,
RapidAPI and MCP. Also prove an acquisition Cron claim, rights refusal, and one
authorized R2/Postgres result in an isolated provider environment. Acquisition
proof must include post-transport revocation; oversized declared and chunked
direct responses; Browser Run repeated-cursor, page, record, diagnostic, and
cumulative-artifact refusals; and zero partial R2 writes. An MCP smoke test must
cover initialize/discovery, tools/list,
one authenticated tools/call, wrong-channel credentials, and a post-deploy
rights-revocation negative.

## What this checklist deliberately does not cover

Choosing which industry to add next is a market decision. Candidate verticals
should still be evaluated for source stability, rights, data quality, refresh
cadence, demand and realistic acquisition cost before configuration work starts.
The platform goal is to make a good vertical cheap to launch, not to make a bad
vertical worth launching.
