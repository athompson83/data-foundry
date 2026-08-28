/**
 * Regression coverage for a defect review found: `sitemapSegmentXml`
 * unconditionally listed `dataset_landing` in the `datasets` segment, even
 * when the SAME gate `renderDatasetLanding` evaluates for that page's own
 * robots meta tag says `noindex`. `include_only_indexable: true` and
 * `on_gate_failure.in_sitemap: false` in `seo.yaml` both say a failed gate
 * must not appear in the sitemap; this proves it does not, against the real
 * compiled hvac gate thresholds (`min_entities: 25`), which the shared
 * fixtures (four entities) genuinely fail — not a contrived double.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { entityQualityScore, type Entity } from '@data-foundry/canonical-schema';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { getDeployment, resetDeployments, type VerticalDeployment } from '../src/composition.js';
import { resolveContext } from '../src/config.js';
import { sitemapIndexXml, sitemapSegmentXml } from '../src/sitemap.js';
import { DEFAULT_CONCURRENCY } from '../src/concurrency.js';
import { RUNTIMES } from '../src/index.js';
import type {
  SearchQuery,
  SurfaceQueryModel,
  TraversalQuery,
} from '@data-foundry/query-model';

const ACTIVE_RUNTIMES = {
  hvac: { ...RUNTIMES['hvac']!, vertical_status: 'ACTIVE' },
};

let fixtures: QueryFixtures;
const openFixtureDriver = async () => fixtures.driver;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB', 'SEARCH_INDEX']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
});

describe('sitemapSegmentXml — dataset_landing is gate-checked, not assumed', () => {
  it('excludes the dataset landing page when the real dataset gate is not met', async () => {
    // hvac's compiled seo.yaml requires min_entities: 25; the shared fixtures
    // seed four. This is the fixture set every other apps/web test already
    // uses, not one written to make this assertion pass.
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: 'https://data-foundry.test' },
      runtimes: ACTIVE_RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const context = resolveContext(deployment);
    const vertical = context.deployment.verticals.get('hvac')!;

    const xml = await sitemapSegmentXml(vertical, context.deployment.publicOrigin, 'datasets', new Date());
    expect(xml).not.toContain(`<loc>${context.deployment.publicOrigin}/data/hvac</loc>`);
  });

  it('still includes docs_api_mcp — its gate is `none`, unconditionally indexable', async () => {
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: 'https://data-foundry.test' },
      runtimes: ACTIVE_RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const context = resolveContext(deployment);
    const vertical = context.deployment.verticals.get('hvac')!;

    const xml = await sitemapSegmentXml(vertical, context.deployment.publicOrigin, 'datasets', new Date());
    expect(xml).toContain(`<loc>${context.deployment.publicOrigin}/data/hvac/docs</loc>`);
  });
});

/**
 * Seeds `count` `equipment_model` entities so the `entities` segment's
 * per-entity fan-out in `sitemapSegmentXml` actually has more than one hit to
 * iterate — the shared query-model fixtures only carry `equipment`/`part`
 * entities (used by search/identity tests elsewhere), none of which match
 * hvac's real `equipment_model_detail` page class.
 */
async function seedEquipmentModels(f: QueryFixtures, count: number, prefix: string): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await f.store.upsertEntity({
      vertical_id: f.vertical.id,
      entity_type: 'equipment_model',
      canonical_name: `${prefix} Model ${i}`,
      canonical_slug: `${prefix}-model-${i}`,
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.5),
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: null,
    }).then((entity) => addSyntheticEntityEvidence(f, entity));
  }
}

