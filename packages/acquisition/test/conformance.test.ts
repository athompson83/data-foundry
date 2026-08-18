import { describe, expect, it } from 'vitest';
import { RightsViolationError, SourceArtifactSchema } from '@data-foundry/canonical-schema';
import type { AcquisitionMethod, SourceRegistryEntry } from '@data-foundry/source-registry';
import { RobotsDisallowedError } from '../src/errors.js';
import { nodeFileSystem } from '../src/fs.js';
import { sha256Hex } from '../src/hashing.js';
import { AcquisitionProviderRegistry, type AcquisitionProvider } from '../src/provider.js';
import { BrowserRunAcquisitionProvider } from '../src/providers/browser-run.js';
import { Crawl4AIAcquisitionProvider } from '../src/providers/crawl4ai.js';
import { FixtureAcquisitionProvider } from '../src/providers/fixture.js';
import { HttpAcquisitionProvider } from '../src/providers/http.js';
import type { StubResponse } from './helpers.js';
import {
  BODY,
  CONFORMANCE_FIXTURE_DIR,
  CountingFileSystem,
  ETAG,
  LAST_MODIFIED,
  TARGET_URL,
  compliantEntry,
  entryForMethod,
  makeHarness,
  makeRequest,
  stubFetch,
  type Harness,
} from './helpers.js';

/**
 * One suite, four adapters.
 *
 * AGENTS.md rule 6 says providers are swappable. That claim is only worth
 * anything if the *same* assertions hold for every one of them, so this file
 * is written once and parameterised: if a new adapter is added and it does not
 * appear here, it is not a provider.
 *
 * Each scenario serves the identical logical resource — the same bytes, the same
 * ETag, the same Last-Modified — through its own transport, so differences in
 * outcome are differences in the adapter, not in the test data.
 */

const HASH = sha256Hex(BODY);
const EXPECTED_KEY = `raw/hvac/ahri-directory/2026/08/14/${HASH}`;
const JOB_ID = 'job-conformance';

interface BuiltProvider {
  readonly provider: AcquisitionProvider;
  /** How many times the adapter's transport was reached. Must be 0 on a refusal. */
  readonly transportCalls: () => number;
}

interface Scenario {
  readonly name: string;
  readonly providerId: string;
  readonly method: AcquisitionMethod;
  readonly build: (harness: Harness) => BuiltProvider;
}

function json(value: unknown): StubResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
  };
}

const scenarios: readonly Scenario[] = [
  {
    name: 'HttpAcquisitionProvider',
    providerId: 'http',
    method: 'DIRECT_HTTP',
    build: (harness) => {
      const net = stubFetch((_url, init) =>
        init?.headers?.['if-none-match'] === ETAG
          ? { status: 304, headers: { etag: ETAG } }
          : {
              status: 200,
              headers: {
                'content-type': 'application/json',
                etag: ETAG,
                'last-modified': LAST_MODIFIED,
              },
              body: BODY,
            },
      );
      return {
        provider: new HttpAcquisitionProvider({ deps: harness.deps, fetch: net.fetch }),
        transportCalls: () => net.calls.length,
      };
    },
  },
  {
    name: 'BrowserRunAcquisitionProvider',
    providerId: 'browser-run',
    method: 'BROWSER_RUN',
    build: (harness) => {
      const net = stubFetch((url, init) => {
        if (init?.method === 'POST' && url.endsWith('/browser-rendering/crawl')) {
          const body = JSON.parse(init.body ?? '{}') as { modifiedSince?: number };
          return json({ success: true, result: body.modifiedSince === undefined ? JOB_ID : `${JOB_ID}-inc` });
        }
        if (url.includes(`/browser-rendering/crawl/${JOB_ID}-inc`)) {
          return json({
            success: true,
            result: { status: 'completed', records: [{ url: TARGET_URL, status: 'skipped' }] },
          });
        }
        return json({
          success: true,
          result: {
            status: 'completed',
            records: [{ url: TARGET_URL, status: 'completed', html: BODY }],
          },
        });
      });
      return {
        provider: new BrowserRunAcquisitionProvider({
          deps: harness.deps,
          accountId: 'acct_conformance',
          apiToken: 'token_conformance',
          fetch: net.fetch,
        }),
        transportCalls: () => net.calls.length,
      };
    },
  },
  {
    name: 'Crawl4AIAcquisitionProvider',
    providerId: 'crawl4ai',
    method: 'CRAWL4AI',
    build: (harness) => {
      const net = stubFetch(() =>
        json({
          success: true,
          results: [
            {
              url: TARGET_URL,
              html: BODY,
              status_code: 200,
              response_headers: { ETag: ETAG, 'Last-Modified': LAST_MODIFIED },
            },
          ],
        }),
      );
      return {
        provider: new Crawl4AIAcquisitionProvider({
          deps: harness.deps,
          baseUrl: 'http://crawl4ai.internal:11235',
          fetch: net.fetch,
        }),
        transportCalls: () => net.calls.length,
      };
    },
  },
  {
    name: 'FixtureAcquisitionProvider',
    providerId: 'fixture',
    method: 'DIRECT_HTTP',
    build: (harness) => {
      const files = new CountingFileSystem(nodeFileSystem);
      return {
        provider: new FixtureAcquisitionProvider({
          deps: harness.deps,
          directory: CONFORMANCE_FIXTURE_DIR,
          fs: files,
        }),
        transportCalls: () => files.reads.length,
      };
    },
  },
];

