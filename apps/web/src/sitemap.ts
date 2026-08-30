/**
 * Sitemap generation is a distribution surface, not a reflection of every
 * public page. An entity must independently pass PUBLIC_WEB and SEARCH_INDEX
 * rights plus the same quality gate used by its public page.
 */
import type { Entity } from '@data-foundry/canonical-schema';
import type { SurfaceQueryModel } from '@data-foundry/query-model';
import {
  computeEntitySignals,
  computeVerticalDatasetSignalsForEntities,
  evaluateGate,
} from './gates.js';
import { sitemapSegmentUrl } from './router.js';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from './concurrency.js';
import type { RequestWebDeployment, VerticalDeployment } from './composition.js';
import type { PageClass, QualityGate } from './seo.js';
import {
  loadEntityContentIntersection,
  verticalPublicationEligibility,
  type VerticalPublicationEligibility,
} from './publication.js';
import {
  scanSurfaceEntityPages,
  SITEMAP_ENTITY_SCAN_PAGE_SIZE,
} from './entity-scan.js';
import {
  SitemapScanBudget,
  validatedSitemapScanPageBudget,
} from './sitemap-capacity.js';

const MAX_DATASET_SIGNAL_ENTITIES = 200;

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

function checkedScanPageBudget(vertical: VerticalDeployment): number {
  try {
    return validatedSitemapScanPageBudget(
      vertical.runtime.seo.sitemaps.max_scan_pages_per_request,
    );
  } catch (error) {
    throw new SitemapConfigurationError(
      error instanceof Error ? error.message : 'Invalid sitemap scan-page budget.',
    );
  }
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

type AddLocation = (location: string) => boolean;

async function collectEntityPageLocations(
  vertical: VerticalDeployment,
  publicOrigin: string,
  pageClass: PageClass & { readonly route_kind: 'entity_detail' },
  now: Date,
  budget: SitemapScanBudget,
  add: AddLocation,
): Promise<boolean> {
  for await (const entities of scanSurfaceEntityPages(
    vertical.publicQueryModel,
    {
      vertical_id: vertical.verticalId,
      entity_type: pageClass.entity_type as never,
    },
    budget,
  )) {
    const indexable = await mapWithConcurrency(
      entities,
      DEFAULT_CONCURRENCY,
      (entity) => isEntityIndexable(vertical, pageClass, entity, now),
    );
    for (const [index, entity] of entities.entries()) {
      if (!indexable[index]) continue;
      const path = pageClass.path.replace('{canonical_slug}', () => entity.canonical_slug);
      if (add(`${publicOrigin}${path}`)) return true;
    }
  }
  return false;
}

interface DatasetSurfaceSnapshot {
  readonly signals: Awaited<ReturnType<typeof computeVerticalDatasetSignalsForEntities>>;
  readonly identities: ReadonlySet<string>;
}

async function datasetSurfaceSnapshot(
  model: SurfaceQueryModel,
  vertical: VerticalDeployment,
  budget: SitemapScanBudget,
): Promise<DatasetSurfaceSnapshot> {
  const sampled: Entity[] = [];
  const identities = new Set<string>();
  let total = 0;
  for await (const entities of scanSurfaceEntityPages(
    model,
    { vertical_id: vertical.verticalId },
    budget,
  )) {
    total += entities.length;
    for (const entity of entities) {
      identities.add(JSON.stringify([entity.id, entity.entity_type]));
      if (sampled.length < MAX_DATASET_SIGNAL_ENTITIES) sampled.push(entity);
    }
  }
  return {
    signals: await computeVerticalDatasetSignalsForEntities(model, sampled, total),
    identities,
  };
}

function sameIdentitySet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((identity) => right.has(identity));
}

async function collectStaticLocation(
  vertical: VerticalDeployment,
  publicOrigin: string,
  pageClass: PageClass & { readonly route_kind: 'static' },
  budget: SitemapScanBudget,
  knownEligibility: VerticalPublicationEligibility | null,
): Promise<readonly string[]> {
  const eligibility = knownEligibility ?? await verticalPublicationEligibility(vertical, budget);
  if (!eligibility.publicWeb || !eligibility.searchIndex) return [];

  if (pageClass.id === 'docs_api_mcp') {
    return [`${publicOrigin}${vertical.runtime.seo.url_prefix}/docs`];
  }
  if (pageClass.id !== 'dataset_landing') return [];

  const gate = vertical.runtime.seo.quality_gates[pageClass.quality_gate];
  if (gate === undefined) return [];
  const [publicSnapshot, indexSnapshot] = await Promise.all([
    datasetSurfaceSnapshot(vertical.publicQueryModel, vertical, budget),
    datasetSurfaceSnapshot(vertical.searchIndexQueryModel, vertical, budget),
  ]);
  return sameIdentitySet(publicSnapshot.identities, indexSnapshot.identities) &&
    evaluateGate(gate, publicSnapshot.signals).passed &&
    evaluateGate(gate, indexSnapshot.signals).passed
    ? [`${publicOrigin}${vertical.runtime.seo.url_prefix}`]
    : [];
}

