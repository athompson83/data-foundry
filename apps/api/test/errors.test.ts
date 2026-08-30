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
import { ApiError, API_ERROR_CODES, ERROR_STATUS, toErrorBody } from '../src/errors.js';
import { call, createApiFixtures, dataOf, errorOf, type ApiFixtures } from './support.js';

let fixtures: ApiFixtures;

beforeAll(async () => {
  fixtures = await createApiFixtures();
}, 300_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('trusted access context', () => {
  it('fails closed when the transport does not bind an authenticated surface', async () => {
    const response = await fixtures.app({
      method: 'GET',
      url: '/v1/health',
      // A caller-controlled header must never substitute for composition-root
      // authentication and billing classification.
      headers: { 'x-data-foundry-surface': 'API_PAID' },
    });
    expect(response.status).toBe(503);
    expect(errorOf(response).code).toBe('SERVICE_UNAVAILABLE');
  });
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
  it('validates the body through the shared wire schema before returning it', () => {
    const failure = new ApiError('ROUTE_NOT_FOUND', 'No route matches this request.');
    expect(() => toErrorBody(failure, 'x'.repeat(65))).toThrow();
    expect(toErrorBody(failure, 'request-123')).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        status: 404,
        message: 'No route matches this request.',
        requestId: 'request-123',
      },
    });
  });

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

  it('refuses a write to every shape of path, routed or not', async () => {
    // The defect this pins: the method check ran AFTER routing, so every answer
    // that returned before a route was matched answered a write with 200 — the
    // service document at `/` and the contract document at `/v1` are exactly
    // those answers. A read-only surface whose read-only-ness depends on the
    // shape of the path is not read-only; it is read-only where someone
    // remembered. So the guarantee is asserted at the door, on paths that
    // route, paths that do not, and a version that does not exist.
    const paths = [
      '/',
      '/v1',
      '/v1/health',
      `/v1/entities/${fixtures.equipment.id}`,
      '/v1/nope',
      '/v2/health',
      '/v1/entities/%ZZ',
    ];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT']) {
      for (const path of paths) {
        const response = await call(fixtures.app, path, { method });
        expect(response.status, `${method} ${path}`).toBe(405);
        expect(response.headers['allow'], `${method} ${path}`).toBe('GET, HEAD');
        expect(errorOf(response).code, `${method} ${path}`).toBe('METHOD_NOT_ALLOWED');
      }
    }
  });

  it('refuses a method nobody has heard of, rather than listing the bad ones', async () => {
    // An allow-list, not a deny-list: the failure mode of a deny-list is a
    // method it has never been told about, and WebDAV alone contributes a dozen
    // that write. Lower case counts too — a guard that compares the raw string
    // is bypassed by the shift key.
    for (const method of ['BREW', 'PROPPATCH', 'MKCOL', 'post', 'delete', '']) {
      const response = await call(fixtures.app, '/v1', { method });
      expect(response.status, method).toBe(405);
      expect(errorOf(response).code, method).toBe('METHOD_NOT_ALLOWED');
    }
  });

  it('still serves both read methods everywhere they were already served', async () => {
    // The other half of the guarantee: closing the bypass must not close the
    // door on the two methods this surface exists to answer.
    for (const path of ['/', '/v1', '/v1/health', `/v1/entities/${fixtures.equipment.id}`]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await call(fixtures.app, path, { method });
        expect(response.status, `${method} ${path}`).toBe(200);
      }
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

/**
 * The same principle the pagination bounds are built on, applied to filters.
 *
 * The contract document says out-of-range paging is "Rejected with 400
 * INVALID_PARAMETER. Values are never silently clamped", and the reason is that
 * a client cannot see the difference between a result set and a quietly
 * altered one. A filter is the sharper case: a caller who asks for a subset and
 * silently receives the whole collection — or a different subset — has no
 * signal at all, and every count and page they derive from it is wrong.
 */
describe('filters are honoured or refused, never silently altered', () => {
  /** Entities holding a `seer2_rating` fact: the two equipment, not the parts. */
  const RATED_ENTITIES = 2;

  const hitCount = (response: Awaited<ReturnType<typeof call>>): number =>
    dataOf<{ entity: { id: string } }[]>(response).length;

  it('refuses a presence flag whose spelling it does not recognise', async () => {
    // These were dropped on the floor: the loop recognised `true`, `1` and the
    // bare flag, and every other value fell through the `if` with no filter
    // pushed and no error raised. `filter.x.exists=yes` therefore answered 200
    // with every entity in the vertical — including all the ones that do not
    // have the property the caller filtered on.
    for (const value of ['yes', 'no', 'on', 'TRUE', 'True', '2', 'null']) {
      const url = `/v1/search?filter.seer2_rating.exists=${value}`;
      const response = await call(fixtures.app, url);
      expect(response.status, url).toBe(400);
      expect(errorOf(response).code, url).toBe('INVALID_PARAMETER');
      expect(errorOf(response).details, url).toMatchObject({
        parameter: 'filter.seer2_rating.exists',
      });
    }
  });

  it('refuses a negated presence flag rather than inventing one', async () => {
    // `exists` is the only presence operator the query layer models; there is
    // no "absent" form. Answering `=false` by dropping the filter returns the
    // opposite of what was asked for, and answering it by composing a negation
    // here would be this surface deciding what a filter means (rule 5). It is
    // refused, and the message says the form does not exist.
    for (const value of ['false', '0']) {
      const response = await call(fixtures.app, `/v1/search?filter.seer2_rating.exists=${value}`);
      expect(response.status, value).toBe(400);
      expect(errorOf(response).code, value).toBe('INVALID_PARAMETER');
    }
  });

  it('still honours every spelling it does accept, and narrows the result set', async () => {
    // The other half: refusing the unrecognised spellings must not cost the
    // recognised ones. Asserted through the result set rather than the status,
    // because a filter that parses and then does nothing is the defect above
    // wearing a 200.
    const unfiltered = await call(fixtures.app, '/v1/search?limit=100');
    expect(hitCount(unfiltered)).toBeGreaterThan(RATED_ENTITIES);

    for (const spelling of ['=true', '=1', '']) {
      const url = `/v1/search?limit=100&filter.seer2_rating.exists${spelling}`;
      const response = await call(fixtures.app, url);
      expect(response.status, url).toBe(200);
      expect(hitCount(response), url).toBe(RATED_ENTITIES);
    }
  });

  it('refuses an empty range bound instead of reading it as zero', async () => {
    // `Number('')` is 0, not NaN, so an empty bound passed the finiteness check
    // and became a real constraint: `filter.tonnage.min=` was `tonnage >= 0`,
    // which quietly dropped every entity with no tonnage fact at all — the
    // parts — from a result set the caller had not filtered. Whitespace is the
    // same trap: `Number(' ')` is 0 too.
    for (const url of [
      '/v1/search?limit=100&filter.tonnage.min=',
      '/v1/search?limit=100&filter.tonnage.max=',
      '/v1/search?limit=100&filter.tonnage.min=%20',
      '/v1/search?limit=100&filter.tonnage.min=&filter.tonnage.max=6',
    ]) {
      const response = await call(fixtures.app, url);
      expect(response.status, url).toBe(400);
      expect(errorOf(response).code, url).toBe('INVALID_PARAMETER');
      expect(errorOf(response).details, url).toMatchObject({ expected: 'expected a number' });
    }
  });

  it('still applies a range bound that was actually written', async () => {
    const response = await call(fixtures.app, '/v1/search?limit=100&filter.tonnage.min=4');
    expect(response.status).toBe(200);
    // The heat pump is 4 tons and the equipment is 3, so a real bound is
    // observable: one of the two rated entities survives it.
    expect(hitCount(response)).toBe(1);
    expect(dataOf<{ entity: { id: string } }[]>(response)[0]?.entity.id).toBe(
      fixtures.heatPump.id,
    );
  });
});
