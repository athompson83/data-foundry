import { afterEach, describe, expect, it } from 'vitest';
import {
  addSyntheticEntityEvidence,
  claim,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import type { RightsSurface } from '@data-foundry/query-model';
import { createWebApp } from '../src/app.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { resolveContext } from '../src/config.js';
import { sitemapSegmentXml } from '../src/sitemap.js';
import { RUNTIMES } from '../src/index.js';
import type { WebRuntime } from '../src/seo.js';

const ORIGIN = 'https://data-foundry.test';
const TEST_RUNTIME: WebRuntime = {
  ...RUNTIMES['hvac']!,
  vertical_status: 'ACTIVE',
  seo: {
    ...RUNTIMES['hvac']!.seo,
    page_classes: [
      {
        id: 'equipment_detail',
        route_kind: 'entity_detail',
        entity_type: 'equipment',
        path: '/data/hvac/equipment/{canonical_slug}',
        title: '{canonical_name}',
        structured_data: null,
        sitemap: 'entities',
        indexable: 'conditional',
        quality_gate: 'none',
      },
    ],
    quality_gates: { none: {} },
    sitemaps: {
      ...RUNTIMES['hvac']!.seo.sitemaps,
      max_urls_per_file: 100,
      segments: [{ id: 'entities', path: '/sitemaps/entities-{n}.xml' }],
    },
  },
};

afterEach(() => resetDeployments());

async function exercise(
  surfaces: readonly RightsSurface[],
  assertion: (fixtures: QueryFixtures) => Promise<void>,
): Promise<void> {
  const fixtures = await createQueryFixtures();
  try {
    await seedSyntheticSurfaceRights(fixtures, surfaces);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
    await assertion(fixtures);
  } finally {
    await fixtures.driver.close();
  }
}

async function deploymentFor(fixtures: QueryFixtures) {
  return getDeployment({
    env: { POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: ORIGIN },
    runtimes: { hvac: TEST_RUNTIME },
    openDriver: async () => fixtures.driver,
  });
}

describe('independent public and index rights', () => {
  it('renders a PUBLIC_WEB entity but omits it from the sitemap without SEARCH_INDEX', async () => {
    await exercise(['PUBLIC_WEB'], async (fixtures) => {
      const deployment = await deploymentFor(fixtures);
      const context = resolveContext(deployment);
      const vertical = context.deployment.verticals.get('hvac')!;
      const response = await createWebApp(context)({
        method: 'GET',
        url: `/data/hvac/equipment/${fixtures.equipment.canonical_slug}`,
      });
      const xml = await sitemapSegmentXml(vertical, ORIGIN, 'entities', new Date());

      expect(response.status).toBe(200);
      expect(response.body).toContain('name="robots" content="noindex,follow"');
      expect(response.body).toContain('This page does not currently meet publication-quality requirements.');
      expect(response.body).not.toContain('SEARCH_INDEX');
      expect(response.body).not.toContain('surface authorization');
      expect(response.body).not.toContain('could not be established');
      expect(response.body).not.toMatch(/\d+ (?:of|check|critical|permission|denial)/i);
      expect(xml).not.toContain(fixtures.equipment.canonical_slug);
    });
  });

  it('does not render or index an entity granted only to SEARCH_INDEX', async () => {
    await exercise(['SEARCH_INDEX'], async (fixtures) => {
      const deployment = await deploymentFor(fixtures);
      const context = resolveContext(deployment);
      const vertical = context.deployment.verticals.get('hvac')!;
      const response = await createWebApp(context)({
        method: 'GET',
        url: `/data/hvac/equipment/${fixtures.equipment.canonical_slug}`,
      });
      const xml = await sitemapSegmentXml(vertical, ORIGIN, 'entities', new Date());

      expect(response.status).toBe(404);
      expect(xml).not.toContain(fixtures.equipment.canonical_slug);
    });
  });

  it('does not treat paid API, MCP, or bulk grants as public or index grants', async () => {
    await exercise(['API_PAID', 'MCP', 'BULK_EXPORT'], async (fixtures) => {
      const deployment = await deploymentFor(fixtures);
      const context = resolveContext(deployment);
      const vertical = context.deployment.verticals.get('hvac')!;
      const response = await createWebApp(context)({
        method: 'GET',
        url: `/data/hvac/equipment/${fixtures.equipment.canonical_slug}`,
      });
      const xml = await sitemapSegmentXml(vertical, ORIGIN, 'entities', new Date());

      expect(response.status).toBe(404);
      expect(xml).not.toContain(fixtures.equipment.canonical_slug);
    });
  });

  it('indexes an entity only when both independent grants exist', async () => {
    await exercise(['PUBLIC_WEB', 'SEARCH_INDEX'], async (fixtures) => {
      const deployment = await deploymentFor(fixtures);
      const context = resolveContext(deployment);
      const vertical = context.deployment.verticals.get('hvac')!;
      const response = await createWebApp(context)({
        method: 'GET',
        url: `/data/hvac/equipment/${fixtures.equipment.canonical_slug}`,
      });
      const xml = await sitemapSegmentXml(vertical, ORIGIN, 'entities', new Date());

      expect(response.status).toBe(200);
      expect(response.body).toContain('name="robots" content="index,follow"');
      expect(xml).toContain(fixtures.equipment.canonical_slug);
    });
  });

  it('does not index a PUBLIC_WEB fact selected from a source without SEARCH_INDEX rights', async () => {
    const fixtures = await createQueryFixtures();
    try {
      await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB'], ['manufacturer']);
      await seedSyntheticSurfaceRights(
        fixtures,
        ['PUBLIC_WEB', 'SEARCH_INDEX'],
        ['certifier'],
      );
      await addSyntheticEntityEvidence(fixtures, fixtures.equipment, 'certifier');
      await claim(fixtures, 'manufacturer', {
        entity_id: fixtures.equipment.id,
        property: 'public_web_only_claim',
        value: 'PUBLIC WEB ONLY VALUE',
      });

      const deployment = await deploymentFor(fixtures);
      const context = resolveContext(deployment);
      const vertical = context.deployment.verticals.get('hvac')!;
      const response = await createWebApp(context)({
        method: 'GET',
        url: `/data/hvac/equipment/${fixtures.equipment.canonical_slug}`,
      });
      const xml = await sitemapSegmentXml(vertical, ORIGIN, 'entities', new Date());

      expect(response.status).toBe(200);
      expect(response.body).toContain('PUBLIC WEB ONLY VALUE');
      expect(response.body).toContain('name="robots" content="noindex,follow"');
      expect(xml).not.toContain(fixtures.equipment.canonical_slug);
    } finally {
      await fixtures.driver.close();
    }
  });
});
