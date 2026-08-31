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
import worker, { RUNTIMES } from '../src/index.js';
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
});
