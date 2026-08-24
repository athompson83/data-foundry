# ADR-0011 — One free web Worker for all industries; one paid API Worker per industry

**Status:** Accepted (first implementation: `apps/web`)
**Date:** 2026-08-24
**Relates to:** ADR-0006 (Cloudflare is the deployment target, merged);
ADR-0007 (abuse protection, accounting and quota are three systems) and
ADR-0008/0009 (usage metering) — proposed in open PR #14, not yet merged to
`main` as of this ADR's date; `docs/owner-actions/cloudflare-deployment.md`;
`docs/owner-actions/revenue-readiness.md`, which states plainly what is
merged versus proposed for the paid-API half of the revenue split below.

## Context

Before this ADR, the repository had three read surfaces — `apps/api`,
`apps/mcp`, `services/export-builder` — and, per the README, "no human pages
… nothing here is deployed." Every one of those three surfaces requires a
client that already knows this product exists: a REST caller, an MCP host, an
export consumer. Nothing crawlable, nothing a search engine or an LLM's web
tool would ever find on its own. A data product nobody can discover has no
funnel into the metered API that is meant to earn revenue from it.

Two requirements had to be reconciled, and they pull in different directions:

1. **The site must be repeatable across industries** — a master/parent site
   plus a child site per vertical, added by configuration, never by forking
   the app (AGENTS.md rule 4).
