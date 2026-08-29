import {
  BrowserRunAcquisitionProvider,
  Crawl4AIAcquisitionProvider,
  HttpAcquisitionProvider,
  type AcquisitionProvider,
  type AcquisitionProviderDeps,
  type FetchLike,
} from '@data-foundry/acquisition';
import type { AcquisitionMethod } from '@data-foundry/canonical-schema';
import type { SourceRegistryEntry } from '@data-foundry/source-registry';
import type { AcquisitionWorkerEnv } from './env.js';

export class ScheduledProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduledProviderConfigurationError';
  }
}

const HTTP_METHODS = ['DIRECT_HTTP', 'VENDOR_API', 'SITEMAP', 'BULK_FILE', 'RSS'] as const;

export function providerMethodsFor(method: AcquisitionMethod): readonly AcquisitionMethod[] {
  if ((HTTP_METHODS as readonly string[]).includes(method)) return HTTP_METHODS;
  if (method === 'BROWSER_RUN') return ['BROWSER_RUN'];
  if (method === 'CRAWL4AI') return ['CRAWL4AI'];
  return [];
}

/** Construct secrets-bearing adapters only after stored rights are admitted. */
export function createScheduledProvider(input: {
  readonly entry: SourceRegistryEntry;
  readonly deps: AcquisitionProviderDeps;
  readonly env: AcquisitionWorkerEnv;
  readonly fetch?: FetchLike;
}): AcquisitionProvider {
  const method = input.entry.acquisition_policy.method;
  if ((HTTP_METHODS as readonly string[]).includes(method)) {
    return new HttpAcquisitionProvider({ deps: input.deps, fetch: input.fetch });
  }
  if (method === 'BROWSER_RUN') {
    const accountId = input.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
    const apiToken = input.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
    if (accountId === '' || apiToken === '') {
      throw new ScheduledProviderConfigurationError(
        'An admitted BROWSER_RUN target requires both configured provider credentials.',
      );
    }
    return new BrowserRunAcquisitionProvider({
      deps: input.deps,
      accountId,
      apiToken,
      fetch: input.fetch,
    });
  }
  if (method === 'CRAWL4AI') {
    const baseUrl = input.env.CRAWL4AI_BASE_URL?.trim() ?? '';
    if (baseUrl === '') {
      throw new ScheduledProviderConfigurationError(
        'An admitted CRAWL4AI target requires CRAWL4AI_BASE_URL.',
      );
    }
    return new Crawl4AIAcquisitionProvider({
      deps: input.deps,
      baseUrl,
      ...(input.env.CRAWL4AI_API_TOKEN === undefined
        ? {}
        : { apiToken: input.env.CRAWL4AI_API_TOKEN }),
      fetch: input.fetch,
    });
  }
  throw new ScheduledProviderConfigurationError(`No scheduled provider implements ${method}.`);
}
