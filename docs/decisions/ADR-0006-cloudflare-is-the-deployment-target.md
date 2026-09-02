# ADR-0006 — Cloudflare Workers is the deployment target

**Status:** Accepted
**Date:** 2026-08-23
**Supersedes:** [ADR-0005](ADR-0005-vercel-is-not-a-deployment-target.md)
**Relates to:** AGENTS.md ("Implementation preferences" — Cloudflare), ADR-0004

## Context

ADR-0005 closed with an instruction rather than a permanent state:

> If a deployable surface is ever built here, this ADR must be revisited rather
> than worked around: delete `vercel.json` and record the decision to adopt a
> host, whichever host that turns out to be.

A deployable stack now exists. `apps/api` serves the read-only REST contract and
`apps/mcp` serves six tools, both over the canonical query layer. Five Cloudflare
Workers compose the production topology around those pure contracts. The
inventory ADR-0005 took — no `apps/`, no framework config, no web dependency —
is no longer accurate, and the ADR it justified has therefore expired on its own
terms.

What was still missing was not an application but a *composition root*.
`apps/api/src/config.ts` refuses to have one, and gives a good reason: opening a
driver there would mean importing `@data-foundry/canonical-store` into a handler
package, "and a single import is all it takes for the next handler to reach
through it." That is an argument about where the root belongs, not an argument
that none should exist.

## Decision

> Deployment targets five Cloudflare Workers, per AGENTS.md. Postgres is reached
> through Hyperdrive; raw acquisition evidence is written to R2; API and MCP
> usage is handed durably to a Queue before success and persisted later by the
> consumer.

The five roles are deliberately separate:

- `apps/edge`: one-vertical authenticated REST composition root and Queue
  producer. RapidAPI is a thin authenticated channel into this same Worker, not
  a second API deployment.
- `apps/web`: one public multi-vertical Worker for human pages, crawl controls,
  sitemaps, and evidence disclosure.
- `apps/usage-consumer`: Queue consumer that persists usage idempotently.
- `apps/acquisition-worker`: hourly Cron composition root that claims scheduled
  work in Postgres, rechecks exact stored `ACQUIRE`/`STORE`/`CACHE` rights, and
  stores immutable raw evidence in R2.
- `apps/mcp-worker`: one-vertical MCP 2026-07-28 Streamable HTTP composition
  root using exact `MCP/NONE` credentials and analytics-only usage events.

Three things follow, and each is a boundary rather than a preference.

**Composition roots may reach below the query layer; pure surface packages may
not.** `apps/edge`, `apps/web`, and `apps/mcp-worker` build their bounded object
graphs while `apps/api` and `apps/mcp` receive a `QueryModel` and cannot reach
past it. `apps/acquisition-worker` is not a read surface: it composes scheduled
rights admission, provider adapters, Postgres run state, and R2 evidence. The
usage consumer owns only the persistence boundary for accepted usage events.

**The transport adapter decides nothing.** `apps/api` states the contract it
satisfies: "swapping the transport (a Cloudflare `fetch` handler, say) changes no
routing code." `adapter.ts` translates and stops. In particular it hands every
HTTP method through verbatim, because `createApiApp` rejects anything outside
GET/HEAD *before* it parses the target — an adapter that answered `OPTIONS`
itself would put a decision in front of that check and reopen the hole the check
was placed first to close.

**Vertical configuration is compiled, not read.** The edge has no filesystem, and
`loadVerticalConfig` reads YAML off disk. `pnpm verticals:compile` emits
`apps/edge/generated/<slug>.runtime.json` — filter/facet metadata and the doc-04
fact-selection policy — and `verticals:compile:check` fails CI when it drifts,
the same shape as `schemas:check`. The Worker imports the artifact and never
parses YAML, never reaches for `services/ingest-worker`, and never accepts a
policy from a request.

`at` is deliberately excluded from the artifact. `buildFactSelectionPolicy`
passes it straight through — it is the caller's as-of instant, not a property of
the vertical — and baking a build timestamp into a committed file would make the
output non-deterministic and `--check` unrunnable.

## What this ADR does not decide

**Vercel is still not adopted, and `vercel.json` stays for now.** The
[2026-08-31 read-only provider reconciliation](../evidence/alpha-lab-provider-reconciliation-20260831.md)
found a configured Vercel project with disconnected Git and a data hostname
that returns 404. That does not make it a deployment or rollback target. The
Vercel GitHub App repository-selection check still requires an owner
sudo/passkey confirmation; deletion is tracked in `docs/owner-actions/`, not
here.

**Monetization is not a deployment decision.** Tenancy, scoped keys, usage
schema, async Queue metering, and channel-safe invoice projection now exist, but
pricing, subscriptions, invoices, marketplace enrollment, and pay per crawl are
separate commercial/provider decisions. Pay per crawl remains a zone-level
Cloudflare setting, not code. None of those choices belongs in this ADR.

## Rejected alternatives

**Put the composition root in `apps/api`.** This is what `config.ts` already
refused, and its reasoning holds: the risk is not the first import but the tenth
handler that finds a driver in scope. A separate package keeps the boundary
something the module graph enforces rather than something reviewers remember.

**A Postgres HTTP driver instead of Hyperdrive.** It would avoid `nodejs_compat`
and TCP sockets. It would also mean a second SQL execution path that CI never
exercises, and the repository's whole database posture is that the same plain
SQL runs against PGlite and real Postgres unchanged. Hyperdrive keeps one path
and adds edge connection pooling, which is what makes a database-backed Worker
viable at all.

**Read vertical YAML at the edge from R2 or KV.** Configuration would then be
mutable independently of the code compiled against it, so a deployment could
serve one vertical's data through another's field metadata with nothing to catch
it. Bundling makes the pairing a build artifact, and `composition.ts` refuses a
`VERTICAL_SLUG` the bundle does not carry.

**Let the Worker fall back to PGlite when no database is configured.**
`createDriverFromEnv` does exactly this, which is right for tests and would be
silent data loss here: a misconfigured deployment would boot, answer every
request successfully, and serve an empty in-memory database as though it were
the product. `apps/edge` never calls that helper — a test reads the source to
prove it — and refuses to serve instead.

## Consequences

- `pnpm verticals:compile:check` joins the CI gate. A vertical config change that
  is not recompiled fails the build rather than shipping a stale runtime.
- Standing up a second vertical is a `VERTICAL_SLUG` change and a deploy, not a
  fork of `apps/edge` (AGENTS.md rule 4).
- Scheduled acquisition is configuration-driven and independently deployed;
  adding a source never adds a sixth per-source Worker.
- An operator must supply the account, Hyperdrive, R2, Queue/DLQ, hostnames,
  routes, protected values, and provider-backed proof.
  `docs/owner-actions/cloudflare-deployment.md` records the minimal actions.
- None of the five Workers is deployed merely because its tracked Wrangler
  manifest and credential-free dry-run succeed.
- ADR-0005's reasoning about permanently-red status checks stands and is not
  reversed by this decision; only its conclusion about there being nothing to
  deploy has expired.
