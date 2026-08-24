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
 */
import { computeEntitySignals, computeVerticalDatasetSignals, evaluateGate } from './gates.js';
import type { VerticalDeployment, WebDeployment } from './composition.js';

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
      const loc = `${deployment.publicOrigin}${vertical.runtime.seo.url_prefix}${path}`;
      entries.push(`<sitemap><loc>${escapeXml(loc)}</loc></sitemap>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
}

async function isIndexable(vertical: VerticalDeployment, entityId: Parameters<VerticalDeployment['queryModel']['getEntity']>[0], entityType: string, now: Date): Promise<boolean> {
  const pageClass = vertical.runtime.seo.page_classes.find((pc) => pc.entity_type === entityType);
  if (pageClass === null || pageClass === undefined) return false;
  const gate = vertical.runtime.seo.quality_gates[pageClass.quality_gate];
  if (gate === undefined) return false;
  const view = await vertical.queryModel.getEntity(entityId);
  if (view === null) return false;
  const critical = vertical.runtime.critical_properties[entityType] ?? [];
  const signals = await computeEntitySignals(
    vertical.queryModel,
    entityId,
    view.entity.quality_score,
    view.entity.updated_at,
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
    for (const hit of result.hits) {
      if (!(await isIndexable(vertical, hit.entity.id, hit.entity.entity_type, now))) continue;
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
