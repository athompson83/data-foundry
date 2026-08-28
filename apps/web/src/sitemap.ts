/**
 * Sitemap generation is a distribution surface, not a reflection of every
 * public page. An entity must independently pass PUBLIC_WEB and SEARCH_INDEX
 * rights plus the same quality gate used by its public page.
 */
import type { Entity } from '@data-foundry/canonical-schema';
import type { SurfaceQueryModel } from '@data-foundry/query-model';
import { computeEntitySignals, computeVerticalDatasetSignals, evaluateGate } from './gates.js';
import { sitemapSegmentUrl } from './router.js';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from './concurrency.js';
import type { RequestWebDeployment, VerticalDeployment } from './composition.js';
import type { PageClass, QualityGate } from './seo.js';
import {
  datasetRenderedCountsCovered,
  loadEntityContentIntersection,
  verticalPublicationEligibility,
} from './publication.js';

/** The canonical query layer clamps searches to 200; never pretend a larger request bypasses it. */
const SEARCH_PAGE_SIZE = 200;

export class SitemapConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SitemapConfigurationError';
  }
}

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

function urlset(locations: readonly string[]): string {
  const entries = locations.map(urlEntry);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

function checkedFileLimit(vertical: VerticalDeployment): number {
  const limit = vertical.runtime.seo.sitemaps.max_urls_per_file;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50_000) {
    throw new SitemapConfigurationError(
      `sitemaps.max_urls_per_file must be an integer from 1 through 50000; received ${limit}.`,
    );
  }
  return limit;
}

async function allVisibleEntities(
  model: SurfaceQueryModel,
  vertical: VerticalDeployment,
  entityType: string,
): Promise<readonly Entity[]> {
  const entities: Entity[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const requestedOffset = offset;
    const result = await model.search({
      vertical_id: vertical.verticalId,
      entity_type: entityType as never,
      limit: SEARCH_PAGE_SIZE,
      offset: requestedOffset,
    });
    if (result.offset !== requestedOffset) {
      throw new SitemapConfigurationError(
        `Sitemap pagination could not advance: requested offset ${requestedOffset}, but the query layer returned ${result.offset}.`,
      );
    }
    entities.push(...result.hits.map((hit) => hit.entity));
    total = result.total;
    if (result.hits.length === 0) break;
    offset += result.hits.length;
  }
  return entities;
}

async function entitySignals(
  model: SurfaceQueryModel,
  vertical: VerticalDeployment,
  entity: Entity,
  gate: QualityGate,
  now: Date,
) {
  const critical = vertical.runtime.critical_properties[entity.entity_type] ?? [];
  const base = await computeEntitySignals(
    model,
    entity.id,
    entity.quality_score,
    entity.updated_at,
    critical,
    {},
    now,
  );
  if (gate.min_related_entities === undefined) return base;
  const traversal = await model.relationships({
    entity_id: entity.id,
    direction: 'both',
    depth: 1,
    limit: 500,
  });
  return { ...base, related_entities: traversal.edges.length };
}

async function isEntityIndexable(
  vertical: VerticalDeployment,
  pageClass: PageClass & { readonly route_kind: 'entity_detail' },
  entity: Entity,
  now: Date,
): Promise<boolean> {
  const content = await loadEntityContentIntersection(vertical, entity);
  if (!content.searchIndexCoversRenderedContent) return false;
  const gate = vertical.runtime.seo.quality_gates[pageClass.quality_gate];
  if (gate === undefined) return false;

  const [publicSignals, indexSignals] = await Promise.all([
    entitySignals(vertical.publicQueryModel, vertical, entity, gate, now),
    entitySignals(vertical.searchIndexQueryModel, vertical, entity, gate, now),
  ]);
  return evaluateGate(gate, publicSignals).passed && evaluateGate(gate, indexSignals).passed;
}

async function collectEntityPageLocations(
  vertical: VerticalDeployment,
  publicOrigin: string,
  pageClass: PageClass & { readonly route_kind: 'entity_detail' },
  now: Date,
): Promise<readonly string[]> {
  const entities = await allVisibleEntities(
    vertical.publicQueryModel,
    vertical,
    pageClass.entity_type,
  );
  const indexable = await mapWithConcurrency(entities, DEFAULT_CONCURRENCY, (entity) =>
    isEntityIndexable(vertical, pageClass, entity, now),
  );
  const locations: string[] = [];
  for (const [index, entity] of entities.entries()) {
    if (!indexable[index]) continue;
    const path = pageClass.path.replace('{canonical_slug}', () => entity.canonical_slug);
    locations.push(`${publicOrigin}${path}`);
  }
  return locations;
}

