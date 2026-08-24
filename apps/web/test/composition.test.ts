/**
 * The composition root against a real database — same discipline as
 * `apps/edge/test/composition.test.ts`. Nothing here stubs the query layer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { WebConfigurationError } from '../src/env.js';
import { RUNTIMES } from '../src/index.js';

let fixtures: QueryFixtures;

const envFor = (overrides: Record<string, string> = {}) => ({
  POSTGRES_URL: 'postgres://fixture/db',
  ...overrides,
});
const openFixtureDriver = async () => fixtures.driver;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
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
});
