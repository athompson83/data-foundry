/**
 * The composition root against a real database.
 *
 * Nothing here stubs the query layer. The suite boots PGlite, applies the real
 * `db/migrations`, and composes the same graph a deployed Worker composes, so
 * that "the Worker serves the API" means the whole path was exercised rather
 * than a mock agreeing with an assertion.
 *
 * The property that matters most is the last one: a deployment must not let a
 * client turn rule 1 off.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { claim, createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import type { SqlDriver } from '@data-foundry/canonical-store';
import { getDeployment, resetDeployments, type VerticalRuntime } from '../src/composition.js';
import { EdgeConfigurationError } from '../src/env.js';
import { RUNTIMES } from '../src/index.js';

let fixtures: QueryFixtures;

/** The compiled artifact the deployed bundle carries, not a hand-written double. */
const runtime = RUNTIMES['hvac'] as VerticalRuntime;

const envFor = (slug: string) => ({
  POSTGRES_URL: 'postgres://fixture/db',
  VERTICAL_SLUG: slug,
});

/** The fixture driver stands in for the pool Hyperdrive would hand us. */
const openFixtureDriver = async () => fixtures.driver;

/**
 * The shared driver, with `close()` observed instead of performed.
 *
 * A refused build closes the pool it opened, which is the behaviour we want in
 * production and would end this suite early if it reached the one PGlite every
 * test shares. Recording the call rather than suppressing it silently keeps the
 * no-leak guarantee assertable.
 */
