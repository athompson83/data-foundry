/**
 * The composition root against a real database — same discipline as
 * `apps/edge/test/composition.test.ts`. Nothing here stubs the query layer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { resolveContext } from '../src/config.js';
import { WebConfigurationError } from '../src/env.js';
import { RUNTIMES } from '../src/index.js';

let fixtures: QueryFixtures;

const envFor = (overrides: Record<string, string> = {}) => ({
  DEPLOYMENT_ENVIRONMENT: 'development',
  POSTGRES_URL: 'postgres://fixture/db',
  PUBLIC_ORIGIN: 'https://data-foundry.test',
  ...overrides,
});
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

describe('composing a deployment', () => {
  it('composes every vertical the fixture database actually holds', async () => {
    const deployment = await getDeployment({
      env: envFor(),
      runtimes: RUNTIMES,
      openDriver: openFixtureDriver,
    });
    expect(deployment.verticals.has('hvac')).toBe(true);
    expect(deployment.verticals.get('hvac')?.slug).toBe('hvac');
  });

  it('caches the canonical graph and binds separate immutable surface models per request', async () => {
    const deployment = await getDeployment({
      env: envFor(),
      runtimes: RUNTIMES,
      openDriver: openFixtureDriver,
    });
    const cached = deployment.verticals.get('hvac')!;
    const vertical = resolveContext(
      deployment,
      () => new Date('2026-07-01T00:00:00Z'),
    ).deployment.verticals.get('hvac')!;

    expect(cached.bindRequestSurfaces).toBeTypeOf('function');
    expect('publicQueryModel' in cached).toBe(false);
    expect(vertical.publicQueryModel.surface).toBe('PUBLIC_WEB');
    expect(vertical.searchIndexQueryModel.surface).toBe('SEARCH_INDEX');
    expect('provenanceCoverage' in vertical.publicQueryModel).toBe(false);
  });

  it('warns rather than throws for a bundled vertical the database does not have', async () => {
    const warnings: string[] = [];
    const deployment = await getDeployment({
      env: envFor(),
      runtimes: { ...RUNTIMES, ghost: { ...RUNTIMES['hvac']!, vertical_slug: 'ghost-vertical' } },
      openDriver: openFixtureDriver,
      onWarning: (message) => warnings.push(message),
    });
    expect(deployment.verticals.has('ghost-vertical')).toBe(false);
    expect(warnings.some((w) => w.includes('ghost-vertical'))).toBe(true);
    // The vertical that DOES exist must still be served — one missing child
    // industry must never take the whole deployment down.
    expect(deployment.verticals.has('hvac')).toBe(true);
  });

  it('refuses with no database configured, rather than falling back to an empty in-memory one', () => {
    // resolveWebConfig runs synchronously at the top of getDeployment (before
    // any promise is returned, so the cache key can be computed) — the
    // refusal is therefore a synchronous throw, not a rejected promise.
    expect(() => getDeployment({ env: {}, runtimes: RUNTIMES, openDriver: openFixtureDriver })).toThrow(
      WebConfigurationError,
    );
  });

  it('shares one pool across every composed vertical rather than opening one per vertical', async () => {
    let opens = 0;
    const countingDriver = async () => {
      opens += 1;
      return fixtures.driver;
    };
    await getDeployment({ env: envFor(), runtimes: RUNTIMES, openDriver: countingDriver });
    expect(opens).toBe(1);
  });

  it('caches the deployment by connection string, not rebuilding per request', async () => {
    let opens = 0;
    const countingDriver = async () => {
      opens += 1;
      return fixtures.driver;
    };
    const env = envFor();
    await getDeployment({ env, runtimes: RUNTIMES, openDriver: countingDriver });
    await getDeployment({ env, runtimes: RUNTIMES, openDriver: countingDriver });
    expect(opens).toBe(1);
  });

  it('binds each production Hyperdrive invocation to the private Alpha Lab schema', async () => {
    const opened: Array<{ readonly connectionString: string; readonly schema: string | undefined }> = [];
    const openDriver = async (connectionString: string, options?: { readonly schema?: string }) => {
      opened.push({ connectionString, schema: options?.schema });
      return fixtures.driver;
    };
    const env = {
      DEPLOYMENT_ENVIRONMENT: 'production',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/data-foundry' },
      PUBLIC_ORIGIN: 'https://data.aroqon.com',
      PUBLIC_CACHE_MODE: 'no-store',
    } as const;

    await getDeployment({ env, runtimes: RUNTIMES, openDriver });
    await getDeployment({ env, runtimes: RUNTIMES, openDriver });

    // The Cloudflare origin pool belongs to Hyperdrive, not the Worker
    // isolate, so each fetch must build a fresh client-backed graph.
    expect(opened).toEqual([
      { connectionString: 'postgres://hyperdrive.fixture/data-foundry', schema: 'data_foundry' },
      { connectionString: 'postgres://hyperdrive.fixture/data-foundry', schema: 'data_foundry' },
    ]);
  });

  it('leaves the local direct-Postgres development driver unscoped', async () => {
    let schema: string | undefined = 'not-called';
    const openDriver = async (_connectionString: string, options?: { readonly schema?: string }) => {
      schema = options?.schema;
      return fixtures.driver;
    };

    await getDeployment({ env: envFor(), runtimes: RUNTIMES, openDriver });

    expect(schema).toBeUndefined();
  });

  it('does not reuse canonical URLs across two origins backed by the same database', async () => {
    let opens = 0;
    const countingDriver = async () => {
      opens += 1;
      return fixtures.driver;
    };

    const first = await getDeployment({
      env: envFor({ PUBLIC_ORIGIN: 'https://one.example' }),
      runtimes: RUNTIMES,
      openDriver: countingDriver,
    });
    const second = await getDeployment({
      env: envFor({ PUBLIC_ORIGIN: 'https://two.example' }),
      runtimes: RUNTIMES,
      openDriver: countingDriver,
    });

    expect(first.publicOrigin).toBe('https://one.example');
    expect(second.publicOrigin).toBe('https://two.example');
    expect(opens).toBe(2);
  });

  it('does not reuse a composed deployment across different public cache modes', async () => {
    let opens = 0;
    const countingDriver = async () => {
      opens += 1;
      return fixtures.driver;
    };

    await getDeployment({
      env: envFor({ PUBLIC_CACHE_MODE: 'cache' }),
      runtimes: RUNTIMES,
      openDriver: countingDriver,
    });
    await getDeployment({
      env: envFor({ PUBLIC_CACHE_MODE: 'no-store' }),
      runtimes: RUNTIMES,
      openDriver: countingDriver,
    });

    expect(opens).toBe(2);
  });
});
