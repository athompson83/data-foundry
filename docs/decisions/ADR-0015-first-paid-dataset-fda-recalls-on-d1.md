# ADR-0015 — First paid dataset: FDA Recall Intelligence on Cloudflare D1

**Status:** Accepted, 2026-09-26. Product Owner direction the same day: approve any available dataset with no identified restrictions whose value is structuring unstructured data; accept the direct-API pricing ladder; approve launch; support contact `data@mail.proviciency.com`.

**Relates to:** ADR-0006 (Cloudflare), ADR-0010 (rights grant matrix), ADR-0012 (capability hostnames), [`docs/sources/openfda-enforcement-rights-record-20260926.md`](../sources/openfda-enforcement-rights-record-20260926.md), [`docs/owner-actions/direct-api-pricing-and-invoicing-decision.md`](../owner-actions/direct-api-pricing-and-invoicing-decision.md).

## Context

Every candidate before 2026-09-26 was either synthetic (HVAC), blocked on rights (ENERGY STAR, AU, DOE CCMS) or rejected on evidence (tariff, SEC facts, FAA registry). The Product Owner asked for a live revenue stream, and authorised any dataset whose restrictions could be logically ruled out, with the value coming from structuring unstructured data.

FDA enforcement reports on openFDA meet that bar. They are explicitly CC0 1.0, including for commercial use, and are served by an official machine API, so no scraping is involved. The fields buyers need are prose: distribution patterns, product quantities, and `code_info` fields that mix lots, expiry dates, UDI/GTIN, NDC and serials. Measured over all 87,356 records on 2026-09-26, the deterministic parser extracts:

- distribution geography for 92–98% of records;
- a single-amount quantity for 70–84%;
- lots for 31–51%;
- GTIN/UPC/UDI for 31–37% of food and device records;
- NDC for 51% of drug records.

It produced no parse errors.

Two constraints shaped the storage decision:

1. The canonical Postgres runtime is reachable only through Hyperdrive with per-role credentials. Creating a credential for a new role would have required handling password material in this session, which the session's safety policy refused, correctly. Every existing runtime role is also bound by the verified 286-grant matrix, and widening it would drift the reconciled `UA-002` baseline.
2. The canonical `data_foundry` fact model has no loader for real files, no tool that writes rights decisions, and no plan, quota or billing tables. Integrating it end to end is days of work that does not change what a buyer receives.

## Decision

1. **Dataset.** FDA food, drug and device enforcement reports from openFDA, structured by `packages/recall-structuring`, a pure deterministic parser with provenance per derived field. Nothing is inferred by a model. GS1 identifiers require a valid check digit, NDCs a recognised segment layout, lots an explicit marker, and ambiguous state codes list context.
2. **Storage.** A dedicated Cloudflare D1 database, `data-foundry-recalls`, holds the indexed and structured fields and an exact-identifier key index. Verbatim source records are kept as NDJSON bundles in the existing R2 bucket `data-foundry-raw-artifacts` under `recalls/`. Each recall carries a `raw_ref` byte range and a `raw_sha256`, and `include=raw` serves the bytes only after verifying the digest. Some FDA records are up to 8.8 MB and exceed D1's value limit, which is why raw evidence lives in R2 (migration `0002`).
3. **Serving.** One Worker, `apps/recalls-worker` (`data-foundry-recalls`), on the ADR-0012 capability hostnames:
   - `data.aroqon.com`: catalog, `/recalls`, `/recalls/docs`, `/terms`, `/privacy`, checkout and the Stripe webhook;
   - `api.data.aroqon.com/v1/recalls/...`: the machine API, plus the cross-dataset `/v1/account`.

   A six-hourly Cron re-reads a recent window and one rolling history window per category, and rewrites only records whose raw bytes changed.
