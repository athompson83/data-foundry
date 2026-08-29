import { describe, expect, it } from 'vitest';
import { ProviderTransportError } from '../src/errors.js';
import {
  headersToRecord,
  parseMimeType,
  readJson,
  requireFetch,
} from '../src/providers/http-client.js';
import {
  HttpAcquisitionProvider,
  MAX_HTTP_RESPONSE_BYTES,
} from '../src/providers/http.js';
import {
  BODY,
  ETAG,
  TARGET_URL,
  forbiddenFetch,
  makeHarness,
  makeRequest,
  makeResponse,
  makeStreamingResponse,
  stubFetch,
} from './helpers.js';

describe('HTTP client helpers', () => {
  it('lowercases response header names', () => {
    expect(headersToRecord(makeResponse({ headers: { ETag: ETAG } }).headers)).toEqual({
      etag: ETAG,
    });
  });

  it('strips charset parameters from a content type', () => {
    expect(parseMimeType('text/html; charset=utf-8', 'x')).toBe('text/html');
    expect(parseMimeType(null, 'application/octet-stream')).toBe('application/octet-stream');
    expect(parseMimeType('', 'application/octet-stream')).toBe('application/octet-stream');
  });

  it('prefers the injected fetch over the ambient one', () => {
    const injected = stubFetch(() => ({})).fetch;
    expect(requireFetch('test', injected)).toBe(injected);
  });

  it('falls back to the runtime fetch, and refuses at construction when there is none', () => {
    const runtime = globalThis as { fetch?: unknown };
    const original = runtime.fetch;
    try {
      expect(requireFetch('test', undefined)).toBeTypeOf('function');
      delete runtime.fetch;
      expect(() => requireFetch('test', undefined)).toThrow(ProviderTransportError);
    } finally {
      runtime.fetch = original;
    }
  });

  it('bounds declared control-plane JSON before reading and cancels the body', async () => {
    const body = makeStreamingResponse({
      headers: { 'content-length': '9' },
      chunks: [new TextEncoder().encode('{"x":1}')],
    });

    await expect(readJson('browser-run', body.response, 8)).rejects.toBeInstanceOf(
      ProviderTransportError,
    );
    expect(body.reads).toBe(0);
    expect(body.cancellations).toBe(1);
    expect(body.arrayBufferReads).toBe(0);
  });

  it('cancels chunked control-plane JSON on cumulative overflow', async () => {
    const body = makeStreamingResponse({
      chunks: [
        new TextEncoder().encode('{"x":"'),
        new TextEncoder().encode('abc'),
        new TextEncoder().encode('"}'),
        new TextEncoder().encode('not-read'),
      ],
    });

    await expect(readJson('crawl4ai', body.response, 8)).rejects.toBeInstanceOf(
      ProviderTransportError,
    );
    expect(body.reads).toBe(2);
    expect(body.cancellations).toBe(1);
    expect(body.arrayBufferReads).toBe(0);
  });
});