function setup(scenario: Scenario, overrides: Partial<SourceRegistryEntry> = {}) {
  const harness = makeHarness({ entry: entryForMethod(scenario.method, overrides) });
  return { harness, ...scenario.build(harness) };
}

describe.each(scenarios)('$name — AcquisitionProvider contract', (scenario) => {
  it('declares a stable identity and the methods it may serve', () => {
    const { provider } = setup(scenario);
    expect(provider.id).toBe(scenario.providerId);
    expect(provider.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(provider.methods).toContain(scenario.method);
  });

  it('yields SourceArtifact[] that satisfy the canonical schema', async () => {
    const { provider } = setup(scenario);
    const result = await provider.fetch(makeRequest());

    expect(result.outcome).toBe('FETCHED');
    expect(result.artifacts).toHaveLength(1);
    for (const artifact of result.artifacts) {
      expect(SourceArtifactSchema.safeParse(artifact).success).toBe(true);
    }
  });

  it('content-addresses the bytes it retrieved', async () => {
    const { provider, harness } = setup(scenario);
    const result = await provider.fetch(makeRequest());
    const artifact = result.artifacts[0];

    expect(artifact?.content_hash).toBe(HASH);
    expect(artifact?.byte_size).toBe(new TextEncoder().encode(BODY).byteLength);
    expect(result.stored[0]?.key).toBe(EXPECTED_KEY);
    expect(artifact?.r2_uri.startsWith(`${harness.store.scheme}:`)).toBe(true);
  });

  it('attributes the artifact to itself', async () => {
    const { provider } = setup(scenario);
    const artifact = (await provider.fetch(makeRequest())).artifacts[0];
    expect(artifact?.acquisition_provider).toBe(scenario.providerId);
    expect(artifact?.extractor_version).toBe(`${scenario.providerId}@1.0.0`);
    expect(artifact?.source_id).toBe(makeRequest().sourceId);
  });

  it('stamps the policy snapshot that permitted the fetch', async () => {
    const { provider, harness } = setup(scenario);
    const result = await provider.fetch(makeRequest());

    expect(result.artifacts[0]?.policy_snapshot_id).toBe(result.policySnapshot.id);
    expect(result.policySnapshot.gate_allowed).toBe(true);
    expect(result.policySnapshot.rights_classification).toBe('GREEN');
    expect(await harness.recorder.get(result.policySnapshot.id)).not.toBeNull();
  });

  it('is idempotent: identical bytes are stored once and keep one identity', async () => {
    const { provider, harness } = setup(scenario);

    // An empty `conditional` forces a full re-fetch rather than a 304, so this
    // exercises deduplication in the store rather than short-circuiting above it.
    const forceFullFetch = makeRequest({ conditional: {} });
    const first = await provider.fetch(forceFullFetch);
    const filesAfterFirst = harness.files.size;
    const second = await provider.fetch(forceFullFetch);

    expect(second.stored[0]?.key).toBe(first.stored[0]?.key);
    expect(second.stored[0]?.deduplicated).toBe(true);
    expect(second.artifacts[0]?.id).toBe(first.artifacts[0]?.id);
    expect(harness.files.size).toBe(filesAfterFirst);
  });

  it('reports NOT_MODIFIED without storing anything when validators still match', async () => {
    const { provider, harness } = setup(scenario);

    const result = await provider.fetch(
      makeRequest({ conditional: { etag: ETAG, lastModified: LAST_MODIFIED } }),
    );

    expect(result.outcome).toBe('NOT_MODIFIED');
    expect(result.artifacts).toEqual([]);
    expect(result.stored).toEqual([]);
    expect(harness.files.size).toBe(0);
  });

  it.each(['RED', 'UNREVIEWED'] as const)(
    'refuses a %s source before its transport is reached',
    async (rights) => {
      const { provider, transportCalls, harness } = setup(scenario, {
        rights_classification: rights,
      });

      await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RightsViolationError);
      expect(transportCalls()).toBe(0);
      expect(harness.files.size).toBe(0);
    },
  );

  it('refuses an engaged kill switch before its transport is reached', async () => {
    const { provider, transportCalls } = setup(scenario, { kill_switch_engaged: true });
    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RightsViolationError);
    expect(transportCalls()).toBe(0);
  });

  it('refuses a robots-disallowed path before its transport is reached', async () => {
    const base = compliantEntry();
    const { provider, transportCalls } = setup(scenario, {
      robots_policy: { ...base.robots_policy, disallowed_paths: ['/certified'] },
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(transportCalls()).toBe(0);
  });

  it('refuses an undeclared source before its transport is reached', async () => {
    const { provider, transportCalls } = setup(scenario);
    await expect(
      provider.fetch(makeRequest({ sourceKey: 'not-in-the-registry' })),
    ).rejects.toBeInstanceOf(RightsViolationError);
    expect(transportCalls()).toBe(0);
  });

  it('waits out the crawl delay through the injected clock', async () => {
    const { provider, harness } = setup(scenario);
    await provider.fetch(makeRequest());
    const second = await provider.fetch(makeRequest());
    expect(second.waitedMs).toBe(2000);
    expect(harness.clock.sleeps).toContain(2000);
  });
});

describe('provider selection never branches on provider type', () => {
  it('resolves the adapter from the source policy alone', () => {
    const harness = makeHarness();
    const registry = new AcquisitionProviderRegistry([
      scenarios[0]!.build(harness).provider,
      scenarios[1]!.build(harness).provider,
      scenarios[2]!.build(harness).provider,
    ]);

    expect(registry.forEntry(entryForMethod('DIRECT_HTTP')).id).toBe('http');
    expect(registry.forEntry(entryForMethod('BROWSER_RUN')).id).toBe('browser-run');
    expect(registry.forEntry(entryForMethod('CRAWL4AI')).id).toBe('crawl4ai');
  });

  it('lets the fixture adapter stand in for every method, so CI needs one registration', () => {
    const harness = makeHarness();
    const registry = new AcquisitionProviderRegistry([scenarios[3]!.build(harness).provider]);

    for (const method of ['DIRECT_HTTP', 'BROWSER_RUN', 'CRAWL4AI', 'BULK_FILE'] as const) {
      expect(registry.forEntry(entryForMethod(method)).id).toBe('fixture');
    }
  });

  it('refuses to guess when no adapter implements the approved method', () => {
    const harness = makeHarness();
    const registry = new AcquisitionProviderRegistry([scenarios[1]!.build(harness).provider]);
    expect(() => registry.forEntry(entryForMethod('DIRECT_HTTP'))).toThrow(/No acquisition provider/);
  });

  it('exposes every registered adapter for admin surfaces', () => {
    const harness = makeHarness();
    const registry = new AcquisitionProviderRegistry(
      scenarios.map((scenario) => scenario.build(harness).provider),
    );
    expect(registry.list().map((provider) => provider.id)).toEqual([
      'http',
      'browser-run',
      'crawl4ai',
      'fixture',
    ]);
    expect(registry.byId('crawl4ai')?.id).toBe('crawl4ai');
    expect(registry.byId('nope')).toBeNull();
  });
});
