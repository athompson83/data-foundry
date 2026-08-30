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

describe('the parent site', () => {
  it('lists every composed vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('HVAC Equipment');
    expect(response.body).toContain('/data/hvac');
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
    expect(response.body).toContain('/data/hvac/sitemaps/');
  });
});

describe('the hvac dataset landing page', () => {
  it('renders 200 with links to every declared entity type', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('Equipment Models');
    expect(response.body).toContain('Manufacturers');
  });

  it('suppresses Dataset JSON-LD until every declared required field is known', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac' });

    expect(response.body).not.toContain('type="application/ld+json"');
    expect(response.body).not.toContain('"@type":"Dataset"');
  });
});

describe('relationship page dispatch', () => {
  it('renders the explicit replacement route instead of treating it as static', async () => {
    const app = await appHandler();
    const response = await app({
      method: 'GET',
      url: `/data/hvac/equipment/${replacedModel.canonical_slug}/replacements`,
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
      url: `/data/hvac/equipment/${mergedLegacyModel.canonical_slug}/replacements`,
    });

    expect(response.status).toBe(308);
    expect(response.headers['location']).toBe(
      `/data/hvac/equipment/${replacedModel.canonical_slug}/replacements`,
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
      url: `/data/hvac/equipment/${mergedLegacyModel.canonical_slug}/replacements`,
    });

    expect(response.status).toBe(200);
    expect(response.headers['location']).toBeUndefined();
    expect(response.body).toContain(
      `href="https://data-foundry.test/data/hvac/equipment/${replacedModel.canonical_slug}/replacements"`,
    );
  });
});

describe('surface-safe inline evidence', () => {
  it('explains each visible fact without leaking a neighboring blocked claim', async () => {
    const app = await appHandler();
    const response = await app({
      method: 'GET',
      url: `/data/hvac/equipment/${replacedModel.canonical_slug}`,
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
  it('renders the bare search form as indexable', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/search' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('<form class="search"');
    expect(response.body).toContain('name="robots" content="index,follow"');
  });

  it('marks a parametrized query noindex — it is a generated, combinatorial view', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/search?q=acme' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('name="robots" content="noindex,follow"');
  });
});

describe('the docs page', () => {
  it('renders and links to llms.txt', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/docs' });
    expect(response.status).toBe(200);
    expect(response.body).toContain('llms.txt');
  });
});

describe('llms.txt', () => {
  it('is plain text and names the vertical', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/llms.txt' });
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
    const response = await app({ method: 'GET', url: '/data/hvac/this-is-not-a-route' });
    expect(response.status).toBe(404);
  });

  it('answers 404 for an entity slug that does not exist', async () => {
    const app = await appHandler();
    const response = await app({ method: 'GET', url: '/data/hvac/equipment/does-not-exist' });
    expect(response.status).toBe(404);
  });

  it('refuses a write method — this surface is exactly as read-only as the metered API', async () => {
    const app = await appHandler();
    const response = await app({ method: 'POST', url: '/' });
    expect(response.status).toBe(405);
  });
});
