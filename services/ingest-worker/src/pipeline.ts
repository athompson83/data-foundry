/**
 * The factory floor.
 *
 * One pass of this pipeline is AGENTS.md's north-star workflow, executed in
 * order and persisted at every step:
 *
 * ```text
 * source approved → artifact acquired → record extracted → values normalized
 *   → entity resolved → facts/relationships validated → provenance attached
 *   → published to the canonical query layer
 * ```
 *
 * Three design decisions carry most of the weight, and each of them is what
 * makes the Phase 1 exit criterion ("a repeatable incremental re-run produces
 * correct canonical records without duplicates or lost provenance") true rather
 * than hoped for:
 *
 * 1. **Claims are written PROPOSED; the canonical value is promoted after every
 *    source has spoken.** Writing each source's claim as ACTIVE as it arrives
 *    would make the last source ingested win, which is precisely the
 *    "latest source wins" rule doc 04 forbids. Writing them all as competing
 *    PROPOSED claims and then running the doc-04 cascade once means the winner
 *    is chosen by authority, and the losers stay in the table with their
 *    evidence instead of being overwritten.
 *
 * 2. **Every identity in the write path is derived, not minted.** Artifacts are
 *    content-addressed, source records are keyed by `(source, source_record_key)`,
 *    entities by their normalized identifier, evidence by
 *    `(fact, source_record, locator)`. A second run therefore collides with
 *    itself at every level and writes nothing new — which is why the idempotency
 *    proof is an assertion about row counts rather than a code review.
 *
 * 3. **A stage failure parks the job; it never unwinds the run.** `FAILED` keeps
 *    `failed_from` and the retry budget, so the next pass resumes at the stage
 *    that failed rather than re-fetching from the top.
 *
 * The pipeline knows nothing about HVAC. Sources, mappings, vocabularies,
 * authority and naming all arrive from `verticals/<slug>/` (rule 4), and every
 * stage talks only to the layer directly beneath it (rule: architecture
 * boundaries).
 */
