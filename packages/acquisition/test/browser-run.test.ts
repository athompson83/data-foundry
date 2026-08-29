import { describe, expect, it } from 'vitest';
import { AcquisitionConfigurationError, ProviderTransportError } from '../src/errors.js';
import {
  BROWSER_RUN_DEFAULT_BASE_URL,
  BrowserRunAcquisitionProvider,
  browserRunConfigFromEnv,
} from '../src/providers/browser-run.js';
import type { StubResponse } from './helpers.js';
import {
  BODY,
  LAST_MODIFIED,
  TARGET_URL,
  compliantEntry,
  makeHarness,
  makeRequest,
  stubFetch,
} from './helpers.js';

const ACCOUNT = 'acct_123';
const TOKEN = 'cf_token_do_not_hardcode';
const JOB_ID = 'c7f8s2d9-a8e7-4b6e-8e4d-3d4a1b2c3f4e';

const childRequest = () => makeRequest({
  resultUrlPolicy: {
    allowedOrigins: [new URL(TARGET_URL).origin],
    allowedPathPrefixes: [new URL(TARGET_URL).pathname],
  },
});

function browserRunEntry() {
  const entry = compliantEntry();
  return {
    ...entry,
    acquisition_policy: { ...entry.acquisition_policy, method: 'BROWSER_RUN' as const },
  };
}

function envelope(result: unknown): StubResponse {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, result }) };
}

/** Initiate returns a job id; the first status poll answers with the supplied job result. */
function crawlApi(jobResults: readonly unknown[]) {
  let poll = 0;
  return stubFetch((url, init) => {
    if (init?.method === 'POST' && url.endsWith('/browser-rendering/crawl')) {
      return envelope(JOB_ID);
    }
    if (url.includes(`/browser-rendering/crawl/${JOB_ID}`)) {
      const next = jobResults[Math.min(poll, jobResults.length - 1)];
      poll += 1;
      return envelope(next);
    }
    return { status: 404, body: JSON.stringify({ success: false, errors: [{ message: 'unexpected' }] }) };
  });
}

describe('Browser Run provider — configuration', () => {
  it('refuses to construct without credentials rather than defaulting them', () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    expect(
      () =>
        new BrowserRunAcquisitionProvider({
          deps: harness.deps,
          accountId: '',
          apiToken: '',
          fetch: stubFetch(() => ({})).fetch,
        }),
    ).toThrow(AcquisitionConfigurationError);
  });

  it('reads credentials from an explicitly supplied environment, never an ambient one', () => {
    expect(browserRunConfigFromEnv({})).toBeNull();
    expect(browserRunConfigFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'a' })).toBeNull();
    expect(
      browserRunConfigFromEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 'b' }),
    ).toEqual({ accountId: 'a', apiToken: 'b' });
  });

  it('targets the documented REST endpoint and authenticates as a bearer token', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([{ status: 'completed', records: [{ url: TARGET_URL, status: 'completed', html: BODY }] }]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    await provider.fetch(makeRequest());

    expect(api.calls[0]?.url).toBe(
      `${BROWSER_RUN_DEFAULT_BASE_URL}/accounts/${ACCOUNT}/browser-rendering/crawl`,
    );
    expect(api.calls[0]?.init?.headers?.['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(api.calls[1]?.url).toContain(`/browser-rendering/crawl/${JOB_ID}`);
  });

  it('defaults to render:false, the cheaper rung of the doc 05 hierarchy', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([{ status: 'completed', records: [{ url: TARGET_URL, status: 'completed', html: BODY }] }]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    await provider.fetch(makeRequest());

    const body = JSON.parse(api.calls[0]?.init?.body ?? '{}') as Record<string, unknown>;
    expect(body['render']).toBe(false);
    expect(body['formats']).toEqual(['html']);
    expect(body['url']).toBe(TARGET_URL);
  });
});

