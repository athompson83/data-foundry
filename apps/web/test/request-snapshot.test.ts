import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  SqlDriver,
  SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { createWebFetchHandler, RUNTIMES } from '../src/index.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import type { WebEnv } from '../src/env.js';
import type { WebRuntime } from '../src/seo.js';

const ORIGIN = 'https://request-snapshot.data-foundry.test';
const ENV: WebEnv = {
  DEPLOYMENT_ENVIRONMENT: 'development',
  POSTGRES_URL: 'postgres://request-snapshot/db',
  PUBLIC_ORIGIN: ORIGIN,
};

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

let fixtures: QueryFixtures;
let transactionCount: number;

interface DatabaseFreeCase {
  readonly name: string;
  readonly request: () => Request;
  readonly status: number;
  readonly bodyIncludes?: string;
}

const DATABASE_FREE_CASES: readonly DatabaseFreeCase[] = [
  {
    name: 'a rejected write method',
    request: () => new Request(`${ORIGIN}/data/hvac`, { method: 'POST' }),
    status: 405,
  },
  {
    name: 'an unparseable request URL',
    request: () => ({ method: 'GET', url: 'http://[' }) as Request,
    status: 404,
  },
  {
    name: 'robots.txt',
    request: () => new Request(`${ORIGIN}/robots.txt`),
    status: 200,
    bodyIncludes: '/sitemap-index.xml',
  },
  {
    name: 'a path naming no vertical',
    request: () => new Request(`${ORIGIN}/not-a-route`),
    status: 404,
  },
  {
    name: 'an unmatched path inside a vertical',
    request: () => new Request(`${ORIGIN}/data/hvac/not-a-route`),
    status: 404,
  },
];

const worker = {
  fetch: createWebFetchHandler({ runtimes: { hvac: TEST_RUNTIME } }),
};

function countingDriver(driver: SqlDriver): SqlDriver {
  return {
    ...driver,
    async transaction<T>(
      run: (transaction: SqlTransactionExecutor) => Promise<T>,
    ): Promise<T> {
      transactionCount += 1;
      return driver.transaction(run);
    },
    // The deployment cache borrows the fixture driver. The fixture remains
    // responsible for closing it after the cached deployment is discarded.
    close: async () => undefined,
  };
}

beforeEach(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB', 'SEARCH_INDEX']);
  await addSyntheticEntityEvidence(fixtures, fixtures.equipment);
  transactionCount = 0;

  await getDeployment({
    env: ENV,
    runtimes: { hvac: TEST_RUNTIME },
    openDriver: async () => countingDriver(fixtures.driver),
  });
});

afterEach(async () => {
  resetDeployments();
  await fixtures.driver.close();
});

describe('one physical read snapshot per production web request', () => {
  it.each(DATABASE_FREE_CASES)(
    'routes $name before invoking the cold-start deployment loader',
    async ({ request, status, bodyIncludes }) => {
      let deploymentLoads = 0;
      const fetch = createWebFetchHandler({
        loadDeployment: async () => {
          deploymentLoads += 1;
          throw new Error('database unavailable');
        },
      });

      const response = await fetch(request(), ENV);

      expect(response.status).toBe(status);
      if (bodyIncludes !== undefined) {
        expect(await response.text()).toContain(bodyIncludes);
      }
      expect(deploymentLoads).toBe(0);
    },
  );

  it('serves an entity detail with compound PUBLIC_WEB and SEARCH_INDEX reads in one transaction', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/data/hvac/equipment/${fixtures.equipment.canonical_slug}`),
      ENV,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(fixtures.equipment.canonical_name);
    expect(transactionCount).toBe(1);
  });

  it('serves a sitemap request in one transaction', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/data/hvac/sitemaps/entities-1.xml`),
      ENV,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(fixtures.equipment.canonical_slug);
    expect(transactionCount).toBe(1);
  });

  it('rejects a write method without opening a database transaction', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/data/hvac`, { method: 'POST' }),
      ENV,
    );

    expect(response.status).toBe(405);
    expect(transactionCount).toBe(0);
  });

  it('rejects an unparseable request URL without opening a database transaction', async () => {
    const response = await worker.fetch(
      { method: 'GET', url: 'http://[' } as Request,
      ENV,
    );

    expect(response.status).toBe(404);
    expect(transactionCount).toBe(0);
  });

  it('serves robots.txt without opening a database transaction', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/robots.txt`),
      ENV,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('/sitemap-index.xml');
    expect(transactionCount).toBe(0);
  });

  it('rejects a path naming no vertical without opening a database transaction', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/not-a-route`),
      ENV,
    );

    expect(response.status).toBe(404);
    expect(transactionCount).toBe(0);
  });

  it('rejects an unmatched path inside a vertical without opening a database transaction', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/data/hvac/not-a-route`),
      ENV,
    );

    expect(response.status).toBe(404);
    expect(transactionCount).toBe(0);
  });
});