describe('HTTP acquisition provider', () => {
  it('refuses an invalid request ceiling before network transport', async () => {
    const harness = makeHarness();
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest({ maxBytes: Number.NaN }))).rejects.toThrow(
      /response byte ceiling/i,
    );
    expect(net.calls).toEqual([]);
    expect(harness.files.size).toBe(0);
  });

  it('rechecks authorization immediately before transport', async () => {
    const checks: string[] = [];
    const harness = makeHarness({
      beforeTransport: ({ request }) => {
        checks.push(request.url);
        return Promise.reject(new Error('stored rights changed before transport'));
      },
    });
    const net = forbiddenFetch();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toThrow(/stored rights changed/);
    expect(checks).toEqual([TARGET_URL]);
    expect(net.calls).toEqual([]);
  });

  it('rechecks authorization exactly once after transport and before artifact persistence', async () => {
    let checks = 0;
    const harness = makeHarness({
      beforePersistence: () => {
        checks += 1;
        return Promise.reject(new Error('stored rights changed before persistence'));
      },
    });
    const net = stubFetch(() => ({ status: 200, body: BODY }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toThrow(/changed before persistence/);
    expect(net.calls).toHaveLength(1);
    expect(checks).toBe(1);
    expect(harness.files.size).toBe(0);
  });

  it('requires the pre-persistence checkpoint before returning NOT_MODIFIED', async () => {
    let checks = 0;
    const harness = makeHarness({
      beforePersistence: () => {
        checks += 1;
        return Promise.reject(new Error('stored rights changed before freshness'));
      },
    });
    const net = stubFetch(() => ({ status: 304, headers: { etag: ETAG } }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toThrow(/changed before freshness/);
    expect(net.calls).toHaveLength(1);
    expect(checks).toBe(1);
    expect(harness.files.size).toBe(0);
  });

  it('identifies the crawler on every request', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({ status: 200, body: BODY }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await provider.fetch(makeRequest());
    expect(net.calls[0]?.init?.headers?.['user-agent']).toBe('DataFoundryBot/test');
  });

  it('lets the caller add headers and choose a method and body', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({ status: 200, body: BODY }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await provider.fetch(
      makeRequest({ method: 'POST', body: '{"q":1}', headers: { Accept: 'application/json' } }),
    );

    expect(net.calls[0]?.init?.method).toBe('POST');
    expect(net.calls[0]?.init?.body).toBe('{"q":1}');
    expect(net.calls[0]?.init?.headers?.['accept']).toBe('application/json');
  });

  it('is format-blind: any mime type becomes evidence', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': 'application/pdf' },
      body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const result = await provider.fetch(makeRequest());
    expect(result.artifacts[0]?.mime_type).toBe('application/pdf');
    expect(result.artifacts[0]?.byte_size).toBe(4);
  });

  it('preflights canonical artifact metadata before writing any evidence bytes', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { 'content-type': `application/${'x'.repeat(256)}` },
      body: BODY,
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toThrow();
    expect(harness.files.size).toBe(0);
  });

  it('preflights durable validator bounds before writing any evidence bytes', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({
      status: 200,
      headers: { etag: `"${'x'.repeat(1_024)}"` },
      body: BODY,
    }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    await expect(provider.fetch(makeRequest())).rejects.toThrow(/etag/i);
    expect(harness.files.size).toBe(0);
  });

  it('defaults an unlabelled response to application/octet-stream', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({ status: 200, body: BODY }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    expect((await provider.fetch(makeRequest())).artifacts[0]?.mime_type).toBe(
      'application/octet-stream',
    );
  });

  it('does not treat an error response as evidence', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({ status: 503, body: 'upstream is unwell' }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    const result = await provider.fetch(makeRequest());
    expect(result.outcome).toBe('EMPTY');
    expect(result.artifacts).toEqual([]);
    expect(harness.files.size).toBe(0);
    expect(result.diagnostics.join(' ')).toContain('503');
  });

  it('refuses an oversized declared length before reading and cancels the body', async () => {
    const harness = makeHarness();
    const body = makeStreamingResponse({
      headers: { 'content-length': '9' },
      chunks: [new TextEncoder().encode('123456789')],
    });
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: () => Promise.resolve(body.response),
      maxBytes: 8,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
    expect(body.reads).toBe(0);
    expect(body.cancellations).toBe(1);
    expect(body.arrayBufferReads).toBe(0);
  });

  it('preflights identical comma-combined Content-Length values conservatively', async () => {
    const harness = makeHarness();
    const body = makeStreamingResponse({
      headers: { 'content-length': '9, 9' },
      chunks: [new TextEncoder().encode('123456789')],
    });
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: () => Promise.resolve(body.response),
      maxBytes: 8,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
    expect(body.reads).toBe(0);
    expect(body.cancellations).toBe(1);
  });

  it('applies the finite default when no caller ceiling is provided', async () => {
    const harness = makeHarness();
    const body = makeStreamingResponse({
      headers: { 'content-length': String(MAX_HTTP_RESPONSE_BYTES + 1) },
      chunks: [new Uint8Array()],
    });
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: () => Promise.resolve(body.response),
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
    expect(body.reads).toBe(0);
    expect(body.cancellations).toBe(1);
  });

  it('refuses a positive declared length when Fetch exposes no response body', async () => {
    const harness = makeHarness();
    const response = {
      ...makeResponse({ headers: { 'content-length': '4' }, body: '' }),
      body: null,
    };
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: () => Promise.resolve(response),
      maxBytes: 8,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
    expect(harness.files.size).toBe(0);
  });

  it('cancels a chunked response as soon as its cumulative bytes cross the ceiling', async () => {
    const harness = makeHarness();
    const body = makeStreamingResponse({
      chunks: [
        new Uint8Array([1, 2, 3, 4]),
        new Uint8Array([5, 6, 7, 8]),
        new Uint8Array([9, 10, 11, 12]),
        new Uint8Array([13, 14, 15, 16]),
      ],
    });
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: () => Promise.resolve(body.response),
      maxBytes: 8,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
    expect(body.reads).toBe(3);
    expect(body.cancellations).toBe(1);
    expect(body.arrayBufferReads).toBe(0);
    expect(harness.files.size).toBe(0);
  });

  it.each([
    ['under', [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7])]],
    ['exactly at', [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])]],
  ] as const)('preserves a body %s the configured ceiling without truncation', async (_label, chunks) => {
    const harness = makeHarness();
    const body = makeStreamingResponse({ chunks });
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: () => Promise.resolve(body.response),
      maxBytes: 8,
    });

    const result = await provider.fetch(makeRequest());
    const expectedBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    expect(result.artifacts[0]?.byte_size).toBe(expectedBytes);
    const stored = await harness.store.get(result.stored[0]!.key);
    expect([...stored!.body]).toEqual(chunks.flatMap((chunk) => [...chunk]));
    expect(body.reads).toBe(chunks.length);
    expect(body.cancellations).toBe(0);
    expect(body.arrayBufferReads).toBe(0);
  });

  it('lets a request override the provider-wide byte ceiling', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({ status: 200, body: BODY }));
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: net.fetch,
      maxBytes: 8,
    });

    const result = await provider.fetch(makeRequest({ maxBytes: 4096 }));
    expect(result.artifacts).toHaveLength(1);
  });

  it('serves the feed-shaped acquisition methods too', () => {
    const harness = makeHarness();
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: stubFetch(() => ({})).fetch,
    });
    expect(provider.methods).toEqual(['DIRECT_HTTP', 'VENDOR_API', 'SITEMAP', 'BULK_FILE', 'RSS']);
  });

  it('reports the URL it actually retrieved', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({ status: 200, body: BODY }));
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    expect((await provider.fetch(makeRequest())).artifacts[0]?.url).toBe(TARGET_URL);
  });
});

