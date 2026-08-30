import { afterEach, describe, expect, it } from 'vitest';
import type { RightsSurface } from '@data-foundry/query-model';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
} from '../../../packages/query-model/test/support.js';
import { createWebApp } from '../src/app.js';
import { resolveContext } from '../src/config.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { RUNTIMES } from '../src/index.js';
import type { WebRuntime } from '../src/seo.js';

const ORIGIN = 'https://data-foundry.test';

afterEach(() => resetDeployments());

async function withApp(
  status: string,
  surfaces: readonly RightsSurface[],
  assertion: (app: ReturnType<typeof createWebApp>) => Promise<void>,
): Promise<void> {
  const fixtures = await createQueryFixtures();
  try {
    await seedSyntheticSurfaceRights(fixtures, surfaces);
    await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
    const runtime: WebRuntime = { ...RUNTIMES['hvac']!, vertical_status: status };
    const deployment = await getDeployment({
      env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: ORIGIN },
      runtimes: { hvac: runtime },
      openDriver: async () => fixtures.driver,
    });
    await assertion(createWebApp(resolveContext(deployment)));
  } finally {
    await fixtures.driver.close();
  }
}

describe('surface-bound vertical publication eligibility', () => {
  it('keeps the parent index out of search when no vertical is publicly published', async () => {
    await withApp('DRAFT', ['PUBLIC_WEB', 'SEARCH_INDEX'], async (app) => {
      const root = await app({ method: 'GET', url: '/' });

      expect(root.status).toBe(200);
      expect(root.body).toContain('No industry is currently serving data from this deployment.');
      expect(root.body).toContain('name="robots" content="noindex,follow"');
    });
  });

  it('does not expose a DRAFT vertical even when synthetic PUBLIC_WEB and SEARCH_INDEX grants exist', async () => {
    await withApp('DRAFT', ['PUBLIC_WEB', 'SEARCH_INDEX'], async (app) => {
      const [root, landing, search, docs, llms, sitemap] = await Promise.all([
        app({ method: 'GET', url: '/' }),
        app({ method: 'GET', url: '/data/hvac' }),
        app({ method: 'GET', url: '/data/hvac/search' }),
        app({ method: 'GET', url: '/data/hvac/docs' }),
        app({ method: 'GET', url: '/data/hvac/llms.txt' }),
        app({ method: 'GET', url: '/sitemap-index.xml' }),
      ]);

      expect(root.body).not.toContain('/data/hvac');
      expect(landing.status).toBe(404);
      expect(search.status).toBe(404);
      expect(docs.status).toBe(404);
      expect(llms.status).toBe(404);
      expect(sitemap.body).not.toContain('/data/hvac/');
    });
  });

  it('does not treat paid API, MCP, or bulk grants as PUBLIC_WEB publication eligibility', async () => {
    await withApp('ACTIVE', ['API_PAID', 'MCP', 'BULK_EXPORT'], async (app) => {
      const root = await app({ method: 'GET', url: '/' });
      const docs = await app({ method: 'GET', url: '/data/hvac/docs' });
      const llms = await app({ method: 'GET', url: '/data/hvac/llms.txt' });

      expect(root.body).not.toContain('/data/hvac');
      expect(docs.status).toBe(404);
      expect(llms.status).toBe(404);
    });
  });

  it('serves an ACTIVE PUBLIC_WEB vertical but keeps discovery pages and static sitemaps noindex without SEARCH_INDEX', async () => {
    await withApp('ACTIVE', ['PUBLIC_WEB'], async (app) => {
      const [root, search, docs, llms, sitemapIndex, datasetSitemap] = await Promise.all([
        app({ method: 'GET', url: '/' }),
        app({ method: 'GET', url: '/data/hvac/search' }),
        app({ method: 'GET', url: '/data/hvac/docs' }),
        app({ method: 'GET', url: '/data/hvac/llms.txt' }),
        app({ method: 'GET', url: '/sitemap-index.xml' }),
        app({ method: 'GET', url: '/data/hvac/sitemaps/datasets.xml' }),
      ]);

      expect(root.body).toContain('/data/hvac');
      expect(root.body).toContain('name="robots" content="noindex,follow"');
      expect(search.status).toBe(200);
      expect(search.body).toContain('name="robots" content="noindex,follow"');
      expect(docs.status).toBe(200);
      expect(docs.body).toContain('name="robots" content="noindex,follow"');
      expect(llms.status).toBe(200);
      expect(llms.headers['x-robots-tag']).toBe('noindex, follow');
      expect(sitemapIndex.body).not.toContain('/data/hvac/');
      expect(datasetSitemap.body).not.toContain('/data/hvac/docs');
    });
  });

  it('indexes discovery pages only when the ACTIVE vertical independently has both grants', async () => {
    await withApp('ACTIVE', ['PUBLIC_WEB', 'SEARCH_INDEX'], async (app) => {
      const [search, docs, llms, sitemapIndex, datasetSitemap] = await Promise.all([
        app({ method: 'GET', url: '/data/hvac/search' }),
        app({ method: 'GET', url: '/data/hvac/docs' }),
        app({ method: 'GET', url: '/data/hvac/llms.txt' }),
        app({ method: 'GET', url: '/sitemap-index.xml' }),
        app({ method: 'GET', url: '/data/hvac/sitemaps/datasets.xml' }),
      ]);

      expect(search.body).toContain('name="robots" content="index,follow"');
      expect(docs.body).toContain('name="robots" content="index,follow"');
      expect(llms.headers['x-robots-tag']).toBeUndefined();
      expect(sitemapIndex.body).toContain('/data/hvac/sitemaps/');
      expect(datasetSitemap.body).toContain('/data/hvac/docs');
    });
  });
});