describe('sitemapSegmentXml — per-entity fan-out performance', () => {
  it('never re-fetches an entity search() already returned in full (no getEntity call)', async () => {
    // RED under the pre-fix code: isIndexable used to call
    // `queryModel.getEntity(entityId)` once per hit even though `search()`
    // already returns the full entity (quality_score, updated_at included).
    await seedEquipmentModels(fixtures, 3, 'nolookup');
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: 'https://data-foundry.test' },
      runtimes: ACTIVE_RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const context = resolveContext(deployment);
    const vertical = context.deployment.verticals.get('hvac')!;

    let getEntityCalls = 0;
    const spied: VerticalDeployment = {
      ...vertical,
      publicQueryModel: {
        ...vertical.publicQueryModel,
        getEntity: async (id) => {
          getEntityCalls += 1;
          return vertical.publicQueryModel.getEntity(id);
        },
      },
    };

    await sitemapSegmentXml(spied, context.deployment.publicOrigin, 'entities', new Date('2026-03-01T00:00:00Z'));
    expect(getEntityCalls).toBe(0);
  });

  it('evaluates more than one entity concurrently, bounded by DEFAULT_CONCURRENCY', async () => {
    // RED under the pre-fix code: the per-hit loop was a plain serial
    // `for...of` with a sequential `await` — at most one `canonicalFacts`
    // call was ever in flight. This proves the replacement is neither that
    // nor unbounded.
    await seedEquipmentModels(fixtures, 5, 'concurrency');
    const deployment = await getDeployment({
      env: { POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: 'https://data-foundry.test' },
      runtimes: ACTIVE_RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const context = resolveContext(deployment);
    const vertical = context.deployment.verticals.get('hvac')!;

    let active = 0;
    let maxActive = 0;
    const spied: VerticalDeployment = {
      ...vertical,
      publicQueryModel: {
        ...vertical.publicQueryModel,
        canonicalFacts: async (entityId, policy) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          try {
            return await vertical.publicQueryModel.canonicalFacts(entityId, policy);
          } finally {
            active -= 1;
          }
        },
      },
    };

    await sitemapSegmentXml(spied, context.deployment.publicOrigin, 'entities', new Date('2026-03-01T00:00:00Z'));
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
  });
});

function fakeSurfaceModel(
  surface: 'PUBLIC_WEB' | 'SEARCH_INDEX',
  entities: readonly typeof fixtures.equipment[],
  searchCalls: SearchQuery[],
  options: {
    readonly maxLimit?: number;
    readonly maxOffset?: number;
    readonly emptyWhenOffsetClamped?: boolean;
  } = {},
): SurfaceQueryModel {
  return {
    fields: fixtures.registry,
    surface,
    search: async (query: SearchQuery) => {
      searchCalls.push(query);
      const requestedOffset = query.offset ?? 0;
      const offset = Math.min(requestedOffset, options.maxOffset ?? Number.MAX_SAFE_INTEGER);
      const limit = Math.min(query.limit ?? 200, options.maxLimit ?? 200);
      const hits =
        options.emptyWhenOffsetClamped === true && offset !== requestedOffset
          ? []
          : entities.slice(offset, offset + limit).map((entity) => ({
              entity,
              match_kind: 'FILTER_ONLY' as const,
              score: 0,
              text_rank: 0,
              exact: false,
              matched_on: null,
              explain: 'synthetic pagination hit',
            }));
      return {
        hits,
        total: entities.length,
        limit,
        offset,
        exact_short_circuit: false,
        exact_count: 0,
        facets: [],
        strategy: { exact_first: true, full_text: false, trigram: false, vector: false },
      };
    },
    getEntity: async (id: Entity['id']) => {
      const entity = entities.find((candidate) => candidate.id === id);
      return entity === undefined ? null : { entity, redirected_from: null };
    },
    canonicalFacts: async () => [],
    explainFact: async () => null,
    relationships: async (query: TraversalQuery) => ({
      root: query.entity_id,
      edges: [],
      depth: query.depth ?? 1,
      truncated: false,
      unevidenced_edge_count: 0,
    }),
  } as unknown as SurfaceQueryModel;
}