function observedDriver(): { readonly driver: SqlDriver; readonly wasClosed: () => boolean } {
  let closed = false;
  const proxy = new Proxy(fixtures.driver, {
    get(target, property, receiver) {
      if (property === 'close') {
        return async () => {
          closed = true;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { driver: proxy as SqlDriver, wasClosed: () => closed };
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
});

describe('the compiled runtime is the one that ships', () => {
  it('carries the vertical the bundle claims', () => {
    expect(runtime.vertical_slug).toBe('hvac');
  });

  it('carries field metadata, without which /v1/search silently accepts no filters', () => {
    expect(runtime.fields.length).toBeGreaterThan(0);
  });

  it('carries no `at`: the as-of instant is the caller’s, not the build’s', () => {
    // A build timestamp in a committed artifact would also make it undiffable.
    expect('at' in runtime.fact_selection).toBe(false);
  });
});

describe('composing a deployment', () => {
  it('serves a request end to end, through the real query layer', async () => {
    const deployment = await getDeployment({
      env: envFor('hvac'),
      runtime,
      openDriver: openFixtureDriver,
    });

    const response = await deployment.app({ method: 'GET', url: '/v1/health' });
    expect(response.status).toBe(200);
  });

  it('resolves the vertical from the database rather than trusting the slug', async () => {
    const deployment = await getDeployment({
      env: envFor('hvac'),
      runtime,
      openDriver: openFixtureDriver,
    });
    expect(deployment.verticalId).toBe(fixtures.vertical.id);
  });

  it('builds once per isolate, so a second request does not open a second pool', async () => {
    let opened = 0;
    const counting = async () => {
      opened += 1;
      return fixtures.driver;
    };

    await getDeployment({ env: envFor('hvac'), runtime, openDriver: counting });
    await getDeployment({ env: envFor('hvac'), runtime, openDriver: counting });
    expect(opened).toBe(1);
  });

  it('does not cache a failed build, so one cold-start outage cannot wedge the isolate', async () => {
    let attempts = 0;
    const flaky = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('connection refused');
      return fixtures.driver;
    };

    await expect(
      getDeployment({ env: envFor('hvac'), runtime, openDriver: flaky }),
    ).rejects.toThrow(/connection refused/);
    // The retry succeeds, which it could not do against a cached rejection.
    const deployment = await getDeployment({ env: envFor('hvac'), runtime, openDriver: flaky });
    expect(deployment.verticalId).toBe(fixtures.vertical.id);
  });
});

describe('a deployment refuses what it cannot serve correctly', () => {
  it('refuses when the bundled runtime is not the configured vertical', async () => {
    await expect(
      getDeployment({ env: envFor('plumbing'), runtime, openDriver: openFixtureDriver }),
    ).rejects.toThrow(EdgeConfigurationError);
  });

  it('says why, because serving hvac data through another vertical’s fields is silent nonsense', async () => {
    await expect(
      getDeployment({ env: envFor('plumbing'), runtime, openDriver: openFixtureDriver }),
    ).rejects.toThrow(/not interchangeable/);
  });

  it('refuses when the vertical is absent from the database', async () => {
    const absent: VerticalRuntime = { ...runtime, vertical_slug: 'plumbing' };
    const observed = observedDriver();
    await expect(
      getDeployment({
        env: envFor('plumbing'),
        runtime: absent,
        openDriver: async () => observed.driver,
      }),
    ).rejects.toThrow(/not present in this database/);
  });

  it('closes the pool it opened when it then refuses, rather than leaking it', async () => {
    const absent: VerticalRuntime = { ...runtime, vertical_slug: 'plumbing' };
    const observed = observedDriver();
    await getDeployment({
      env: envFor('plumbing'),
      runtime: absent,
      openDriver: async () => observed.driver,
    }).catch(() => undefined);

    // A Worker that refused on every cold start while holding a connection open
    // would exhaust the database's connection limit and take the origin with it.
    expect(observed.wasClosed()).toBe(true);
  });
});

describe('rule 1 survives the trip to the edge', () => {
  /**
   * A claim whose only evidence is the UNREVIEWED forum.
   *
   * Without it this whole block is vacuous, and measurably so: the first draft
   * asserted that adding `?requirePublishableRights=false` changed nothing, and
   * it passed against `fixtures.equipment` — which has no rights-blocked fact,
   * so both answers were identical no matter what the policy said. A test that
   * cannot fail is worse than no test, because it reads like coverage.
   */
  const BLOCKED_PROPERTY = 'forum_rumor';

  beforeAll(async () => {
    await claim(fixtures, 'blocked', {
      entity_id: fixtures.equipment.id,
      property: BLOCKED_PROPERTY,
      value: 'sounds-like-40-decibels',
    });
  });

  it('deploys with publishable-rights filtering on', () => {
    expect(runtime.fact_selection['requirePublishableRights']).toBe(true);
  });

  it('withholds the blocked claim from a deployed surface', async () => {
    const deployment = await getDeployment({
      env: envFor('hvac'),
      runtime,
      openDriver: openFixtureDriver,
    });
    const response = await deployment.app({
      method: 'GET',
      url: `/v1/entities/${fixtures.equipment.id}/facts`,
    });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(BLOCKED_PROPERTY);
  });

  /**
   * The incorrect-direction proof. If the compiled `true` were doing nothing,
   * flipping it to `false` would change no answer and the test above would be
   * passing for an unrelated reason.
   */
  it('would serve it if the policy said so, which is what makes the guard load-bearing', async () => {
    const permissive: VerticalRuntime = {
      ...runtime,
      fact_selection: { ...runtime.fact_selection, requirePublishableRights: false },
    };
    const deployment = await getDeployment({
      // A distinct connection string, so this is a second deployment rather
      // than the cached one answering again.
      env: { ...envFor('hvac'), POSTGRES_URL: 'postgres://fixture/permissive' },
      runtime: permissive,
      openDriver: openFixtureDriver,
    });
    const response = await deployment.app({
      method: 'GET',
      url: `/v1/entities/${fixtures.equipment.id}/facts`,
    });

    expect(JSON.stringify(response.body)).toContain(BLOCKED_PROPERTY);
  });

  /**
   * A surface that read its fact-selection policy from the query string would
   * let a client send `?requirePublishableRights=false` and read RED/UNREVIEWED
   * claims. The app is handed the compiled policy at construction and never
   * merges a request into it, so the parameter is not a control surface —
   * demonstrated against a fact that would visibly appear if it were.
   */
  it('ignores a client attempting to turn it off in the query string', async () => {
    const deployment = await getDeployment({
      env: envFor('hvac'),
      runtime,
      openDriver: openFixtureDriver,
    });
    const attempted = await deployment.app({
      method: 'GET',
      url: `/v1/entities/${fixtures.equipment.id}/facts?requirePublishableRights=false`,
    });

    expect(attempted.status).toBe(200);
    expect(JSON.stringify(attempted.body)).not.toContain(BLOCKED_PROPERTY);
  });
});
