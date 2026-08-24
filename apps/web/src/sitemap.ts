/**
 * Sitemaps, generated from the same gate every page itself is rendered
 * against — `include_only_indexable: true` in `seo.yaml` is enforced here by
 * calling `evaluateGate` per candidate URL, not by a separate "is this thing
 * good" heuristic that could drift from what the page actually decided.
 *
 * Single-shard only: `max_urls_per_file` sharding (`entities-{n}.xml`) is not
 * implemented — every deployment today is far under 45,000 URLs per segment,
 * and building pagination for a limit nothing is near is exactly the kind of
 * complexity doc 07 warns against manufacturing ahead of need. Documented as a
 * known gap rather than silently only-ever-emitting page 1 of something larger.
 *
 * Per-entity fan-out is bounded (see concurrency.ts), not eliminated: each
 * hit still costs `computeEntitySignals` a `canonicalFacts` call, and
 * `canonicalStore.canonicalView`/`selectFact` (packages/canonical-store)
 * issues one query per distinct property on the entity — for an
 * `equipment_model`-shaped entity (~12 properties) that is roughly a dozen
 * sequential queries PER entity before this module even runs its own
 * `provenanceCoverage` call. A batch/aggregate fetch for that would live in
 * `canonical-store` itself, which is a shared package used by `apps/api`,
 * `apps/mcp`, `services/export-builder` and `services/ingest-worker` too —
 * out of scope here, and left as a follow-up rather than special-cased for
 * this one caller.
 *
 * Bounded concurrency cuts wall-clock per request; it does not cut total
 * query volume across repeated crawls. Cloudflare Workers do not cache a
 * Worker's own response from its `Cache-Control` header alone (confirmed
 * against Cloudflare's current docs, Aug 2026) — the existing header on
 * `xmlResponse` (http.ts) states an intent this module cannot itself
 * fulfil; real edge caching needs an explicit `caches.default.put()`/`.match()`
 * call, which is a bigger, separately-testable change (this repo's test
 * harness has no Miniflare/workerd runtime, so a Cache API integration needs
 * its own injectable seam, the same way `composition.ts`'s `openDriver`
 * lets tests substitute PGlite for a real connection). Left as a follow-up
 * rather than folded into this fix.
 */
import { computeEntitySignals, computeVerticalDatasetSignals, evaluateGate } from './gates.js';
import { sitemapSegmentUrl } from './router.js';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from './concurrency.js';
import type { VerticalDeployment, WebDeployment } from './composition.js';
import type { Entity } from '@data-foundry/canonical-schema';

const MAX_ENTITIES_PER_SEGMENT = 2000;

