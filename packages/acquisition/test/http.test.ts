import { describe, expect, it } from 'vitest';
import { ProviderTransportError } from '../src/errors.js';
import { headersToRecord, parseMimeType, requireFetch } from '../src/providers/http-client.js';
import { HttpAcquisitionProvider } from '../src/providers/http.js';
import { BODY, ETAG, TARGET_URL, makeHarness, makeRequest, makeResponse, stubFetch } from './helpers.js';

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
});

describe('HTTP acquisition provider', () => {
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

  it('fails rather than silently truncating an oversized body', async () => {
    const harness = makeHarness();
    const net = stubFetch(() => ({ status: 200, body: BODY }));
    const provider = new HttpAcquisitionProvider({
      deps: harness.deps,
      fetch: net.fetch,
      maxBytes: 8,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
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
