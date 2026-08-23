/**
 * The transport translation, and the two things it must not quietly do.
 *
 * It must not decide method policy — `createApiApp` rejects anything outside
 * GET/HEAD before it parses the target, and an adapter that answered `OPTIONS`
 * itself would put a decision in front of that check.
 *
 * It must not widen what the app can see. The app reads exactly one header;
 * copying the whole set would hand it cookies and `authorization` for free, and
 * the next handler to read `request.headers` would find them there.
 */
import { describe, expect, it } from 'vitest';
import { toApiRequest, toFetchResponse } from '../src/adapter.js';
import type { ApiResponse } from '@data-foundry/api';

const ok = (body: unknown): ApiResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body,
});

describe('Request to ApiRequest', () => {
  it('passes path and query, and drops the origin', () => {
    const request = new Request('https://api.example.com/v1/search?q=heat&limit=5');
    expect(toApiRequest(request).url).toBe('/v1/search?q=heat&limit=5');
  });

  it('hands every method through verbatim, so the app keeps deciding', () => {
    // Not a list of what is allowed — a proof that this file has no opinion.
    // TRACE is absent because the Fetch `Request` constructor refuses to build
    // one, so a Worker can never be handed it in the first place.
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const request = new Request('https://api.example.com/v1/health', { method });
      expect(toApiRequest(request).method, method).toBe(method);
    }
  });

  it('forwards x-request-id', () => {
    const request = new Request('https://api.example.com/v1/health', {
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(toApiRequest(request).headers?.['x-request-id']).toBe('abc-123');
  });

  it('forwards nothing else, so credentials never reach a handler', () => {
    const request = new Request('https://api.example.com/v1/health', {
      headers: {
        'x-request-id': 'abc-123',
        cookie: 'session=secret',
        authorization: 'Bearer secret',
        'cf-connecting-ip': '203.0.113.7',
      },
    });
    expect(Object.keys(toApiRequest(request).headers ?? {})).toEqual(['x-request-id']);
  });
});

describe('ApiResponse to Response', () => {
  it('serializes the body once, here', async () => {
    const response = toFetchResponse(ok({ status: 'ok' }), 'GET');
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.status).toBe(200);
  });

  it('carries the app’s headers through', () => {
    const response = toFetchResponse(
      { status: 200, headers: { 'x-api-version': 'v1', 'cache-control': 'no-store' }, body: {} },
      'GET',
    );
    expect(response.headers.get('x-api-version')).toBe('v1');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  describe('HEAD', () => {
    const body = { entities: [{ id: 1 }, { id: 2 }], total: 2 };

    it('sends no body', async () => {
      expect(await toFetchResponse(ok(body), 'HEAD').text()).toBe('');
    });

    it('still reports the length a GET would have sent, which is the point of HEAD', () => {
      const head = toFetchResponse(ok(body), 'HEAD');
      const get = toFetchResponse(ok(body), 'GET');
      expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
      // Not zero: a HEAD that reported 0 would be lying about the resource.
      expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
    });

    it('is case-insensitive, because a client may send `head`', async () => {
      expect(await toFetchResponse(ok(body), 'head').text()).toBe('');
    });
  });

  it('measures content-length in bytes, not characters', () => {
    // 'é' is two bytes in UTF-8. A `.length` implementation says 3 for "\"é\"".
    const response = toFetchResponse(ok('é'), 'GET');
    expect(response.headers.get('content-length')).toBe('4');
  });
});
