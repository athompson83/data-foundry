# `apps/api` — the read-only REST surface

The first of the three consumer surfaces AGENTS.md rule 5 names ("Web/API/MCP
must read from the same canonical query layer"). It reads through
`@data-foundry/query-model` and nothing beneath it, and it owns no business
logic: no SQL, no fact selection, no filtering, no search ranking, no redirect
following, no notion of what is publishable. All of that already exists once,
below, and re-deciding any of it here is how the API and the web page start
disagreeing about what is true.

`test/boundary.test.ts` enforces that mechanically — it reads this directory's
source and fails on an import beneath the query layer, on a SQL fragment, and
on a second fact serializer. That last check is ADR-0004's deferred enforcement,
which was waiting for exactly this package to exist.

## Contract

`/v1` in the path is the contract. The path segment is the **only** version
selector: there is no `Accept` negotiation and no default-to-latest, because
silently serving the newest contract to an unversioned request breaks clients on
a deploy they did not trigger. An unknown version is `404 UNSUPPORTED_API_VERSION`
with the served versions in `details`.

`GET /v1` returns the contract as data — routes, served methods, pagination
bounds, error codes — generated from the same constants the handlers use, so it
cannot drift from the behaviour it describes.

| Method | Path | What it answers |
| --- | --- | --- |
| `GET` | `/` | Which versions this deployment serves. |
| `GET` | `/v1` | The contract document: routes, served methods, pagination bounds, error codes. |
| `GET` | `/v1/health` | Liveness **plus** a real round trip through the query layer. `503` if it cannot answer. |
| `GET` | `/v1/entities/{id}` | One entity. A merged-away id answers `301` with its redirect chain. |
| `GET` | `/v1/entities/by-slug/{slug}?type=` | One entity by canonical slug. A retired slug answers `301`. |
| `GET` | `/v1/entities/{id}/facts?property=&at=&limit=&offset=` | The canonical view: one selected value per property, with the doc-04 rule that chose it and its correction state. |
| `GET` | `/v1/entities/{id}/relationships?predicate=&direction=&depth=&limit=&offset=` | Bounded traversal (depth 1–4, 500 edges). |
| `GET` | `/v1/search?q=&type=&filter.{field}=&facets=&limit=&offset=` | Faceted search. Exact identifiers lead the results (rule 7). |
| `GET` | `/v1/compare?ids=a,b&properties=&at=` | 2–8 entities aligned on declared field order. |

Only `GET` and `HEAD`, on every path — `/` and `/v1` included. Everything else is
`405` with an `Allow` header. The check is the first thing `dispatch` does, ahead
of parsing and of routing, so read-only is a property of the surface rather than
of the paths someone remembered to guard, and it is an allow-list: a method
nobody has heard of is refused rather than missed.

### Filters

`filter.{field}=a,b` selects values, `filter.{field}.min=` / `.max=` bound a
numeric range, and `filter.{field}.exists=true` (or `=1`, or the bare flag with
no value) asks for the property to be present.

* **An unrecognised value is a `400`, never a dropped filter.** Same reasoning
  as the pagination bounds below: a caller who wrote `exists=yes` and silently
  received the whole unfiltered collection has no signal that the constraint was
  never applied. `exists=false` is refused too rather than inverted — presence is
  the only such operator the query layer models, and composing a negation here
  would make this surface a second place that decides what a filter means.
* **An empty range bound is a `400`, not a zero.** `filter.tonnage.min=` is a
  bound the caller did not supply; reading it as `>= 0` quietly removes every
  entity that has no such fact at all.
* Which fields are filterable is the query layer's decision, not this surface's:
  an undeclared or non-filterable field is `422 UNPROCESSABLE_QUERY`.

### Pagination

`limit` 1–100 (default 25), `offset` 0–10000.

* **Out of range is a `400`, never a clamp.** A client that asks for `limit=1000`
  and silently receives 100 has no way to know it is missing rows, and every
  page it computes afterwards is wrong.
* **Past the end is `200` with an empty `data` array**, `hasMore: false`, and the
  real `total`. Never a `404`: the collection exists, the page is just empty.
* `total` is the size of the whole result set, so a client never has to guess
  whether a short page is the last one.

### Error envelope

Every failure — `400`, `404`, `405`, `422`, `500`, `503` — is:

```json
{ "error": { "code": "ENTITY_NOT_FOUND", "status": 404, "message": "…", "details": { } } }
```

Branch on `code`, not on the status and not on the prose. Every message in a
body is authored in `src/errors.ts` from a fixed set; an unanticipated throwable
collapses to one opaque `INTERNAL_ERROR` and the real error goes to the
`onError` hook, which is where operators — not customers — read it.

`422 UNPROCESSABLE_QUERY` is specifically the query layer refusing a filter the
request parsed correctly (an undeclared field, a range on a string field), as
opposed to `400` for something this surface could not parse at all.

## The two guarantees worth stating

**Rule 1 — nothing unpublishable is served.** Facts are read through
`canonicalFacts`, never `QueryModel.facts`. The latter is the provenance/audit
read: it returns stored fact versions with no rights gate. `canonicalFacts` runs
the doc-04 cascade, whose eligibility pre-filter drops any claim backed only by
`RED`/`UNREVIEWED` sources. A property that survives with nothing selected is
not served either — no selected value is not a published fact. Proved in
`test/routes.test.ts`, which also demonstrates that the unfiltered read *does*
return the blocked claim, so the guarantee is visibly the choice of method.

**The reviewer never reaches a customer.** Every fact leaving this surface goes
through `assertNoReviewerIdentity` against the deployment's declared reviewers.
`test/privacy.test.ts` proves the guard is load-bearing rather than decorative:
the same fact view is serialized twice, once through the raw shared mapper
(where the identity *does* come through) and once through this surface's
boundary (where it throws).

## Deliberately absent

* **No composition root, no CLI, no `main`.** A `QueryModel` is injected. Opening
  a driver here would mean importing `@data-foundry/canonical-store`, and one
  import is all it takes for the next handler to reach through it. Deployment is
  also moot: ADR-0005 records that this repository has no deployment target.
* **No dependencies.** `node:http` and the workspace, nothing else.
* **No auth, no rate limiting, no tenancy — in this package.** `db/migrations`
  gained an account/API-key/tenant schema (`0011_api_tenancy.sql`) and
  `apps/edge` enforces it before this package's handler ever runs — see
  `apps/edge/src/auth.ts`. Nothing changes here: `vertical_id` is still the
  only isolation boundary this layer itself knows about, and it stays that
  way on purpose. Authentication is a concern of the deployment that exposes
  this app to the network, not of the pure request/response contract
  underneath it; the composition root is where a driver may be opened
  (see "No composition root" above), and a tenant lookup is exactly that
  kind of reach-through.

## Known limitations (honest)

* **Comparison cells carry no correction state.** `EntityComparison` does not
  expose it, and deriving it here would mean re-implementing comparison. The
  route says so in its published caveat and points at `/facts`.

Two entries that stood here are gone because the gaps closed, both in the query
layer rather than in a second filter on this surface (rule 5): traversal now
applies the same rule-1 gate fact selection applies, and a fact's `sources` now
names only the publishers its rights-filtered evidence allows. Both are covered
by `test/privacy.test.ts`.

## Running

```sh
pnpm vitest run --project api   # this package
pnpm typecheck                  # whole repo, this package included
```

Tests boot a real PGlite, apply the real `db/migrations`, and use the query
layer's own fixtures. Nothing mocks `QueryModel`: the properties worth testing
here — rule-1 exclusion, redirect following, exact-before-fuzzy ordering — are
properties of the real thing.