/**
 * `&`, `<` etc. in a `loc` value break the surrounding XML for the WHOLE
 * document, not just one entry — a crawler that fails to parse the sitemap
 * gets none of it. `canonical_slug` is ingested, third-party-sourced data by
 * the time it reaches here, not something this module may assume is already
 * XML-safe.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(loc: string): string {
  return `<url><loc>${escapeXml(loc)}</loc></url>`;
}

function urlset(entries: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

/** Every (vertical, segment) this deployment could serve, whether or not it has any URLs yet. */
export function sitemapIndexXml(deployment: WebDeployment): string {
  const entries: string[] = [];
  for (const vertical of deployment.verticals.values()) {
    for (const segment of vertical.runtime.seo.sitemaps.segments) {
      const path = segment.path.replace('{n}', '1');
      const loc = `${deployment.publicOrigin}${sitemapSegmentUrl(vertical.runtime.seo.url_prefix, path)}`;
      entries.push(`<sitemap><loc>${escapeXml(loc)}</loc></sitemap>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
}

/**
 * `entity` is the search hit's own entity — `SearchHit.entity` already
 * carries `quality_score`/`updated_at`, so this never re-fetches an entity
 * the caller just got back from `search()`. A second `getEntity` per hit
 * would add a full extra round trip on top of the several `computeEntitySignals`
 * already needs, for a value already in hand.
 */
async function isIndexable(vertical: VerticalDeployment, entity: Entity, now: Date): Promise<boolean> {
  const pageClass = vertical.runtime.seo.page_classes.find((pc) => pc.entity_type === entity.entity_type);
  if (pageClass === null || pageClass === undefined) return false;
  const gate = vertical.runtime.seo.quality_gates[pageClass.quality_gate];
  if (gate === undefined) return false;
  const critical = vertical.runtime.critical_properties[entity.entity_type] ?? [];
  const signals = await computeEntitySignals(
    vertical.queryModel,
    entity.id,
    entity.quality_score,
    entity.updated_at,
    critical,
    {},
    now,
  );
  // `min_unique_content_words` is not measured here — computing it would mean
  // rendering the full page, which is exactly the O(n) full-render cost this
  // module exists to avoid for a sitemap listing. A gate that declares it
  // fails closed here (see gates.ts's UNMEASURED convention) and is decided
  // for real when the page itself is requested; a sitemap is a recommendation,
  // never the source of truth for what serves.
  return evaluateGate(gate, signals).passed;
}

/**
 * One segment's URLs, gate-filtered. `segmentId` is `seo.yaml`'s own
 * `sitemaps.segments[].id` (e.g. `entities`, `manufacturers`, `datasets`).
 */
export async function sitemapSegmentXml(
  vertical: VerticalDeployment,
  publicOrigin: string,
  segmentId: string,
  now: Date,
): Promise<string> {
  const seo = vertical.runtime.seo;
  const pageClasses = seo.page_classes.filter((pc) => pc.sitemap === segmentId);
  const entries: string[] = [];

  for (const pageClass of pageClasses) {
    if (pageClass.entity_type === undefined) {
      // Static page classes sharing the `datasets` segment. `docs_api_mcp`
      // declares `quality_gate: none` — "no data gate applies" per seo.yaml,
      // so it is unconditionally indexable. `dataset_landing` declares
      // `quality_gate: dataset`, which DOES have thresholds
      // (min_entities/min_evidence_coverage/min_distinct_sources) — it must
      // be evaluated the same way `renderDatasetLanding` evaluates it, or the
      // sitemap can recommend a page the page itself marks `noindex`.
      if (pageClass.id === 'dataset_landing') {
        const gate = seo.quality_gates[pageClass.quality_gate];
        const signals = await computeVerticalDatasetSignals(vertical.queryModel, vertical.verticalId);
        if (gate !== undefined && evaluateGate(gate, signals).passed) {
          entries.push(urlEntry(`${publicOrigin}${seo.url_prefix}`));
        }
      }
      if (pageClass.id === 'docs_api_mcp') entries.push(urlEntry(`${publicOrigin}${seo.url_prefix}/docs`));
      continue;
    }

    const result = await vertical.queryModel.search({
      vertical_id: vertical.verticalId,
      entity_type: pageClass.entity_type as never,
      limit: MAX_ENTITIES_PER_SEGMENT,
    });
    // Bounded, not serial and not unbounded: up to MAX_ENTITIES_PER_SEGMENT
    // hits, each needing several sequential DB round trips inside
    // computeEntitySignals, would either make one request take far too long
    // (serial) or flood the connection pool (unbounded Promise.all). See
    // concurrency.ts for why DEFAULT_CONCURRENCY is what it is.
    const indexable = await mapWithConcurrency(result.hits, DEFAULT_CONCURRENCY, (hit) =>
      isIndexable(vertical, hit.entity, now),
    );
    for (const [i, hit] of result.hits.entries()) {
      if (!indexable[i]) continue;
      // A function replacer, not a string one: String.replace's string form
      // treats `$&`/`$'`/`` $` `` in the replacement as special patterns, so a
      // slug containing a literal `$` would corrupt the URL. A function
      // replacer's return value is inserted literally.
      const path = pageClass.path.replace('{canonical_slug}', () => hit.entity.canonical_slug);
      entries.push(urlEntry(`${publicOrigin}${path}`));
    }
  }
  return urlset(entries);
}
