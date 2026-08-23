/**
 * What the surface says when the layer beneath it is gone.
 *
 * Two different answers, deliberately:
 *
 *   * `/v1/health` is a readiness check, so a query layer it cannot reach is
 *     its ANSWER, not its failure: 503 `SERVICE_UNAVAILABLE`. A health endpoint
 *     that reports "ok" through a database outage is worse than none, which is
 *     why the check makes a real round trip rather than returning a literal.
 *   * Every other route treats it as an unanticipated failure and collapses to
 *     an opaque 500. The driver's own error text names files, drivers and SQL
 *     state; a customer gets none of it and an operator gets all of it.
 *
 * The suite closes the real driver rather than stubbing one, so the error under
 * test is the error production would raise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPAQUE_INTERNAL_MESSAGE } from '../src/errors.js';
import { call, createApiFixtures, errorOf, type ApiFixtures } from './support.js';

let fixtures: ApiFixtures;

beforeAll(async () => {
  fixtures = await createApiFixtures();
  // Everything below this line runs against a query layer that cannot answer.
  await fixtures.driver.close();
}, 300_000);

afterAll(async () => {
  try {
    await fixtures?.driver.close();
  } catch {
    // Already closed by the setup; closing twice is not a test failure.
  }
});

describe('a query layer that cannot answer', () => {
  it('fails the health check instead of reporting ok', async () => {
    const response = await call(fixtures.app, '/v1/health');
    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('collapses every other route to an opaque 500', async () => {
    const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}`);
    expect(response.status).toBe(500);
    expect(errorOf(response)).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: OPAQUE_INTERNAL_MESSAGE,
    });
  });

  it('discloses nothing about the driver, the query or the file that threw', async () => {
    for (const url of [
      `/v1/entities/${fixtures.equipment.id}`,
      `/v1/entities/${fixtures.equipment.id}/facts`,
      '/v1/search?q=carrier',
      `/v1/compare?ids=${fixtures.equipment.id},${fixtures.heatPump.id}`,
    ]) {
      const raw = JSON.stringify((await call(fixtures.app, url)).body).toLowerCase();
      for (const forbidden of ['pglite', 'postgres', 'closed', 'sql', 'select', ' at ', '.ts']) {
        expect(raw, `${url} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('hands the operator channel the real error, with the path that failed', async () => {
    fixtures.logged.length = 0;
    await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}`, {
      headers: { 'x-request-id': 'probe-1' },
    });
    expect(fixtures.logged).toHaveLength(1);
    expect(fixtures.logged[0]?.path).toBe(`/v1/entities/${fixtures.equipment.id}`);
    expect(fixtures.logged[0]?.error).toBeInstanceOf(Error);
  });

  it('still answers the documents that need no data at all', async () => {
    // The contract is static. An outage must not make the API undescribable.
    expect((await call(fixtures.app, '/v1')).status).toBe(200);
    expect((await call(fixtures.app, '/')).status).toBe(200);
    expect((await call(fixtures.app, '/v1/nope')).status).toBe(404);
  });
});