2. **`apps/edge` is deliberately siloed per vertical** (one `VERTICAL_SLUG`
   per deployment, per `composition.ts`'s own doc comment), because a
   `QueryModel` carries exactly one vertical's field metadata and a metered
   API benefits from that isolation — a bug or an incident in one industry's
   deployment cannot touch another's paid customers.

Copying the edge's per-vertical-Worker shape onto the public site would mean
either N separate domains with no shared parent index (bad for discovery: a
crawler landing on `hvac.example.com` has no path to `plumbing.example.com`),
or a parent site that is itself a third kind of Worker maintaining its own
cross-vertical index out of band with the child sites — two sources of truth
for "which industries exist."

## Decision

> `apps/web` is ONE Cloudflare Worker, serving every vertical from one origin:
> a parent index at `/` and a child site per industry at that vertical's own
> `seo.yaml` `url_prefix` (e.g. `/data/hvac`). `apps/edge` remains one
> deployment per vertical, unchanged. The two Workers read the same database
> through the same `@data-foundry/query-model` (rule 5) and share nothing else
> — not a process, not a deployment, not a rate limit.

This is also the revenue architecture, not just the URL scheme:

| | `apps/web` | `apps/edge` |
|---|---|---|
| Audience | People, search engines, LLM web tools | Applications with an API key |
| Auth | None | None on `main` today; API key auth (`packages/api-keys`) is designed in ADR-0007/0008/0009 and implemented in open PR #15 |
| Cost model | Free, cached, crawlable | Metered per request once PR #14/#15 merge; unmetered, open reads today |
| Failure mode | Cacheable 503 if misconfigured | Same, but a paying customer is waiting |
| Job | Discovery, trust, citation — the funnel | The thing that earns money, once metering lands |

The free site is not a loss leader tolerated alongside the paid API; it is
meant as the **demand-generation half of the same revenue design** ADR-0007
proposes. That ADR's own test for whether a change confuses two systems is
"abuse protection fails closed, accounting fails open"; the test here is
symmetric: a change that makes the free site slower to earn discovery traffic,
or the paid API free to browse, has confused the split.

### Why one Worker rather than N

A vertical is added to `apps/web` by adding it to
`tooling/scripts/compile-web-runtime.ts`'s `PUBLISHED_VERTICALS` list and
running `pnpm web:compile` — the same "configuration, not a fork" shape rule 4
already requires of `verticals/*`. `apps/web/src/composition.ts` opens ONE
database connection and builds one `QueryModel` per vertical the bundle
carries AND the database actually holds; a vertical compiled into the bundle
but not yet ingested is not an error, it is simply not offered — a child site
can exist in code before it exists in data without taking the parent site
down with it (proven in `apps/web/test/composition.test.ts`).

### Indexability is measured, not asserted

`verticals/hvac/seo.yaml` already specified page classes, per-page quality
gates, sitemap segments, structured data and LLM discovery (doc 07) before
this ADR — nothing rendered it. AGENTS.md rule 8's "Do not create thin SEO
pages. Indexability is quality/demand gated" is enforced for real in
`apps/web/src/gates.ts`: every threshold `seo.yaml` declares is checked
against a signal computed from the same `QueryModel` every other surface
reads — `entity.quality_score`, `canonicalFacts` for critical-property
coverage, `provenanceCoverage` for evidence coverage, real relationship
traversals for supersession and related-entity counts, and the page's own
rendered word count.

**A threshold this deployment cannot honestly measure fails closed, not
open.** No traffic/analytics system exists in this repository, so
`demand_threshold` never passes; no dispute ledger exists beyond the per-fact
conflict state `canonicalFacts` already reports, so `block_on_open_dispute`
never passes (its narrower, actually-measured cousin,
`block_on_disputed_critical_property`, does). This is a deliberate reading of
rule 8: absence of proof of quality is absence of quality, and a gate that
silently passed what it could not check would be worse than no gate — it
would read as a control that was applied. `seo.yaml`'s own `on_gate_failure`
makes this cheap: a failed gate still renders the page, still serves it to the
API and MCP, and only withholds the index entry it had not yet earned.

### Sitemap path scoping

`seo.yaml`'s sitemap segment paths (`/sitemaps/entities-{n}.xml`) were written
assuming a URL space scoped to one vertical's own deployment. Served from the
single multi-vertical `apps/web` origin, they are resolved relative to that
vertical's `url_prefix` (`/data/hvac/sitemaps/entities-1.xml`), and the global
`/sitemap-index.xml` lists every vertical's segments together. This is an
interpretation this ADR makes explicit rather than one `seo.yaml` states,
because `seo.yaml` predates the multi-vertical-single-origin decision.

### What is not built here

- **Sitemap sharding.** `max_urls_per_file` is honored in spirit — every
  segment is single-shard (`-1.xml`) today because no deployment is within two
  orders of magnitude of the 45,000-URL limit. Building pagination for a limit
  nothing is near is exactly the complexity doc 07 warns against manufacturing
  ahead of need; `apps/web/src/sitemap.ts` documents this as a known gap.
- **`comparison` and `filtered_collection` page rendering.** Both are
  demand-gated in `seo.yaml`, and with no demand signal in this deployment
  (see above), both would always render `noindex` today. Building the UI for a
  page class that cannot yet be indexed is deferred rather than half-built —
  see `docs/owner-actions/revenue-readiness.md` for what unblocks it.
- **Pricing, billing collection, and pay-per-crawl enrollment.** Those are
  owner actions, not code — see `docs/owner-actions/revenue-readiness.md`.

## Consequences

**The free site can be cached aggressively; the paid API cannot.**
`apps/web/src/http.ts` sets `public, max-age=3600` on every 200 response,
deliberately the opposite of `apps/api`'s `no-store` — nothing on the free
surface is personalized, and an hour of shared caching is real cost saved with
no correctness risk. Getting this backwards in either direction — caching a
per-customer API response, or serving the marketing site uncached at crawl
volume — is the failure this split exists to prevent.

**Adding an industry is additive to both Workers independently.** A second
vertical needs its own `apps/edge` deployment (or none, if it is not yet sold
metered access) and an entry in `apps/web`'s compiled bundle — the two
decisions are genuinely separate, which is the point: a vertical can be
publicly discoverable before it is commercially available, or sold via the API
before its public pages clear their quality gate.

**If this is revisited:** a vertical's public traffic outgrowing what one
Worker should serve, or a genuine need to silo one industry's public site from
another (a legal takedown affecting one industry only, say) are the conditions
under which "one Worker for every industry" should be re-examined rather than
worked around.