describe('Browser Run provider — crawl results', () => {
  it('turns completed records into artifacts', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([
      {
        status: 'completed',
        records: [
          { url: TARGET_URL, status: 'completed', html: BODY },
          { url: `${TARGET_URL}?page=2`, status: 'completed', html: '<p>second</p>' },
        ],
      },
    ]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    const result = await provider.fetch(childRequest());

    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0]?.acquisition_provider).toBe('browser-run');
    expect(result.artifacts[0]?.mime_type).toBe('text/html');
    expect(result.artifacts[1]?.url).toBe(`${TARGET_URL}?page=2`);
  });

  it('drops robots-disallowed records instead of storing them', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([
      {
        status: 'completed',
        records: [
          { url: TARGET_URL, status: 'completed', html: BODY },
          { url: `${TARGET_URL}/admin`, status: 'disallowed' },
        ],
      },
    ]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    const result = await provider.fetch(childRequest());

    expect(result.artifacts).toHaveLength(1);
    expect(result.diagnostics.join(' ')).toContain('robots disallowed');
  });

  it('polls until the job leaves the running state, using the injected clock', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([
      { status: 'running' },
      { status: 'running' },
      { status: 'completed', records: [{ url: TARGET_URL, status: 'completed', html: BODY }] },
    ]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
      pollIntervalMs: 1_500,
    });

    const result = await provider.fetch(makeRequest());

    expect(result.artifacts).toHaveLength(1);
    expect(harness.clock.sleeps).toEqual([1_500, 1_500]);
  });

  it('follows the pagination cursor', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([
      {
        status: 'completed',
        records: [{ url: TARGET_URL, status: 'completed', html: BODY }],
        cursor: '10',
      },
      {
        status: 'completed',
        records: [{ url: `${TARGET_URL}?page=2`, status: 'completed', html: '<p>2</p>' }],
      },
    ]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    const result = await provider.fetch(childRequest());

    expect(result.artifacts).toHaveLength(2);
    expect(api.calls[2]?.url).toContain('cursor=10');
  });

  it.each([
    'https://off-scope.example.net/catalog/units.json?page=2',
    `${new URL(TARGET_URL).origin}/admin/units.json?page=2`,
    `${TARGET_URL}/%2e%2e/admin`,
  ])('preflights every result and leaves R2 empty for an off-scope child: %s', async (badUrl) => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([{
      status: 'completed',
      records: [
        { url: TARGET_URL, status: 'completed', html: BODY },
        { url: badUrl, status: 'completed', html: '<p>bad</p>' },
      ],
    }]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    await expect(provider.fetch(childRequest())).rejects.toThrow(/result policy/i);
    expect(harness.files.size).toBe(0);
  });

  it('sends modifiedSince and reports NOT_MODIFIED when everything was skipped', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([
      { status: 'completed', records: [{ url: TARGET_URL, status: 'skipped' }] },
    ]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    const result = await provider.fetch(
      makeRequest({ conditional: { lastModified: LAST_MODIFIED } }),
    );

    const body = JSON.parse(api.calls[0]?.init?.body ?? '{}') as Record<string, unknown>;
    expect(body['modifiedSince']).toBe(Math.floor(Date.parse(LAST_MODIFIED) / 1000));
    expect(result.outcome).toBe('NOT_MODIFIED');
    expect(result.artifacts).toEqual([]);
  });

  it('uses /json for structured extraction when asked', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = stubFetch(() => envelope({ model: 'XC21', seer2: 16.2 }));
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    const result = await provider.fetch(
      makeRequest({ providerOptions: { mode: 'json', prompt: 'extract the model' } }),
    );

    expect(api.calls[0]?.url).toContain('/browser-rendering/json');
    expect(JSON.parse(api.calls[0]?.init?.body ?? '{}')).toMatchObject({
      url: TARGET_URL,
      prompt: 'extract the model',
    });
    expect(result.artifacts[0]?.mime_type).toBe('application/json');
  });
});

describe('Browser Run provider — degrading cleanly', () => {
  it('raises a typed transport error on an API failure', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = stubFetch(() => ({
      status: 403,
      body: JSON.stringify({ success: false, errors: [{ message: 'Invalid API token' }] }),
    }));
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    const error = await provider.fetch(makeRequest()).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).httpStatus).toBe(403);
    expect((error as Error).message).toContain('Invalid API token');
  });

  it('raises rather than silently returning nothing when the job errored', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([{ status: 'errored' }]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(ProviderTransportError);
  });

  it('gives up politely when a job never finishes', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([{ status: 'running' }]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
      maxPollAttempts: 3,
      pollIntervalMs: 100,
    });

    await expect(provider.fetch(makeRequest())).rejects.toThrow(/did not finish within 3 polls/);
  });

  it('skips unusable records instead of crashing on them', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([
      {
        status: 'completed',
        records: [
          'not-an-object',
          { status: 'completed', html: 'no url here' },
          { url: `${TARGET_URL}?x=1`, status: 'completed' },
          { url: TARGET_URL, status: 'completed', html: BODY },
        ],
      },
    ]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    const result = await provider.fetch(makeRequest());

    expect(result.artifacts).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(3);
  });

  it('accepts the alternate results-array key without special-casing at the call site', async () => {
    const harness = makeHarness({ entry: browserRunEntry() });
    const api = crawlApi([
      { status: 'completed', results: [{ url: TARGET_URL, status: 'completed', html: BODY }] },
    ]);
    const provider = new BrowserRunAcquisitionProvider({
      deps: harness.deps,
      accountId: ACCOUNT,
      apiToken: TOKEN,
      fetch: api.fetch,
    });

    expect((await provider.fetch(makeRequest())).artifacts).toHaveLength(1);
  });
});