async function collectSegmentLocations(
  vertical: VerticalDeployment,
  publicOrigin: string,
  segmentId: string,
  now: Date,
  budget: SitemapScanBudget,
  knownEligibility: VerticalPublicationEligibility | null,
  stopAfter?: number,
): Promise<readonly string[]> {
  const locations = new Set<string>();
  const add: AddLocation = (location) => {
    locations.add(location);
    return stopAfter !== undefined && locations.size >= stopAfter;
  };

  for (const pageClass of vertical.runtime.seo.page_classes) {
    if (pageClass.sitemap !== segmentId) continue;
    switch (pageClass.route_kind) {
      case 'static': {
        const statics = await collectStaticLocation(
          vertical,
          publicOrigin,
          pageClass,
          budget,
          knownEligibility,
        );
        for (const location of statics) if (add(location)) return [...locations];
        break;
      }
      case 'entity_detail':
        if (
          await collectEntityPageLocations(
            vertical,
            publicOrigin,
            pageClass,
            now,
            budget,
            add,
          )
        ) return [...locations];
        break;
      case 'relationship':
        // Terminal-page indexability and rendered uniqueness are not yet
        // measurable through the shared renderer. Omission remains fail closed.
        break;
      case 'comparison':
      case 'filtered_collection':
        // These spaces are not finitely enumerable and demand is unmeasured.
        break;
    }
  }
  return [...locations];
}

function shardStart(shard: number, limit: number): number | null {
  if (!Number.isSafeInteger(shard) || shard < 1) return null;
  if (shard - 1 > Math.floor(Number.MAX_SAFE_INTEGER / limit)) return null;
  return (shard - 1) * limit;
}

function segmentUpperBound(
  vertical: VerticalDeployment,
  segmentId: string,
  scanPageLimit: number,
): number {
  const pageClasses = vertical.runtime.seo.page_classes.filter(
    (pageClass) => pageClass.sitemap === segmentId,
  );
  const staticCount = pageClasses.filter((pageClass) => pageClass.route_kind === 'static').length;
  const hasEntityPages = pageClasses.some((pageClass) => pageClass.route_kind === 'entity_detail');
  return staticCount + (hasEntityPages ? scanPageLimit * SITEMAP_ENTITY_SCAN_PAGE_SIZE : 0);
}

/** Build the global index only after measuring complete authorized shard counts. */
export async function sitemapIndexXml(
  deployment: RequestWebDeployment,
  now = new Date(),
): Promise<string> {
  const configured = [...deployment.verticals.values()].map((vertical) => ({
    vertical,
    fileLimit: checkedFileLimit(vertical),
    scanPageLimit: checkedScanPageBudget(vertical),
  }));
  const sharedLimit = configured.length === 0
    ? 1
    : Math.min(...configured.map((entry) => entry.scanPageLimit));
  const budget = new SitemapScanBudget(sharedLimit);
  const entries: string[] = [];

  for (const { vertical, fileLimit } of configured) {
    const eligibility = await verticalPublicationEligibility(vertical, budget);
    if (!eligibility.publicWeb || !eligibility.searchIndex) continue;
    for (const segment of vertical.runtime.seo.sitemaps.segments) {
      const locations = await collectSegmentLocations(
        vertical,
        deployment.publicOrigin,
        segment.id,
        now,
        budget,
        eligibility,
      );
      const shardCount = Math.max(1, Math.ceil(locations.length / fileLimit));
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
  const scanPageLimit = checkedScanPageBudget(vertical);
  const start = shardStart(shard, limit);
  if (start === null) return urlset([]);
  const segment = vertical.runtime.seo.sitemaps.segments.find((entry) => entry.id === segmentId);
  if (segment === undefined) return urlset([]);
  const sharded = segment.path.includes('{n}');
  if (shard > 1 && !sharded) return urlset([]);

  // This upper bound is derived entirely from validated config, so an
  // attacker-selected impossible shard is refused before rights or SQL work.
  if (start >= segmentUpperBound(vertical, segmentId, scanPageLimit)) return urlset([]);
  if (vertical.runtime.vertical_status !== 'ACTIVE') return urlset([]);

  const budget = new SitemapScanBudget(scanPageLimit);
  const stopAfter = sharded ? start + limit : limit + 1;
  const locations = await collectSegmentLocations(
    vertical,
    publicOrigin,
    segmentId,
    now,
    budget,
    null,
    stopAfter,
  );
  if (!sharded && locations.length > limit) {
    throw new SitemapConfigurationError(
      `Sitemap segment "${segment.id}" exceeds max_urls_per_file but its path has no {n} shard placeholder.`,
    );
  }
  return urlset(locations.slice(start, start + limit));
}