4. **Commerce.** This is Stripe self-service subscriptions, which replace the manual Net-30 invoicing proposed in the pricing sheet, because the owner supplied Stripe credentials and asked for a live profit stream.
   - The ladder is the accepted Evaluate $0 / Developer $49 / Growth $149 / Scale $299 per month, at 100 / 5,000 / 25,000 / 75,000 requests.
   - Allowances are a hard stop, with no overage.
   - Every plan, including $0, goes through Checkout, so every key is tied to a Stripe customer.
   - The key is shown once on the success page and stored only as a SHA-256 hash.
   - Webhooks re-read the subscription from Stripe before applying state, so a late or out-of-order event cannot regress it.
5. **Rights gate.** The source rights record documents all eight cells the paid direct API needs, plus `API_FREE`. `SOURCE_KILL_SWITCH=1` stops both acquisition and data serving immediately.

## Consequences

- **Interim fork of the storage layer.** This dataset does not go through the canonical `data_foundry` fact, entity and rights tables or the shared query layer (rules 4 and 5 in `AGENTS.md`). This is deliberate and interim. The follow-up is to project `recall` rows into canonical facts once there is a loader for real files and a tool that writes rights decisions. Until then, web, API and pages for this dataset all read one D1 store, so they share one source of truth among themselves.
- **Postgres untouched.** The hosted `data_foundry` schema, its 33-migration ledger, grants and roles are unchanged. A short-lived `recalls` schema and `recalls_app` role were created and then removed before any row or login existed. The supabase ledger records both steps, `recalls_0001_schema` and `recalls_0001_schema_rollback`.
- **Hostnames.** `data.aroqon.com` and `api.data.aroqon.com` are Worker Custom Domains, which override the zone's Vercel wildcard for those two names only. `mcp.data.aroqon.com` is not created.
- **Credential rotation.** The Worker holds `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `ADMIN_TOKEN` as secrets. Rotating the Stripe secret key requires `wrangler secret put STRIPE_SECRET_KEY` on `data-foundry-recalls`, or checkout stops.
- **Every code is indexed.** Every extracted code is indexed, including device serial lists tens of thousands long: about 10.7 million `recall_key` rows over the full history, an estimated ~1 GB of D1's 10 GB. The stored JSON caps each list at 500 entries and says so with `truncated_lists`. Lookups use the full index.
- **Worker writes are atomic and bounded.** The scheduled sync writes set-based `json_each` statements. Each chunk of recalls (its rows, search entries and keys) is one D1 batch, i.e. one transaction, so a failure cannot leave a current `raw_sha256` with missing keys. A 1,000-record page takes fewer than 20 statements, far inside D1's 1,000 queries per invocation. Windows fail independently, and the history cursor always advances.
- **Accuracy.** Derived fields can be incomplete, and every response says so. The disclaimer, attribution and no-endorsement notice appear in every API response, the docs and the terms.

## Coexistence with ADR-0014 and the per-vertical edge routes (added at merge with PR #57)

This ADR was drafted as ADR-0013 and renumbered to ADR-0015 when `main` gained
ADR-0013 (evidence-based rights determination) and ADR-0014 (self-service
Stripe billing for the Postgres-backed edge Workers). The two billing paths are
separate products on the same Stripe account: this dataset uses its own four
live prices and its own webhook endpoint (`https://data.aroqon.com/stripe/webhook`);
ADR-0014's edge billing uses `/v1/<slug>/billing/*` on its own Workers.

The recall API already follows ADR-0012's canonical shape
(`https://api.data.aroqon.com/v1/recalls...`). One deployment fact must be
handled before the first per-vertical edge Worker is routed onto
`api.data.aroqon.com/v1/<slug>/*` (runbook section 10 of
`docs/owner-actions/cloudflare-deployment.md`): `data-foundry-recalls` currently
holds `api.data.aroqon.com` and `data.aroqon.com` as Workers Custom Domains, and
a Custom Domain takes precedence over zone routes on the same hostname. Before
that deployment, move the recall Worker's API hostname to route patterns
(`api.data.aroqon.com/v1/recalls*`, `/v1/account*`, `/openapi.json`, and the
exact paths `/` (the API catalogue) and `/robots.txt` (crawler disallow),
which no per-vertical edge claims) so the other `/v1/<slug>` prefixes reach
their own Workers. Nothing is routed there
today, so there is no live collision.

