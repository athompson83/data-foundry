import { describe, expect, it } from 'vitest';
import type { AcquisitionProviderDeps } from '@data-foundry/acquisition';
import { ACQUISITION_RUNTIMES } from '../generated/runtime-registry.js';
import { createScheduledProvider, providerMethodsFor } from '../src/providers.js';

const deps = {} as AcquisitionProviderDeps;
const targets = ACQUISITION_RUNTIMES['hvac']!.targets;

describe('lazy scheduled providers', () => {
  it('constructs credential-free HTTP providers normally', () => {
    const provider = createScheduledProvider({ entry: targets[0]!.source, deps, env: {} });
    expect(provider.id).toBe('http');
  });

  it('does not read Browser Run secrets until that admitted provider is constructed', () => {
    const browser = targets.find(({ source }) => source.acquisition_policy.method === 'BROWSER_RUN')!;
    expect(() => createScheduledProvider({ entry: browser.source, deps, env: {} })).toThrow(
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