import {
  AcquisitionProviderRegistry,
  FixtureAcquisitionProvider,
  InMemoryValidatorCache,
  SqlPolicySnapshotRecorder,
  sha256Hex,
  stableStringify,
  unlimitedRateLimiter,
  type ArtifactStore,
  type Clock,
  type StoredArtifact,
  type ValidatorCache,
} from '@data-foundry/acquisition';
import { explainFact, verifyFact } from '@data-foundry/provenance';
import {
  JOB_PIPELINE_ORDER,
  compareCodeUnits,
  factConfidence,
  identityConfidence,
  relationshipConfidence,
  type Entity,
  type EntityId,
  type FactValueType,
  type Identifier,
  type IsoDateTime,
  type JobPipelineState,
  type Source,
  type SourceArtifact,
  type SourceRecord,
  type Vertical,
  type VerticalId,
} from '@data-foundry/canonical-schema';
import {
  createCanonicalStore,
  loadStoredRightsContext,
  type CanonicalStore,
  type FactEvidenceInput,
  type FactSelectionPolicyInput,
  type RelationshipClaimInput,
  type RelationshipEvidenceInput,
  type SqlDriver,
  type SqlExecutor,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import {
  createExtractionRegistry,
  type ExtractedRecord,
  type ExtractionProviderRegistry,
  type ExtractionSchema,
} from '@data-foundry/extraction';
import {
  DerivedCandidateGraphError,
  normalizeRecord,
  orderCanonicalCandidatesByDerivation,
  type NormalizationResult,
} from '@data-foundry/normalization';
import {
  toSourceInsert,
  type SourceRegistryEntry,
} from '@data-foundry/source-registry';
import { RightsViolationError } from '@data-foundry/canonical-schema';
import {
  evaluateRights,
  type RightsAssetClass,
  type RightsEvaluation,
  type RightsOperation,
  type RightsOutputClass,
} from '@data-foundry/rights-engine';
import { compileSourcePlans, type RelationshipPlan, type SourcePlan, type StreamPlan } from './compile.js';
import { loadVerticalConfig, type LoadVerticalOptions, type VerticalConfig } from './config.js';
import { IngestError, PipelineConfigurationError } from './errors.js';
import { buildFactSelectionPolicy } from './fact-policy.js';
import { buildFixtureManifest, type FixtureBinding } from './fixtures.js';
import { IngestionJobStore } from './jobs.js';
import {
  EntityResolver,
  type AliasLockIdentity,
  type AliasClaim,
  type ResolvedEntityPlan,
  type SourceAliasDraft,
  type StagedAliasMatch,
} from './resolution.js';

// Bump this only when validation or resolution changes the meaning of a
// persisted evidence chain. The fingerprint also contains the actual accepted
// claims and locators, so a changed validation outcome cannot reuse an older
// finalized source-record revision.
const SOURCE_RECORD_EVIDENCE_SEMANTICS_VERSION = 'source-record-evidence@3';
const FULL_SNAPSHOT_ACCEPTANCE_SEMANTICS_VERSION = 'full-snapshot-acceptance@1';

export interface PipelineOptions {
  readonly driver: SqlDriver;
  readonly config: VerticalConfig;
  readonly providers: AcquisitionProviderRegistry;
  readonly artifactStore: ArtifactStore;
  readonly fixtures: readonly FixtureBinding[];
  /** Fixed instant for the whole run; every derived timestamp descends from it. */
  readonly now: IsoDateTime;
  /** Distinguishes one refresh cycle from another in the job's idempotency key. */
  readonly runId?: string;
  readonly validatorCache?: ValidatorCache;
  readonly extraction?: ExtractionProviderRegistry;
  /** Acquire, extract, normalize and resolve, but write no canonical claims. */
  readonly dryRun?: boolean;
}

export interface SourceRunResult {
  readonly sourceKey: string;
  readonly jobId: string;
  readonly finalState: string;
  readonly outcome: string;
  readonly artifacts: number;
  readonly records: number;
  readonly claims: number;
  readonly relationships: number;
  readonly normalizationFailures: number;
  readonly diagnostics: readonly string[];
  readonly error: string | null;
}

export interface VerticalRunResult {
  readonly vertical: Vertical;
  readonly sources: readonly SourceRunResult[];
  readonly promoted: number;
  readonly blocking: { readonly proposed: number; readonly rejected: number };
  readonly diagnostics: readonly string[];
}

/**
 * Fresh offline-ingest acquisition guard. The provider calls it before
 * transport and again immediately before persistence. It deliberately reloads
 * the database instead of consulting Pipeline's per-run cache because a kill
 * switch or rights activation can change during either wait.
 */
export async function requireStoredAcquisitionTransportRights(input: {
  readonly driver: SqlDriver;
  readonly sourceId: string;
  readonly entry: SourceRegistryEntry;
  readonly asOf: string;
}): Promise<void> {
  const context = await loadStoredRightsContext(input.driver, input.sourceId, input.asOf);
  const refused: string[] = [];
  for (const operation of ['ACQUIRE', 'STORE', 'CACHE'] as const) {
    const decision =
      context === null
        ? null
        : evaluateRights(
            {
              source: context.source,
              sourceStatusRequirement: 'APPROVED_OR_ACTIVE',
              acquisitionRoute: input.entry.acquisition_policy.method,
              accountOrProductPlan: input.entry.acquisition_policy.account_or_product_plan,
              jurisdiction: input.entry.acquisition_policy.jurisdiction,
              assetClass: 'DOCUMENT',
              fieldKey: null,
              fieldGroupIds: [],
              outputClass: 'RAW_RECORD',
              operation,
              channel: 'INTERNAL_PROCESSING',
              asOf: input.asOf,
              conditionReceipts: [],
            },
            context.snapshot,
          );
    if (decision?.permitted !== true) {
      refused.push(`${operation}=${decision?.reasonCode ?? 'NO_GRANT'}`);
    }
  }
  if (refused.length > 0) {
    throw new RightsViolationError(
      'UNREVIEWED',
      `source "${input.entry.key}" transport`,
      `STORED_RIGHTS_REFUSED: ${refused.join(', ')}`,
    );
  }
}

/** An extracted record and its normalization output, before any canonical write. */
interface NormalizedRecord {
  readonly plan: StreamPlan;
  readonly extracted: ExtractedRecord;
  readonly artifact: SourceArtifact;
  readonly normalization: NormalizationResult;
}

interface AcquiredArtifact {
  readonly artifact: SourceArtifact;
  readonly stored: StoredArtifact;
  readonly body: Uint8Array;
}

interface SnapshotCandidate {
  readonly stream: string;
  readonly observedAt: IsoDateTime;
  readonly snapshotDigest: string;
  readonly artifactSetDigest: string;
  readonly mappingDigest: string;
  readonly recordSetDigest: string;
}

interface AcceptedSnapshot extends SnapshotCandidate {
  readonly acceptanceId: string;
}

const digestSortedProjection = (values: readonly unknown[]): string => {
  const serialized = values.map((value) => stableStringify(value)).sort(compareCodeUnits);
  return sha256Hex(stableStringify(serialized));
};

const snapshotArtifactIdentity = ({ stored }: AcquiredArtifact): Readonly<Record<string, unknown>> => ({
  // StoredArtifact.metadata describes this retrieval. The canonical artifact
  // row deliberately preserves the first retrieval when bytes deduplicate and
  // therefore cannot supply the current snapshot's URL/scope identity.
  url: stored.metadata.url,
  contentHash: stored.contentHash,
  acquisitionProvider: stored.metadata.acquisition_provider,
  acquisitionRoute: stored.metadata.acquisition_route,
  accountOrProductPlan: stored.metadata.account_or_product_plan,
  acquisitionJurisdiction: stored.metadata.acquisition_jurisdiction,
});

const buildSnapshotCandidates = (
  streams: readonly StreamPlan[],
  items: readonly NormalizedRecord[],
  artifacts: readonly AcquiredArtifact[],
  observedAt: IsoDateTime,
): readonly SnapshotCandidate[] => {
  const artifactSetDigest = digestSortedProjection(artifacts.map(snapshotArtifactIdentity));
  return streams
    .filter(({ refreshMode }) => refreshMode === 'FULL_SNAPSHOT')
    .map((stream): SnapshotCandidate => {
      const mappingDigest = sha256Hex(stableStringify({
        version: FULL_SNAPSHOT_ACCEPTANCE_SEMANTICS_VERSION,
        sourceKey: stream.sourceKey,
        stream: stream.stream,
        refreshMode: stream.refreshMode,
        entityType: stream.entityType,
        schema: stream.schema,
        ruleSet: stream.ruleSet,
        aliases: stream.aliases,
        relationships: stream.relationships,
        skipLinesMatching: stream.skipLinesMatching,
      }));
      const recordSetDigest = digestSortedProjection(
        items
          .filter(({ plan }) => plan.stream === stream.stream)
          .map(({ extracted, artifact }) => ({
            sourceRecordKey: extracted.source_record_key,
            artifactContentHash: artifact.content_hash,
            rawPayload: extracted.raw_payload,
            values: extracted.values,
            locator: extracted.locator,
            extractionConfidence: extracted.extraction_confidence,
            extractorVersion: extracted.extractor_version,
          })),
      );
      const snapshotDigest = sha256Hex(stableStringify({
        version: FULL_SNAPSHOT_ACCEPTANCE_SEMANTICS_VERSION,
        sourceStream: stream.stream,
        artifactSetDigest,
        mappingDigest,
        recordSetDigest,
      }));
      return {
        stream: stream.stream,
        observedAt,
        snapshotDigest,
        artifactSetDigest,
        mappingDigest,
        recordSetDigest,
      };
    })
    .sort((left, right) => compareCodeUnits(left.stream, right.stream));
};

interface ValidatedAlias {
  readonly claim: AliasClaim;
  readonly locator: ExtractedRecord['locator'];
}

interface PreparedRecord {
  readonly item: NormalizedRecord;
  readonly validatedAliases: readonly ValidatedAlias[];
  readonly manufacturerObservation: {
    readonly value: string;
    readonly locator: ExtractedRecord['locator'];
  } | null;
  readonly manufacturerAliasIdentities: readonly AliasLockIdentity[];
  readonly canonicalSlugLockIdentity: string | null;
}

interface PlannedSourceAlias extends SourceAliasDraft {
  readonly locator: ExtractedRecord['locator'];
}

type RelationshipDisposition =
  | 'PERSIST'
  | 'RIGHTS_WITHHELD'
  | 'NULL_SKIPPED'
  | 'AMBIGUOUS_SUBJECT'
  | 'AMBIGUOUS_OBJECT'
  | 'UNRESOLVED_SUBJECT'
  | 'UNRESOLVED_OBJECT'
  | 'SELF_EDGE_SKIPPED';

interface PlannedRelationship {
  readonly plan: RelationshipPlan;
  readonly disposition: RelationshipDisposition;
  readonly subject: EntityId | null;
  readonly object: EntityId | null;
  readonly subjectLookup: string | null;
  readonly objectLookup: string | null;
  readonly writer: {
    readonly draft: RelationshipClaimInput;
    readonly evidence: Omit<RelationshipEvidenceInput, 'source_record_id'>;
  } | null;
}

interface PlannedRecordResolution {
  readonly prepared: PreparedRecord;
  readonly resolution: ResolvedEntityPlan | null;
  readonly entity: Entity | null;
  readonly manufacturer: Entity | null;
  readonly aliases: readonly PlannedSourceAlias[];
  readonly relationships: readonly PlannedRelationship[];
}

/** One resolved source record, carried from the RESOLVED stage into PUBLISHED. */
interface ResolvedRecordContext {
  readonly plan: StreamPlan;
  readonly extracted: ExtractedRecord;
  readonly sourceRecord: SourceRecord;
  readonly normalization: NormalizationResult;
  readonly artifact: SourceArtifact;
  readonly entity: Entity;
  readonly manufacturer: Entity | null;
}

interface InternalRightsIntent {
  readonly operation: Extract<RightsOperation, 'ACQUIRE' | 'STORE' | 'CACHE' | 'NORMALIZE' | 'DERIVE'>;
  readonly assetClass: RightsAssetClass;
  readonly outputClass: RightsOutputClass;
  readonly fieldKey: string | null;
}

function sortedEvidenceProjection<T>(items: readonly T[]): readonly T[] {
  return [...items].sort((left, right) => {
    const leftKey = stableStringify(left);
    const rightKey = stableStringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

/**
 * The exact source-side evidence fields that `#buildEdge` later persists. Keep
 * this pure so the fingerprint and writer cannot drift apart as mappings grow.
 */
function relationshipEvidenceInput(
  extracted: ExtractedRecord,
  plan: RelationshipPlan,
): {
  readonly sourceValue: string;
  readonly locatorType: FactEvidenceInput['locator_type'];
  readonly locatorValue: string;
} {
  const evidenceEndpoint = plan.subject.kind === 'self' ? plan.object : plan.subject;
  let sourceValue = '';
  let locatorType: FactEvidenceInput['locator_type'] = extracted.locator.type;
  let locatorValue = extracted.locator.value;
  if (evidenceEndpoint.kind === 'publisher' && evidenceEndpoint.literal !== null) {
    sourceValue = evidenceEndpoint.literal;
  } else if (evidenceEndpoint.kind !== 'self') {
    const field = evidenceEndpoint.field;
    const value = field === null ? null : extracted.values.find((item) => item.field === field);
    if (value?.raw != null) {
      sourceValue = value.raw;
      locatorType = value.locator.type;
      locatorValue = value.locator.value;
    }
  }
  return {
    sourceValue: sourceValue === '' ? extracted.source_record_key : sourceValue,
    locatorType,
    locatorValue,
  };
}

/**
 * Fingerprint every input that can appear in persisted entity, fact, or
 * relationship evidence. A matching artifact/payload is insufficient: an
 * extractor or mapper may move a locator or change the value/edge semantics
 * without changing either artifact bytes or the normalized record payload.
 */
function sourceRecordEvidenceFingerprint(planned: PlannedRecordResolution): string {
  const { item, validatedAliases } = planned.prepared;
  return sha256Hex(stableStringify({
    semanticsVersion: SOURCE_RECORD_EVIDENCE_SEMANTICS_VERSION,
    entity: {
      entityType: item.plan.entityType,
      resolutionOutcome: planned.resolution === null ? 'NO_USABLE_STRONG_IDENTIFIER' : 'RESOLVED',
      resolvedEntityId: planned.entity?.id ?? null,
      manufacturerId: planned.manufacturer?.id ?? null,
      recordLocator: {
        locatorType: item.extracted.locator.type,
        locatorValue: item.extracted.locator.value,
      },
      validatedAliases: sortedEvidenceProjection(validatedAliases.map(({ claim, locator }) => ({
        aliasType: claim.aliasType,
        aliasValue: claim.aliasValue,
        normalizedValue: claim.normalizedValue,
        strong: claim.strong,
        locatorType: locator.type,
        locatorValue: locator.value,
      }))),
      persistedAliasClaims: sortedEvidenceProjection(planned.aliases.map((alias) => ({
        entityId: alias.entity.id,
        entityType: alias.entity.entity_type,
        aliasType: alias.aliasType,
        aliasValue: alias.aliasValue,
        normalizedValue: alias.normalizedValue,
        identityConfidence: alias.identityConfidence,
        locatorType: alias.locator.type,
        locatorValue: alias.locator.value,
      }))),
      audit: planned.resolution?.audit ?? null,
    },
    facts: sortedEvidenceProjection(item.normalization.candidates.map((candidate) => ({
      property: candidate.property,
      normalizedValue: candidate.normalized_value,
      valueType: candidate.value_type,
      outputKind: candidate.output_kind,
      derivedFromProperty: candidate.derived_from_property ?? null,
      transformationRef: candidate.transformation_ref ?? null,
      unit: candidate.unit,
      confidence: candidate.confidence,
      extractionConfidence: candidate.extraction_confidence,
      sourceField: candidate.source_field,
      sourceValue: candidate.source_value,
      sourceUnit: candidate.source_unit,
      transforms: candidate.transforms,
      locatorType: candidate.locator.type,
      locatorValue: candidate.locator.value,
    }))),
    relationships: sortedEvidenceProjection(planned.relationships.map((relationship) => ({
      disposition: relationship.disposition,
      subjectEntityId: relationship.subject,
      objectEntityId: relationship.object,
      subjectLookup: relationship.subjectLookup,
      objectLookup: relationship.objectLookup,
      plan: relationship.plan,
      writer: relationship.writer,
    }))),
    mapping: {
      schema: item.plan.schema,
      ruleSet: item.plan.ruleSet,
      aliases: item.plan.aliases,
    },
  }));
}

export class Pipeline {
  readonly store: CanonicalStore;
  readonly config: VerticalConfig;
  readonly jobs: IngestionJobStore;

  readonly #options: PipelineOptions;
  readonly #extraction: ExtractionProviderRegistry;
  readonly #plans: ReadonlyMap<string, SourcePlan>;
  readonly #fixtures: ReadonlyMap<string, FixtureBinding>;
  readonly #diagnostics: string[] = [];
  readonly #rightsContexts = new Map<string, ReturnType<typeof loadStoredRightsContext>>();

  #vertical: Vertical | null = null;
  readonly #sources = new Map<string, Source>();
  #resolver: EntityResolver | null = null;

  constructor(options: PipelineOptions) {
    this.#options = options;
    this.store = createCanonicalStore(options.driver);
    this.config = options.config;
    this.jobs = new IngestionJobStore(this.store);
    this.#extraction = options.extraction ?? createExtractionRegistry();
    this.#plans = new Map(compileSourcePlans(options.config).map((plan) => [plan.sourceKey, plan]));
    this.#fixtures = new Map(options.fixtures.map((binding) => [binding.sourceKey, binding]));
  }

  /**
   * Composition root for the offline factory: real vertical config, real
   * migrations-backed store, fixture acquisition. No credentials, no network.
   *
   * Swapping in Browser Run or Crawl4AI is a change to `providers` here and
   * nothing else (AGENTS.md rule 6).
   */
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

  get diagnostics(): readonly string[] {
    return [...this.#diagnostics, ...(this.#resolver?.diagnostics ?? [])];
  }

  get factSelectionPolicy(): FactSelectionPolicyInput {
    return buildFactSelectionPolicy(this.config, { at: this.#options.now });
  }

  /** Run every declared source, then promote the canonical view. */
  async runVertical(options: { readonly sources?: readonly string[] } = {}): Promise<VerticalRunResult> {
    const vertical = await this.#ensureVertical();
    const keys =
      options.sources ??
      this.config.sources.filter((source) => source.status === 'ACTIVE').map((source) => source.key);

    const results: SourceRunResult[] = [];
    for (const key of keys) {
      results.push(await this.runSource(key));
    }

    const promoted = this.#options.dryRun === true ? 0 : await this.promoteCanonicalView();
    const blocking =
      this.#options.dryRun === true
        ? { proposed: 0, rejected: 0 }
        : await (await this.#ensureResolver()).runBlockingPass();

    return { vertical, sources: results, promoted, blocking, diagnostics: this.diagnostics };
  }

  /**
   * One source, DISCOVERED → PUBLISHED.
   *
   * Failure never throws out of here: it is recorded on the job with its stage
   * and retry budget and returned on the result, because a four-source run must
   * not lose three good sources to one bad one.
   */
  async runSource(sourceKey: string): Promise<SourceRunResult> {
    const now = this.#options.now;
    const vertical = await this.#ensureVertical();
    const entry = await this.config.registry.getSource(this.config.slug, sourceKey);
    if (entry === null) {
      throw new RightsViolationError(
        'UNREVIEWED',
        `source "${sourceKey}"`,
        `SOURCE_NOT_DECLARED: no registry entry in vertical "${this.config.slug}"; ` +
          'acquisition requires a rights record (AGENTS.md rule 1).',
      );
    }
    const source = await this.#ensureSource(entry, vertical.id);
    const binding = this.#fixtures.get(sourceKey);
    if (binding === undefined) {
      throw new PipelineConfigurationError(
        `no fixture binding for source "${sourceKey}"; the offline factory cannot acquire it`,
      );
    }

    const url = binding.entry.url;
    let job = await this.jobs.open({
      verticalId: vertical.id,
      sourceId: source.id,
      jobType: 'ARTIFACT_FETCH',
      idempotencyKey: `${this.#options.runId ?? now}:${url}`,
      payload: { url, source_key: sourceKey, vertical: this.config.slug },
      at: now,
    });

    const diagnostics: string[] = [];
    let outcome = 'SKIPPED';
    let artifactCount = 0;
    let recordCount = 0;
    let claimCount = 0;
    let relationshipCount = 0;
    let normalizationFailures = 0;

    /**
     * Advance to `to`, or do nothing if the job has already been there.
     *
     * A job resumed from `FAILED` re-enters at the stage it failed on, and
     * every stage below that point is idempotent, so the work is simply redone
     * while the state machine is not asked to move backwards.
     */
    const advanceTo = async (to: JobPipelineState, reason: string): Promise<void> => {
      const current = JOB_PIPELINE_ORDER.indexOf(job.status.state as JobPipelineState);
      if (current >= 0 && current >= JOB_PIPELINE_ORDER.indexOf(to)) return;
      job = await this.jobs.advance(job, to, now, reason);
    };

    try {
      if (job.status.state === 'FAILED') {
        // Not retryable, or the budget is spent. This belongs in a human
        // exception queue, not in a loop that re-tries it every cycle.
        return {
          sourceKey,
          jobId: job.id,
          finalState: 'FAILED',
          outcome: 'NOT_RETRYABLE',
          artifacts: 0,
          records: 0,
          claims: 0,
          relationships: 0,
          normalizationFailures: 0,
          diagnostics: [
            `job is FAILED at ${job.status.failed_from} and is not retryable ` +
              `(attempt ${job.status.retry.attempt}/${job.status.retry.max_attempts}); ` +
              'it needs a human, not another automatic attempt',
          ],
          error: job.status.retry.last_error_message,
        };
      }

      if (job.status.state === 'PUBLISHED') {
        // The unit already completed in this cycle. Re-running it is a no-op by
        // construction; the state machine says so rather than the code guessing.
        return {
          sourceKey,
          jobId: job.id,
          finalState: 'PUBLISHED',
          outcome: 'ALREADY_PUBLISHED',
          artifacts: 0,
          records: 0,
          claims: 0,
          relationships: 0,
          normalizationFailures: 0,
          diagnostics: ['job already PUBLISHED for this run id; nothing to do'],
          error: null,
        };
      }

      // ---- FETCH_QUEUED ---------------------------------------------------
      await advanceTo('FETCH_QUEUED', 'rights record present; queued');

      // ---- FETCHED --------------------------------------------------------
      const plan = this.#plans.get(sourceKey);
      if (plan === undefined) {
        throw new PipelineConfigurationError(
          `source "${sourceKey}" has a rights record but no mapping in source-mappings.yaml`,
        );
      }
      const undeclaredStreams = await this.#undeclaredCurrentStreams(
        source.id,
        plan.streams.map(({ stream }) => stream),
        this.store.driver,
      );
      if (undeclaredStreams.length > 0) {
        throw new PipelineConfigurationError(
          `SOURCE_STREAM_TRANSITION_REQUIRED: source "${sourceKey}" still has current ` +
            `FINALIZED membership in undeclared stream(s): ${undeclaredStreams.join(', ')}. ` +
            'Stream identifiers are immutable while membership is current.',
        );
      }
      await this.#requireInternalRights(source, entry, 'APPROVED_OR_ACTIVE', [
        { operation: 'ACQUIRE', assetClass: 'DOCUMENT', outputClass: 'RAW_RECORD', fieldKey: null },
        { operation: 'STORE', assetClass: 'DOCUMENT', outputClass: 'RAW_RECORD', fieldKey: null },
        { operation: 'CACHE', assetClass: 'DOCUMENT', outputClass: 'RAW_RECORD', fieldKey: null },
      ]);
      const provider = this.#options.providers.forEntry(entry);
      const acquisition = await provider.fetch({
        sourceId: source.id,
        sourceKey,
        verticalSlug: this.config.slug,
        url,
        retrievalScopeId: job.id,
      });
      outcome = acquisition.outcome;
      diagnostics.push(...acquisition.diagnostics);

      const acquired: AcquiredArtifact[] = [];
      for (const [index, artifact] of acquisition.artifacts.entries()) {
        const stored = acquisition.stored[index];
        const row = await this.store.recordSourceArtifact({
          source_id: source.id,
          url: artifact.url,
          retrieved_at: artifact.retrieved_at,
          content_hash: artifact.content_hash,
          mime_type: artifact.mime_type,
          r2_uri: artifact.r2_uri,
          http_status: artifact.http_status,
          extractor_version: artifact.extractor_version,
          policy_snapshot_id: artifact.policy_snapshot_id,
          byte_size: artifact.byte_size,
          acquisition_provider: artifact.acquisition_provider,
          acquisition_route: artifact.acquisition_route,
          account_or_product_plan: artifact.account_or_product_plan,
          acquisition_jurisdiction: artifact.acquisition_jurisdiction,
        });
        if (stored === undefined) {
          throw new IngestError(
            'ARTIFACT_RECEIPT_MISSING',
            `artifact ${row.id} has no matching durable storage receipt`,
            'TRANSIENT',
          );
        }
        const body = await this.#options.artifactStore.get(stored.key);
        if (body === null) {
          throw new IngestError(
            'ARTIFACT_BODY_MISSING',
            `artifact ${row.id} was recorded but its bytes are not in the evidence store`,
            'TRANSIENT',
          );
        }
        acquired.push({ artifact: row, stored, body: new Uint8Array(body.body) });
        await this.jobs.setArtifact(job.id, row.id);
      }
      artifactCount = acquired.length;
      await advanceTo('FETCHED', `${acquired.length} artifact(s) stored`);

      // A validator-confirmed 304 is evidence that the previously accepted
      // bytes are unchanged, not a new complete snapshot and never an empty
      // one. Advance the durable job without opening the canonical write
      // transaction or minting a watermark. `EMPTY` deliberately does not use
      // this path: absence without an artifact cannot authorize membership.
      if (acquisition.outcome === 'NOT_MODIFIED') {
        await advanceTo('EXTRACTED', 'not modified; prior extraction remains authoritative');
        await advanceTo('NORMALIZED', 'not modified; prior normalization remains authoritative');
        await this.#requireInternalRights(source, entry, 'ACTIVE', [
          { operation: 'DERIVE', assetClass: 'DATA', outputClass: 'METADATA', fieldKey: null },
        ]);
        await advanceTo('RESOLUTION_PENDING', 'not modified; no resolution write queued');
        await advanceTo('RESOLVED', 'not modified; prior resolution remains authoritative');
        await advanceTo('VALIDATED', 'internal rights matrix passed');
        job = await this.jobs.advance(job, 'PUBLISHED', now, 'not modified; no canonical writes');
        return {
          sourceKey,
          jobId: job.id,
          finalState: job.status.state,
          outcome,
          artifacts: 0,
          records: 0,
          claims: 0,
          relationships: 0,
          normalizationFailures: 0,
          diagnostics,
          error: null,
        };
      }

      // ---- EXTRACTED ------------------------------------------------------
      for (const stream of plan.streams) diagnostics.push(...stream.diagnostics);

      const extracted: { plan: StreamPlan; record: ExtractedRecord; artifact: SourceArtifact }[] = [];
      for (const { artifact, body } of acquired) {
        for (const stream of plan.streams) {
          const schema = this.#schemaFor(stream, body);
          const records = await this.#extraction.extract({ artifact, body }, schema);
          for (const record of records) extracted.push({ plan: stream, record, artifact });
        }
      }
      recordCount = extracted.length;

      // Extraction creates no canonical source-record authority. Full-snapshot
      // acceptance must win the stream lock first, otherwise a delayed stale
      // snapshot could leave behind a current PROVISIONAL row even when all of
      // its membership changes were later refused.
      await advanceTo('EXTRACTED', `${extracted.length} source record(s)`);

      // ---- NORMALIZED -----------------------------------------------------
      const normalized: NormalizedRecord[] = [];
      for (const item of extracted) {
        const permittedProperties = [];
        for (const rule of item.plan.ruleSet.properties) {
          const normalize = await this.#internalRightsDecision(source, entry, 'ACTIVE', {
            operation: 'NORMALIZE',
            assetClass: 'DATA',
            outputClass: rule.output_kind ?? 'NORMALIZED_FACT',
            fieldKey: rule.property,
          });
          const derive = await this.#internalRightsDecision(source, entry, 'ACTIVE', {
            operation: 'DERIVE',
            assetClass: 'DATA',
            outputClass: rule.output_kind ?? 'NORMALIZED_FACT',
            fieldKey: rule.property,
          });
          if (normalize.permitted && derive.permitted) {
            permittedProperties.push(rule);
          } else {
            diagnostics.push(
              `${sourceKey}/${item.record.source_record_key}: field ${rule.property} withheld by ` +
                `rights matrix (NORMALIZE=${normalize.reasonCode}, DERIVE=${derive.reasonCode})`,
            );
          }
        }
        const permittedIdentifiers = [];
        for (const rule of item.plan.ruleSet.identifiers) {
          const normalize = await this.#internalRightsDecision(source, entry, 'ACTIVE', {
            operation: 'NORMALIZE',
            assetClass: 'DATA',
            outputClass: 'METADATA',
            fieldKey: rule.alias_type,
          });
          const derive = await this.#internalRightsDecision(source, entry, 'ACTIVE', {
            operation: 'DERIVE',
            assetClass: 'DATA',
            outputClass: 'METADATA',
            fieldKey: rule.alias_type,
          });
          if (normalize.permitted && derive.permitted) {
            permittedIdentifiers.push(rule);
          } else {
            diagnostics.push(
              `${sourceKey}/${item.record.source_record_key}: identifier ${rule.alias_type} withheld by ` +
                `rights matrix (NORMALIZE=${normalize.reasonCode}, DERIVE=${derive.reasonCode})`,
            );
          }
        }
        const normalization = normalizeRecord(
          {
            source_record_key: item.record.source_record_key,
            entity_type: item.plan.entityType,
            values: item.record.values,
            extraction_confidence: item.record.extraction_confidence,
            artifact_id: item.artifact.id,
          },
          {
            ...item.plan.ruleSet,
            properties: permittedProperties,
            identifiers: permittedIdentifiers,
          },
        );
        normalizationFailures += normalization.failures.length;
        for (const failure of normalization.failures) {
          diagnostics.push(
            `${sourceKey}/${item.record.source_record_key}: ${failure.reason} — ${failure.message}`,
          );
        }
        normalized.push({
          plan: item.plan,
          extracted: item.record,
          artifact: item.artifact,
          normalization,
        });
      }
      await advanceTo('NORMALIZED', `${normalized.length} record(s) normalized`);

      // Canonical identity is itself a derived output. The legacy source-wide
      // publication booleans no longer decide this boundary: the accepted
      // matrix does, with absence of a DERIVE grant treated as refusal.
      await this.#requireInternalRights(source, entry, 'ACTIVE', [
        { operation: 'DERIVE', assetClass: 'DATA', outputClass: 'METADATA', fieldKey: null },
      ]);

      // ---- RESOLUTION_PENDING → RESOLVED ----------------------------------
      await advanceTo('RESOLUTION_PENDING', 'deterministic resolution queued');
      const resolver = await this.#ensureResolver();
      const batch = await this.#resolveBatch(
        resolver,
        source,
        entry,
        vertical.id,
        normalized,
        plan.streams,
        acquired,
        acquisition.fetchedAt as IsoDateTime,
        diagnostics,
      );
      const resolved = batch.resolved;
      relationshipCount = batch.relationshipCount;
      for (const sourceRecord of batch.sourceRecords) {
        await this.jobs.setSourceRecord(job.id, sourceRecord.id);
      }
      await advanceTo('RESOLVED', `${resolved.length} record(s) resolved`);

      // ---- VALIDATED ------------------------------------------------------
      // The gate itself ran before resolution (above); this records that the
      // record set passed it. A source that may be *fetched* is not
      // automatically a source that may be *published*.
      await advanceTo('VALIDATED', 'internal rights matrix passed');

      // ---- PUBLISHED ------------------------------------------------------
      if (this.#options.dryRun === true) {
        diagnostics.push('dry run: no canonical claims were written');
      } else {
        claimCount = await this.#writeClaims(resolved, source);
      }
      job = await this.jobs.advance(
        job,
        'PUBLISHED',
        now,
        `${claimCount} claim(s), ${relationshipCount} relationship(s)`,
      );

      return {
        sourceKey,
        jobId: job.id,
        finalState: job.status.state,
        outcome,
        artifacts: artifactCount,
        records: recordCount,
        claims: claimCount,
        relationships: relationshipCount,
        normalizationFailures,
        diagnostics,
        error: null,
      };
    } catch (error) {
      // Never a silent drop and never a thrown-away row: the job keeps the
      // stage it failed on and its retry budget.
      const failed = await this.jobs.fail(job, error, now);
      const message = error instanceof Error ? error.message : String(error);
      this.#diagnostics.push(`${sourceKey}: FAILED at ${failed.status.state} — ${message}`);
      return {
        sourceKey,
        jobId: failed.id,
        finalState: failed.status.state,
        outcome: 'FAILED',
        artifacts: artifactCount,
        records: recordCount,
        claims: claimCount,
        relationships: relationshipCount,
        normalizationFailures,
        diagnostics,
        error: message,
      };
    }
  }

  /**
   * Run the doc-04 cascade over every property that has more than one standing
   * claim and promote the winner to ACTIVE.
   *
   * This is deliberately a separate pass over the whole vertical rather than
   * something each source does as it lands. Promoting inside a source's own run
   * would let ingestion order decide the canonical value, and would close a
   * rival claim that a later, more authoritative source is about to contradict.
   */
  async promoteCanonicalView(): Promise<number> {
    const policy = this.factSelectionPolicy;
    const now = this.#options.now;
    const rows = await this.store.driver.query<{ entity_id: string; property: string }>(
      `SELECT DISTINCT f.entity_id, f.property
         FROM facts f
         JOIN entities e ON e.id = f.entity_id
        WHERE e.vertical_id = $1 AND f.valid_to IS NULL AND f.status <> 'RETRACTED'
        ORDER BY f.entity_id, f.property`,
      [(await this.#ensureVertical()).id],
    );

    let promoted = 0;
    for (const row of rows) {
      const entityId = row.entity_id as EntityId;
      const property = row.property as Identifier;
      const selection = await this.store.selectFact(entityId, property, policy);
      const winner = selection.selected;
      if (winner === null) continue;
      if (winner.fact.status === 'ACTIVE') continue;

      // Re-assert the winning claim as ACTIVE. Its own existing evidence is
      // supplied, so the write promotes rather than adding a new row or a new
      // evidence chain.
      const evidence = winner.evidence[0];
      if (evidence === undefined) continue;
      const draft = {
        entity_id: entityId,
        property,
        normalized_value: winner.fact.normalized_value,
        value_type: winner.fact.value_type,
        unit: winner.fact.unit,
        valid_from: now,
        confidence: winner.fact.confidence,
        recorded_at: now,
        status: 'ACTIVE' as const,
      };
      const evidenceInput = [
        {
          artifact_id: evidence.evidence.artifact_id,
          source_record_id: evidence.evidence.source_record_id,
          source_value: evidence.evidence.source_value,
          locator_type: evidence.evidence.locator_type,
          locator_value: evidence.evidence.locator_value,
          observed_at: evidence.evidence.observed_at,
        },
      ] as const;
      const dependencies = await this.store.driver.query<{
        input_fact_id: string;
        transformation_ref: string;
      }>(
        `SELECT input_fact_id, transformation_ref FROM fact_dependencies
          WHERE derived_fact_id = $1 ORDER BY input_fact_id, transformation_ref`,
        [winner.fact.id],
      );
      const result = winner.fact.output_kind === 'DERIVED_METRIC'
        ? await this.store.appendDerivedFactWithEvidence(
            draft,
            evidenceInput,
            dependencies.map((dependency) => ({
              input_fact_id: dependency.input_fact_id as never,
              transformation_ref: dependency.transformation_ref,
            })) as never,
          )
        : await this.store.appendFactWithEvidence(
            draft,
            evidenceInput,
          );
      if (result.outcome !== 'UNCHANGED') promoted += 1;
    }

    await this.recordVerificationVerdicts();
    return promoted;
  }

  /**
   * Record the "Source verified" verdict for every published property.
   *
   * The badge used to exist only as a pure function of today's evidence and
   * today's policy, which cannot answer the question that actually gets asked:
   * "your export said this was verified in March; on what basis?" Both inputs
   * move — evidence is superseded, policy is rewritten — so the verdict is
   * stored as an event carrying the value, the exact evidence, the outcome and
   * its blockers, the policy version and when it was evaluated.
   *
   * Deliberately after promotion, not during it: the verdict is about the value
   * that was actually published, and promotion is what decides that.
   *
   * A verdict is never allowed to fail a run. Verification is a claim ABOUT
   * published data, not a precondition for publishing it, and losing an
   * already-written canonical fact because its badge could not be recorded
   * would be the wrong trade in both directions.
   */
  async recordVerificationVerdicts(): Promise<number> {
    const policy = this.factSelectionPolicy;
    const evaluatedAt = this.#options.now;
    const rows = await this.store.driver.query<{ entity_id: string; property: string }>(
      `SELECT DISTINCT f.entity_id, f.property
         FROM facts f
         JOIN entities e ON e.id = f.entity_id
        WHERE e.vertical_id = $1 AND f.valid_to IS NULL AND f.status = 'ACTIVE'
        ORDER BY f.entity_id, f.property`,
      [(await this.#ensureVertical()).id],
    );

    let recorded = 0;
    for (const row of rows) {
      const entityId = row.entity_id as EntityId;
      const property = row.property as Identifier;
      try {
        const explanation = await explainFact(this.store, entityId, property, policy);
        const selected = explanation?.selected;
        if (explanation === null || selected === undefined || selected === null) continue;

        const verdict = verifyFact(explanation, new Date(evaluatedAt));
        const evidenceRefs = (explanation.lineage?.chain ?? []).map((link) => ({
          artifact_id: link.artifact.id,
          content_hash: link.artifact.content_hash,
          source_record_id: link.source_record.id,
          locator_type: link.locator.type,
          locator_value: link.locator.value,
          artifact_url: link.artifact.url,
          publisher: link.source.publisher,
          retrieved_at: link.retrieved_at,
        }));

        await this.store.recordFactVerification({
          entity_id: entityId,
          property,
          fact_id: selected.fact_id,
          selected_value: selected.value,
          unit: selected.unit,
          verified: verdict.verified,
          reason: verdict.reason,
          blockers: [...verdict.blockers],
          signals: { ...verdict.signals },
          evidence_refs: evidenceRefs,
          selection_rule: explanation.rule,
          policy_version: verdict.policy_version,
          evaluated_at: evaluatedAt,
          // Outcome plus the evidence it rested on. Two evaluations that agree
          // on both are the same verdict; anything else is a new event.
          verdict_fingerprint: sha256Hex(
            stableStringify({
              verified: verdict.verified,
              blockers: [...verdict.blockers].sort(),
              rule: explanation.rule,
              value: selected.value,
              unit: selected.unit,
              evidence: evidenceRefs
                .map((ref) => `${ref.content_hash}#${ref.locator_type}#${ref.locator_value}`)
                .sort(),
            }),
          ),
        });
        recorded += 1;
      } catch (error) {
        this.#diagnostics.push(
          `verification verdict for ${entityId}/${property} not recorded: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return recorded;
  }

  /* ---------------- stages ---------------- */

  /**
   * CSV exports commonly ship a provenance preamble above the header. The
   * mapping declares the pattern; the physical line to start at can only be
   * known once the bytes are in hand.
   */
  #schemaFor(stream: StreamPlan, body: Uint8Array): ExtractionSchema {
    if (stream.skipLinesMatching === null || stream.schema.record.kind !== 'csv_rows') {
      return stream.schema;
    }
    const pattern = new RegExp(stream.skipLinesMatching);
    const lines = new TextDecoder().decode(body).split(/\r\n|\r|\n/);
    let skipped = 0;
    while (skipped < lines.length && pattern.test(lines[skipped] ?? '')) skipped += 1;
    return {
      ...stream.schema,
      record: { ...stream.schema.record, from_line: skipped + 1 },
    };
  }

  async #resolveBatch(
    resolver: EntityResolver,
    source: Source,
    entry: SourceRegistryEntry,
    verticalId: VerticalId,
    items: readonly NormalizedRecord[],
    streams: readonly StreamPlan[],
    snapshotArtifacts: readonly AcquiredArtifact[],
    snapshotObservedAt: IsoDateTime,
    diagnostics: string[],
  ): Promise<{
    readonly resolved: readonly ResolvedRecordContext[];
    readonly sourceRecords: readonly SourceRecord[];
    readonly relationshipCount: number;
  }> {
    const prepared = items.map((item): PreparedRecord => {
      const validatedAliases = this.#validatedAliases(resolver, source, item);
      const manufacturerObservation = this.#manufacturerObservation(item);
      const hasStrongAlias = validatedAliases.some(({ claim }) => claim.strong);
      return {
        item,
        validatedAliases,
        manufacturerObservation,
        manufacturerAliasIdentities:
          !hasStrongAlias || manufacturerObservation === null
            ? []
            : resolver.previewManufacturerAliasIdentities(
                manufacturerObservation.value,
                validatedAliases.map(({ claim }) => claim),
              ),
        canonicalSlugLockIdentity: !hasStrongAlias
          ? null
          : resolver.previewCanonicalSlug(
              item.plan.entityType,
              validatedAliases.map(({ claim }) => claim),
              manufacturerObservation?.value ?? null,
            ),
      };
    });
    const incomingLogicalKeys = prepared.map(({ item }) => item.extracted.source_record_key);
    const uniqueIncomingLogicalKeys = new Set(incomingLogicalKeys);
    if (uniqueIncomingLogicalKeys.size !== prepared.length) {
      throw new IngestError(
        'DUPLICATE_SOURCE_RECORD_KEY',
        'one source batch contains duplicate logical source-record keys',
        'DATA',
      );
    }
    const snapshotCandidates = buildSnapshotCandidates(
      streams,
      items,
      snapshotArtifacts,
      snapshotObservedAt,
    );
    const fullSnapshotStreams = snapshotCandidates.map(({ stream }) => stream);
    if (fullSnapshotStreams.length > 0 && snapshotArtifacts.length === 0) {
      throw new IngestError(
        'FULL_SNAPSHOT_EVIDENCE_MISSING',
        'a complete stream cannot retire membership without at least one stored artifact',
        'DATA',
      );
    }
    if (
      fullSnapshotStreams.length > 0 &&
      snapshotArtifacts.some(({ stored }) => stored.retrievalReceiptId === null)
    ) {
      throw new IngestError(
        'FULL_SNAPSHOT_RETRIEVAL_RECEIPT_MISSING',
        'a complete stream cannot change membership without a run-scoped retrieval receipt',
        'DATA',
      );
    }
    const snapshotPreview = await this.#currentSnapshotRecords(
      source.id,
      fullSnapshotStreams,
      this.store.driver,
    );
    const logicalKeys = [...new Set([
      ...incomingLogicalKeys,
      ...snapshotPreview.map(({ source_record_key }) => source_record_key),
    ])]
      .sort(compareCodeUnits);

    const rights = new Map<RelationshipPlan, RightsEvaluation>();
    for (const { item } of prepared) {
      for (const plan of item.plan.relationships) {
        rights.set(
          plan,
          await this.#internalRightsDecision(source, entry, 'ACTIVE', {
            operation: 'DERIVE',
            assetClass: 'DATA',
            outputClass: 'METADATA',
            fieldKey: plan.predicate,
          }),
        );
      }
    }

    // Preview the outgoing identities before opening the write transaction so
    // the transaction can acquire the complete alias-lock set before any read
    // or mutation. The logical-record locks serialize a competing refresh; a
    // post-lock reload below refuses a stale preview instead of writing under
    // an incomplete lock set.
    const outgoingPreview = await this.#outgoingAliasClaims(
      source.id,
      logicalKeys,
      this.store.driver,
    );
    const aliasLockKeys = new Set<string>();
    for (const claim of outgoingPreview) {
      aliasLockKeys.add(stableStringify([
        claim.entity_type,
        claim.alias_type,
        claim.normalized_value,
      ]));
    }
    for (const preparedRecord of prepared) {
      const { item, validatedAliases } = preparedRecord;
      for (const { claim } of validatedAliases) {
        aliasLockKeys.add(stableStringify([
          item.plan.entityType,
          claim.aliasType,
          claim.normalizedValue,
        ]));
      }
      for (const identity of preparedRecord.manufacturerAliasIdentities) {
        aliasLockKeys.add(stableStringify([
          identity.entityType,
          identity.aliasType,
          identity.normalizedValue,
        ]));
      }
      if (preparedRecord.canonicalSlugLockIdentity !== null) {
        aliasLockKeys.add(stableStringify([
          'canonical-slug',
          verticalId,
          item.plan.entityType,
          preparedRecord.canonicalSlugLockIdentity,
        ]));
      }
      for (const plan of item.plan.relationships) {
        for (const endpoint of [plan.subject, plan.object]) {
          if (endpoint.kind !== 'alias') continue;
          const value = stringOrNull(item.extracted.raw_payload[endpoint.field]);
          if (value === null) continue;
          aliasLockKeys.add(stableStringify([
            endpoint.entityType,
            endpoint.aliasType,
            resolver.normalizer.normalize(endpoint.aliasType, value),
          ]));
        }
      }
    }

    return this.store.driver.transaction(async (tx) => {
      // A source-wide set lock prevents a mapping rename/removal from racing a
      // refresh that still owns the prior stream. Stream identifiers are
      // durable membership keys, not presentation labels.
      await tx.query(
        `SELECT pg_advisory_xact_lock(hashtext('source-stream-set'), hashtext($1))`,
        [source.id],
      );
      const undeclaredStreams = await this.#undeclaredCurrentStreams(
        source.id,
        streams.map(({ stream }) => stream),
        tx,
      );
      if (undeclaredStreams.length > 0) {
        throw new IngestError(
          'SOURCE_STREAM_TRANSITION_REQUIRED',
          `current FINALIZED membership exists in undeclared stream(s): ${undeclaredStreams.join(', ')}`,
          'DATA',
        );
      }
      // Every ingest run takes the source stream locks first. A complete
      // snapshot can then treat omission as evidence without racing another
      // full or incremental update of the same stream.
      for (const stream of streams.map(({ stream }) => stream).sort(compareCodeUnits)) {
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtext('source-stream-refresh'), hashtext($1))`,
          [stableStringify([source.id, stream])],
        );
      }
      const snapshotCurrentAll = await this.#currentSnapshotRecords(source.id, fullSnapshotStreams, tx);
      const unheldSnapshotKeys = snapshotCurrentAll.filter(
        ({ source_record_key }) => !logicalKeys.includes(source_record_key),
      );
      if (unheldSnapshotKeys.length > 0) {
        throw new IngestError(
          'SNAPSHOT_LOCK_SET_CHANGED',
          'complete-stream membership changed while the replacement batch was waiting for locks',
          'TRANSIENT',
        );
      }

      // The stream advisory lock makes this comparison and append one atomic
      // acceptance decision. Postgres performs both parts of the total order:
      // provider observation time first, lowercase SHA-256 digest under C
      // collation second. A rejected candidate causes no canonical writes.
      const acceptedSnapshots = new Map<string, AcceptedSnapshot>();
      for (const candidate of snapshotCandidates) {
        const [latest] = await tx.query<{
          id: string;
          observed_at: string;
          snapshot_digest: string;
          candidate_is_newer: boolean;
          candidate_is_replay: boolean;
        }>(
          `SELECT id, observed_at, snapshot_digest,
                  ($3::timestamptz > observed_at OR
                   ($3::timestamptz = observed_at AND
                    $4 COLLATE "C" > snapshot_digest COLLATE "C")) AS candidate_is_newer,
                  ($3::timestamptz = observed_at AND
                   $4 COLLATE "C" = snapshot_digest COLLATE "C") AS candidate_is_replay
             FROM source_stream_snapshot_acceptances
            WHERE source_id = $1 AND source_stream = $2
            ORDER BY observed_at DESC, snapshot_digest COLLATE "C" DESC
            LIMIT 1`,
          [source.id, candidate.stream, candidate.observedAt, candidate.snapshotDigest],
        );
        if (latest !== undefined && !latest.candidate_is_newer) {
          diagnostics.push(
            latest.candidate_is_replay
              ? `${source.domain}/${candidate.stream}: complete snapshot replay ignored`
              : `${source.domain}/${candidate.stream}: stale complete snapshot ignored ` +
                `(observed ${candidate.observedAt}; current ${String(latest.observed_at)})`,
          );
          continue;
        }
        const [acceptance] = await tx.query<{ id: string }>(
          `INSERT INTO source_stream_snapshot_acceptances
             (source_id, source_stream, observed_at, snapshot_digest,
              artifact_set_digest, mapping_digest, record_set_digest, retrieval_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            source.id,
            candidate.stream,
            candidate.observedAt,
            candidate.snapshotDigest,
            candidate.artifactSetDigest,
            candidate.mappingDigest,
            candidate.recordSetDigest,
            snapshotArtifacts.length,
          ],
        );
        if (acceptance === undefined) throw new Error('snapshot acceptance insert returned no row');
        for (const acquired of [...snapshotArtifacts].sort((left, right) =>
          compareCodeUnits(
            stableStringify(snapshotArtifactIdentity(left)),
            stableStringify(snapshotArtifactIdentity(right)),
          ) || compareCodeUnits(left.artifact.id, right.artifact.id))) {
          if (acquired.stored.retrievalReceiptId === null) {
            throw new Error('validated snapshot retrieval receipt unexpectedly missing');
          }
          await tx.query(
            `INSERT INTO source_stream_snapshot_acceptance_artifacts
               (acceptance_id, artifact_id, retrieval_key, retrieval_receipt_id)
             VALUES ($1, $2, $3, $4)`,
            [
              acceptance.id,
              acquired.artifact.id,
              acquired.stored.retrievalKey,
              acquired.stored.retrievalReceiptId,
            ],
          );
        }
        acceptedSnapshots.set(candidate.stream, { ...candidate, acceptanceId: acceptance.id });
      }

      const activePrepared = prepared.filter(
        ({ item }) => item.plan.refreshMode === 'INCREMENTAL' || acceptedSnapshots.has(item.plan.stream),
      );
      const snapshotCurrent = snapshotCurrentAll.filter(({ source_stream }) =>
        acceptedSnapshots.has(source_stream));
      const activeLogicalKeys = [...new Set([
        ...activePrepared.map(({ item }) => item.extracted.source_record_key),
        ...snapshotCurrent.map(({ source_record_key }) => source_record_key),
      ])].sort(compareCodeUnits);

      // Every competing refresh of the same logical records follows this exact
      // lock order after the enclosing stream locks.
      for (const key of logicalKeys) {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [source.id, key]);
      }
      for (const key of [...aliasLockKeys].sort(compareCodeUnits)) {
        await tx.query(
          `SELECT pg_advisory_xact_lock(hashtext('entity-alias-resolution'), hashtext($1))`,
          [key],
        );
      }

      const outgoing = await this.#outgoingAliasClaims(source.id, activeLogicalKeys, tx);
      const unheldOutgoing = outgoing.filter((claim) => !aliasLockKeys.has(stableStringify([
        claim.entity_type,
        claim.alias_type,
        claim.normalized_value,
      ])));
      if (unheldOutgoing.length > 0) {
        throw new IngestError(
          'ALIAS_LOCK_SET_CHANGED',
          'current source alias ownership changed while the replacement batch was waiting for locks',
          'TRANSIENT',
        );
      }
      const maskedAliasIds = new Set(
        outgoing.filter((claim) => !claim.independent_current).map((claim) => claim.alias_id),
      );

      const stagedAliases: StagedAliasMatch[] = [];
      const identityPlans: PlannedRecordResolution[] = [];
      for (const preparedRecord of activePrepared) {
        const { item, validatedAliases } = preparedRecord;
        const aliases = validatedAliases.map(({ claim }) => claim);
        if (aliases.every((alias) => !alias.strong)) {
          diagnostics.push(
            `${source.domain}/${item.extracted.source_record_key}: no usable strong identifier; record not resolved`,
          );
          identityPlans.push({
            prepared: preparedRecord,
            resolution: null,
            entity: null,
            manufacturer: null,
            aliases: [],
            relationships: [],
          });
          continue;
        }

        const manufacturerObservation = preparedRecord.manufacturerObservation;
        const manufacturerPlan = manufacturerObservation === null
          ? null
          : await resolver.planManufacturer(manufacturerObservation.value, source.id, tx);
        const manufacturer = manufacturerPlan?.entity ?? null;
        const continuityAliasIds = new Set(
          outgoing
            .filter(
              (claim) =>
                claim.source_record_key === item.extracted.source_record_key &&
                validatedAliases.some(
                  ({ claim: incoming }) =>
                    incoming.aliasType === claim.alias_type &&
                    incoming.normalizedValue === claim.normalized_value,
                ),
            )
            .map((claim) => claim.alias_id),
        );
        const resolution = await resolver.planRecord(
          {
            entityType: item.plan.entityType,
            aliases,
            manufacturer,
            sourceId: source.id,
            sourceRecordKey: item.extracted.source_record_key,
            resolutionDiscriminator: sha256Hex(stableStringify({
              sourceDomain: source.domain,
              sourceRecordKey: item.extracted.source_record_key,
              artifactContentHash: item.artifact.content_hash,
              entityType: item.plan.entityType,
              aliases,
              manufacturerSlug: manufacturer?.canonical_slug ?? null,
            })),
            stagedAliases,
            maskedAliasIds,
            continuityAliasIds,
          },
          tx,
        );

        const plannedAliases: PlannedSourceAlias[] = validatedAliases.map(({ claim, locator }) => ({
          entity: resolution.entity,
          aliasType: claim.aliasType,
          aliasValue: claim.aliasValue,
          normalizedValue: claim.normalizedValue,
          sourceId: source.id,
          identityConfidence: identityConfidence(claim.strong ? 0.99 : 0.6),
          locator,
        }));
        if (manufacturerPlan !== null && manufacturerObservation !== null) {
          for (const alias of manufacturerPlan.aliases) {
            plannedAliases.push({ ...alias, locator: manufacturerObservation.locator });
          }
          for (const { claim, locator } of validatedAliases) {
            const prefix = resolver.planScopedIdentifierPrefix(
              manufacturerPlan.entity,
              claim.aliasType,
              claim.aliasValue,
              source.id,
            );
            if (prefix !== null) plannedAliases.push({ ...prefix, locator });
          }
        }
        for (const alias of plannedAliases) {
          stagedAliases.push({
            entity: alias.entity,
            aliasType: alias.aliasType,
            aliasValue: alias.aliasValue,
            normalizedValue: alias.normalizedValue,
          });
        }
        identityPlans.push({
          prepared: preparedRecord,
          resolution,
          entity: resolution.entity,
          manufacturer,
          aliases: plannedAliases,
          relationships: [],
        });
      }

      const planned: PlannedRecordResolution[] = [];
      for (const identity of identityPlans) {
        const relationships: PlannedRelationship[] = [];
        for (const plan of identity.prepared.item.plan.relationships) {
          relationships.push(
            await this.#planRelationship(
              identity,
              plan,
              rights.get(plan),
              stagedAliases,
              maskedAliasIds,
              source,
              verticalId,
              tx,
              diagnostics,
            ),
          );
        }
        planned.push({ ...identity, relationships });
      }

      const finalRecords = new Map<string, SourceRecord>();
      for (const record of planned) {
        const { item } = record.prepared;
        const sourceRecord = await this.store.reconcileSourceRecord(
          {
            source_id: source.id,
            artifact_id: item.artifact.id,
            source_record_key: item.extracted.source_record_key,
            source_stream: item.plan.stream,
            entity_type: item.plan.entityType,
            raw_payload: item.extracted.raw_payload,
            normalized_payload: item.normalization.normalized_payload,
            extraction_confidence: item.extracted.extraction_confidence,
            extractor_version: item.extracted.extractor_version,
          },
          tx,
          sourceRecordEvidenceFingerprint(record),
          snapshotObservedAt,
        );
        finalRecords.set(item.extracted.source_record_key, sourceRecord);
      }

      const incomingMemberships = new Set(
        activePrepared.map(({ item }) =>
          stableStringify([item.plan.stream, item.extracted.source_record_key])),
      );
      const omitted = snapshotCurrent.filter(
        ({ source_stream, source_record_key }) =>
          !incomingMemberships.has(stableStringify([source_stream, source_record_key])),
      );
      const artifacts = [...new Map(
        snapshotArtifacts.map((artifact) => [artifact.artifact.id, artifact] as const),
      ).values()].sort((left, right) => compareCodeUnits(left.artifact.id, right.artifact.id));
      for (const record of omitted) {
        const acceptance = acceptedSnapshots.get(record.source_stream);
        if (acceptance === undefined) {
          throw new Error('accepted snapshot missing for omission target');
        }
        const retired = await tx.query<{ id: string }>(
          `UPDATE source_records
              SET is_current = FALSE, updated_at = now()
            WHERE id = $1 AND is_current
            RETURNING id`,
          [record.id],
        );
        if (retired[0] === undefined) {
          throw new IngestError(
            'SNAPSHOT_RECORD_CHANGED',
            'a complete-stream omission target changed after membership was locked',
            'TRANSIENT',
          );
        }
        for (const artifact of artifacts) {
          await tx.query(
            `INSERT INTO source_record_snapshot_retirements
               (source_record_id, snapshot_acceptance_id, artifact_id,
                source_id, source_stream, retired_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (source_record_id, artifact_id) DO NOTHING`,
            [
              record.id,
              acceptance.acceptanceId,
              artifact.artifact.id,
              source.id,
              record.source_stream,
              acceptance.observedAt,
            ],
          );
        }
      }
      if (omitted.length > 0) {
        diagnostics.push(`${omitted.length} source record(s) retired by complete snapshot omission`);
      }

      const resolved: ResolvedRecordContext[] = [];
      const refreshedEntityIds = new Set<EntityId>();
      let relationshipCount = 0;
      for (const record of planned) {
        const { item } = record.prepared;
        const sourceRecord = finalRecords.get(item.extracted.source_record_key);
        if (sourceRecord === undefined) throw new Error('reconciled source record missing');
        if (record.resolution === null || record.entity === null) continue;

        for (const alias of record.aliases) {
          const staged = await resolver.stageSourceAlias(alias, tx);
          const aliasClaim = await this.store.recordSourceAliasClaim(
            {
              entity_alias_id: staged.id,
              asserted_alias_value: alias.aliasValue,
              asserted_normalized_value: alias.normalizedValue,
              identity_confidence: alias.identityConfidence,
              source_record_id: sourceRecord.id,
              locator_type: alias.locator.type,
              locator_value: alias.locator.value,
            },
            tx,
          );
          await this.store.recordEntityEvidence(
            {
              entity_id: alias.entity.id,
              artifact_id: item.artifact.id,
              source_record_id: sourceRecord.id,
              entity_alias_claim_id: aliasClaim.id,
              contribution_role: 'ALIAS',
              locator_type: alias.locator.type,
              locator_value: alias.locator.value,
              observed_at: item.artifact.retrieved_at,
            },
            tx,
          );
        }
        await this.store.recordEntityEvidence(
          {
            entity_id: record.entity.id,
            artifact_id: item.artifact.id,
            source_record_id: sourceRecord.id,
            contribution_role: 'EXISTENCE',
            locator_type: item.extracted.locator.type,
            locator_value: item.extracted.locator.value,
            observed_at: item.artifact.retrieved_at,
          },
          tx,
        );
        if (record.manufacturer !== null) {
          await this.store.recordEntityEvidence(
            {
              entity_id: record.manufacturer.id,
              artifact_id: item.artifact.id,
              source_record_id: sourceRecord.id,
              contribution_role: 'EXISTENCE',
              locator_type: item.extracted.locator.type,
              locator_value: item.extracted.locator.value,
              observed_at: item.artifact.retrieved_at,
            },
            tx,
          );
        }
        await resolver.persistResolution(record.resolution, sourceRecord.id, tx);

        if (this.#options.dryRun !== true) {
          for (const relationship of record.relationships) {
            if (relationship.writer === null) continue;
            await this.store.upsertRelationshipWithEvidence(
              relationship.writer.draft,
              [{ ...relationship.writer.evidence, source_record_id: sourceRecord.id }],
              tx,
            );
            relationshipCount += 1;
          }
        }

        const entity = await resolver.refreshPreferredName(
          record.entity,
          {
            entityType: item.plan.entityType,
            aliases: record.prepared.validatedAliases.map(({ claim }) => claim),
            manufacturer: record.manufacturer,
          },
          tx,
        );
        refreshedEntityIds.add(entity.id);
        resolved.push({
          plan: item.plan,
          extracted: item.extracted,
          sourceRecord,
          normalization: item.normalization,
          artifact: item.artifact,
          entity,
          manufacturer: record.manufacturer,
        });
      }
      const withdrawnEntityIds = [...new Set(outgoing.map((claim) => claim.entity_id as EntityId))]
        .sort(compareCodeUnits);
      for (const entityId of withdrawnEntityIds) {
        if (refreshedEntityIds.has(entityId)) continue;
        await resolver.refreshStoredPreferredName(entityId, tx);
      }
      return {
        resolved,
        sourceRecords: [...finalRecords.values()],
        relationshipCount,
      };
    });
  }

  async #currentSnapshotRecords(
    sourceId: Source['id'],
    streams: readonly string[],
    executor: SqlExecutor,
  ): Promise<readonly {
    readonly id: string;
    readonly source_record_key: string;
    readonly source_stream: string;
  }[]> {
    if (streams.length === 0) return [];
    const streamPlaceholders = streams.map((_, index) => `$${index + 2}`).join(', ');
    return executor.query(
      `SELECT id::text, source_record_key, source_stream
         FROM source_records
        WHERE source_id = $1
          AND source_stream IN (${streamPlaceholders})
          AND is_current
        ORDER BY source_stream, source_record_key, id`,
      [sourceId, ...streams],
    );
  }

  async #undeclaredCurrentStreams(
    sourceId: Source['id'],
    declaredStreams: readonly string[],
    executor: SqlExecutor,
  ): Promise<readonly string[]> {
    const rows = await executor.query<{ source_stream: string }>(
      `SELECT DISTINCT source_stream
         FROM source_records
        WHERE source_id = $1
          AND is_current
          AND revision_state = 'FINALIZED'
          AND source_stream IS NOT NULL
        ORDER BY source_stream`,
      [sourceId],
    );
    const declared = new Set(declaredStreams);
    return rows
      .map(({ source_stream }) => source_stream)
      .filter((stream) => !declared.has(stream));
  }

  #validatedAliases(
    resolver: EntityResolver,
    source: Source,
    item: NormalizedRecord,
  ): readonly ValidatedAlias[] {
    const validated: ValidatedAlias[] = [];
    for (const identifier of item.normalization.identifiers) {
      const plan = item.plan.aliases.find((alias) => alias.aliasType === identifier.alias_type);
      const normalizedValue = resolver.normalizer.normalize(identifier.alias_type, identifier.alias_value);
      const invalid = resolver.normalizer.validate(identifier.alias_type, normalizedValue);
      if (invalid !== null) {
        this.#diagnostics.push(
          `${source.domain}/${item.extracted.source_record_key}: alias ${identifier.alias_type} quarantined — ${invalid}`,
        );
        continue;
      }
      validated.push({
        claim: {
          aliasType: identifier.alias_type,
          aliasValue: identifier.alias_value,
          normalizedValue,
          strong: plan?.strong ?? false,
        },
        locator: identifier.locator,
      });
    }
    return validated;
  }

  #manufacturerObservation(item: NormalizedRecord): {
    readonly value: string;
    readonly locator: ExtractedRecord['locator'];
  } | null {
    for (const relationship of item.plan.relationships) {
      for (const endpoint of [relationship.subject, relationship.object]) {
        if (endpoint.kind !== 'publisher') continue;
        if (endpoint.literal !== null) {
          return { value: endpoint.literal, locator: item.extracted.locator };
        }
        if (endpoint.field === null) continue;
        const value = stringOrNull(item.extracted.raw_payload[endpoint.field]);
        if (value === null) continue;
        const extracted = item.extracted.values.find((candidate) => candidate.field === endpoint.field);
        return { value, locator: extracted?.locator ?? item.extracted.locator };
      }
    }
    return null;
  }

  async #outgoingAliasClaims(
    sourceId: Source['id'],
    logicalKeys: readonly string[],
    tx: SqlExecutor,
  ): Promise<readonly {
    readonly alias_id: string;
    readonly entity_id: string;
    readonly source_record_key: string;
    readonly entity_type: string;
    readonly alias_type: string;
    readonly normalized_value: string;
    readonly independent_current: boolean;
  }[]> {
    if (logicalKeys.length === 0) return [];
    const keyPlaceholders = logicalKeys.map((_, index) => `$${index + 2}`).join(', ');
    return tx.query(
      `SELECT DISTINCT alias_row.id::text AS alias_id,
              alias_row.entity_id::text AS entity_id,
              source_record.source_record_key,
              entity.entity_type,
              alias_row.alias_type,
              alias_row.normalized_value,
              EXISTS (
                SELECT 1
                  FROM entity_alias_claims independent_claim
                  LEFT JOIN source_records independent_record
                    ON independent_record.id = independent_claim.source_record_id
                 WHERE independent_claim.entity_alias_id = alias_row.id
                   AND independent_claim.authority_epoch = alias_row.authority_epoch
                   AND independent_claim.asserted_normalized_value = alias_row.normalized_value
                   AND (
                     (independent_claim.claim_kind = 'CURATED' AND independent_claim.valid_to IS NULL)
                     OR
                     (independent_claim.claim_kind = 'SOURCE_RECORD'
                       AND independent_record.is_current
                       AND independent_record.revision_state = 'FINALIZED'
                       AND NOT (
                         independent_record.source_id = $1
                         AND independent_record.source_record_key IN (${keyPlaceholders})
                       ))
                   )
              ) AS independent_current
         FROM entity_alias_claims alias_claim
         JOIN source_records source_record ON source_record.id = alias_claim.source_record_id
         JOIN entity_aliases alias_row ON alias_row.id = alias_claim.entity_alias_id
         JOIN entities entity ON entity.id = alias_row.entity_id
        WHERE alias_claim.claim_kind = 'SOURCE_RECORD'
          AND alias_claim.authority_epoch = alias_row.authority_epoch
          AND alias_claim.asserted_normalized_value = alias_row.normalized_value
          AND alias_claim.valid_to IS NULL
          AND source_record.source_id = $1
          AND source_record.source_record_key IN (${keyPlaceholders})
          AND source_record.is_current
          AND source_record.revision_state = 'FINALIZED'
          AND alias_row.valid_to IS NULL
        ORDER BY source_record.source_record_key, alias_row.alias_type, alias_row.normalized_value`,
      [sourceId, ...logicalKeys],
    );
  }

  /**
   * Write every normalized value as a claim, with its evidence, in one
   * transaction per claim.
   *
   * Status is `PROPOSED`: this source is asserting something, not deciding the
   * canonical value. `promoteCanonicalView()` decides, once, after every source
   * has spoken.
   */
  async #writeClaims(resolved: readonly ResolvedRecordContext[], source: Source): Promise<number> {
    let written = 0;
    for (const context of resolved) {
      const factsByProperty = new Map<string, Awaited<ReturnType<CanonicalStore['appendFactWithEvidence']>>['fact']>();
      let candidates;
      try {
        candidates = orderCanonicalCandidatesByDerivation(context.normalization.candidates);
      } catch (error) {
        if (error instanceof DerivedCandidateGraphError) {
          throw new IngestError('DERIVED_GRAPH_INVALID', error.message, 'DATA', { cause: error });
        }
        throw error;
      }
      for (const candidate of candidates) {
        const evidence: FactEvidenceInput = {
          artifact_id: context.artifact.id,
          source_record_id: context.sourceRecord.id,
          source_value: candidate.source_value,
          locator_type: candidate.locator.type,
          locator_value: candidate.locator.value,
          // When we saw the bytes, taken from the immutable artifact — not from
          // the wall clock, so a re-run produces byte-identical evidence.
          observed_at: context.artifact.retrieved_at,
        };
        const draft = {
            entity_id: context.entity.id,
            property: candidate.property,
            normalized_value: candidate.normalized_value,
            value_type: candidate.value_type as FactValueType,
            unit: candidate.unit,
            valid_from: context.artifact.retrieved_at,
            confidence: factConfidence(
              claimConfidence(source.authority_rank, candidate.extraction_confidence),
            ),
            recorded_at: context.artifact.retrieved_at,
            status: 'PROPOSED',
          } as const;
        const result = candidate.output_kind === 'DERIVED_METRIC'
          ? await this.store.appendDerivedFactWithEvidence(
              draft,
              [evidence],
              [
                {
                  input_fact_id:
                    factsByProperty.get(candidate.derived_from_property ?? '')?.id ??
                    (() => {
                      throw new IngestError(
                        'DERIVED_INPUT_MISSING',
                        `derived property ${candidate.property} has no stored input ` +
                          `${candidate.derived_from_property ?? '(undeclared)'}`,
                        'DATA',
                      );
                    })(),
                  transformation_ref: candidate.transformation_ref ?? '',
                },
              ],
            )
          : await this.store.appendFactWithEvidence(draft, [evidence]);
        factsByProperty.set(candidate.property, result.fact);
        written += 1;
      }
    }
    return written;
  }

  async #planRelationship(
    context: PlannedRecordResolution,
    plan: RelationshipPlan,
    decision: RightsEvaluation | undefined,
    stagedAliases: readonly StagedAliasMatch[],
    maskedAliasIds: ReadonlySet<string>,
    source: Source,
    verticalId: VerticalId,
    tx: SqlTransactionExecutor,
    diagnostics: string[],
  ): Promise<PlannedRelationship> {
    const item = context.prepared.item;
    const raw = item.extracted.raw_payload;
    if (decision?.permitted !== true) {
      diagnostics.push(
        `${source.domain}/${item.extracted.source_record_key}: relationship ${plan.predicate} ` +
          `withheld by rights matrix (${decision?.reasonCode ?? 'NO_GRANT'})`,
      );
      return {
        plan,
        disposition: 'RIGHTS_WITHHELD',
        subject: null,
        object: null,
        subjectLookup: null,
        objectLookup: null,
        writer: null,
      };
    }

    const resolveEndpoint = async (
      endpoint: RelationshipPlan['subject'],
      side: 'subject' | 'object',
    ): Promise<{
      readonly id: EntityId | null;
      readonly lookup: string | null;
      readonly ambiguous: boolean;
    }> => {
      if (endpoint.kind === 'self') {
        return { id: context.entity?.id ?? null, lookup: null, ambiguous: false };
      }
      if (endpoint.kind === 'publisher') {
        if (context.manufacturer === null) {
          diagnostics.push(
            `${item.extracted.source_record_key}: ${plan.predicate} ${side} publisher unresolved; edge skipped`,
          );
          return { id: null, lookup: null, ambiguous: false };
        }
        return { id: context.manufacturer.id, lookup: null, ambiguous: false };
      }
      const value = stringOrNull(raw[endpoint.field]);
      if (value === null) return { id: null, lookup: null, ambiguous: false };
      const normalized = (await this.#ensureResolver()).normalizer.normalize(
        endpoint.aliasType,
        value,
      );
      const stored = await this.store.lookupByAlias({
        vertical_id: verticalId,
        values: [normalized],
        alias_type: endpoint.aliasType,
        entity_type: endpoint.entityType,
      }, tx);
      const candidates = new Map<EntityId, Entity>();
      for (const match of stored) {
        if (
          match.alias.normalized_value === normalized &&
          !maskedAliasIds.has(match.alias.id)
        ) {
          candidates.set(match.entity.id, match.entity);
        }
      }
      for (const staged of stagedAliases) {
        if (
          staged.entity.entity_type === endpoint.entityType &&
          staged.aliasType === endpoint.aliasType &&
          staged.normalizedValue === normalized
        ) {
          candidates.set(staged.entity.id, staged.entity);
        }
      }
      if (candidates.size > 1) {
        diagnostics.push(
          `${item.extracted.source_record_key}: ${plan.predicate} ${side} "${value}" is ambiguous ` +
            `across ${candidates.size} exact ${endpoint.entityType} identities; edge skipped`,
        );
        return { id: null, lookup: normalized, ambiguous: true };
      }
      const match = [...candidates.values()].sort((left, right) => {
        const byFirstSeen = Date.parse(left.first_seen_at) - Date.parse(right.first_seen_at);
        if (byFirstSeen !== 0) return byFirstSeen;
        const byCreated = Date.parse(left.created_at) - Date.parse(right.created_at);
        if (byCreated !== 0) return byCreated;
        return compareCodeUnits(left.canonical_slug, right.canonical_slug);
      })[0];
      if (match === undefined) {
        // Never fabricate the other end of an edge. An unresolvable reference
        // is reported and dropped.
        diagnostics.push(
          `${item.extracted.source_record_key}: ${plan.predicate} ${side} "${value}" ` +
            `resolves to no ${endpoint.entityType}; edge skipped`,
        );
        return { id: null, lookup: normalized, ambiguous: false };
      }
      return { id: match.id, lookup: normalized, ambiguous: false };
    };

    const evidence = relationshipEvidenceInput(item.extracted, plan);

    if (plan.skipWhenNull === 'subject' && plan.subject.kind === 'alias') {
      if (stringOrNull(raw[plan.subject.field]) === null) {
        return {
          plan,
          disposition: 'NULL_SKIPPED',
          subject: null,
          object: null,
          subjectLookup: null,
          objectLookup: null,
          writer: null,
        };
      }
    }
    if (plan.skipWhenNull === 'object' && plan.object.kind === 'alias') {
      if (stringOrNull(raw[plan.object.field]) === null) {
        return {
          plan,
          disposition: 'NULL_SKIPPED',
          subject: null,
          object: null,
          subjectLookup: null,
          objectLookup: null,
          writer: null,
        };
      }
    }

    const subject = await resolveEndpoint(plan.subject, 'subject');
    const object = await resolveEndpoint(plan.object, 'object');
    if (subject.id === null) {
      return {
        plan,
        disposition: subject.ambiguous ? 'AMBIGUOUS_SUBJECT' : 'UNRESOLVED_SUBJECT',
        subject: null,
        object: object.id,
        subjectLookup: subject.lookup,
        objectLookup: object.lookup,
        writer: null,
      };
    }
    if (object.id === null) {
      return {
        plan,
        disposition: object.ambiguous ? 'AMBIGUOUS_OBJECT' : 'UNRESOLVED_OBJECT',
        subject: subject.id,
        object: null,
        subjectLookup: subject.lookup,
        objectLookup: object.lookup,
        writer: null,
      };
    }
    if (subject.id === object.id) {
      return {
        plan,
        disposition: 'SELF_EDGE_SKIPPED',
        subject: subject.id,
        object: object.id,
        subjectLookup: subject.lookup,
        objectLookup: object.lookup,
        writer: null,
      };
    }

    const declaredValidFrom =
      plan.validFromField === null ? null : stringOrNull(raw[plan.validFromField]);
    const validFrom =
      declaredValidFrom === null
        ? item.artifact.retrieved_at
        : (new Date(
            /^\d{4}-\d{2}-\d{2}$/.test(declaredValidFrom)
              ? `${declaredValidFrom}T00:00:00Z`
              : declaredValidFrom,
          ).toISOString() as IsoDateTime);

    return {
      plan,
      disposition: 'PERSIST',
      subject: subject.id,
      object: object.id,
      subjectLookup: subject.lookup,
      objectLookup: object.lookup,
      writer: {
        draft: {
          vertical_id: verticalId,
          subject_entity_id: subject.id,
          predicate: plan.predicate,
          object_entity_id: object.id,
          confidence: relationshipConfidence(claimConfidence(source.authority_rank, undefined)),
          valid_from: validFrom,
          recorded_at: item.artifact.retrieved_at,
          status: 'ACTIVE',
        },
        evidence: {
          artifact_id: item.artifact.id,
          source_value: evidence.sourceValue,
          locator_type: evidence.locatorType,
          locator_value: evidence.locatorValue,
          observed_at: item.artifact.retrieved_at,
        },
      },
    };
  }

  /* ---------------- lazily-created singletons ---------------- */

  async #storedRights(source: Source): ReturnType<typeof loadStoredRightsContext> {
    const cached = this.#rightsContexts.get(source.id);
    if (cached !== undefined) return cached;
    const loaded = loadStoredRightsContext(this.store.driver, source.id, this.#options.now);
    this.#rightsContexts.set(source.id, loaded);
    return loaded;
  }

  async #internalRightsDecision(
    source: Source,
    entry: SourceRegistryEntry,
    sourceStatusRequirement: 'ACTIVE' | 'APPROVED_OR_ACTIVE',
    intent: InternalRightsIntent,
  ): Promise<RightsEvaluation> {
    const context = await this.#storedRights(source);
    if (context === null) {
      return {
        permitted: false,
        state: 'UNKNOWN',
        reasonCode: 'NO_GRANT',
        cellId: null,
        decisionId: null,
        blockingDecisionIds: [],
        exceptionIds: [],
        unmetConditions: [],
        obligations: [],
        termsVersionId: null,
        evaluatedAt: this.#options.now,
      };
    }
    const fieldGroupIds =
      intent.fieldKey === null
        ? []
        : [...(context.snapshot.fieldGroupMembers ?? new Map())]
            .filter(([, members]) => members.includes(intent.fieldKey as string))
            .map(([groupId]) => groupId);
    return evaluateRights(
      {
        source: context.source,
        sourceStatusRequirement,
        acquisitionRoute: entry.acquisition_policy.method,
        accountOrProductPlan: entry.acquisition_policy.account_or_product_plan,
        jurisdiction: entry.acquisition_policy.jurisdiction,
        assetClass: intent.assetClass,
        fieldKey: intent.fieldKey,
        fieldGroupIds,
        outputClass: intent.outputClass,
        operation: intent.operation,
        channel: 'INTERNAL_PROCESSING',
        asOf: this.#options.now,
        conditionReceipts: [],
      },
      context.snapshot,
    );
  }

  async #requireInternalRights(
    source: Source,
    entry: SourceRegistryEntry,
    sourceStatusRequirement: 'ACTIVE' | 'APPROVED_OR_ACTIVE',
    intents: readonly InternalRightsIntent[],
  ): Promise<void> {
    const refused: string[] = [];
    for (const intent of intents) {
      const decision = await this.#internalRightsDecision(
        source,
        entry,
        sourceStatusRequirement,
        intent,
      );
      if (!decision.permitted) {
        refused.push(
          `${intent.operation}/${intent.outputClass}/${intent.fieldKey ?? '*'}=${decision.reasonCode}`,
        );
      }
    }
    if (refused.length > 0) {
      throw new RightsViolationError(
        entry.rights_classification,
        `source "${entry.key}"`,
        `RIGHTS_MATRIX_REFUSED: ${refused.join(' | ')}`,
      );
    }
  }

  async #ensureVertical(): Promise<Vertical> {
    if (this.#vertical !== null) return this.#vertical;
    this.#vertical = await this.store.upsertVertical({
      slug: this.config.slug,
      name: this.config.name,
      schema_version: this.config.schemaVersion,
      status: this.config.status as Vertical['status'],
      default_refresh_policy: this.config.defaultRefreshPolicy as Vertical['default_refresh_policy'],
    });
    return this.#vertical;
  }

  async #ensureSource(entry: SourceRegistryEntry, verticalId: VerticalId): Promise<Source> {
    const cached = this.#sources.get(entry.key);
    if (cached !== undefined) return cached;
    const source = await this.store.upsertSource(toSourceInsert(entry, verticalId));
    this.#sources.set(entry.key, source);
    return source;
  }

  async #ensureResolver(): Promise<EntityResolver> {
    if (this.#resolver !== null) return this.#resolver;
    const vertical = await this.#ensureVertical();
    const authorityBySourceId = new Map<string, number>();
    for (const entry of this.config.sources) {
      const source = await this.#ensureSource(entry, vertical.id);
      authorityBySourceId.set(source.id, entry.authority_rank);
    }
    this.#resolver = new EntityResolver({
      store: this.store,
      config: this.config,
      verticalId: vertical.id,
      now: this.#options.now,
      authorityBySourceId,
    });
    return this.#resolver;
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

const stringOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

/**
 * A claim's confidence at ingestion time.
 *
 * Deliberately modest and mechanical: how well we read it (`extraction`) times
 * how much the publisher is worth listening to (`authority_rank`). It is *not*
 * the canonical value's confidence — that is decided by fact selection, which
 * sees every rival claim. Inventing a high number here would launder a
 * distributor's re-keyed spec into a confident fact.
 */
function claimConfidence(authorityRank: number, extraction: number | undefined): number {
  const authority = Math.min(1, Math.max(0, authorityRank / 100));
  const read = extraction ?? 1;
  return Math.round(Math.min(1, Math.max(0, authority * 0.5 + read * 0.5)) * 10_000) / 10_000;
}
