/** Production ingestion contract; importing this file never loads fixture or YAML files. */
import { sha256Hex, stableStringify } from '@data-foundry/acquisition';
import { InMemorySourceRegistry } from '@data-foundry/source-registry';
import type { VerticalConfig } from './config-core.js';
export { ArtifactPipeline, type AcquiredArtifact, type ArtifactPipelineInput } from './pipeline-core.js';
export type { VerticalConfig } from './config-core.js';

export const INGESTION_LIMITS = {
  maxArtifacts: 16,
  maxArtifactBytes: 1_048_576,
  maxTotalBytes: 4_194_304,
  maxRecords: 1_000,
  maxReceiptBytes: 32_768,
} as const;
export type SerializableIngestionConfig = Omit<VerticalConfig, 'registry' | 'directory'>;
export interface IngestionRuntime {
  readonly version: 1;
  readonly runtime_digest: string;
  readonly implementation_digest: string;
  readonly implementation_inputs: readonly string[];
  readonly acquisition_runtime_digest: string;
  readonly vertical_slug: string;
  readonly supported_source_keys: readonly string[];
  /** Current snapshot ownership is source+stream, so only one target per source qualifies. */
  readonly source_targets: readonly { source_key: string; target_id: string }[];
  readonly unsupported_sources: readonly { source_key: string; formats: readonly string[]; reason: 'UNSUPPORTED_FORMAT' | 'SOURCE_TARGET_PARTITION_REQUIRED' }[];
  readonly limits: typeof INGESTION_LIMITS;
  readonly config: SerializableIngestionConfig;
}
export function ingestionRuntimeDigest(runtime: Omit<IngestionRuntime, 'runtime_digest'>): string {
  return sha256Hex(stableStringify(runtime));
}
export function loadIngestionRuntime(runtime: IngestionRuntime): VerticalConfig {
  const { runtime_digest, ...payload } = runtime;
  if (runtime.version !== 1 || runtime_digest !== ingestionRuntimeDigest(payload) ||
      !/^[0-9a-f]{64}$/.test(runtime.implementation_digest) ||
      !Array.isArray(runtime.implementation_inputs) || runtime.implementation_inputs.length === 0 || runtime.implementation_inputs.length > 512 ||
      runtime.vertical_slug !== runtime.config.slug ||
      !Array.isArray(runtime.source_targets) || runtime.source_targets.length !== runtime.supported_source_keys.length ||
      runtime.supported_source_keys.some(key => runtime.source_targets.filter(target => target.source_key === key).length !== 1) ||
      stableStringify(runtime.limits) !== stableStringify(INGESTION_LIMITS)) {
    throw new Error('INGESTION_RUNTIME_INVALID');
  }
  return { ...runtime.config, registry: new InMemorySourceRegistry(runtime.config.sources), directory: '' };
}
