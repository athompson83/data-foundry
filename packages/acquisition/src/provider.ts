import type { AcquisitionMethod, SourceRegistryEntry } from '@data-foundry/source-registry';
import { AcquisitionConfigurationError } from './errors.js';
import type { AcquisitionResult, SourceRequest } from './types.js';

/**
 * The provider contract from doc 02:
 *
 * ```text
 * AcquisitionProvider.fetch(source_request) -> SourceArtifact[]
 * ```
 *
 * AGENTS.md rule 6: *"Keep acquisition providers swappable. Cloudflare Browser
 * Run and Crawl4AI are adapters, not domain logic."* So this interface mentions
 * no vendor, no rendering, no crawl depth and no vertical. A caller holding an
 * `AcquisitionProvider` must never need to know which one it is holding — if a
 * caller ever branches on `provider.id`, the abstraction has failed.
 */
export interface AcquisitionProvider {
  /** Stable adapter identity, recorded on every artifact (`http`, `browser-run`, …). */
  readonly id: string;
  /** Adapter version, recorded so a reprocessing decision can be explained. */
  readonly version: string;
  /** Which approved acquisition methods this adapter is allowed to serve. */
  readonly methods: readonly AcquisitionMethod[];
  fetch(request: SourceRequest): Promise<AcquisitionResult>;
}

/**
 * Selects a provider from a source's approved acquisition method.
 *
 * This is the mechanism that keeps rule 6 true in practice: the pipeline asks
 * the registry which method is approved and asks the registry of providers who
 * implements it. Swapping Browser Run for Crawl4AI is a registration change.
 */
export class AcquisitionProviderRegistry {
  readonly #providers: AcquisitionProvider[] = [];

  constructor(providers: readonly AcquisitionProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: AcquisitionProvider): this {
    this.#providers.push(provider);
    return this;
  }

  list(): readonly AcquisitionProvider[] {
    return [...this.#providers];
  }

  has(method: AcquisitionMethod): boolean {
    return this.#providers.some((provider) => provider.methods.includes(method));
  }

  /** First registered provider implementing `method`; registration order is the priority order. */
  get(method: AcquisitionMethod): AcquisitionProvider {
    const provider = this.#providers.find((candidate) => candidate.methods.includes(method));
    if (provider === undefined) {
      throw new AcquisitionConfigurationError(
        `No acquisition provider is registered for method ${method}. ` +
          `Registered: [${this.#providers.map((p) => p.id).join(', ')}].`,
      );
    }
    return provider;
  }

  /** Provider for a source, chosen by its approved acquisition policy. */
  forEntry(entry: SourceRegistryEntry): AcquisitionProvider {
    return this.get(entry.acquisition_policy.method);
  }

  byId(id: string): AcquisitionProvider | null {
    return this.#providers.find((provider) => provider.id === id) ?? null;
  }
}
