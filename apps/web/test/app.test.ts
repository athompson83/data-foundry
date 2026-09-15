/**
 * Dispatch, end to end, through the real query layer — same discipline as
 * `apps/edge/test/index.test.ts`. The platform-level routes (`/`,
 * `/robots.txt`, `/sitemap-index.xml`, 404, method refusal) are proven against
 * the REAL compiled `hvac` runtime. The quality-gate proof is separate
 * (`gates-live.test.ts`) because it needs entities shaped like the real
 * vertical's `critical` properties, which the shared query-model fixtures
 * (entity_type `equipment`/`part`) are not.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  addSyntheticEntityEvidence,
  claim,
  createQueryFixtures,
  relate,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { entityQualityScore, type Entity } from '@data-foundry/canonical-schema';
import { SurfaceCatalogCapacityError } from '@data-foundry/query-model';
import { toFetchResponse } from '../src/adapter.js';
import { createWebApp } from '../src/app.js';
import { resolveContext } from '../src/config.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { RUNTIMES } from '../src/index.js';
import type { WebRuntime } from '../src/seo.js';

let fixtures: QueryFixtures;
let replacedModel: Entity;
let replacementModel: Entity;
let mergedLegacyModel: Entity;
let publishedFactId: string;
const openFixtureDriver = async () => fixtures.driver;
const ACTIVE_RUNTIME: WebRuntime = {
  ...RUNTIMES['hvac']!,
  vertical_status: 'ACTIVE',
};

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB', 'SEARCH_INDEX']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
  replacedModel = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment_model',
    canonical_name: 'Synthetic Legacy Model',
    canonical_slug: 'synthetic-legacy-model',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.8),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: ts('2026-02-01T00:00:00Z'),
  });
  replacementModel = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment_model',
    canonical_name: 'Synthetic Replacement Model',
    canonical_slug: 'synthetic-replacement-model',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.8),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: ts('2026-02-01T00:00:00Z'),
  });
  await addSyntheticEntityEvidence(fixtures, replacedModel);
  await addSyntheticEntityEvidence(fixtures, replacementModel);
  mergedLegacyModel = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment_model',
    canonical_name: 'Synthetic Merged Legacy Model',
    canonical_slug: 'synthetic-merged-legacy-model',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.8),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: ts('2026-02-01T00:00:00Z'),
  });
  await addSyntheticEntityEvidence(fixtures, mergedLegacyModel);
  await fixtures.store.mergeEntities({
    from_entity_id: mergedLegacyModel.id,
    to_entity_id: replacedModel.id,
    reason: 'MERGE',
    from_slug: mergedLegacyModel.canonical_slug,
    judgment_id: null,
  });
  const publishedFact = await claim(fixtures, 'manufacturer', {
    entity_id: replacedModel.id,
    property: 'seer2_rating',
    value: 18.5,
    value_type: 'number',
    source_value: 'SEER2 18.5',
  });
  publishedFactId = publishedFact.fact.id;
  await claim(fixtures, 'blocked', {
    entity_id: replacedModel.id,
    property: 'seer2_rating',
    value: 99.9,
    value_type: 'number',
    status: 'PROPOSED',
    source_value: 'BLOCKED NEIGHBOR VALUE',
  });
  await relate(fixtures, replacementModel, 'supersedes', replacedModel);
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
});

async function appHandler(
  runtime: WebRuntime = ACTIVE_RUNTIME,
  cacheMode: 'cache' | 'no-store' = 'cache',
) {
  const deployment = await getDeployment({
    env: {
      DEPLOYMENT_ENVIRONMENT: 'development',
      POSTGRES_URL: 'postgres://fixture/db',
      PUBLIC_ORIGIN: 'https://data-foundry.test',
      PUBLIC_CACHE_MODE: cacheMode,
    } as never,
    runtimes: { hvac: runtime },
    openDriver: openFixtureDriver,
  });
  return createWebApp(resolveContext(deployment));
}

describe('buyer journey and canonical industry URLs', () => {
  it('redirects the old industry path permanently while preserving the query', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/search?q=model%201&type=equipment_model' });
    expect(response.status).toBe(308);
    expect(response.headers['location']).toBe('/hvac/search?q=model%201&type=equipment_model');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('explains the equipment offer and marks pricing as a proposal without a fabricated listing', async () => {
    const app = await appHandler();
    const landing = await app({ method: 'GET', url: '/hvac' });
    expect(landing.status).toBe(200);
    expect(landing.body).toContain('HVAC Equipment Specifications &amp; Evidence API');
    expect(landing.body).toContain('/hvac/pricing');
    const pricing = await app({ method: 'GET', url: '/hvac/pricing' });
    expect(pricing.status).toBe(200);
    expect(pricing.body).toContain('Proposed plans');
    expect(pricing.body).toContain('$49');
    expect(pricing.body).not.toMatch(/href="https:\/\/rapidapi.com\//);
    for (const route of ['terms', 'privacy', 'support']) {
      const response = await app({ method: 'GET', url: `/hvac/${route}` });
      expect(response.status).toBe(200);
      expect(response.body).toContain('Pending approval');
      expect(response.body).toContain('noindex,follow');
    }
  });
  it('applies declared public filters and retains them when paging', async () => {
    await claim(fixtures, 'manufacturer', { entity_id: replacedModel.id, property: 'refrigerant', value: 'R-32' });
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/hvac/search?type=equipment_model&filter.refrigerant=R-32' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('Synthetic Legacy Model');
    expect(response.body).not.toContain('Synthetic Replacement Model');
    expect(response.body).toContain('name="filter.refrigerant"');
    expect(response.body).toContain('noindex,follow');
    const second = await app({ method: 'GET', url: '/hvac/search?type=equipment_model&filter.refrigerant=R-32&page=2' });
    expect(second.body).toContain('rel="prev"');
    expect(second.body).toContain('filter.refrigerant=R-32');
    expect((await app({ method: 'GET', url: '/hvac/search?filter.unknown=anything' })).status).toBe(400);
    expect((await app({ method: 'GET', url: '/hvac/search?page=100000' })).status).toBe(400);
  });
});

describe('the parent site', () => {
  it('lists every composed vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('HVAC Equipment');
    expect(response.body).toContain('/hvac');
  });

  it('is indexable — this is the discovery hub, not a generated page', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/' });
    expect(response.body).toContain('name="robots" content="index,follow"');
  });
});

describe('robots.txt and the sitemap index', () => {
  it('returns no-store for successful HTML, text, and XML through the real app and Fetch adapter', async () => {
    const app = await appHandler(ACTIVE_RUNTIME, 'no-store');
    const responses = await Promise.all([
      app({ method: 'GET', url: '/' }),
      app({ method: 'GET', url: '/robots.txt' }),
      app({ method: 'GET', url: '/sitemap-index.xml' }),
    ]);

    for (const response of responses) {
      const fetchResponse = toFetchResponse(response, 'GET');
      expect(fetchResponse.status).toBe(200);
      expect(fetchResponse.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('serves robots.txt pointing at one global sitemap index', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/robots.txt' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('Sitemap: ');
    expect(response.body).toContain('/sitemap-index.xml');
  });

  it('serves a sitemap index naming every segment of every composed vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/sitemap-index.xml' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');
    expect(response.body).toContain('<sitemapindex');
    expect(response.body).toContain('/hvac/sitemaps/');
  });
});

describe('the hvac dataset landing page', () => {
  it('renders 200 with links to every declared entity type', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/hvac' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('Equipment Models');
    expect(response.body).toContain('Manufacturers');
  });

  it('suppresses Dataset JSON-LD until every declared required field is known', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/hvac' });

    expect(response.body).not.toContain('type="application/ld+json"');
    expect(response.body).not.toContain('"@type":"Dataset"');
  });
});

describe('relationship page dispatch', () => {
  it('renders the explicit replacement route instead of treating it as static', async () => {
    const app = await appHandler();
    const response = await app({
      method: 'GET',
      url: `/hvac/equipment/${replacedModel.canonical_slug}/replacements`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain(replacementModel.canonical_name);
    expect(response.body).toContain('What replaces');
  });

  it('redirects a merged relationship subject to the canonical relationship path and configured status', async () => {
    const runtime: WebRuntime = {
      ...ACTIVE_RUNTIME,
      seo: {
        ...ACTIVE_RUNTIME.seo,
        canonical: { ...ACTIVE_RUNTIME.seo.canonical, redirect_status: 308 },
      },
    };
    const app = await appHandler(runtime);
    const response = await app({
      method: 'GET',
      url: `/hvac/equipment/${mergedLegacyModel.canonical_slug}/replacements`,
    });

    expect(response.status).toBe(308);
    expect(response.headers['location']).toBe(
      `/hvac/equipment/${replacedModel.canonical_slug}/replacements`,
    );
  });

  it('renders the canonical relationship with a canonical tag when redirects are disabled', async () => {
    const runtime: WebRuntime = {
      ...ACTIVE_RUNTIME,
      seo: {
        ...ACTIVE_RUNTIME.seo,
        canonical: { ...ACTIVE_RUNTIME.seo.canonical, redirect_on_merge: false },
      },
    };
    const app = await appHandler(runtime);
    const response = await app({
      method: 'GET',
      url: `/hvac/equipment/${mergedLegacyModel.canonical_slug}/replacements`,
    });

    expect(response.status).toBe(200);
    expect(response.headers['location']).toBeUndefined();
    expect(response.body).toContain(
      `href="https://data-foundry.test/hvac/equipment/${replacedModel.canonical_slug}/replacements"`,
    );
  });
});

describe('surface-safe inline evidence', () => {
  it('explains each visible fact without leaking a neighboring blocked claim', async () => {
    const app = await appHandler();
    const response = await app({
      method: 'GET',
      url: `/hvac/equipment/${replacedModel.canonical_slug}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain(publishedFactId);
    expect(response.body).toContain('Selection:');
    expect(response.body).toContain('Acme Climate');
    expect(response.body).toContain('table.specs');
    expect(response.body).toContain('catalog.acme-climate.example.com');
    expect(response.body).not.toContain('BLOCKED NEIGHBOR VALUE');
    expect(response.body).not.toContain('HVAC Forum');
    expect(response.body).not.toContain('99.9');
    expect(response.body).not.toContain('reviewed_by');
    expect(response.body).not.toContain('withheld');
  });
});

describe('manual search', () => {
  it.each(['/hvac/search', '/hvac/search?q=', '/hvac/search?page=1', '/hvac/search?q=&page=1'])('keeps dynamic results and facets noindex at %s', async (url) => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url });
    expect(response.status).toBe(200);
    expect(response.body).toContain('<form class="search"');
    expect(response.body).toContain('Filter specifications');
    expect(response.body).toContain('<ul class="results">');
    expect(response.body).toContain('Synthetic Legacy Model');
    expect(response.body).toContain('name="robots" content="noindex,follow"');
  });

  it.each(['/hvac/search?q=acme', '/hvac/search?page=2', '/hvac/search?type=equipment_model'])('keeps a query, paginated or typed result view noindex at %s', async (url) => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url });
    expect(response.status).toBe(200);
    expect(response.body).toContain('name="robots" content="noindex,follow"');
  });

  it('returns an opaque non-retryable 503 instead of partial HTML on authorization capacity', async () => {
    const deployment = await getDeployment({
      env: {
        DEPLOYMENT_ENVIRONMENT: 'development',
        POSTGRES_URL: 'postgres://fixture/db',
        PUBLIC_ORIGIN: 'https://data-foundry.test',
        PUBLIC_CACHE_MODE: 'no-store',
      } as never,
      runtimes: { hvac: ACTIVE_RUNTIME },
      openDriver: openFixtureDriver,
    });
    const context = resolveContext(deployment);
    const vertical = context.deployment.verticals.get('hvac');
    if (vertical === undefined) throw new Error('HVAC web fixture missing');
    const app = createWebApp({
      ...context,
      deployment: {
        ...context.deployment,
        verticals: new Map([[
          'hvac',
          {
            ...vertical,
            publicQueryModel: {
              ...vertical.publicQueryModel,
              search: async () => {
                throw new SurfaceCatalogCapacityError('entities', 10_000);
              },
            },
          },
        ]]),
      },
    });

    const response = await app({ method: 'GET', url: '/hvac/search?q=capacity' });

    expect(response).toMatchObject({
      status: 503,
      body: 'Service unavailable.\n',
      headers: {
        'cache-control': 'no-store',
      },
    });
    expect(response.headers).not.toHaveProperty('retry-after');
    expect(response.body).not.toContain('10000');
    expect(response.body).not.toContain('entities');
  });
});

describe('the docs page', () => {
  it('renders and links to llms.txt', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/hvac/docs' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('llms.txt');
  });
});

describe('llms.txt', () => {
  it('is plain text and names the vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/hvac/llms.txt' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('HVAC Equipment');
  });
});

describe('unmatched requests', () => {
  it('answers 404 for a path naming no vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/nothing-here' });
    expect(response.status).toBe(404);
  });

  it('answers 404 for a path inside a real vertical that matches no page class', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/hvac/this-is-not-a-route' });
    expect(response.status).toBe(404);
  });

  it('answers 404 for an entity slug that does not exist', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/hvac/equipment/does-not-exist' });
    expect(response.status).toBe(404);
  });

  it('refuses a write method — this surface is exactly as read-only as the metered API', async () => {
    const app = await appHandler();
    const response = await app({ method: 'POST', url: '/' });
    expect(response.status).toBe(405);
  });
});
