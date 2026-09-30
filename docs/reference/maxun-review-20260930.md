# Maxun review (2026-09-30)

**Asked:** "Review https://github.com/getmaxun/maxun and see what we can use for our tool." Then: "Add anything
that would be valuable."

**Reviewed:** `getmaxun/maxun` at `3b5d0f9` (2026-09-30), read from source. The review covered `maxun-core`
(workflow interpreter and in-page scraper), the server's browser management, the LLM robot builder and the
selector validator.

## Decision

Maxun is a reference only. We do not adopt it, vendor it or depend on it. We rebuilt the two ideas that fill
real gaps inside our existing adapter boundaries. No Maxun code was copied.

| Reason | Detail |
|---|---|
| Licence | The whole repository, `maxun-core` included, is AGPL-3.0-or-later. Data Foundry is MIT and sold as a hosted service. Under AGPL's network clause, linking or vendoring it would pull our service into source-disclosure obligations. |
| Rules | The browser layer ships `puppeteer-extra-plugin-stealth`, randomised fingerprint injection and residential-proxy configuration. Those exist to defeat bot controls. They conflict with rights-gated, supported acquisition (AGENTS.md rules 1 and 6) and with robots handling in `packages/acquisition`. |
| Architecture | A Maxun "robot" is one Playwright step list that navigates and extracts in the same pass. Our pipeline keeps acquisition (immutable artifact), extraction (schema over bytes) and canonical storage apart. Maxun also runs its own Node/Postgres/MinIO platform, scheduler, webhooks and MCP server, which would be duplicate infrastructure beside Cloudflare (ADR-0006) and would split the single source of truth (rule 5). |

## Built from it

1. **Sitemap parsing and target planning.** `packages/acquisition/src/policy/sitemap.ts`
   - `SITEMAP` was already an approved acquisition method served by the HTTP provider, but nothing read the
     fetched XML.
   - `parseSitemapXml` reads `<urlset>` and `<sitemapindex>`, including namespaced tags, entities and CDATA. It
     normalises `lastmod` to UTC, reports every dropped entry, and follows the protocol: entries on another origin
     are dropped. Over 50,000 entries or 50 MB is an error, never a truncation.
   - `planSitemapTargets` keeps only entries inside the source's reviewed result-URL policy and its robots
     snapshot. It skips entries whose `lastmod` is at or before the last *published* cycle and orders the rest
     oldest first.
   - A sitemap larger than the per-run bound is worked through in slices. Each plan returns a `nextCursor` to pass
     back as `after`. Once the cursor comes back null, the plan's `watermark` becomes the next cycle's
     `changedSince`. Entries added or updated mid-cycle sort after the cursor, so they are still reached.
   - `lastmod` values that don't exist on the calendar (for example `2026-02-30`) are reported and treated as
     undated, not rolled over to a nearby date.
   - A sitemap plan is incremental work. It never authorises omission-based retirement.
   - Maxun's crawl mode seeds from `/sitemap.xml` in a similar way. Robots crawl-delay, the other half of that
     feature, already existed here (`policy/robots.ts`, `policy/rate-limit.ts`).
2. **Record-selector suggestions.** `packages/extraction/src/record-selector-suggest.ts`
   - This is the deterministic counterpart to Maxun's `scrapeListAuto` repeated-element heuristic. Maxun's
     version measures rendered element area; ours works on the stored HTML alone.
   - `suggestHtmlRecordSelectors` finds sibling groups that share a tag, classes and child shape. It ignores groups
     nested inside another repeated group, because those are the fields of each record. Each suggestion must
     select exactly its group, and suggestions are ranked by size, shape consistency and text fields per member.
   - Use it when drafting a `{ kind: 'css' }` record selector for a new HTML source. A suggestion is a draft: it is
     accepted only when the schema built from it passes the source's fixture and golden-record tests. It never runs
     at ingestion time.

Both are pure functions with tests (`packages/acquisition/test/sitemap.test.ts`,
`packages/extraction/test/record-selector-suggest.test.ts`). Neither is wired into a scheduled runner yet, because
no approved source needs them today. Wiring one in is a per-source acquisition-policy change, following
[`source-onboarding.md`](../source-onboarding.md).

## Deferred until a real source needs it

- **Declarative pagination.** Maxun supports next-button, load-more and scroll pagination, and detects the last
  page by comparing content signatures. Our Browser Run adapter uses the Cloudflare `/crawl` API, which follows
  links but does not click. Build pagination when a qualified source's records are reachable only through
  pagination.
  - Build it as a versioned acquisition-policy field: next-link selector or URL template, a page bound, and a stop
    rule on an unchanged content digest.
  - Store every page as its own artifact within the existing ingestion bounds.
  - A paginated listing is a complete snapshot only when the last page is proven reached.
- **Model-proposed field selectors, validated against fixtures.** Maxun's `selectorValidator.ts` tests
  LLM-proposed selectors against the live page. The equivalent here would have the local collector (ADR-0017)
  propose `css` or `html_table_label` field selectors, accepted only if the extraction schema reproduces the
  fixture values exactly. Consider this once the scout starts onboarding HTML sources in volume.

## Rejected

Stealth and fingerprinting, proxy rotation, the no-code recorder UI, Maxun's scheduler, webhooks and MCP server,
and its AGPL code in any form.
