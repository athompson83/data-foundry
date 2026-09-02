/**
 * `onRequest`: the one channel a metering caller may read.
 *
 * The property under test is not "the hook fires". It is that `routeKey` is
 * always one member of the closed accounting vocabulary and never anything
 * built from the request itself. A caller that persists it verbatim therefore
 * cannot persist a path, query string, or entity identifier by construction.
 *
 * `onRequest` is a per-call parameter, not a construction-time option: a
 * built app is shared across every request a deployment serves, and two of
 * those can be in flight at once for different callers. A callback captured
 * once at construction would have nowhere concurrency-safe to carry
 * per-request context — see `http.ts`'s doc comment on `ApiHandler`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/index.js';
import type { ApiRequestTelemetry } from '../src/config.js';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { call } from './support.js';

let fixtures: QueryFixtures;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['API_FREE']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
}, 300_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

function appAndEvents(): { app: ReturnType<typeof createApiApp>; events: ApiRequestTelemetry[] } {
  const app = createApiApp({ queryModel: fixtures.qm, verticalId: fixtures.vertical.id });
  return { app, events: [] };
}

describe('onRequest telemetry', () => {
  it('reports the matched route key for a successful request, not the request target', async () => {
    const { app, events } = appAndEvents();
    await call(app, `/v1/entities/${fixtures.equipment.id}`, { onRequest: (info) => events.push(info) });
    expect(events).toEqual([{ method: 'GET', routeKey: 'entities.detail', status: 200 }]);
  });

  it('reports the same key for a parameterised route regardless of the parameter value', async () => {
    const { app, events } = appAndEvents();
    const onRequest = (info: ApiRequestTelemetry): number => events.push(info);
    await call(app, '/v1/entities/00000000-0000-4000-8000-000000000000', { onRequest }); // well-formed, no match
    await call(app, `/v1/entities/${fixtures.equipment.id}`, { onRequest }); // well-formed, matches
    expect(events.map((event) => event.routeKey)).toEqual(['entities.detail', 'entities.detail']);
    // Neither event, nor anything serialisable from this suite, carries the id.
    for (const event of events) {
      expect(JSON.stringify(event)).not.toContain(fixtures.equipment.id);
    }
  });

  it('reports unmatched, never the attempted path, when nothing matches', async () => {
    const { app, events } = appAndEvents();
    await call(app, '/v1/this-route-does-not-exist', { onRequest: (info) => events.push(info) });
    expect(events).toEqual([{ method: 'GET', routeKey: 'unmatched', status: 404 }]);
    expect(JSON.stringify(events)).not.toContain('this-route-does-not-exist');
  });

  it('reports unmatched for a disallowed method, before the target is parsed', async () => {
    const { app, events } = appAndEvents();
    await call(app, '/v1/entities/anything-at-all', {
      method: 'POST',
      onRequest: (info) => events.push(info),
    });
    expect(events).toEqual([{ method: 'POST', routeKey: 'unmatched', status: 405 }]);
  });

  it('reports unmatched for an unsupported version', async () => {
    const { app, events } = appAndEvents();
    await call(app, '/v99/health', { onRequest: (info) => events.push(info) });
    expect(events).toEqual([{ method: 'GET', routeKey: 'unmatched', status: 404 }]);
  });

  it('reports the root and contract documents by their own path', async () => {
    const { app, events } = appAndEvents();
    const onRequest = (info: ApiRequestTelemetry): number => events.push(info);
    await call(app, '/', { onRequest });
    await call(app, '/v1', { onRequest });
    expect(events.map((event) => event.routeKey)).toEqual(['service', 'contract']);
  });

  it('fires exactly once per request, on the error path too', async () => {
    const { app, events } = appAndEvents();
    await call(app, '/v1/entities/not-a-uuid', { onRequest: (info) => events.push(info) });
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe(400);
  });

  it('is optional: a call without one never throws for lacking one', async () => {
    const { app } = appAndEvents();
    const response = await call(app, `/v1/entities/${fixtures.equipment.id}`);
    expect(response.status).toBe(200);
  });

  it('keeps two concurrent requests from two different callers from crossing telemetry', async () => {
    const { app } = appAndEvents();
    const callerA: ApiRequestTelemetry[] = [];
    const callerB: ApiRequestTelemetry[] = [];
    await Promise.all([
      call(app, `/v1/entities/${fixtures.equipment.id}`, { onRequest: (info) => callerA.push(info) }),
      call(app, '/v1/health', { onRequest: (info) => callerB.push(info) }),
    ]);
    expect(callerA).toEqual([{ method: 'GET', routeKey: 'entities.detail', status: 200 }]);
    expect(callerB).toEqual([{ method: 'GET', routeKey: 'health', status: 200 }]);
  });
});
