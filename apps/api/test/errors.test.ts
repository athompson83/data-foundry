/**
 * The failure contract.
 *
 * One envelope for every failure, a machine-readable code in it, and nothing
 * from inside the process in the message. A client that has to parse prose to
 * tell "you sent a bad id" from "we fell over" does not have a contract, it has
 * a habit — so the code, not the status and not the wording, is what these
 * tests pin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_ERROR_CODES, ERROR_STATUS } from '../src/errors.js';
import { call, createApiFixtures, errorOf, type ApiFixtures } from './support.js';

let fixtures: ApiFixtures;

beforeAll(async () => {
  fixtures = await createApiFixtures();
}, 300_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

/** Every failure this suite can provoke, with the code it must carry. */
const FAILURES: readonly { url: string; method?: string; status: number; code: string }[] = [
  { url: '/v1/nope', status: 404, code: 'ROUTE_NOT_FOUND' },
  { url: '/v2/health', status: 404, code: 'UNSUPPORTED_API_VERSION' },
  { url: '/health', status: 404, code: 'UNSUPPORTED_API_VERSION' },
  { url: '/v1/entities/not-a-uuid', status: 400, code: 'INVALID_PARAMETER' },
  { url: '/v1/entities/%ZZ', status: 400, code: 'INVALID_PARAMETER' },
  {
    url: '/v1/entities/33333333-3333-4333-8333-333333333333',
    status: 404,
    code: 'ENTITY_NOT_FOUND',
  },
  { url: '/v1/entities/by-slug/Not_A_Slug?type=equipment', status: 400, code: 'INVALID_PARAMETER' },
  { url: '/v1/search?filter.no_such_field=1', status: 422, code: 'UNPROCESSABLE_QUERY' },
  { url: '/v1/health', method: 'POST', status: 405, code: 'METHOD_NOT_ALLOWED' },
  { url: '/v1/search?limit=0', status: 400, code: 'INVALID_PARAMETER' },
  { url: '/v1/compare?ids=', status: 400, code: 'INVALID_PARAMETER' },
];

describe('the error envelope', () => {
  it('is the same shape for every failure', async () => {
    for (const failure of FAILURES) {
      const response = await call(fixtures.app, failure.url, {
        ...(failure.method === undefined ? {} : { method: failure.method }),
      });
      expect(response.status, failure.url).toBe(failure.status);

      const body = response.body as Record<string, unknown>;
      expect(Object.keys(body), failure.url).toEqual(['error']);

      const error = errorOf(response);
      expect(error.code, failure.url).toBe(failure.code);
      expect(error.status, failure.url).toBe(failure.status);
      expect(typeof error.message, failure.url).toBe('string');
      expect(error.message.length, failure.url).toBeGreaterThan(0);
      expect(response.headers['content-type'], failure.url).toBe('application/json; charset=utf-8');
    }
  });

  it('never carries a stack trace, a SQL fragment or a file path', async () => {
    for (const failure of FAILURES) {
      const raw = JSON.stringify(
        (
          await call(fixtures.app, failure.url, {
            ...(failure.method === undefined ? {} : { method: failure.method }),
          })
        ).body,
      );
      for (const forbidden of ['\\n    at ', 'SELECT ', 'INSERT ', 'node_modules', '.ts:', 'pglite']) {
        expect(raw.toLowerCase(), `${failure.url} / ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it('uses one status per code, so a code is never ambiguous', () => {
    for (const code of API_ERROR_CODES) {
      expect(typeof ERROR_STATUS[code]).toBe('number');
    }
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it('echoes a well-formed x-request-id and refuses a hostile one', async () => {
    const good = await call(fixtures.app, '/v1/nope', {
      headers: { 'x-request-id': 'abc-123_45:6' },
    });
    expect(errorOf(good).requestId).toBe('abc-123_45:6');

    const bad = await call(fixtures.app, '/v1/nope', {
      headers: { 'x-request-id': '</script><img src=x onerror=alert(1)>' },
    });
    expect(errorOf(bad).requestId).toBeUndefined();
    expect(JSON.stringify(bad.body)).not.toContain('onerror');
  });
});

describe('version negotiation', () => {
  it('treats the path segment as the only version selector', async () => {
    // An Accept header naming another version changes nothing: the path decides.
    const response = await call(fixtures.app, '/v1/health', {
      headers: { accept: 'application/vnd.data-foundry.v9+json' },
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-api-version']).toBe('v1');
  });

  it('refuses an unknown version and says which ones exist', async () => {
    const response = await call(fixtures.app, '/v2/entities/anything');
    expect(response.status).toBe(404);
    expect(errorOf(response)).toMatchObject({
      code: 'UNSUPPORTED_API_VERSION',
      details: { requested: 'v2', supported: ['v1'] },
    });
  });

  it('does not silently serve the newest contract to an unversioned path', async () => {
    // `/health` is a real route under `/v1`. Answering it unversioned would mean
    // a client is pinned to whatever we deploy next without knowing it.
    const response = await call(fixtures.app, '/health');
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('UNSUPPORTED_API_VERSION');
  });
});

describe('read-only enforcement', () => {
  it('refuses every write method with an Allow header', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}`, { method });
      expect(response.status, method).toBe(405);
      expect(response.headers['allow'], method).toBe('GET, HEAD');
      expect(errorOf(response).code, method).toBe('METHOD_NOT_ALLOWED');
    }
  });

  it('serves HEAD exactly as GET at the handler level', async () => {
    const get = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}`);
    const head = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}`, {
      method: 'HEAD',
    });
    expect(head.status).toBe(get.status);
    expect(head.body).toEqual(get.body);
  });
});

describe('422 — the query layer refusing a filter, not the parser', () => {
  it('rejects a field the vertical never declared', async () => {
    const response = await call(fixtures.app, '/v1/search?filter.no_such_field=1');
    expect(response.status).toBe(422);
    expect(errorOf(response).details).toMatchObject({ field: 'no_such_field' });
  });

  it('rejects a declared field that opts out of filtering', async () => {
    // `internal_note` is declared with filter.type "none".
    const response = await call(fixtures.app, '/v1/search?filter.internal_note=secret');
    expect(response.status).toBe(422);
    expect(errorOf(response).details).toMatchObject({ field: 'internal_note' });
  });

  it('rejects a range filter on a non-numeric field', async () => {
    const response = await call(fixtures.app, '/v1/search?filter.refrigerant.min=1');
    expect(response.status).toBe(422);
    expect(errorOf(response).details).toMatchObject({ field: 'refrigerant' });
  });

  it('separates a malformed filter (400) from a refused one (422)', async () => {
    const malformed = await call(fixtures.app, '/v1/search?filter.tonnage.min=three');
    expect(malformed.status).toBe(400);
    expect(errorOf(malformed).code).toBe('INVALID_PARAMETER');
  });
});
