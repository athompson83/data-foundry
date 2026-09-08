/** Offline filesystem and fixture composition root. Production imports pipeline-core. */
import { AcquisitionProviderRegistry, FixtureAcquisitionProvider, InMemoryValidatorCache, SqlPolicySnapshotRecorder, unlimitedRateLimiter, type Clock, type ArtifactStore, type ValidatorCache } from '@data-foundry/acquisition';
import type { IsoDateTime } from '@data-foundry/canonical-schema';
import type { SqlDriver } from '@data-foundry/canonical-store';
import { createExtractionRegistry } from '@data-foundry/extraction';
import { loadVerticalConfig, type LoadVerticalOptions } from './config.js';
import { buildFixtureManifest } from './fixtures.js';
import { ArtifactPipeline, requireStoredAcquisitionTransportRights, type PipelineOptions } from './pipeline-core.js';
export * from './pipeline-core.js';
export class Pipeline extends ArtifactPipeline {
  constructor(options: PipelineOptions) { super({ ...options, extraction: options.extraction ?? createExtractionRegistry() }); }
  static async create(options: CreatePipelineOptions): Promise<Pipeline> {
    const config = await loadVerticalConfig(options.verticalSlug, {
      ...(options.verticalsDir === undefined ? {} : { verticalsDir: options.verticalsDir }),
    });
    const { directory, bindings } = await buildFixtureManifest(config, {
      ...(options.fixtureOverrides === undefined ? {} : { overrides: options.fixtureOverrides }),
    });
    const validatorCache = options.validatorCache ?? new InMemoryValidatorCache();
    const clock: Clock = {
      now: () => Date.parse(options.now),
      nowIso: () => options.now,
      sleep: () => Promise.resolve(),
    };

    const provider = new FixtureAcquisitionProvider({
      deps: {
        registry: config.registry,
        artifactStore: options.artifactStore,
        policyRecorder: new SqlPolicySnapshotRecorder(options.driver),
        validatorCache,
        clock,
        // Politeness is a property of the live adapters; sleeping through a
        // 3-second crawl delay per fixture would make the offline factory
        // useless in CI without proving anything.
        rateLimiter: unlimitedRateLimiter,
        beforeTransport: ({ request, entry, asOf }) =>
          requireStoredAcquisitionTransportRights({
            driver: options.driver,
            sourceId: request.sourceId,
            entry,
            asOf,
          }),
        beforePersistence: ({ request, entry, asOf }) =>
          requireStoredAcquisitionTransportRights({
            driver: options.driver,
            sourceId: request.sourceId,
            entry,
            asOf,
          }),
      },
      directory,
      manifest: { version: 1, entries: bindings.map((binding) => binding.entry) },
    });

    return new Pipeline({
      driver: options.driver,
      config,
      providers: new AcquisitionProviderRegistry([provider]),
      artifactStore: options.artifactStore,
      fixtures: bindings,
      now: options.now,
      ...(options.runId === undefined ? {} : { runId: options.runId }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      validatorCache,
    });
  }

}
export interface CreatePipelineOptions extends LoadVerticalOptions {
  readonly driver: SqlDriver;
  readonly verticalSlug: string;
  readonly artifactStore: ArtifactStore;
  /** Fixed instant for the whole run. */
  readonly now: IsoDateTime;
  readonly runId?: string;
  readonly dryRun?: boolean;
  readonly validatorCache?: ValidatorCache;
  /** Source key → replacement body; simulates an upstream change offline. */
  readonly fixtureOverrides?: Readonly<Record<string, string>>;
}
