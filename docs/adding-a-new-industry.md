# Adding a new industry (child site)

AGENTS.md rule 4: a new industry is a **configuration and data change**, never
a fork of the platform. This is the checklist that keeps that true, and the
order that makes each step checkable before moving to the next. Every command
below is one already used elsewhere in CI — nothing here is bespoke to onboard
a vertical.

`verticals/_template/` is the starting point for every step that edits a file.

## 1. Scaffold the vertical

```bash
cp -r verticals/_template verticals/<slug>
```

Fill in, in this order — each one is checkable before the next:

1. **`vertical.yaml`** — slug, name, entity types, relationship predicates,
   alias types, entity-resolution parameters. Read `verticals/hvac/vertical.yaml`
   for a worked example; the comments there explain what each field is for and
   which mistakes it exists to prevent (e.g. `never_merge_across: supersedes`).
2. **`entities/<type>.yaml`** per entity type — properties, which ones are
   `critical: true` (this is what feeds the indexability quality gate, see
   step 4), identity rules, quality rules.
3. **`relationships.yaml`**, **`filters.yaml`** — the same file, one canonical
   definition, that drives the web filter UI, the API/OpenAPI docs, and SEO
   facet generation (doc 10 — one model, not three that can drift).
4. **`normalizers/*.yaml`** — extraction/normalization rules, controlled
   vocabularies, fact-selection policy (the doc-04 authority cascade).

Validate as you go:

```bash
pnpm verticals:validate   # config is well-formed; every source carries complete rights metadata
```

## 2. Write `seo.yaml`

The file that makes this vertical's pages exist at all, and — just as
importantly — makes most of them **not** indexable until they earn it
(AGENTS.md rule 8). `verticals/hvac/seo.yaml` is the fullest worked example in
the repository; `verticals/_template/seo.yaml` is the annotated skeleton.

The one thing worth internalizing before writing thresholds:
`min_critical_fact_coverage` and `min_total_facts` are BOTH required, and for
a reason found the hard way in `hvac`'s own gate: coverage without a floor
passes six-fact stubs, and a floor without coverage passes entities padded
with unimportant properties. Set both.

## 3. Sources — proposed, not active

`docs/source-onboarding.md` is the full procedure. The short version: a
proposed source lives in `docs/sources/proposed/*.yaml`, `reviewed_by: null`,
status `UNREVIEWED`, every permission flag `false`. **Real source acquisition
is an owner decision, not something this checklist — or any automated
session — authorizes on its own.** `pnpm sources:readiness` reports exactly
where the vertical stands against real, rights-cleared sources; a vertical can
be structurally complete and still correctly report `NOT READY` with zero real
sources, same as `hvac` does today.

Synthetic fixtures (`fixtures/*`, on RFC 2606 reserved domains — `.example`,
`.test`, never a real publisher's domain) let every step from here on be
proven end to end before a single real byte is fetched.

## 4. Compile the runtime artifacts

Both Workers have no filesystem; they read committed JSON, never YAML:

```bash
pnpm verticals:compile   # apps/edge/generated/<slug>.runtime.json — the metered API
pnpm web:compile         # apps/web/generated/<slug>.web-runtime.json — the free site
```

Add the slug to `DEPLOYED_VERTICALS` in
`tooling/scripts/compile-vertical-runtime.ts` and to `PUBLISHED_VERTICALS` in
`tooling/scripts/compile-web-runtime.ts` first — both default to `hvac` only,
deliberately, so a vertical is not silently bundled before it is ready.

```bash
pnpm verticals:compile:check   # CI gate: fails when the artifact drifts from seo.yaml/filters.yaml/entities
pnpm web:compile:check
```

## 5. Ingest and verify

Run the ingest worker against the vertical's fixtures — `tests/e2e/factory-proof.test.ts`
is the worked HVAC example, running four sources through the worker and
checking the canonical result against golden records — then:

```bash
pnpm test              # includes the vertical's own tests/vertical-config.test.ts and golden-data.test.ts
pnpm migrate:check
```

`apps/web/test/gates-live.test.ts` is the pattern to follow for proving the
new vertical's quality gate measures something real against its own fixture
data, not a hand-copied assumption from `hvac`.

## 6. Deploy — two independent decisions

Per [ADR-0011](decisions/ADR-0011-web-frontend-and-multi-industry-sites.md),
the two Workers are added independently:

- **`apps/web`** — no new deployment. The single Worker picks up the new
  vertical automatically once it is in `PUBLISHED_VERTICALS`, rebuilt, and
  redeployed; the parent index lists it the moment its data is present.
- **`apps/edge`** — needs its OWN Cloudflare Worker deployment
  (`VERTICAL_SLUG=<slug>`), because the metered API is deliberately siloed per
  industry. Not required for the vertical to have a public presence — a
  vertical can be discoverable on the free site well before it is sold
  through the metered API.

`docs/owner-actions/cloudflare-deployment.md` has the full deployment
checklist; `docs/owner-actions/revenue-readiness.md` has what turns either
deployment into revenue.

## What this checklist deliberately does not cover

Choosing WHICH industry to add next is a market decision this checklist has
no opinion on. `docs/sources/energy-star-air-source-heat-pumps-review-packet.md`
is the kind of research a next-industry proposal should look like — every
claim about a candidate source labelled `[VERIFIED]`, `[INFERRED]`, `[UNKNOWN]`
or `[REVIEWER]`, so nothing an automated review concluded is mistaken for a
decision a person made — before a line of vertical config is written.
