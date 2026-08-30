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
  type ValidatorCache,
} from '@data-foundry/acquisition';
import { explainFact, verifyFact } from '@data-foundry/provenance';
import {
  JOB_PIPELINE_ORDER,
  factConfidence,
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
  type SqlDriver,
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
  type IdentifierCandidate,
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
import { EntityResolver, type AliasClaim } from './resolution.js';

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

/** An extracted record, its persisted row and its normalization output. */
interface NormalizedRecord {
  readonly plan: StreamPlan;
  readonly extracted: ExtractedRecord;
  readonly artifact: SourceArtifact;
  readonly row: SourceRecord;
  readonly normalization: NormalizationResult;
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

/**
 * Returning normally from a transaction commits it. An unresolved record must
 * instead roll back any manufacturer/alias writes performed before identifier
 * validation, while remaining a non-error pipeline outcome.
 */
class UnresolvableRecordRollback extends Error {}

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
      });
      outcome = acquisition.outcome;
      diagnostics.push(...acquisition.diagnostics);

      const acquired: { artifact: SourceArtifact; body: Uint8Array }[] = [];
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
        const body =
          stored === undefined ? null : await this.#options.artifactStore.get(stored.key);
        if (body === null) {
          throw new IngestError(
            'ARTIFACT_BODY_MISSING',
            `artifact ${row.id} was recorded but its bytes are not in the evidence store`,
            'TRANSIENT',
          );
        }
        acquired.push({ artifact: row, body: new Uint8Array(body.body) });
        await this.jobs.setArtifact(job.id, row.id);
      }
      artifactCount = acquired.length;
      await advanceTo('FETCHED', `${acquired.length} artifact(s) stored`);

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

      const persisted: { plan: StreamPlan; extracted: ExtractedRecord; artifact: SourceArtifact; row: SourceRecord }[] =
        [];
      for (const item of extracted) {
        const row = await this.store.ensureSourceRecord({
          source_id: source.id,
          artifact_id: item.artifact.id,
          source_record_key: item.record.source_record_key,
          entity_type: item.plan.entityType,
          raw_payload: item.record.raw_payload,
          // Filled by the next stage. An extractor that pre-populated it would
          // have quietly crossed an architecture boundary.
          normalized_payload: null,
          extraction_confidence: item.record.extraction_confidence,
          extractor_version: item.record.extractor_version,
        });
        persisted.push({ plan: item.plan, extracted: item.record, artifact: item.artifact, row });
        await this.jobs.setSourceRecord(job.id, row.id);
      }
      await advanceTo('EXTRACTED', `${persisted.length} source record(s)`);

      // ---- NORMALIZED -----------------------------------------------------
      const normalized: NormalizedRecord[] = [];
      for (const item of persisted) {
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
              `${sourceKey}/${item.row.source_record_key}: field ${rule.property} withheld by ` +
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
              `${sourceKey}/${item.row.source_record_key}: identifier ${rule.alias_type} withheld by ` +
                `rights matrix (NORMALIZE=${normalize.reasonCode}, DERIVE=${derive.reasonCode})`,
            );
          }
        }
        const normalization = normalizeRecord(
          {
            source_record_key: item.row.source_record_key,
            entity_type: item.plan.entityType,
            values: item.extracted.values,
            extraction_confidence: item.extracted.extraction_confidence,
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
            `${sourceKey}/${item.row.source_record_key}: ${failure.reason} — ${failure.message}`,
          );
        }
        normalized.push({ ...item, normalization });
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
      const resolved: ResolvedRecordContext[] = [];
      for (const item of normalized) {
        const context = await this.#resolveRecord(resolver, source, item);
        if (context !== null) resolved.push(context);
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
        relationshipCount = await this.#writeRelationships(
          resolved,
          source,
          entry,
          vertical.id,
          diagnostics,
        );
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

  async #resolveRecord(
    resolver: EntityResolver,
    source: Source,
    item: NormalizedRecord,
  ): Promise<ResolvedRecordContext | null> {
    const raw = item.extracted.raw_payload;
    try {
      return await this.store.driver.transaction(async (tx) => {
        const sourceRecord = await this.store.reconcileSourceRecord(
          {
            source_id: source.id,
            artifact_id: item.artifact.id,
            source_record_key: item.row.source_record_key,
            entity_type: item.plan.entityType,
            raw_payload: item.extracted.raw_payload,
            normalized_payload: item.normalization.normalized_payload,
            extraction_confidence: item.extracted.extraction_confidence,
            extractor_version: item.extracted.extractor_version,
          },
          tx,
        );
        // The manufacturer is resolved first: it is the scope a model number is
        // unique within, and the slug pattern needs it.
        let manufacturer: Entity | null = null;
        for (const relationship of item.plan.relationships) {
          for (const endpoint of [relationship.subject, relationship.object]) {
            if (endpoint.kind !== 'publisher') continue;
            const value =
              endpoint.literal ??
              (endpoint.field === null ? null : stringOrNull(raw[endpoint.field]));
            if (value === null) continue;
            manufacturer = await resolver.resolveManufacturer(value, source.id, tx);
            break;
          }
          if (manufacturer !== null) break;
        }

        const validatedAliases: Array<{
          readonly claim: AliasClaim;
          readonly locator: IdentifierCandidate['locator'];
        }> = [];
        for (const identifier of item.normalization.identifiers) {
          const plan = item.plan.aliases.find((alias) => alias.aliasType === identifier.alias_type);
          const normalizedValue = resolver.normalizer.normalize(
            identifier.alias_type,
            identifier.alias_value,
          );
          const invalid = resolver.normalizer.validate(identifier.alias_type, normalizedValue);
          if (invalid !== null) {
            // Quarantine, never write. A garbage join key silently creates a
            // duplicate entity, which is far more expensive than a rejected value.
            this.#diagnostics.push(
              `${source.domain}/${item.row.source_record_key}: alias ${identifier.alias_type} quarantined — ${invalid}`,
            );
            continue;
          }
          validatedAliases.push({
            claim: {
              aliasType: identifier.alias_type,
              aliasValue: identifier.alias_value,
              normalizedValue,
              strong: plan?.strong ?? false,
            },
            locator: identifier.locator,
          });
        }

        const aliases = validatedAliases.map(({ claim }) => claim);

        if (aliases.every((alias) => !alias.strong)) {
          this.#diagnostics.push(
            `${source.domain}/${item.row.source_record_key}: no usable strong identifier; record not resolved`,
          );
          throw new UnresolvableRecordRollback();
        }

        const resolved = await resolver.resolveRecord(
          {
            entityType: item.plan.entityType,
            aliases,
            manufacturer,
            sourceId: source.id,
            sourceRecordId: sourceRecord.id,
          },
          tx,
        );

        await this.store.recordEntityEvidence(
          {
            entity_id: resolved.entity.id,
            artifact_id: item.artifact.id,
            source_record_id: sourceRecord.id,
            contribution_role: 'EXISTENCE',
            locator_type: item.extracted.locator.type,
            locator_value: item.extracted.locator.value,
            observed_at: item.artifact.retrieved_at,
          },
          tx,
        );
        for (const { locator } of validatedAliases) {
          await this.store.recordEntityEvidence(
            {
              entity_id: resolved.entity.id,
              artifact_id: item.artifact.id,
              source_record_id: sourceRecord.id,
              contribution_role: 'ALIAS',
              locator_type: locator.type,
              locator_value: locator.value,
              observed_at: item.artifact.retrieved_at,
            },
            tx,
          );
        }
        if (manufacturer !== null) {
          await this.store.recordEntityEvidence(
            {
              entity_id: manufacturer.id,
              artifact_id: item.artifact.id,
              source_record_id: sourceRecord.id,
              contribution_role: 'EXISTENCE',
              locator_type: item.extracted.locator.type,
              locator_value: item.extracted.locator.value,
              observed_at: item.artifact.retrieved_at,
            },
            tx,
          );

          for (const alias of aliases) {
            await resolver.recordScopedIdentifierPrefix(
              manufacturer,
              alias.aliasType,
              alias.aliasValue,
              source.id,
              tx,
            );
          }
        }

        return {
          plan: item.plan,
          extracted: item.extracted,
          sourceRecord,
          normalization: item.normalization,
          artifact: item.artifact,
          entity: resolved.entity,
          manufacturer,
        };
      });
    } catch (error) {
      if (error instanceof UnresolvableRecordRollback) return null;
      throw error;
    }
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

  async #writeRelationships(
    resolved: readonly ResolvedRecordContext[],
    source: Source,
    entry: SourceRegistryEntry,
    verticalId: VerticalId,
    diagnostics: string[],
  ): Promise<number> {
    let written = 0;
    for (const context of resolved) {
      for (const plan of context.plan.relationships) {
        const decision = await this.#internalRightsDecision(source, entry, 'ACTIVE', {
          operation: 'DERIVE',
          assetClass: 'DATA',
          outputClass: 'METADATA',
          fieldKey: plan.predicate,
        });
        if (!decision.permitted) {
          diagnostics.push(
            `${source.domain}/${context.sourceRecord.source_record_key}: relationship ` +
              `${plan.predicate} withheld by rights matrix (${decision.reasonCode})`,
          );
          continue;
        }
        const edge = await this.#buildEdge(context, plan, diagnostics);
        if (edge === null) continue;
        await this.store.upsertRelationshipWithEvidence(
          {
            vertical_id: verticalId,
            subject_entity_id: edge.subject,
            predicate: plan.predicate,
            object_entity_id: edge.object,
            confidence: relationshipConfidence(claimConfidence(source.authority_rank, undefined)),
            valid_from: edge.validFrom,
            recorded_at: context.artifact.retrieved_at,
            status: 'ACTIVE',
          },
          [
            {
              artifact_id: context.artifact.id,
              source_record_id: context.sourceRecord.id,
              source_value: edge.sourceValue,
              locator_type: edge.locatorType,
              locator_value: edge.locatorValue,
              observed_at: context.artifact.retrieved_at,
            },
          ],
        );
        written += 1;
      }
    }
    return written;
  }

  async #buildEdge(
    context: ResolvedRecordContext,
    plan: RelationshipPlan,
    diagnostics: string[],
  ): Promise<{
    readonly subject: EntityId;
    readonly object: EntityId;
    readonly validFrom: IsoDateTime;
    readonly sourceValue: string;
    readonly locatorType: FactEvidenceInput['locator_type'];
    readonly locatorValue: string;
  } | null> {
    const raw = context.extracted.raw_payload;

    const resolveEndpoint = async (
      endpoint: RelationshipPlan['subject'],
      side: 'subject' | 'object',
    ): Promise<EntityId | null> => {
      if (endpoint.kind === 'self') return context.entity.id;
      if (endpoint.kind === 'publisher') {
        if (context.manufacturer === null) {
          diagnostics.push(
            `${context.sourceRecord.source_record_key}: ${plan.predicate} ${side} publisher unresolved; edge skipped`,
          );
          return null;
        }
        return context.manufacturer.id;
      }
      const value = stringOrNull(raw[endpoint.field]);
      if (value === null) return null;
      const normalized = (await this.#ensureResolver()).normalizer.normalize(
        endpoint.aliasType,
        value,
      );
      const matches = await this.store.lookupByAlias({
        vertical_id: context.entity.vertical_id,
        values: [normalized],
        alias_type: endpoint.aliasType,
        entity_type: endpoint.entityType,
      });
      const match = matches.find((candidate) => candidate.alias.normalized_value === normalized);
      if (match === undefined) {
        // Never fabricate the other end of an edge. An unresolvable reference
        // is reported and dropped.
        diagnostics.push(
          `${context.sourceRecord.source_record_key}: ${plan.predicate} ${side} "${value}" ` +
            `resolves to no ${endpoint.entityType}; edge skipped`,
        );
        return null;
      }
      return match.entity.id;
    };

    // The evidence for an edge is the endpoint the source actually wrote down;
    // the other end is the record itself.
    const evidenceEndpoint = plan.subject.kind === 'self' ? plan.object : plan.subject;
    let sourceValue = '';
    let locatorType: FactEvidenceInput['locator_type'] = context.extracted.locator.type;
    let locatorValue = context.extracted.locator.value;
    if (evidenceEndpoint.kind === 'publisher' && evidenceEndpoint.literal !== null) {
      sourceValue = evidenceEndpoint.literal;
    } else if (evidenceEndpoint.kind !== 'self') {
      const field = evidenceEndpoint.field;
      const value =
        field === null ? null : context.extracted.values.find((item) => item.field === field);
      if (value?.raw != null) {
        sourceValue = value.raw;
        locatorType = value.locator.type;
        locatorValue = value.locator.value;
      }
    }

    if (plan.skipWhenNull === 'subject' && plan.subject.kind === 'alias') {
      if (stringOrNull(raw[plan.subject.field]) === null) return null;
    }
    if (plan.skipWhenNull === 'object' && plan.object.kind === 'alias') {
      if (stringOrNull(raw[plan.object.field]) === null) return null;
    }

    const subject = await resolveEndpoint(plan.subject, 'subject');
    const object = await resolveEndpoint(plan.object, 'object');
    if (subject === null || object === null || subject === object) return null;

    const declaredValidFrom =
      plan.validFromField === null ? null : stringOrNull(raw[plan.validFromField]);
    const validFrom =
      declaredValidFrom === null
        ? context.artifact.retrieved_at
        : (new Date(
            /^\d{4}-\d{2}-\d{2}$/.test(declaredValidFrom)
              ? `${declaredValidFrom}T00:00:00Z`
              : declaredValidFrom,
          ).toISOString() as IsoDateTime);

    return {
      subject,
      object,
      validFrom,
      sourceValue: sourceValue === '' ? context.sourceRecord.source_record_key : sourceValue,
      locatorType,
      locatorValue,
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
