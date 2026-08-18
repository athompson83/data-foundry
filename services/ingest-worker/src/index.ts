/**
 * `@data-foundry/ingest-worker`
 *
 * The service that runs the factory: it composes the finished packages into
 * AGENTS.md's north-star workflow and persists a durable, resumable job for
 * every unit of work.
 *
 * It owns orchestration and nothing else. It does not define rights policy, it
 * does not parse artifacts, it does not decide which of two claims is true, and
 * it does not write a fact without evidence — those belong to
 * `source-registry`, `extraction`, `canonical-store` and its fact-selection
 * cascade respectively. What it does own is the *order*: a stage may only ever
 * call the layer directly beneath it.
 */
export { InMemoryArtifactStore } from './artifact-store.js';
export {
  compileSourcePlan,
  compileSourcePlans,
  type AliasPlan,
  type EndpointPlan,
  type RelationshipPlan,
  type SourcePlan,
  type StreamPlan,
} from './compile.js';
export {
  DEFAULT_VERTICALS_DIR,
  REPO_ROOT,
  loadVerticalConfig,
  primaryAliasType,
  resolvePublisher,
  type LoadVerticalOptions,
  type PublisherAlias,
  type VerticalConfig,
} from './config.js';
export {
  IngestError,
  MappingCompilationError,
  PipelineConfigurationError,
  classifyError,
  type IngestErrorClass,
} from './errors.js';
export {
  buildFactSelectionPolicy,
  buildFieldMetadata,
  verticalConsistencyChecks,
  type FactPolicyOptions,
} from './fact-policy.js';
export {
  buildFixtureManifest,
  type FixtureBinding,
  type FixtureManifestResult,
} from './fixtures.js';
export { AliasNormalizer, slugify, upcMod10, type AliasNormalizationRule } from './identifiers.js';
export {
  DEFAULT_MAX_ATTEMPTS,
  IngestionJobStore,
  type JobHandle,
  type OpenJobInput,
} from './jobs.js';
export {
  Pipeline,
  type CreatePipelineOptions,
  type PipelineOptions,
  type SourceRunResult,
  type VerticalRunResult,
} from './pipeline.js';
export {
  EntityResolver,
  type AliasClaim,
  type ResolvedEntity,
  type ResolveRecordInput,
  type ResolverDeps,
} from './resolution.js';