async function collectStaticLocation(
  vertical: VerticalDeployment,
  publicOrigin: string,
  pageClass: PageClass & { readonly route_kind: 'static' },
): Promise<readonly string[]> {
  if (pageClass.id === 'docs_api_mcp') {
    return (await verticalPublicationEligibility(vertical)).searchIndex
      ? [`${publicOrigin}${vertical.runtime.seo.url_prefix}/docs`]
      : [];
  }
  if (pageClass.id !== 'dataset_landing') return [];

  const gate = vertical.runtime.seo.quality_gates[pageClass.quality_gate];
  if (gate === undefined) return [];
  const [publicSignals, indexSignals] = await Promise.all([
    computeVerticalDatasetSignals(vertical.publicQueryModel, vertical.verticalId),
    computeVerticalDatasetSignals(vertical.searchIndexQueryModel, vertical.verticalId),
  ]);
  const contentCovered = await datasetRenderedCountsCovered(vertical);
  return contentCovered &&
    evaluateGate(gate, publicSignals).passed && evaluateGate(gate, indexSignals).passed
    ? [`${publicOrigin}${vertical.runtime.seo.url_prefix}`]
    : [];
}

async function collectSegmentLocations(
  vertical: VerticalDeployment,
  publicOrigin: string,
  segmentId: string,
  now: Date,
): Promise<readonly string[]> {
  const locations: string[] = [];
  for (const pageClass of vertical.runtime.seo.page_classes) {
    if (pageClass.sitemap !== segmentId) continue;
    switch (pageClass.route_kind) {
      case 'static':
        locations.push(...(await collectStaticLocation(vertical, publicOrigin, pageClass)));
        break;
      case 'entity_detail':
        locations.push(
          ...(await collectEntityPageLocations(vertical, publicOrigin, pageClass, now)),
        );
        break;
      case 'relationship':
        // Relationship indexing also needs terminal-page indexability and
        // rendered unique content. Until those signals are shared with the
        // page renderer, omission is the only honest result.
        break;
      case 'comparison':
      case 'filtered_collection':
        // These spaces are not finitely enumerable yet and their demand
        // signals are intentionally unmeasured. Fail closed.
        break;
    }
  }
  return [...new Set(locations)];
}

/** Build the global index after measuring actual authorized shard counts. */
export async function sitemapIndexXml(
  deployment: RequestWebDeployment,
  now = new Date(),
): Promise<string> {
  const entries: string[] = [];
  for (const vertical of deployment.verticals.values()) {
    const eligibility = await verticalPublicationEligibility(vertical);
    if (!eligibility.publicWeb || !eligibility.searchIndex) continue;
    const limit = checkedFileLimit(vertical);
    for (const segment of vertical.runtime.seo.sitemaps.segments) {
      const locations = await collectSegmentLocations(
        vertical,
        deployment.publicOrigin,
        segment.id,
        now,
      );
      const shardCount = Math.max(1, Math.ceil(locations.length / limit));
      if (shardCount > 1 && !segment.path.includes('{n}')) {
        throw new SitemapConfigurationError(
          `Sitemap segment "${segment.id}" exceeds max_urls_per_file but its path has no {n} shard placeholder.`,
        );
      }
      for (let shard = 1; shard <= shardCount; shard += 1) {
        const path = segment.path.replace('{n}', String(shard));
        const loc = `${deployment.publicOrigin}${sitemapSegmentUrl(vertical.runtime.seo.url_prefix, path)}`;
        entries.push(`<sitemap><loc>${escapeXml(loc)}</loc></sitemap>`);
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
}

/** One authorized, quality-gated sitemap shard. */
export async function sitemapSegmentXml(
  vertical: VerticalDeployment,
  publicOrigin: string,
  segmentId: string,
  now: Date,
  shard = 1,
): Promise<string> {
  const limit = checkedFileLimit(vertical);
  const eligibility = await verticalPublicationEligibility(vertical);
  if (!eligibility.publicWeb || !eligibility.searchIndex) return urlset([]);
  if (!Number.isSafeInteger(shard) || shard < 1) return urlset([]);
  const segment = vertical.runtime.seo.sitemaps.segments.find((entry) => entry.id === segmentId);
  if (segment === undefined) return urlset([]);
  if (shard > 1 && !segment.path.includes('{n}')) return urlset([]);

  const locations = await collectSegmentLocations(vertical, publicOrigin, segmentId, now);
  const start = (shard - 1) * limit;
  return urlset(locations.slice(start, start + limit));
}