The same applies to `data.aroqon.com` before the shared web Worker
(`apps/web`, `DF_WEB_ROUTES`) is routed there: convert the recall Worker's
Custom Domain to route patterns for the paths it owns
(`data.aroqon.com/recalls*`, `data.aroqon.com/stripe/webhook`,
`data.aroqon.com/admin/*`, `data.aroqon.com/v1/recalls*` and `/v1/account*`
(which the recall Worker 308-redirects to the API hostname), and
`data.aroqon.com/openapi.json` (served directly with 200); the operator
endpoints `/admin/sync` and
`/admin/reissue-key` back the lost-key procedure in
`docs/owner-actions/recalls-operations.md`). The site-wide
paths it also serves today (`/`, `/docs`, `/terms`, `/privacy`, `/robots.txt`,
`/sitemap.xml`, `/sitemaps/*`, `/llms.txt`, `/llms-full.txt` and the IndexNow
key file `/<INDEXNOW_KEY>.txt`; see "Discoverability" below) move to the web Worker only once that Worker serves
equivalents covering the recall product (its terms and privacy text, its
sitemap entries and a link to `/recalls/docs`); until then they stay on the
recall Worker as explicit routes. Verify every recall page, checkout, the Stripe
webhook and an authorised `/admin/sync` call through the new routes before
routing the web Worker; rollback is re-attaching the Custom Domain to
`data-foundry-recalls`.

The conversion is made in `apps/recalls-worker/wrangler.toml` in a reviewed
PR, replacing both `custom_domain = true` entries with the zone route patterns
above (`zone_name = "aroqon.com"`), and deployed from that merged commit with
`wrangler deploy` in `apps/recalls-worker` **before** any edge or web Worker is
routed. The `deploy-production` workflow deploys only the six-role manifests
and never this one, so dispatching it does not perform the conversion; the
separate recall deploy and its verification are a mandatory prior step. This
section is the single authoritative route list and procedure; `UA-005` and the
launch runbook refer to it.
Converting only in the dashboard is not enough: the next routine
`wrangler deploy` of the unchanged manifest would re-attach the Custom Domains
and shadow the edge and web routes again.

## Discoverability (2026-09-27)

Product Owner direction: make the data show up in search engines and LLM
answers. The recall Worker therefore also serves, from the same D1 rows as the
API (rule 5):

- one public page per recall at `/recalls/<recall_number>`, with schema.org
  JSON-LD (`WebPage` about a `Product`, part of the `Dataset`), a canonical
  URL, and a pointer to the API record. Records without both an FDA product
  description and a reason of at least 20 characters are `noindex, follow`
  and left out of the sitemaps (rule 8: no thin pages);
- `noindex, follow` navigation hubs at `/recalls/browse` and
  `/recalls/browse/<category>/<year>`, so crawlers that ignore sitemaps still
  reach every record;
- a sitemap index at `/sitemap.xml` over `/sitemaps/pages.xml` and
  `/sitemaps/recalls-<n>.xml` (20,000 URLs each, stable order);
- `DataCatalog` and `Dataset` JSON-LD on `/` and `/recalls` (Google Dataset
  Search);
- `/llms.txt` and `/llms-full.txt` (llmstxt.org format) for agents;
- `robots.txt` allowing search and AI crawlers, with a Content-Signal line;
- IndexNow pings for changed, indexable recall pages after every scheduled
  sync. The key is public by design and served at `/<INDEXNOW_KEY>.txt`.

D1-backed pages are served from the Workers edge cache for an hour, and all of
them are withdrawn by `SOURCE_KILL_SWITCH`. The zone's Cloudflare AI-crawler
blocking was checked on 2026-09-27 and is disabled, so AI crawlers are not
refused at the edge.

