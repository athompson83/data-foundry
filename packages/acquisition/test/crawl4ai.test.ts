import { describe, expect, it } from 'vitest';
import { AcquisitionConfigurationError, ProviderTransportError } from '../src/errors.js';
import { Crawl4AIAcquisitionProvider } from '../src/providers/crawl4ai.js';
import type { StubResponse } from './helpers.js';
import {
  BODY,
  ETAG,
  TARGET_URL,
  compliantEntry,
  makeHarness,
  makeRequest,
  stubFetch,
} from './helpers.js';

const BASE_URL = 'http://crawl4ai.internal:11235';
const childRequest = () => makeRequest({
  resultUrlPolicy: {
    allowedOrigins: [new URL(TARGET_URL).origin],
    allowedPathPrefixes: [new URL(TARGET_URL).pathname],
  },
});

function crawl4aiEntry() {
  const entry = compliantEntry();
  return {
    ...entry,
    acquisition_policy: { ...entry.acquisition_policy, method: 'CRAWL4AI' as const },
  };
}

function results(value: unknown): StubResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

describe('Crawl4AI provider — configuration', () => {
  it('requires a service base URL', () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    expect(
      () =>
        new Crawl4AIAcquisitionProvider({
          deps: harness.deps,
          baseUrl: '',
          fetch: stubFetch(() => ({})).fetch,
        }),
    ).toThrow(AcquisitionConfigurationError);
  });

  it('posts the documented crawl payload and omits auth when no token is configured', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() =>
      results({ success: true, results: [{ url: TARGET_URL, html: BODY, status_code: 200 }] }),
    );
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    await provider.fetch(makeRequest());

    expect(api.calls[0]?.url).toBe(`${BASE_URL}/crawl`);
    expect(api.calls[0]?.init?.headers?.['authorization']).toBeUndefined();
    expect(JSON.parse(api.calls[0]?.init?.body ?? '{}')).toMatchObject({ urls: [TARGET_URL] });
  });

  it('sends a bearer token when the service is protected', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() => results({ success: true, results: [] }));
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      apiToken: 'secret',
      fetch: api.fetch,
    });

    await provider.fetch(makeRequest());
    expect(api.calls[0]?.init?.headers?.['authorization']).toBe('Bearer secret');
  });

  it('forwards the crawler identity to the service', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() => results({ success: true, results: [] }));
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    await provider.fetch(makeRequest());

    const payload = JSON.parse(api.calls[0]?.init?.body ?? '{}') as {
      crawler_config?: { headers?: Record<string, string> };
    };
    expect(payload.crawler_config?.headers?.['user-agent']).toBe('DataFoundryBot/test');
  });
});

describe('Crawl4AI provider — result mapping', () => {
  it('prefers raw HTML as the strongest evidence', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() =>
      results({
        success: true,
        results: [{ url: TARGET_URL, html: BODY, markdown: '# ignored', status_code: 200 }],
      }),
    );
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    const result = await provider.fetch(childRequest());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.mime_type).toBe('text/html');
    expect(result.artifacts[0]?.acquisition_provider).toBe('crawl4ai');
  });

  it('falls back through the configured format preference', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() =>
      results({ success: true, results: [{ url: TARGET_URL, markdown: '# heading' }] }),
    );
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
      formats: ['html', 'markdown'],
    });

    const result = await provider.fetch(childRequest());
    expect(result.artifacts[0]?.mime_type).toBe('text/markdown');
  });

  it('accepts the structured markdown shape newer builds return', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() =>
      results({
        success: true,
        results: [{ url: TARGET_URL, markdown: { raw_markdown: '# raw', fit_markdown: '# fit' } }],
      }),
    );
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
      formats: ['markdown'],
    });

    const result = await provider.fetch(childRequest());
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.byte_size).toBe(new TextEncoder().encode('# raw').byteLength);
  });

  it('evaluates conditional validators the service does not', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() =>
      results({
        success: true,
        results: [
          { url: TARGET_URL, html: BODY, status_code: 200, response_headers: { ETag: ETAG } },
        ],
      }),
    );
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    const first = await provider.fetch(makeRequest());
    expect(first.outcome).toBe('FETCHED');

    const second = await provider.fetch(makeRequest());
    expect(second.outcome).toBe('NOT_MODIFIED');
    expect(second.artifacts).toEqual([]);
  });

  it('carries the upstream status code onto the artifact', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() =>
      results({ success: true, results: [{ url: TARGET_URL, html: BODY, status_code: 203 }] }),
    );
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    expect((await provider.fetch(makeRequest())).artifacts[0]?.http_status).toBe(203);
  });
});

describe('Crawl4AI provider — degrading cleanly', () => {
  it('raises a typed transport error on an HTTP failure', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() => ({ status: 502, body: JSON.stringify({ detail: 'bad gateway' }) }));
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    const error = await provider.fetch(makeRequest()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).httpStatus).toBe(502);
  });

  it('raises when the service reports failure', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() => results({ success: false, error_message: 'browser crashed' }));
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    await expect(provider.fetch(makeRequest())).rejects.toThrow(/browser crashed/);
  });

  it('reports an empty acquisition rather than crashing on a missing results array', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() => results({ success: true }));
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    const result = await provider.fetch(makeRequest());
    expect(result.outcome).toBe('EMPTY');
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('no results array');
  });

  it('drops per-result failures with a diagnostic', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() =>
      results({
        success: true,
        results: [
          { url: TARGET_URL, success: false, error_message: 'timeout' },
          { url: `${TARGET_URL}?p=2`, html: BODY },
        ],
      }),
    );
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    const result = await provider.fetch(childRequest());
    expect(result.artifacts).toHaveLength(1);
    expect(result.diagnostics.join(' ')).toContain('timeout');
  });

  it('raises a typed error rather than a SyntaxError on a non-JSON body', async () => {
    const harness = makeHarness({ entry: crawl4aiEntry() });
    const api = stubFetch(() => ({ status: 200, body: '<html>gateway page</html>' }));
    const provider = new Crawl4AIAcquisitionProvider({
      deps: harness.deps,
      baseUrl: BASE_URL,
      fetch: api.fetch,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
  });
});