function paginationVertical(
  count: number,
  maxUrlsPerFile: number,
  searchOptions: Parameters<typeof fakeSurfaceModel>[3] = {},
) {
  const entities = Array.from({ length: count }, (_, index) => ({
    ...fixtures.equipment,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` as typeof fixtures.equipment.id,
    entity_type: 'equipment_model' as typeof fixtures.equipment.entity_type,
    canonical_name: `Pagination Model ${index}` as typeof fixtures.equipment.canonical_name,
    canonical_slug: `pagination-model-${index}` as typeof fixtures.equipment.canonical_slug,
  }));
  const publicCalls: SearchQuery[] = [];
  const indexCalls: SearchQuery[] = [];
  const runtime = {
    ...RUNTIMES['hvac']!,
    vertical_status: 'ACTIVE',
    seo: {
      ...RUNTIMES['hvac']!.seo,
      page_classes: [
        {
          id: 'equipment_model_detail',
          route_kind: 'entity_detail' as const,
          entity_type: 'equipment_model',
          path: '/data/hvac/equipment/{canonical_slug}',
          title: '{canonical_name}',
          structured_data: null,
          sitemap: 'entities',
          indexable: 'conditional' as const,
          quality_gate: 'none',
        },
      ],
      quality_gates: { none: {} },
      sitemaps: {
        ...RUNTIMES['hvac']!.seo.sitemaps,
        max_urls_per_file: maxUrlsPerFile,
        segments: [{ id: 'entities', path: '/sitemaps/entities-{n}.xml' }],
      },
    },
  };
  const vertical: VerticalDeployment = {
    slug: 'hvac',
    verticalId: fixtures.vertical.id,
    runtime,
    publicQueryModel: fakeSurfaceModel('PUBLIC_WEB', entities, publicCalls, searchOptions),
    searchIndexQueryModel: fakeSurfaceModel('SEARCH_INDEX', entities, indexCalls, searchOptions),
  };
  return { vertical, entities, publicCalls, indexCalls };
}

describe('sitemap pagination and configured file limits', () => {
  it('paginates in query-layer-sized batches instead of losing results after 200', async () => {
    const { vertical, publicCalls } = paginationVertical(205, 45_000);
    const xml = await sitemapSegmentXml(
      vertical,
      'https://data-foundry.test',
      'entities',
      new Date('2026-03-01T00:00:00Z'),
    );

    expect(xml).toContain('pagination-model-204');
    expect(
      publicCalls.filter((call) => (call.limit ?? 200) > 1).map((call) => call.offset),
    ).toEqual([0, 200]);
    expect(publicCalls.every((call) => (call.limit ?? 0) <= 200)).toBe(true);
  });

  it('shards output and advertises every shard without exceeding max_urls_per_file', async () => {
    const { vertical } = paginationVertical(5, 2);
    const now = new Date('2026-03-01T00:00:00Z');
    const first = await sitemapSegmentXml(vertical, 'https://data-foundry.test', 'entities', now, 1);
    const second = await sitemapSegmentXml(vertical, 'https://data-foundry.test', 'entities', now, 2);
    const index = await sitemapIndexXml({
      publicOrigin: 'https://data-foundry.test',
      verticals: new Map([['hvac', vertical]]),
    }, now);

    expect((first.match(/<url>/g) ?? []).length).toBe(2);
    expect((second.match(/<url>/g) ?? []).length).toBe(2);
    expect(first).toContain('pagination-model-0');
    expect(first).not.toContain('pagination-model-2');
    expect(second).toContain('pagination-model-2');
    expect(index).toContain('/sitemaps/entities-1.xml');
    expect(index).toContain('/sitemaps/entities-2.xml');
    expect(index).toContain('/sitemaps/entities-3.xml');
  });

  it('fails closed instead of truncating or looping when the query cursor is clamped', async () => {
    const { vertical } = paginationVertical(5, 45_000, {
      maxLimit: 2,
      maxOffset: 2,
      emptyWhenOffsetClamped: true,
    });

    await expect(
      sitemapSegmentXml(
        vertical,
        'https://data-foundry.test',
        'entities',
        new Date('2026-03-01T00:00:00Z'),
      ),
    ).rejects.toThrow(/pagination could not advance/i);
  });
});