/**
 * A redirect is a second request to a host the gate never saw.
 *
 * `evaluateAcquisitionGate` checks the URL it is given. The ambient `fetch`
 * defaults to `redirect: 'follow'`, and `HttpRequestInit` had no field with
 * which to say otherwise — so a permitted source could answer 302 and the
 * client would go on to contact whatever host the `Location` header named,
 * including one refused by name in platform code. The gate would have allowed
 * exactly one URL and the process would have contacted two.
 *
 * The stored artifact compounds it: `request.url` is recorded as the source of
 * the bytes, so evidence would attribute a prohibited host's content to a
 * permitted one. That is a rule-10 defect sitting on top of a rights defect.
 *
 * Following redirects safely means re-running the whole gate per hop — rights,
 * robots, scope, rate limit, policy snapshot — and that machinery lives in the
 * base class, not here. Until it exists, the honest behaviour is to refuse and
 * say which host was proposed.
 */
describe('a redirect is refused rather than followed', () => {
  const REDIRECT_TARGET = 'https://www.carrier.com/manuals/index.json';

  const redirectingFetch = (status: number, location: string | null) =>
    stubFetch(() => ({
      status,
      headers: location === null ? {} : { location },
      body: '',
    }));

  it('asks the client not to follow in the first place', async () => {
    const net = stubFetch(() => ({ status: 200, headers: {}, body: '{}' }));
    const harness = makeHarness();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });
    await provider.fetch(makeRequest());
    // Belt: the transport must not delegate the decision to the runtime default.
    expect(net.calls[0]?.init?.redirect).toBe('manual');
  });

  it('refuses a redirect to a prohibited host without contacting it', async () => {
    const net = redirectingFetch(302, REDIRECT_TARGET);
    const harness = makeHarness();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });

    // `REDIRECT_NOT_GATED` is the contract: `gate-types.ts` lists it in
    // `RIGHTS_GATE_CODES`, which is what makes `isRightsBlocker` treat this as
    // a rights refusal. Matching the prose would survive a change of code.
    await expect(provider.fetch(makeRequest())).rejects.toMatchObject({
      name: 'AcquisitionRefusedError',
      code: 'REDIRECT_NOT_GATED',
    });

    // Braces: exactly one request, and it was to the gated URL.
    expect(net.calls.length).toBe(1);
    expect(net.calls[0]?.url).toBe(TARGET_URL);
    expect(net.calls.some((call) => call.url.includes('carrier.com'))).toBe(false);
  });

  it('cancels an unread redirect body when refusing the ungated destination', async () => {
    const body = makeStreamingResponse({
      status: 302,
      headers: { location: REDIRECT_TARGET },
      chunks: [new TextEncoder().encode('redirect payload')],
    });
    const harness = makeHarness();
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: () => Promise.resolve(body.response),
    });

    await expect(provider.fetch(makeRequest())).rejects.toMatchObject({
      code: 'REDIRECT_NOT_GATED',
    });
    expect(body.reads).toBe(0);
    expect(body.cancellations).toBe(1);
  });

  it('names the host it was asked to contact', async () => {
    const net = redirectingFetch(301, REDIRECT_TARGET);
    const harness = makeHarness();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });
    // Here the message *is* the subject — the refusal must name the host — so
    // this one asserts both the code and the text.
    await expect(provider.fetch(makeRequest())).rejects.toMatchObject({
      code: 'REDIRECT_NOT_GATED',
    });
    await expect(provider.fetch(makeRequest())).rejects.toThrow(/www\.carrier\.com/);
  });

  it('refuses every redirect status, not only the prohibited destination', async () => {
    // The refusal is not "that host is prohibited" — it is "the gate has not
    // seen this URL". A redirect to an innocuous host is equally ungated.
    for (const status of [301, 302, 303, 307, 308]) {
      const net = redirectingFetch(status, 'https://elsewhere.example.org/x.json');
      const harness = makeHarness();
      const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });
      await expect(provider.fetch(makeRequest()), `status ${status}`).rejects.toMatchObject({
        code: 'REDIRECT_NOT_GATED',
      });
      expect(net.calls.length, `status ${status}`).toBe(1);
    }
  });

  it('refuses a 3xx with no Location rather than treating it as a body', async () => {
    const net = redirectingFetch(302, null);
    const harness = makeHarness();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });
    await expect(provider.fetch(makeRequest())).rejects.toMatchObject({
      code: 'REDIRECT_NOT_GATED',
    });
  });

  it('still passes a 304 through, which is not a redirect', async () => {
    // Guards the fix: 304 shares the 3xx range and is the whole point of
    // conditional requests. Refusing it would break incremental refresh.
    const net = stubFetch(() => ({ status: 304, headers: {}, body: '' }));
    const harness = makeHarness();
    const provider = new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch });
    const result = await provider.fetch(makeRequest());
    // The conditional path stores nothing and says so in diagnostics.
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.join(' ')).toMatch(/304/);
  });
});
