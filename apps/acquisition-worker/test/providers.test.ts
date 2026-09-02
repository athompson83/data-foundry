import { describe, expect, it } from 'vitest';
import type { AcquisitionProviderDeps } from '@data-foundry/acquisition';
import { ACQUISITION_RUNTIMES } from '../generated/runtime-registry.js';
import { createScheduledProvider, providerMethodsFor } from '../src/providers.js';

const deps = {} as AcquisitionProviderDeps;
const targets = ACQUISITION_RUNTIMES['hvac']!.targets;

describe('lazy scheduled providers', () => {
  it('refuses a stale runtime target with no compiled response ceiling', () => {
    const target = targets[0]!;
    expect(() => Reflect.apply(createScheduledProvider, undefined, [{
      entry: target.source,
      deps,
      env: {},
    }])).toThrow(/response byte ceiling/i);
  });

  it('constructs credential-free HTTP providers normally', () => {
    const target = targets[0]!;
    const provider = createScheduledProvider({
      entry: target.source,
      maxBytes: target.max_direct_http_response_bytes,
      deps,
      env: {},
    });
    expect(provider.id).toBe('http');
  });

  it('does not pretend the direct-HTTP response ceiling protects Browser Run', () => {
    const browser = targets.find(({ source }) => source.acquisition_policy.method === 'BROWSER_RUN')!;
    expect(() => createScheduledProvider({
      entry: browser.source,
      maxBytes: 1024,
      deps,
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'configured-account',
        CLOUDFLARE_API_TOKEN: 'configured-token',
      },
    })).toThrow(/only supported for direct HTTP/i);
  });

  it('does not read Browser Run secrets until that admitted provider is constructed', () => {
    const browser = targets.find(({ source }) => source.acquisition_policy.method === 'BROWSER_RUN')!;
    expect(() => createScheduledProvider({
      entry: browser.source,
      deps,
      env: {},
    })).toThrow(
      /requires both configured provider credentials/i,
    );
    expect(() =>
      createScheduledProvider({
        entry: browser.source,
        deps,
        env: { CLOUDFLARE_ACCOUNT_ID: 'configured-without-token' },
      }),
    ).toThrow(/requires both configured provider credentials/i);
  });

  it('reports provider capabilities without constructing secret-bearing adapters', () => {
    expect(providerMethodsFor('DIRECT_HTTP')).toContain('DIRECT_HTTP');
    expect(providerMethodsFor('BROWSER_RUN')).toEqual(['BROWSER_RUN']);
    expect(providerMethodsFor('MANUAL_UPLOAD')).toEqual([]);
  });
});
