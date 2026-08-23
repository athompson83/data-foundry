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

A deployable surface now exists. `apps/api` serves eight read-only REST routes
and `apps/mcp` serves six tools, both over the canonical query layer. The
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

> Deployment targets Cloudflare Workers, per AGENTS.md. `apps/edge` is the
> Worker: a `fetch` handler, a transport adapter, and the composition root.
> Postgres is reached through Hyperdrive.

Three things follow, and each is a boundary rather than a preference.

**`apps/edge` is the only package that may reach below the query layer.** It
builds the object graph — driver, store, `QueryModel`, app — and hands each layer
only what it may see. `apps/api` still receives a `QueryModel` and still cannot
reach past it, so the property `config.ts` was protecting is preserved rather
than traded away.

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

**Vercel is still not adopted, and `vercel.json` stays for now.** ADR-0005 named
disconnecting the Git integration as the complete fix and noted it needs a person
in the Vercel dashboard. That has not happened, so deleting the file would let
failing deployments resume. Deletion is tracked in `docs/owner-actions/`, not
here.

**Monetization is not a deployment decision.** Metered API access needs tenancy,
keys and usage schema that `db/migrations` does not have. Pay per crawl is a
zone-level Cloudflare setting, not code. Neither belongs in this ADR.

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
- An operator must supply the account, the Hyperdrive binding and the route.
  `docs/owner-actions/cloudflare-deployment.md` records what and why.
- ADR-0005's reasoning about permanently-red status checks stands and is not
  reversed by this decision; only its conclusion about there being nothing to
  deploy has expired.
