# `@data-foundry/edge`

The Cloudflare Worker that serves the read-only REST surface. Three files of
substance and no routing of its own.

| file | what it is |
|---|---|
| `src/index.ts` | the `fetch` handler: authenticate, run the route, publish a usage event, answer — plus the 503 a misconfigured deployment returns |
| `src/adapter.ts` | `Request` ↔ `ApiRequest`/`ApiResponse`. Translates, decides nothing |
| `src/auth.ts` | the authentication and scope-enforcement pipeline; the one place this deployment reaches `api_keys`/`api_tenants` |
| `src/composition.ts` | the composition root: driver → store → `QueryModel` → app |
| `src/env.ts` | what a deployment is configured with, and what it refuses to start without |
| `generated/*.runtime.json` | compiled vertical config. Generated — do not hand-edit |

See [ADR-0006](../../docs/decisions/ADR-0006-cloudflare-is-the-deployment-target.md).

## Why the composition root lives here

`apps/api/src/config.ts` refuses to build one, and is right to:

> building one would mean importing `@data-foundry/canonical-store` here to open
> a driver, and a single import is all it takes for the next handler to reach
> through it.

That is an argument about where the root belongs, not that none should exist.
Somebody has to open the driver. This package does it once, at the process edge,
and hands each layer only what it may see — so `apps/api` still receives a
`QueryModel` and still cannot reach past it.

## Three things this package will not do

**It will not decide method policy.** `createApiApp` rejects anything outside
GET/HEAD *before* it parses the target, which makes read-only a property of the
surface rather than of each route. The adapter therefore hands every method
through verbatim; answering `OPTIONS` here would put a decision in front of that
check and reopen the hole it was placed first to close.

**It will not serve an empty database.** `createDriverFromEnv` falls back to
PGlite when no connection string is set — correct in tests, silent disaster here:
a Worker deployed without a database would boot, answer every request
successfully, and return zero results forever. Nothing in `src/` imports that
helper, and `test/env.test.ts` reads the source to prove it.

**It will not accept a fact-selection policy from a request.** The compiled
policy is passed at construction. A client that could send
`?requirePublishableRights=false` would have a rule-1 bypass in a query string.

## The generated runtime

The edge has no filesystem, and `loadVerticalConfig` reads YAML off disk. So the
parts a *read* surface needs are compiled and committed:

```bash
pnpm verticals:compile        # write apps/edge/generated/<slug>.runtime.json
pnpm verticals:compile:check  # CI gate
```

The artifact carries filter/facet metadata and the doc-04 fact-selection policy,
and deliberately **no `at`** — that is the caller's as-of instant, not a property
of the vertical, and a build timestamp in a committed file would make the output
undiffable.

A bundle carries runtimes by slug, so standing up a second vertical is a
`VERTICAL_SLUG` change and a deploy rather than a fork of this package (AGENTS.md
rule 4). `composition.ts` refuses a slug the bundle does not carry instead of
serving one vertical's data through another's field metadata.

## Running

```bash
pnpm vitest run --project edge   # this package
pnpm --filter @data-foundry/edge dev      # wrangler dev
pnpm --filter @data-foundry/edge deploy   # wrangler deploy
```

`wrangler dev` wants a database. Put `POSTGRES_URL` in `.dev.vars` (gitignored),
never in `wrangler.toml` — that file is committed.

Deployment needs an account id, a Hyperdrive binding and a route, none of which
are in this repository. See
[docs/owner-actions/cloudflare-deployment.md](../../docs/owner-actions/cloudflare-deployment.md).

## Authentication and metering

Every request is authenticated and scope-checked in `src/auth.ts` before
`apps/api`'s handler ever runs — see `AGENTS.md` rule 5's reasoning for why
that lookup belongs here and not in `apps/api`. A rejected key or a key
scoped to a different vertical never reaches a route, and its failure
response is uniform across every 401 reason and every 403 reason, so a
client cannot use the response shape to probe which one applies.

A successful GET/HEAD request is metered asynchronously: `src/index.ts` builds
a `UsageEvent` from `apps/api`'s `onRequest` telemetry. Telemetry carries only a
registered route key such as `entities.detail`, never a path, query, slug, or
entity identifier. The Worker publishes it to `USAGE_EVENTS_QUEUE` via
`ctx.waitUntil`,
without ever awaiting the publish before answering. A request's success
never depends on the queue, or on the database write the queue's consumer
(`apps/usage-consumer`) eventually makes — see that package for the
idempotent-persistence half of this design, and migrations 0011–0012
for the schema and the invariants it enforces (revocation is a timestamp,
usage rows cannot cross the tenant boundary, no plaintext key is ever
stored).

Deliberately not built as part of this: pricing, plans, invoices,
subscriptions, or a Durable Object. Metering here is measurement only; see
`packages/usage-events` for the contract and `docs/owner-actions/cloudflare-deployment.md`
for what an operator still has to provision (the queue itself and its
dead-letter queue).

`API_KEY_ENVIRONMENT` is required and exact. Production declares `live` in
`wrangler.toml`; local/test deployments must explicitly override it to `test`.
A `df_test_*` key is rejected by live before hashing or any database lookup.

## Deliberately absent

* **No MCP handler yet.** `apps/mcp` exists and AGENTS.md names Cloudflare
  Streamable HTTP as its target. It is a second entry point over the same
  composition root, not a second composition root.
* **No caching.** `apps/api` sets `cache-control: no-store` and says why:
  correctness first, no shared caching until there is a documented invalidation
  story. Putting a cache in front of it here would be that decision made silently.
