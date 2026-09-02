/**
 * The canonical store — the only component permitted to write entities, facts,
 * relationships and evidence.
 *
 * Two invariants are enforced here rather than documented here:
 *
 * **AGENTS.md rule 2 — no published fact without evidence.** There is no public
 * method on `CanonicalStore` that writes a bare fact or a bare relationship.
 * `appendFactWithEvidence` and `upsertRelationshipWithEvidence` take their
 * evidence as a required, statically non-empty argument
 * (`readonly [T, ...T[]]`), write the claim and its evidence in one
 * transaction, and re-assert the invariant against the database before
 * committing. If any evidence row fails — a bad artifact id, a violated
 * constraint — the whole transaction rolls back and no fact exists.
 *
 * **ADR-0001 / doc 04 — facts are append-only.** A changed value is a new row;
 * the previous version is closed by setting `valid_to`. `normalized_value` is
 * never rewritten. The close patch is run through
 * `assertNonDestructiveFactUpdate` from the schema package, so the guard is
 * exercised on the real write path rather than only in a unit test.
 *
 * A consequence worth stating: re-running ingestion with unchanged values is a
 * no-op. It creates no new fact version, and re-asserting the same evidence
 * collides with `fact_evidence_unique_locator` and is discarded. That is the
 * idempotency the Phase 1 exit criterion depends on.
 */
import {
  appendFactVersion,
  assertNonDestructiveFactUpdate,
  canonicalValuesEqual,
  retractFactVersion,
  type DatasetSnapshot,
  type DatasetSnapshotInsert,
  type FactVerification,
  type FactVerificationInsert,
  type Entity,
  type EntityAlias,
  type EntityAliasClaim,
  type EntityAliasId,
  type EntityAliasInsert,
  type EntityId,
  type EntityInsert,
  type EntityRedirect,
  type EntityRedirectInsert,
  type EntityRedirectReason,
  type Fact,
  type FactConfidence,
  type FactEvidence,
  type FactId,
  type FactOutputKind,
  type FactStatus,
  type FactVersionDraft,
  type Identifier,
  type IsoDateTime,
  type LocatorType,
  type Relationship,
  type RelationshipConfidence,
  type RelationshipEvidence,
  type RelationshipId,
  type RelationshipStatus,
  type ResolutionJudgmentId,
  type Slug,
  type Source,
  type SourceArtifact,
  type SourceArtifactInsert,
  type SourceId,
  type SourceInsert,
  type SourceRecord,
  type SourceRecordInsert,
  type Vertical,
  type VerticalId,
  type VerticalInsert,
  compareCodeUnits,
} from '@data-foundry/canonical-schema';
import { FactDependencyError, MissingEvidenceError, NotFoundError } from './errors.js';
import {
  selectCanonicalFact,
  type CandidateEvidence,
  type FactCandidate,
  type FactSelection,
  type FactSelectionPolicyInput,
} from './fact-selection.js';
import {
  ALIAS_COLUMNS,
  ALIAS_CLAIM_COLUMNS,
  ARTIFACT_COLUMNS,
  ENTITY_COLUMNS,
  FACT_COLUMNS,
  FACT_EVIDENCE_COLUMNS,
  REDIRECT_COLUMNS,
  RELATIONSHIP_COLUMNS,
  RELATIONSHIP_EVIDENCE_COLUMNS,
  SNAPSHOT_COLUMNS,
  SOURCE_COLUMNS,
  SOURCE_RECORD_COLUMNS,
  mapDatasetSnapshot,
  mapFactVerification,
  FACT_VERIFICATION_COLUMNS,
  mapEntity,
  mapEntityAlias,
  mapEntityAliasClaim,
  mapEntityRedirect,
  mapFact,
  mapFactEvidence,
  mapRelationship,
  mapRelationshipEvidence,
  mapSource,
  mapSourceArtifact,
  mapSourceRecord,
  mapVertical,
  toNumber,
} from './rows.js';
import {
  placeholders,
  type SqlDriver,
  type SqlExecutor,
  type SqlParam,
  type SqlRow,
  type SqlTransactionExecutor,
} from './sql-driver.js';

/** Compile-time proof that an evidence set is not empty. */
export type NonEmptyArray<T> = readonly [T, ...T[]];

/** Evidence for a fact, minus the `fact_id` the store assigns. */
export interface FactEvidenceInput {
  readonly artifact_id: SourceArtifact['id'];
  readonly source_record_id: SourceRecord['id'];
  readonly source_value: string;
  readonly locator_type: FactEvidence['locator_type'];
  readonly locator_value: string;
  readonly observed_at: IsoDateTime;
}

/** One immutable input edge for a derived output. */
export interface FactDependencyInput {
  readonly input_fact_id: FactId;
  readonly transformation_ref: string;
}

/** Evidence for a relationship, minus the `relationship_id`. */
export interface RelationshipEvidenceInput {
  readonly artifact_id: SourceArtifact['id'];
  readonly source_record_id: SourceRecord['id'];
  readonly source_value: string;
  readonly locator_type: RelationshipEvidence['locator_type'];
  readonly locator_value: string;
  readonly observed_at: IsoDateTime;
}

/** Exact provenance shared by every canonical entity/identity contribution. */
interface EntityEvidenceBaseInput {
  readonly entity_id: EntityId;
  readonly artifact_id: SourceArtifact['id'];
  readonly source_record_id: SourceRecord['id'];
  readonly locator_type: FactEvidence['locator_type'];
  readonly locator_value: string;
  readonly observed_at: IsoDateTime;
}

/**
 * Source-derived aliases bind their exact append-only claim to evidence. Other
 * entity roles must not borrow an alias claim as provenance.
 */
export type EntityEvidenceInput = EntityEvidenceBaseInput & (
  | {
      readonly contribution_role: 'ALIAS';
      readonly entity_alias_claim_id: EntityAliasClaim['id'];
    }
  | {
      readonly contribution_role: 'EXISTENCE' | 'CANONICAL_NAME' | 'CANONICAL_SLUG' | 'IDENTITY';
      readonly entity_alias_claim_id?: null;
    }
);

export interface RelationshipClaimInput {
  readonly vertical_id: VerticalId;
  readonly subject_entity_id: EntityId;
  readonly predicate: Identifier;
  readonly object_entity_id: EntityId;
  readonly confidence: RelationshipConfidence;
  readonly valid_from: IsoDateTime;
  readonly recorded_at: IsoDateTime;
  readonly status: Extract<RelationshipStatus, 'PROPOSED' | 'ACTIVE'>;
}

export type FactWriteOutcome =
  /** A new version row was appended (and any prior ACTIVE version closed). */
  | 'CREATED'
  /** The value already stood. No new version. Evidence may have been added. */
  | 'UNCHANGED'
  /** An existing PROPOSED claim with this value was promoted to ACTIVE. */
  | 'PROMOTED';

export interface FactWriteResult {
  readonly outcome: FactWriteOutcome;
  readonly fact: Fact;
  /** Every evidence row now backing this fact. */
  readonly evidence: readonly FactEvidence[];
  /** The subset written by this call; empty on a fully idempotent re-run. */
  readonly added_evidence: readonly FactEvidence[];
  readonly superseded_fact_id: FactId | null;
}

export type RelationshipWriteOutcome = 'CREATED' | 'UNCHANGED' | 'PROMOTED';

export interface RelationshipWriteResult {
  readonly outcome: RelationshipWriteOutcome;
  readonly relationship: Relationship;
  readonly evidence: readonly RelationshipEvidence[];
  readonly added_evidence: readonly RelationshipEvidence[];
}

export interface AliasLookupQuery {
  readonly vertical_id: VerticalId;
  readonly values: readonly string[];
  readonly alias_type?: Identifier;
  readonly entity_type?: Identifier;
  /** Include aliases whose validity has been closed. Default false. */
  readonly include_expired?: boolean;
}

export interface AliasMatch {
  readonly entity: Entity;
  readonly alias: EntityAlias;
}

/** A source-described alias row. Staging neither activates nor reopens a retired alias. */
export interface SourceAliasInsert extends Omit<EntityAliasInsert, 'source_id'> {
  readonly source_id: SourceId;
}

/** Exact source-record provenance that activates one staged alias. */
export interface SourceAliasClaimInput {
  readonly entity_alias_id: EntityAliasId;
  readonly asserted_alias_value: string;
  readonly asserted_normalized_value: string;
  readonly identity_confidence: EntityAlias['identity_confidence'];
  readonly source_record_id: SourceRecord['id'];
  readonly locator_type: LocatorType;
  readonly locator_value: string;
}

export interface ListFactsOptions {
  readonly property?: Identifier;
  /** Point in time for the validity window. Default: now. */
  readonly at?: IsoDateTime;
  /** Include closed/superseded/retracted versions. Default false. */
  readonly include_history?: boolean;
}

export interface RedirectResolution {
  readonly entity_id: EntityId;
  readonly redirected: boolean;
  readonly hops: readonly EntityRedirect[];
}

export interface MergeEntitiesInput {
  readonly from_entity_id: EntityId;
  readonly to_entity_id: EntityId;
  readonly reason: EntityRedirectReason;
  readonly from_slug: Slug | null;
  readonly judgment_id: ResolutionJudgmentId | null;
}

/**
 * The write and read surface of canonical storage.
 *
 * Note what is absent: there is no `insertFact`, no `updateFact`, no
 * `insertRelationship`. Evidence is not an optional second call.
 */
export interface CanonicalStore {
  readonly driver: SqlDriver;

  upsertVertical(input: VerticalInsert): Promise<Vertical>;
  /** Insert bundled identity/config only when absent; never overwrite stored lifecycle state. */
  registerVertical(input: VerticalInsert): Promise<Vertical>;
  getVerticalBySlug(slug: Slug): Promise<Vertical | null>;
  upsertSource(input: SourceInsert): Promise<Source>;
  /**
   * Insert bundled source metadata when absent. On conflict, preserve every
   * database-owned field and apply only the monotone kill-switch join.
   */
  registerSource(input: SourceInsert): Promise<Source>;
  getSourceById(id: SourceId): Promise<Source | null>;

  recordSourceArtifact(input: SourceArtifactInsert): Promise<SourceArtifact>;
  /** Insert a finalized source-record revision. Existing current revisions are never updated. */
  recordSourceRecord(input: SourceRecordInsert): Promise<SourceRecord>;
  /** Create a record if absent, but leave its current payload/evidence untouched until reconciliation. */
  ensureSourceRecord(input: SourceRecordInsert): Promise<SourceRecord>;
  /** Replace or finalize one source record through the caller's pinned transaction. */
  reconcileSourceRecord(
    input: SourceRecordInsert,
    transaction: SqlTransactionExecutor,
    evidenceFingerprint: string,
    reconciledAt: IsoDateTime,
  ): Promise<SourceRecord>;

  /** Identity writes may join a caller-owned transaction through its pinned executor. */
  upsertEntity(input: EntityInsert, executor?: SqlExecutor): Promise<Entity>;
  /** Entity identity is publishable only when its exact source contribution is recorded. */
  recordEntityEvidence(input: EntityEvidenceInput, executor?: SqlExecutor): Promise<void>;
  getEntityById(id: EntityId, executor?: SqlExecutor): Promise<Entity | null>;
  getEntityBySlug(
    verticalId: VerticalId,
    entityType: Identifier,
    slug: Slug,
  ): Promise<Entity | null>;

  /** Explicit curated assertion and the only API that may globally retire or reopen an alias. */
  addAlias(input: EntityAliasInsert, executor?: SqlExecutor): Promise<EntityAlias>;
  /** Upsert the shared alias row without granting it current resolution authority. */
  stageSourceAlias(input: SourceAliasInsert, executor?: SqlExecutor): Promise<EntityAlias>;
  /** Append exact source-record authority for a staged alias. */
  recordSourceAliasClaim(
    input: SourceAliasClaimInput,
    executor?: SqlExecutor,
  ): Promise<EntityAliasClaim>;
  listAliases(entityId: EntityId, executor?: SqlExecutor): Promise<EntityAlias[]>;
  lookupByAlias(query: AliasLookupQuery, executor?: SqlExecutor): Promise<AliasMatch[]>;

  /** The only way to record a fact. Evidence is required and written atomically. */
  appendFactWithEvidence(
    draft: FactVersionDraft,
    evidence: NonEmptyArray<FactEvidenceInput>,
  ): Promise<FactWriteResult>;
  /** Derived outputs commit their evidence and complete, non-empty lineage atomically. */
  appendDerivedFactWithEvidence(
    draft: FactVersionDraft,
    evidence: NonEmptyArray<FactEvidenceInput>,
    dependencies: NonEmptyArray<FactDependencyInput>,
  ): Promise<FactWriteResult>;
  listFacts(entityId: EntityId, options?: ListFactsOptions): Promise<Fact[]>;
  getFactById(id: FactId): Promise<Fact | null>;
  listFactEvidence(factId: FactId): Promise<FactEvidence[]>;
  retractFact(
    id: FactId,
    at: IsoDateTime,
    status?: Extract<FactStatus, 'RETRACTED' | 'SUPERSEDED'>,
  ): Promise<Fact>;

  /** The only way to record a relationship. Evidence is required. */
  upsertRelationshipWithEvidence(
    draft: RelationshipClaimInput,
    evidence: NonEmptyArray<RelationshipEvidenceInput>,
    executor?: SqlTransactionExecutor,
  ): Promise<RelationshipWriteResult>;
  listRelationships(
    entityId: EntityId,
    options?: { readonly predicate?: Identifier; readonly direction?: 'out' | 'in' | 'both' },
  ): Promise<Relationship[]>;
  listRelationshipEvidence(id: RelationshipId): Promise<RelationshipEvidence[]>;

  recordEntityRedirect(input: EntityRedirectInsert): Promise<EntityRedirect>;
  mergeEntities(input: MergeEntitiesInput): Promise<EntityRedirect>;
  resolveRedirect(entityId: EntityId): Promise<RedirectResolution>;
  findRedirectBySlug(verticalId: VerticalId, slug: Slug): Promise<EntityRedirect | null>;

  /**
   * Append a verification verdict. Re-evaluating an unchanged claim under an
   * unchanged policy returns the stored verdict rather than duplicating it.
   */
  recordFactVerification(input: FactVerificationInsert): Promise<FactVerification>;
  /** Verdict history for one property, newest first. Never collapsed. */
  listFactVerifications(
    entityId: EntityId,
    property: Identifier,
  ): Promise<FactVerification[]>;

  recordDatasetSnapshot(input: DatasetSnapshotInsert): Promise<DatasetSnapshot>;
  getDatasetSnapshot(verticalId: VerticalId, version: string): Promise<DatasetSnapshot | null>;

  /** Every claim about one property, with its evidence chain, for selection. */
  loadFactCandidates(
    entityId: EntityId,
    property: Identifier,
    at?: IsoDateTime,
  ): Promise<FactCandidate[]>;
  /** One exact stored fact version with immutable full-history evidence for recursive lineage. */
  loadFactCandidateById(id: FactId): Promise<FactCandidate | null>;
  /** One exact stored fact version with only evidence authoritative at the requested instant. */
  loadFactCandidateByIdAtAuthority(
    id: FactId,
    at: IsoDateTime,
  ): Promise<FactCandidate | null>;
  /** Doc 04 fact selection for one property, with the rule that fired. */
  selectFact(
    entityId: EntityId,
    property: Identifier,
    policy?: Partial<FactSelectionPolicyInput>,
  ): Promise<FactSelection>;
  /** Doc 04 fact selection for every property of an entity. */
  canonicalView(
    entityId: EntityId,
    policy?: Partial<FactSelectionPolicyInput>,
  ): Promise<Map<Identifier, FactSelection>>;
}

const nowIso = (): IsoDateTime => new Date().toISOString() as IsoDateTime;
const json = (value: unknown): string => JSON.stringify(value ?? null);
const DIRECT_RECORD_EVIDENCE_FINGERPRINT = 'd'.repeat(64);
const PROVISIONAL_EVIDENCE_FINGERPRINT = 'f'.repeat(64);

export function createCanonicalStore(driver: SqlDriver): CanonicalStore {
  return new PostgresCanonicalStore(driver);
}

class PostgresCanonicalStore implements CanonicalStore {
  readonly driver: SqlDriver;

  constructor(driver: SqlDriver) {
    this.driver = driver;
  }

  /* ---------------- verticals & sources ---------------- */

  async upsertVertical(input: VerticalInsert): Promise<Vertical> {
    const rows = await this.driver.query(
      `INSERT INTO verticals (slug, name, schema_version, status, default_refresh_policy)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             schema_version = EXCLUDED.schema_version,
             status = EXCLUDED.status,
             default_refresh_policy = EXCLUDED.default_refresh_policy,
             updated_at = now()
       RETURNING id, slug, name, schema_version, status, default_refresh_policy, created_at, updated_at`,
      [
        input.slug,
        input.name,
        input.schema_version,
        input.status,
        json(input.default_refresh_policy),
      ],
    );
    return mapVertical(requireRow(rows, 'verticals'));
  }

  async getVerticalBySlug(slug: Slug): Promise<Vertical | null> {
    const rows = await this.driver.query(
      `SELECT id, slug, name, schema_version, status, default_refresh_policy, created_at, updated_at
         FROM verticals WHERE slug = $1`,
      [slug],
    );
    const row = rows[0];
    return row === undefined ? null : mapVertical(row);
  }

  async registerVertical(input: VerticalInsert): Promise<Vertical> {
    const inserted = await this.driver.query(
      `INSERT INTO verticals (slug, name, schema_version, status, default_refresh_policy)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug, name, schema_version, status, default_refresh_policy, created_at, updated_at`,
      [
        input.slug,
        input.name,
        input.schema_version,
        input.status,
        json(input.default_refresh_policy),
      ],
    );
    const row = inserted[0];
    if (row !== undefined) return mapVertical(row);
    const stored = await this.getVerticalBySlug(input.slug);
    if (stored === null) throw new Error('vertical registration conflict did not resolve');
    return stored;
  }

  async upsertSource(input: SourceInsert): Promise<Source> {
    const rows = await this.driver.query(
      `INSERT INTO sources (vertical_id, publisher, domain, source_type, authority_rank,
                            rights_classification, attribution_requirement, robots_policy,
                            refresh_cadence, status, kill_switch_engaged)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
       ON CONFLICT (vertical_id, domain, source_type) DO UPDATE
         SET publisher = EXCLUDED.publisher,
             authority_rank = EXCLUDED.authority_rank,
             rights_classification = EXCLUDED.rights_classification,
             attribution_requirement = EXCLUDED.attribution_requirement,
             robots_policy = EXCLUDED.robots_policy,
             refresh_cadence = EXCLUDED.refresh_cadence,
             status = EXCLUDED.status,
             -- Registry synchronization may engage an operational stop but it
             -- must never clear one. Only an explicit operator/database action
             -- may move TRUE back to FALSE.
             kill_switch_engaged = COALESCE(sources.kill_switch_engaged, FALSE)
                                   OR EXCLUDED.kill_switch_engaged,
             updated_at = now()
       RETURNING ${SOURCE_COLUMNS}`,
      [
        input.vertical_id,
        input.publisher,
        input.domain,
        input.source_type,
        input.authority_rank,
        input.rights_classification,
        json(input.attribution_requirement),
        json(input.robots_policy),
        input.refresh_cadence,
        input.status,
        input.kill_switch_engaged,
      ],
    );
    return mapSource(requireRow(rows, 'sources'));
  }

  async registerSource(input: SourceInsert): Promise<Source> {
    const rows = await this.driver.query(
      `INSERT INTO sources (vertical_id, publisher, domain, source_type, authority_rank,
                            rights_classification, attribution_requirement, robots_policy,
                            refresh_cadence, status, kill_switch_engaged)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
       ON CONFLICT (vertical_id, domain, source_type) DO UPDATE
         SET -- The registry may engage an operational stop, and migration-0016
             -- NULL is synchronized explicitly. It may never clear stored TRUE.
             kill_switch_engaged = COALESCE(sources.kill_switch_engaged, FALSE)
                                   OR EXCLUDED.kill_switch_engaged
       RETURNING ${SOURCE_COLUMNS}`,
      [
        input.vertical_id,
        input.publisher,
        input.domain,
        input.source_type,
        input.authority_rank,
        input.rights_classification,
        json(input.attribution_requirement),
        json(input.robots_policy),
        input.refresh_cadence,
        input.status,
        input.kill_switch_engaged,
      ],
    );
    return mapSource(requireRow(rows, 'sources'));
  }

  async getSourceById(id: SourceId): Promise<Source | null> {
    const rows = await this.driver.query(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = $1`, [id]);
    const row = rows[0];
    return row === undefined ? null : mapSource(row);
  }

  /* ---------------- raw evidence ---------------- */

  async recordSourceArtifact(input: SourceArtifactInsert): Promise<SourceArtifact> {
    // Artifacts are immutable (rule 10): identical bytes from the same URL and
    // acquisition scope are the same artifact, without requiring UPDATE.
    const parameters = [
      input.source_id,
      input.url,
      input.retrieved_at,
      input.content_hash,
      input.mime_type,
      input.r2_uri,
      input.http_status,
      input.extractor_version,
      input.policy_snapshot_id,
      input.byte_size,
      input.acquisition_provider,
      input.acquisition_route,
      input.account_or_product_plan,
      input.acquisition_jurisdiction,
    ] as const;
    const inserted = await this.driver.query(
      `INSERT INTO source_artifacts (source_id, url, retrieved_at, content_hash, mime_type, r2_uri,
                                     http_status, extractor_version, policy_snapshot_id, byte_size,
                                     acquisition_provider, acquisition_route,
                                     account_or_product_plan, acquisition_jurisdiction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (source_id, url, content_hash, acquisition_route,
                    account_or_product_plan, acquisition_jurisdiction)
       DO NOTHING
       RETURNING ${ARTIFACT_COLUMNS}`,
      parameters,
    );
    const insertedRow = inserted[0];
    if (insertedRow !== undefined) return mapSourceArtifact(insertedRow);
    const conflictIdentity = [
      input.source_id,
      input.url,
      input.content_hash,
      input.acquisition_route,
      input.account_or_product_plan,
      input.acquisition_jurisdiction,
    ] as const;
    const existing = await this.driver.query(
      `SELECT ${ARTIFACT_COLUMNS}
         FROM source_artifacts
        WHERE source_id = $1 AND url = $2 AND content_hash = $3
          AND acquisition_route = $4
          AND account_or_product_plan IS NOT DISTINCT FROM $5
          AND acquisition_jurisdiction IS NOT DISTINCT FROM $6`,
      conflictIdentity,
    );
    return mapSourceArtifact(requireRow(existing, 'source_artifacts'));
  }

  async recordSourceRecord(input: SourceRecordInsert): Promise<SourceRecord> {
    return this.#insertSourceRecord(input, this.driver, 'FINALIZED', DIRECT_RECORD_EVIDENCE_FINGERPRINT);
  }

  async #insertSourceRecord(
    input: SourceRecordInsert,
    executor: SqlExecutor,
    revisionState: 'PROVISIONAL' | 'FINALIZED',
    evidenceFingerprint: string,
  ): Promise<SourceRecord> {
    const rows = await executor.query(
      `INSERT INTO source_records (source_id, artifact_id, source_record_key, source_stream, entity_type,
                                   raw_payload, normalized_payload, extraction_confidence,
                                   extractor_version, evidence_fingerprint, revision_state)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11)
       RETURNING ${SOURCE_RECORD_COLUMNS}`,
      [
        input.source_id,
        input.artifact_id,
        input.source_record_key,
        input.source_stream,
        input.entity_type,
        json(input.raw_payload),
        input.normalized_payload === null ? null : json(input.normalized_payload),
        input.extraction_confidence,
        input.extractor_version,
        evidenceFingerprint,
        revisionState,
      ],
    );
    return mapSourceRecord(requireRow(rows, 'source_records'));
  }

  async ensureSourceRecord(input: SourceRecordInsert): Promise<SourceRecord> {
    const inserted = await this.driver.query(
      `INSERT INTO source_records (source_id, artifact_id, source_record_key, source_stream, entity_type,
                                   raw_payload, normalized_payload, extraction_confidence,
                                   extractor_version, evidence_fingerprint, revision_state)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, 'PROVISIONAL')
       ON CONFLICT (source_id, source_record_key) WHERE is_current DO NOTHING
       RETURNING ${SOURCE_RECORD_COLUMNS}`,
      [
        input.source_id,
        input.artifact_id,
        input.source_record_key,
        input.source_stream,
        input.entity_type,
        json(input.raw_payload),
        input.normalized_payload === null ? null : json(input.normalized_payload),
        input.extraction_confidence,
        input.extractor_version,
        PROVISIONAL_EVIDENCE_FINGERPRINT,
      ],
    );
    if (inserted[0] !== undefined) return mapSourceRecord(inserted[0]);
    const existing = await this.driver.query(
      `SELECT ${SOURCE_RECORD_COLUMNS} FROM source_records
        WHERE source_id = $1 AND source_record_key = $2 AND is_current`,
      [input.source_id, input.source_record_key],
    );
    return mapSourceRecord(requireRow(existing, 'source_records'));
  }

  async reconcileSourceRecord(
    input: SourceRecordInsert,
    transaction: SqlTransactionExecutor,
    evidenceFingerprint: string,
    reconciledAt: IsoDateTime,
  ): Promise<SourceRecord> {
    if (!/^[0-9a-f]{64}$/.test(evidenceFingerprint)) {
      throw new Error('evidenceFingerprint must be a lowercase SHA-256 digest.');
    }
    // Serialize the logical key for this whole caller-owned transaction. The
    // first statement is deliberately the lock: a waiter must not inspect a
    // pre-replacement current row and later conflict-update its successor.
    await transaction.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [input.source_id, input.source_record_key],
    );
    type CurrentRevisionRow = SqlRow & {
      readonly id: string;
      readonly revision_state: 'PROVISIONAL' | 'FINALIZED';
      readonly artifact_matches: boolean;
      readonly source_stream_matches: boolean;
      readonly entity_type_matches: boolean;
      readonly raw_payload_matches: boolean;
      readonly normalized_payload_matches: boolean;
      readonly extraction_confidence_matches: boolean;
      readonly extractor_version_matches: boolean;
      readonly evidence_fingerprint_matches: boolean;
    };
    const current = await transaction.query<CurrentRevisionRow>(
      `SELECT ${SOURCE_RECORD_COLUMNS},
              artifact_id = $3 AS artifact_matches,
              source_stream = $4 AS source_stream_matches,
              entity_type = $5 AS entity_type_matches,
              raw_payload = $6::jsonb AS raw_payload_matches,
              normalized_payload IS NOT DISTINCT FROM $7::jsonb AS normalized_payload_matches,
              extraction_confidence = $8 AS extraction_confidence_matches,
              extractor_version = $9 AS extractor_version_matches,
              evidence_fingerprint = $10 AS evidence_fingerprint_matches
         FROM source_records
        WHERE source_id = $1 AND source_record_key = $2 AND is_current
        FOR UPDATE`,
      [
        input.source_id,
        input.source_record_key,
        input.artifact_id,
        input.source_stream,
        input.entity_type,
        json(input.raw_payload),
        input.normalized_payload === null ? null : json(input.normalized_payload),
        input.extraction_confidence,
        input.extractor_version,
        evidenceFingerprint,
      ],
    );
    const existing = current[0];
    if (existing === undefined) {
      return this.#insertSourceRecord(input, transaction, 'FINALIZED', evidenceFingerprint);
    }
    const extractionMatches =
      existing.artifact_matches &&
      existing.source_stream_matches &&
      existing.entity_type_matches &&
      existing.raw_payload_matches &&
      existing.extraction_confidence_matches &&
      existing.extractor_version_matches;
    if (extractionMatches && existing.normalized_payload_matches && existing.evidence_fingerprint_matches) {
      // A repeat with identical extraction and normalization is a true no-op,
      // including updated_at. Replaying evidence stays harmlessly idempotent.
      return mapSourceRecord(existing);
    }
    if (existing.revision_state === 'PROVISIONAL' && extractionMatches) {
      // EXTRACTED creates the one explicitly provisional row. Its matching
      // NORMALIZED completion may fill the payload in place before any evidence
      // is legal; all other changes create a fresh immutable revision.
      const finalized = await transaction.query(
        `UPDATE source_records
            SET normalized_payload = $2::jsonb, evidence_fingerprint = $3,
                revision_state = 'FINALIZED', updated_at = now()
          WHERE id = $1 AND revision_state = 'PROVISIONAL'
          RETURNING ${SOURCE_RECORD_COLUMNS}`,
        [
          existing.id,
          input.normalized_payload === null ? null : json(input.normalized_payload),
          evidenceFingerprint,
        ],
      );
      return mapSourceRecord(requireRow(finalized, 'source_records'));
    }

    // Evidence-bearing revisions are immutable. Retire the current revision,
    // insert its successor, and record the one-way reconciliation edge inside
    // the same pinned transaction.
    await transaction.query(
        `UPDATE source_records SET is_current = FALSE, updated_at = now()
          WHERE id = $1 AND is_current`,
      [existing.id],
    );
    const replacement = await this.#insertSourceRecord(input, transaction, 'FINALIZED', evidenceFingerprint);
    await transaction.query(
      `INSERT INTO source_record_reconciliations
         (superseded_source_record_id, replacement_source_record_id, reconciled_at)
       VALUES ($1, $2, $3)`,
      [existing.id, replacement.id, reconciledAt],
    );
    return replacement;
  }

  /* ---------------- entities & aliases ---------------- */

  async recordEntityEvidence(input: EntityEvidenceInput, executor?: SqlExecutor): Promise<void> {
    await (executor ?? this.driver).query(
      `INSERT INTO entity_evidence
         (entity_id, artifact_id, source_record_id, entity_alias_claim_id,
          contribution_role, locator_type, locator_value, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        input.entity_id,
        input.artifact_id,
        input.source_record_id,
        input.entity_alias_claim_id ?? null,
        input.contribution_role,
        input.locator_type,
        input.locator_value,
        input.observed_at,
      ],
    );
  }

  async upsertEntity(input: EntityInsert, executor?: SqlExecutor): Promise<Entity> {
    const rows = await (executor ?? this.driver).query(
      `INSERT INTO entities (vertical_id, entity_type, canonical_name, canonical_slug, status,
                             quality_score, first_seen_at, last_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (vertical_id, entity_type, canonical_slug) DO UPDATE
         SET canonical_name = EXCLUDED.canonical_name,
             status = EXCLUDED.status,
             quality_score = EXCLUDED.quality_score,
             first_seen_at = LEAST(entities.first_seen_at, EXCLUDED.first_seen_at),
             last_verified_at = GREATEST(entities.last_verified_at, EXCLUDED.last_verified_at),
             updated_at = now()
       RETURNING ${ENTITY_COLUMNS}`,
      [
        input.vertical_id,
        input.entity_type,
        input.canonical_name,
        input.canonical_slug,
        input.status,
        input.quality_score,
        input.first_seen_at,
        input.last_verified_at,
      ],
    );
    return mapEntity(requireRow(rows, 'entities'));
  }

  async getEntityById(id: EntityId, executor?: SqlExecutor): Promise<Entity | null> {
    const rows = await (executor ?? this.driver).query(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapEntity(row);
  }

  async getEntityBySlug(
    verticalId: VerticalId,
    entityType: Identifier,
    slug: Slug,
  ): Promise<Entity | null> {
    const rows = await this.driver.query(
      `SELECT ${ENTITY_COLUMNS} FROM entities
        WHERE vertical_id = $1 AND entity_type = $2 AND canonical_slug = $3`,
      [verticalId, entityType, slug],
    );
    const row = rows[0];
    return row === undefined ? null : mapEntity(row);
  }

  async addAlias(input: EntityAliasInsert, executor?: SqlExecutor): Promise<EntityAlias> {
    const rows = await (executor ?? this.driver).query(
      `WITH alias_write AS (
         INSERT INTO entity_aliases (
           entity_id, alias_type, alias_value, normalized_value, source_id,
           identity_confidence, valid_from, valid_to
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (entity_id, alias_type, normalized_value) DO UPDATE
           SET alias_value = EXCLUDED.alias_value,
               identity_confidence = GREATEST(entity_aliases.identity_confidence,
                                              EXCLUDED.identity_confidence),
               valid_to = EXCLUDED.valid_to,
               authority_epoch = CASE
                 WHEN entity_aliases.valid_to IS DISTINCT FROM EXCLUDED.valid_to
                   THEN entity_aliases.authority_epoch + 1
                 ELSE entity_aliases.authority_epoch
               END
           WHERE entity_aliases.valid_to IS NULL
              OR EXCLUDED.valid_to IS NOT NULL
              OR entity_aliases.valid_from IS NOT DISTINCT FROM EXCLUDED.valid_from
         RETURNING ${ALIAS_COLUMNS}, authority_epoch
       ), claim_write AS (
         INSERT INTO entity_alias_claims (
           entity_alias_id, asserted_alias_value, asserted_normalized_value,
           identity_confidence, claim_kind, source_id, source_record_id, authority_epoch,
           locator_type, locator_value, valid_to
         )
         SELECT alias_write.id, $3, $4, $6, 'CURATED', $5, NULL,
                alias_write.authority_epoch, NULL, NULL, $8
           FROM alias_write
         ON CONFLICT DO NOTHING
         RETURNING entity_alias_id
       )
       SELECT ${ALIAS_COLUMNS} FROM alias_write`,
      [
        input.entity_id,
        input.alias_type,
        input.alias_value,
        input.normalized_value,
        input.source_id,
        input.identity_confidence,
        input.valid_from,
        input.valid_to,
      ],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(
        'cannot reopen an alias with a different validity start; the stored row cannot represent a second interval',
      );
    }
    return mapEntityAlias(row);
  }

  async stageSourceAlias(
    input: SourceAliasInsert,
    executor?: SqlExecutor,
  ): Promise<EntityAlias> {
    return this.#upsertAlias(input, executor ?? this.driver, false);
  }

  async recordSourceAliasClaim(
    input: SourceAliasClaimInput,
    executor?: SqlExecutor,
  ): Promise<EntityAliasClaim> {
    const writeExecutor = executor ?? this.driver;
    const params: readonly SqlParam[] = [
      input.entity_alias_id,
      input.source_record_id,
      input.locator_type,
      input.locator_value,
      input.asserted_alias_value,
      input.asserted_normalized_value,
      input.identity_confidence,
    ];
    const select =
      `SELECT ${ALIAS_CLAIM_COLUMNS}
         FROM entity_alias_claims
        WHERE claim_kind = 'SOURCE_RECORD'
          AND entity_alias_id = $1
          AND authority_epoch = (
              SELECT authority_epoch FROM entity_aliases WHERE id = $1
          )
          AND source_record_id = $2
          AND locator_type = $3
          AND locator_value = $4
          AND asserted_alias_value = $5
          AND asserted_normalized_value = $6
          AND identity_confidence = $7`;
    const existing = await writeExecutor.query(select, params);
    if (existing[0] !== undefined) return mapEntityAliasClaim(existing[0]);

    const inserted = await writeExecutor.query(
      `INSERT INTO entity_alias_claims (
         entity_alias_id, claim_kind, source_id, source_record_id, authority_epoch,
         locator_type, locator_value, asserted_alias_value, asserted_normalized_value,
         identity_confidence, valid_to
       )
       SELECT alias_row.id, 'SOURCE_RECORD', source_record.source_id, source_record.id,
              alias_row.authority_epoch, $3, $4, $5, $6, $7, NULL
         FROM source_records source_record
         JOIN entity_aliases alias_row ON alias_row.id = $1
        WHERE source_record.id = $2
       ON CONFLICT DO NOTHING
       RETURNING ${ALIAS_CLAIM_COLUMNS}`,
      params,
    );
    if (inserted[0] !== undefined) return mapEntityAliasClaim(inserted[0]);
    return mapEntityAliasClaim(requireRow(await writeExecutor.query(select, params), 'entity_alias_claims'));
  }

  async #upsertAlias(
    input: EntityAliasInsert,
    executor: SqlExecutor,
    allowValidityChange: boolean,
  ): Promise<EntityAlias> {
    const validityAssignment = allowValidityChange
      ? 'EXCLUDED.valid_to'
      : 'entity_aliases.valid_to';
    const rows = await executor.query(
      `INSERT INTO entity_aliases (entity_id, alias_type, alias_value, normalized_value, source_id,
                                   identity_confidence, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (entity_id, alias_type, normalized_value) DO UPDATE
         SET alias_value = EXCLUDED.alias_value,
             identity_confidence = GREATEST(entity_aliases.identity_confidence,
                                            EXCLUDED.identity_confidence),
             valid_to = ${validityAssignment}
       RETURNING ${ALIAS_COLUMNS}`,
      [
        input.entity_id,
        input.alias_type,
        input.alias_value,
        input.normalized_value,
        input.source_id,
        input.identity_confidence,
        input.valid_from,
        input.valid_to,
      ],
    );
    return mapEntityAlias(requireRow(rows, 'entity_aliases'));
  }

  async listAliases(entityId: EntityId, executor?: SqlExecutor): Promise<EntityAlias[]> {
    const rows = await (executor ?? this.driver).query(
      // `COLLATE "C"` because this order is a decision, not a display: the
      // first alias of the primary type is what rebuilds the entity's
      // canonical name. Left to the database's collation, the published name
      // would differ between a `C`-collated PGlite and an `en_US`-collated
      // hosted Postgres (#14).
      `SELECT ${ALIAS_COLUMNS} FROM current_entity_aliases WHERE entity_id = $1
        ORDER BY alias_type COLLATE "C", normalized_value COLLATE "C"`,
      [entityId],
    );
    return rows.map(mapEntityAlias);
  }

  async lookupByAlias(query: AliasLookupQuery, executor?: SqlExecutor): Promise<AliasMatch[]> {
    if (query.values.length === 0) return [];
    const params: SqlParam[] = [query.vertical_id, ...query.values];
    const valueList = placeholders(query.values.length, 1);
    const aliasRelation = query.include_expired === true ? 'entity_aliases' : 'current_entity_aliases';
    let sql =
      `SELECT ${prefix('e', ENTITY_COLUMNS, 'e_')}, ${prefix('a', ALIAS_COLUMNS, 'a_')}
         FROM ${aliasRelation} a
         JOIN entities e ON e.id = a.entity_id
        WHERE e.vertical_id = $1
          AND (a.normalized_value IN (${valueList}) OR a.alias_value IN (${valueList}))`;
    if (query.alias_type !== undefined) {
      params.push(query.alias_type);
      sql += ` AND a.alias_type = $${params.length}`;
    }
    if (query.entity_type !== undefined) {
      params.push(query.entity_type);
      sql += ` AND e.entity_type = $${params.length}`;
    }
    sql += ' ORDER BY a.identity_confidence DESC, e.canonical_slug';
    const rows = await (executor ?? this.driver).query(sql, params);
    return rows.map((row) => ({
      entity: mapEntity(unprefix(row, 'e_')),
      alias: mapEntityAlias(unprefix(row, 'a_')),
    }));
  }

  /* ---------------- facts ---------------- */

  async appendFactWithEvidence(
    draft: FactVersionDraft,
    evidence: NonEmptyArray<FactEvidenceInput>,
  ): Promise<FactWriteResult> {
    return this.#appendClassifiedFactWithEvidence(draft, evidence, 'NORMALIZED_FACT', []);
  }

  async appendDerivedFactWithEvidence(
    draft: FactVersionDraft,
    evidence: NonEmptyArray<FactEvidenceInput>,
    dependencies: NonEmptyArray<FactDependencyInput>,
  ): Promise<FactWriteResult> {
    if (dependencies.length === 0) {
      throw new FactDependencyError('A derived fact requires at least one input dependency.');
    }
    if (dependencies.some((item) => item.transformation_ref.trim() === '')) {
      throw new FactDependencyError('Every derived fact dependency requires a transformation reference.');
    }
    const unique = new Set(dependencies.map((item) => item.input_fact_id));
    if (unique.size !== dependencies.length) {
      throw new FactDependencyError('A derived fact dependency set cannot contain duplicate edges.');
    }
    return this.#appendClassifiedFactWithEvidence(draft, evidence, 'DERIVED_METRIC', dependencies);
  }

  async #appendClassifiedFactWithEvidence(
    draft: FactVersionDraft,
    evidence: NonEmptyArray<FactEvidenceInput>,
    outputKind: FactOutputKind,
    dependencies: readonly FactDependencyInput[],
  ): Promise<FactWriteResult> {
    // Runtime backstop for the type-level guarantee. A JavaScript caller, or a
    // dynamically-built array, must not be able to slip past rule 2.
    if (evidence.length === 0) {
      throw new MissingEvidenceError(`fact "${draft.property}" on entity ${draft.entity_id}`);
    }

    return this.driver.transaction(async (tx) => {
      const openRows = await tx.query(
        `SELECT ${FACT_COLUMNS} FROM facts
          WHERE entity_id = $1 AND property = $2 AND valid_to IS NULL AND status <> 'RETRACTED'
          ORDER BY recorded_at DESC, id
            FOR UPDATE`,
        [draft.entity_id, draft.property],
      );
      const open = openRows.map(mapFact);

      const sameValue = open.filter(
        (fact) =>
          fact.output_kind === outputKind &&
          fact.value_type === draft.value_type &&
          fact.unit === draft.unit &&
          canonicalValuesEqual(fact.normalized_value, draft.normalized_value),
      );
      let identical: Fact | undefined;
      if (outputKind === 'DERIVED_METRIC') {
        const expected = normalizeDependencies(dependencies);
        for (const candidate of sameValue) {
          const stored = await loadDependencies(tx, candidate.id);
          if (dependenciesEqual(stored, expected)) {
            identical = candidate;
            break;
          }
        }
      } else {
        identical = sameValue[0];
      }

      let outcome: FactWriteOutcome;
      let fact: Fact;
      let supersededFactId: FactId | null = null;

      if (identical !== undefined) {
        if (draft.status === 'ACTIVE' && identical.status !== 'ACTIVE') {
          // Promote a standing proposal. `status` and `confidence` are the only
          // mutable columns; the recorded value is untouched.
          const rival = open.find((row) => row.status === 'ACTIVE' && row.id !== identical.id);
          if (rival !== undefined) {
            await closeVersion(tx, rival.id, draft.valid_from);
            supersededFactId = rival.id;
          }
          const promoted = await tx.query(
            `UPDATE facts SET status = 'ACTIVE', confidence = $2 WHERE id = $1
             RETURNING ${FACT_COLUMNS}`,
            [identical.id, draft.confidence],
          );
          fact = mapFact(requireRow(promoted, 'facts'));
          outcome = 'PROMOTED';
        } else {
          fact = identical;
          outcome = 'UNCHANGED';
        }
      } else {
        // A rival PROPOSED claim is never closed by a new claim — doc 04:
        // "Do not overwrite conflicting facts prematurely." Only the standing
        // ACTIVE version is superseded, and only by another ACTIVE version.
        const previous =
          draft.status === 'ACTIVE' ? (open.find((row) => row.status === 'ACTIVE') ?? null) : null;
        const { close, insert } = appendFactVersion(previous, draft, outputKind);

        if (close !== null) {
          await closeVersion(tx, close.id, close.valid_to);
          supersededFactId = close.id;
        }

        const inserted = await tx.query(
          `INSERT INTO facts (entity_id, property, normalized_value, value_type, output_kind, unit, valid_from,
                              valid_to, status, confidence, supersedes_fact_id, recorded_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING ${FACT_COLUMNS}`,
          [
            insert.entity_id,
            insert.property,
            json(insert.normalized_value),
            insert.value_type,
            outputKind === 'DERIVED_METRIC' ? null : insert.output_kind,
            insert.unit,
            insert.valid_from,
            insert.valid_to,
            insert.status,
            insert.confidence,
            insert.supersedes_fact_id,
            insert.recorded_at,
          ],
        );
        fact = mapFact(requireRow(inserted, 'facts'));
        outcome = 'CREATED';
      }

      if (outputKind === 'DERIVED_METRIC') {
        if (outcome === 'CREATED') {
          for (const dependency of dependencies) {
            await tx.query(
              `INSERT INTO fact_dependencies (derived_fact_id, input_fact_id, transformation_ref)
               VALUES ($1, $2, $3)`,
              [fact.id, dependency.input_fact_id, dependency.transformation_ref],
            );
          }
          const classified = await tx.query(
            `UPDATE facts SET output_kind = 'DERIVED_METRIC' WHERE id = $1
             RETURNING ${FACT_COLUMNS}`,
            [fact.id],
          );
          fact = mapFact(requireRow(classified, 'facts'));
        } else {
          const stored = await loadDependencies(tx, fact.id);
          const expected = normalizeDependencies(dependencies);
          if (!dependenciesEqual(stored, expected)) {
            throw new FactDependencyError(
              `Derived fact ${fact.id} already has a different immutable dependency set.`,
            );
          }
        }
      }

      const added: FactEvidence[] = [];
      for (const item of evidence) {
        const rows = await tx.query(
          `INSERT INTO fact_evidence (fact_id, artifact_id, source_record_id, source_value,
                                      locator_type, locator_value, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (fact_id, source_record_id, locator_type, locator_value) DO NOTHING
           RETURNING ${FACT_EVIDENCE_COLUMNS}`,
          [
            fact.id,
            item.artifact_id,
            item.source_record_id,
            item.source_value,
            item.locator_type,
            item.locator_value,
            item.observed_at,
          ],
        );
        const row = rows[0];
        if (row !== undefined) added.push(mapFactEvidence(row));
      }

      // Rule 2, re-asserted against the database inside the transaction. If a
      // future refactor ever lets a fact reach this point unevidenced, the
      // transaction aborts rather than committing an unsupported claim.
      const all = await tx.query(
        `SELECT ${FACT_EVIDENCE_COLUMNS} FROM fact_evidence WHERE fact_id = $1
          ORDER BY observed_at, id`,
        [fact.id],
      );
      if (all.length === 0) {
        throw new MissingEvidenceError(`fact ${fact.id} ("${fact.property}")`);
      }

      return {
        outcome,
        fact,
        evidence: all.map(mapFactEvidence),
        added_evidence: added,
        superseded_fact_id: supersededFactId,
      };
    });
  }

  async listFacts(entityId: EntityId, options: ListFactsOptions = {}): Promise<Fact[]> {
    const at = options.at ?? nowIso();
    const params: SqlParam[] = [entityId];
    let sql = `SELECT ${FACT_COLUMNS} FROM facts WHERE entity_id = $1`;
    if (options.property !== undefined) {
      params.push(options.property);
      sql += ` AND property = $${params.length}`;
    }
    if (options.include_history !== true) {
      params.push(at);
      const index = params.length;
      sql +=
        ` AND status <> 'RETRACTED'` +
        ` AND valid_from <= $${index} AND (valid_to IS NULL OR valid_to > $${index})`;
    }
    sql += ' ORDER BY property, valid_from, id';
    const rows = await this.driver.query(sql, params);
    return rows.map(mapFact);
  }

  async getFactById(id: FactId): Promise<Fact | null> {
    const rows = await this.driver.query(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = $1`, [id]);
    const row = rows[0];
    return row === undefined ? null : mapFact(row);
  }

  async listFactEvidence(factId: FactId): Promise<FactEvidence[]> {
    const rows = await this.driver.query(
      `SELECT ${FACT_EVIDENCE_COLUMNS} FROM fact_evidence WHERE fact_id = $1
        ORDER BY observed_at, id`,
      [factId],
    );
    return rows.map(mapFactEvidence);
  }

  async retractFact(
    id: FactId,
    at: IsoDateTime,
    status: Extract<FactStatus, 'RETRACTED' | 'SUPERSEDED'> = 'RETRACTED',
  ): Promise<Fact> {
    const existing = await this.getFactById(id);
    if (existing === null) throw new NotFoundError('facts', id);
    // Validates that the retraction cannot predate the claim. The row is kept;
    // withdrawal is a validity change, never a delete.
    const patch = retractFactVersion(existing, at);
    assertNonDestructiveFactUpdate({ valid_to: patch.valid_to, status });
    const rows = await this.driver.query(
      `UPDATE facts SET valid_to = $2, status = $3 WHERE id = $1 RETURNING ${FACT_COLUMNS}`,
      [id, patch.valid_to, status],
    );
    return mapFact(requireRow(rows, 'facts'));
  }

  /* ---------------- relationships ---------------- */

  async upsertRelationshipWithEvidence(
    draft: RelationshipClaimInput,
    evidence: NonEmptyArray<RelationshipEvidenceInput>,
    executor?: SqlTransactionExecutor,
  ): Promise<RelationshipWriteResult> {
    if (evidence.length === 0) {
      throw new MissingEvidenceError(
        `relationship ${draft.subject_entity_id} -${draft.predicate}-> ${draft.object_entity_id}`,
      );
    }

    const write = async (tx: SqlExecutor): Promise<RelationshipWriteResult> => {
      const openRows = await tx.query(
        `SELECT ${RELATIONSHIP_COLUMNS} FROM relationships
          WHERE subject_entity_id = $1 AND predicate = $2 AND object_entity_id = $3
            AND valid_to IS NULL AND status <> 'RETRACTED'
          ORDER BY recorded_at DESC, id
            FOR UPDATE`,
        [draft.subject_entity_id, draft.predicate, draft.object_entity_id],
      );
      const open = openRows.map(mapRelationship);
      const existing = open[0];

      let relationship: Relationship;
      let outcome: RelationshipWriteOutcome;

      if (existing !== undefined) {
        if (draft.status === 'ACTIVE' && existing.status !== 'ACTIVE') {
          const promoted = await tx.query(
            `UPDATE relationships SET status = 'ACTIVE', confidence = $2 WHERE id = $1
             RETURNING ${RELATIONSHIP_COLUMNS}`,
            [existing.id, draft.confidence],
          );
          relationship = mapRelationship(requireRow(promoted, 'relationships'));
          outcome = 'PROMOTED';
        } else {
          relationship = existing;
          outcome = 'UNCHANGED';
        }
      } else {
        const inserted = await tx.query(
          `INSERT INTO relationships (vertical_id, subject_entity_id, predicate, object_entity_id,
                                      confidence, valid_from, valid_to, status,
                                      supersedes_relationship_id, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, NULL, $8)
           RETURNING ${RELATIONSHIP_COLUMNS}`,
          [
            draft.vertical_id,
            draft.subject_entity_id,
            draft.predicate,
            draft.object_entity_id,
            draft.confidence,
            draft.valid_from,
            draft.status,
            draft.recorded_at,
          ],
        );
        relationship = mapRelationship(requireRow(inserted, 'relationships'));
        outcome = 'CREATED';
      }

      const added: RelationshipEvidence[] = [];
      for (const item of evidence) {
        const rows = await tx.query(
          `INSERT INTO relationship_evidence (relationship_id, artifact_id, source_record_id,
                                              source_value, locator_type, locator_value, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (relationship_id, source_record_id, locator_type, locator_value) DO NOTHING
           RETURNING ${RELATIONSHIP_EVIDENCE_COLUMNS}`,
          [
            relationship.id,
            item.artifact_id,
            item.source_record_id,
            item.source_value,
            item.locator_type,
            item.locator_value,
            item.observed_at,
          ],
        );
        const row = rows[0];
        if (row !== undefined) added.push(mapRelationshipEvidence(row));
      }

      const all = await tx.query(
        `SELECT ${RELATIONSHIP_EVIDENCE_COLUMNS} FROM relationship_evidence
          WHERE relationship_id = $1 ORDER BY observed_at, id`,
        [relationship.id],
      );
      if (all.length === 0) {
        throw new MissingEvidenceError(`relationship ${relationship.id}`);
      }

      return {
        outcome,
        relationship,
        evidence: all.map(mapRelationshipEvidence),
        added_evidence: added,
      };
    };
    return executor === undefined ? this.driver.transaction(write) : write(executor);
  }

  async listRelationships(
    entityId: EntityId,
    options: { readonly predicate?: Identifier; readonly direction?: 'out' | 'in' | 'both' } = {},
  ): Promise<Relationship[]> {
    const direction = options.direction ?? 'both';
    const params: SqlParam[] = [entityId];
    const clause =
      direction === 'out'
        ? 'subject_entity_id = $1'
        : direction === 'in'
          ? 'object_entity_id = $1'
          : '(subject_entity_id = $1 OR object_entity_id = $1)';
    let sql = `SELECT ${RELATIONSHIP_COLUMNS} FROM relationships WHERE ${clause}
                 AND status <> 'RETRACTED' AND valid_to IS NULL
                 AND (
                   NOT EXISTS (
                     SELECT 1
                       FROM relationship_evidence any_evidence
                      WHERE any_evidence.relationship_id = relationships.id
                   )
                   OR EXISTS (
                     SELECT 1
                       FROM relationship_evidence current_evidence
                       JOIN source_records current_record
                         ON current_record.id = current_evidence.source_record_id
                      WHERE current_evidence.relationship_id = relationships.id
                        AND current_record.is_current
                        AND current_record.revision_state = 'FINALIZED'
                   )
                 )`;
    if (options.predicate !== undefined) {
      params.push(options.predicate);
      sql += ` AND predicate = $${params.length}`;
    }
    sql += ' ORDER BY predicate, recorded_at DESC, id';
    const rows = await this.driver.query(sql, params);
    return rows.map(mapRelationship);
  }

  async listRelationshipEvidence(id: RelationshipId): Promise<RelationshipEvidence[]> {
    const rows = await this.driver.query(
      `SELECT ${RELATIONSHIP_EVIDENCE_COLUMNS} FROM relationship_evidence
        WHERE relationship_id = $1 ORDER BY observed_at, id`,
      [id],
    );
    return rows.map(mapRelationshipEvidence);
  }

  /* ---------------- redirects ---------------- */

  async recordEntityRedirect(input: EntityRedirectInsert): Promise<EntityRedirect> {
    const rows = await this.driver.query(
      `INSERT INTO entity_redirects (vertical_id, from_entity_id, to_entity_id, from_slug, reason,
                                     judgment_id, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (from_entity_id) WHERE active DO UPDATE
         SET to_entity_id = EXCLUDED.to_entity_id,
             from_slug = EXCLUDED.from_slug,
             reason = EXCLUDED.reason,
             judgment_id = EXCLUDED.judgment_id
       RETURNING ${REDIRECT_COLUMNS}`,
      [
        input.vertical_id,
        input.from_entity_id,
        input.to_entity_id,
        input.from_slug,
        input.reason,
        input.judgment_id,
        input.active,
      ],
    );
    return mapEntityRedirect(requireRow(rows, 'entity_redirects'));
  }

  async mergeEntities(input: MergeEntitiesInput): Promise<EntityRedirect> {
    return this.driver.transaction(async (tx) => {
      const fromRows = await tx.query(
        `SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = $1 FOR UPDATE`,
        [input.from_entity_id],
      );
      const from = mapEntity(requireRow(fromRows, 'entities'));
      const toRows = await tx.query(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = $1`, [
        input.to_entity_id,
      ]);
      const to = mapEntity(requireRow(toRows, 'entities'));

      // A merge retires an identity; it never deletes it, so the merge stays
      // reversible and old URLs keep resolving (AGENTS.md rule 3).
      await tx.query(
        `UPDATE entities SET status = $2, updated_at = now() WHERE id = $1`,
        [from.id, input.reason === 'SPLIT' ? 'SPLIT' : 'MERGED'],
      );

      const rows = await tx.query(
        `INSERT INTO entity_redirects (vertical_id, from_entity_id, to_entity_id, from_slug, reason,
                                       judgment_id, active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (from_entity_id) WHERE active DO UPDATE
           SET to_entity_id = EXCLUDED.to_entity_id,
               from_slug = EXCLUDED.from_slug,
               reason = EXCLUDED.reason,
               judgment_id = EXCLUDED.judgment_id
         RETURNING ${REDIRECT_COLUMNS}`,
        [
          to.vertical_id,
          from.id,
          to.id,
          input.from_slug ?? from.canonical_slug,
          input.reason,
          input.judgment_id,
        ],
      );
      return mapEntityRedirect(requireRow(rows, 'entity_redirects'));
    });
  }

  async resolveRedirect(entityId: EntityId): Promise<RedirectResolution> {
    const hops: EntityRedirect[] = [];
    const seen = new Set<string>([entityId]);
    let cursor: EntityId = entityId;

    for (;;) {
      const rows = await this.driver.query(
        `SELECT ${REDIRECT_COLUMNS} FROM entity_redirects WHERE from_entity_id = $1 AND active`,
        [cursor],
      );
      const row = rows[0];
      if (row === undefined) break;
      const redirect = mapEntityRedirect(row);
      if (seen.has(redirect.to_entity_id)) break; // cycle guard
      hops.push(redirect);
      seen.add(redirect.to_entity_id);
      cursor = redirect.to_entity_id;
    }

    return { entity_id: cursor, redirected: hops.length > 0, hops };
  }

  async findRedirectBySlug(verticalId: VerticalId, slug: Slug): Promise<EntityRedirect | null> {
    const rows = await this.driver.query(
      `SELECT ${REDIRECT_COLUMNS} FROM entity_redirects
        WHERE vertical_id = $1 AND from_slug = $2 AND active
        ORDER BY created_at DESC LIMIT 1`,
      [verticalId, slug],
    );
    const row = rows[0];
    return row === undefined ? null : mapEntityRedirect(row);
  }

  /* ---------------- snapshots ---------------- */

  /**
   * Append a verification verdict (`fact_verifications`).
   *
   * `ON CONFLICT DO NOTHING` on `(fact_id, policy_version, verdict_fingerprint)`
   * is what keeps a refresh cycle from turning the history into noise: the same
   * claim re-evaluated under the same policy with the same evidence is the same
   * verdict, and the stored one — with its original `evaluated_at` — is
   * returned unchanged. A different outcome, different evidence or a bumped
   * policy version is a different key and is appended as the new event it is.
   */
  async recordFactVerification(input: FactVerificationInsert): Promise<FactVerification> {
    const rows = await this.driver.query(
      `INSERT INTO fact_verifications
         (entity_id, property, fact_id, selected_value, unit, verified, reason, blockers,
          signals, evidence_refs, selection_rule, policy_version, evaluated_at,
          verdict_fingerprint)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::text[], $9::jsonb, $10::jsonb, $11, $12,
               $13, $14)
       ON CONFLICT (fact_id, policy_version, verdict_fingerprint) DO NOTHING
       RETURNING ${FACT_VERIFICATION_COLUMNS}`,
      [
        input.entity_id,
        input.property,
        input.fact_id,
        json(input.selected_value),
        input.unit,
        input.verified,
        input.reason,
        `{${input.blockers.join(',')}}`,
        json(input.signals),
        json(input.evidence_refs),
        input.selection_rule,
        input.policy_version,
        input.evaluated_at,
        input.verdict_fingerprint,
      ],
    );
    const inserted = rows[0];
    if (inserted !== undefined) return mapFactVerification(inserted);

    const existing = await this.driver.query(
      `SELECT ${FACT_VERIFICATION_COLUMNS} FROM fact_verifications
        WHERE fact_id = $1 AND policy_version = $2 AND verdict_fingerprint = $3`,
      [input.fact_id, input.policy_version, input.verdict_fingerprint],
    );
    return mapFactVerification(requireRow(existing, 'fact_verifications'));
  }

  async listFactVerifications(
    entityId: EntityId,
    property: Identifier,
  ): Promise<FactVerification[]> {
    const rows = await this.driver.query(
      `SELECT ${FACT_VERIFICATION_COLUMNS} FROM fact_verifications
        WHERE entity_id = $1 AND property = $2
        ORDER BY evaluated_at DESC, created_at DESC`,
      [entityId, property],
    );
    return rows.map(mapFactVerification);
  }

  async recordDatasetSnapshot(input: DatasetSnapshotInsert): Promise<DatasetSnapshot> {
    const rows = await this.driver.query(
      `INSERT INTO dataset_snapshots (vertical_id, version, generated_at, record_counts,
                                      schema_version, manifest_uri, checksums, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8)
       ON CONFLICT (vertical_id, version) DO UPDATE
         SET generated_at = EXCLUDED.generated_at,
             record_counts = EXCLUDED.record_counts,
             schema_version = EXCLUDED.schema_version,
             manifest_uri = EXCLUDED.manifest_uri,
             checksums = EXCLUDED.checksums,
             status = EXCLUDED.status
       RETURNING ${SNAPSHOT_COLUMNS}`,
      [
        input.vertical_id,
        input.version,
        input.generated_at,
        json(input.record_counts),
        input.schema_version,
        input.manifest_uri,
        json(input.checksums),
        input.status,
      ],
    );
    return mapDatasetSnapshot(requireRow(rows, 'dataset_snapshots'));
  }

  async getDatasetSnapshot(verticalId: VerticalId, version: string): Promise<DatasetSnapshot | null> {
    const rows = await this.driver.query(
      `SELECT ${SNAPSHOT_COLUMNS} FROM dataset_snapshots WHERE vertical_id = $1 AND version = $2`,
      [verticalId, version],
    );
    const row = rows[0];
    return row === undefined ? null : mapDatasetSnapshot(row);
  }

  /* ---------------- canonical selection ---------------- */

  async loadFactCandidates(
    entityId: EntityId,
    property: Identifier,
    at: IsoDateTime = nowIso(),
  ): Promise<FactCandidate[]> {
    const factRows = await this.driver.query(
      `SELECT ${FACT_COLUMNS} FROM facts
        WHERE entity_id = $1 AND property = $2
          AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)
          AND recorded_at <= $3
          AND (
            (output_kind = 'NORMALIZED_FACT' AND NOT EXISTS (
              SELECT 1 FROM fact_dependencies fd WHERE fd.derived_fact_id = facts.id
            ))
            OR
            (output_kind = 'DERIVED_METRIC' AND EXISTS (
              SELECT 1 FROM fact_dependencies fd WHERE fd.derived_fact_id = facts.id
            ))
          )
        ORDER BY recorded_at DESC, id`,
      [entityId, property, at],
    );
    const facts = factRows.map(mapFact);
    if (facts.length === 0) return [];

    const evidenceByFact = await this.loadEvidenceChains(facts.map((fact) => fact.id), at);
    return facts.map((fact) => ({
      fact,
      evidence: evidenceByFact.get(fact.id) ?? [],
    }));
  }

  async loadFactCandidateById(id: FactId): Promise<FactCandidate | null> {
    const fact = await this.getFactById(id);
    if (fact === null) return null;
    const evidenceByFact = await this.loadEvidenceChains([fact.id]);
    return { fact, evidence: evidenceByFact.get(fact.id) ?? [] };
  }

  async loadFactCandidateByIdAtAuthority(
    id: FactId,
    at: IsoDateTime,
  ): Promise<FactCandidate | null> {
    const fact = await this.getFactById(id);
    if (fact === null) return null;
    const evidenceByFact = await this.loadEvidenceChains([fact.id], at);
    return { fact, evidence: evidenceByFact.get(fact.id) ?? [] };
  }

  /** Evidence + source_record + artifact + source, for a set of facts. */
  private async loadEvidenceChains(
    factIds: readonly FactId[],
    at?: IsoDateTime,
  ): Promise<Map<FactId, CandidateEvidence[]>> {
    const byFact = new Map<FactId, CandidateEvidence[]>();
    if (factIds.length === 0) return byFact;

    const params: SqlParam[] = [...factIds];
    let authorityAt = '';
    if (at !== undefined) {
      params.push(at);
      const atParameter = `$${params.length}`;
      authorityAt = `
          AND fe.observed_at <= ${atParameter}
          AND sr.revision_state = 'FINALIZED'
          AND (
            sr.is_current OR
            EXISTS (
              SELECT 1
                FROM source_record_reconciliations reconciliation
               WHERE reconciliation.superseded_source_record_id = sr.id
                 AND reconciliation.reconciled_at > ${atParameter}
            ) OR
            EXISTS (
              SELECT 1
                FROM source_record_snapshot_retirements retirement
               WHERE retirement.source_record_id = sr.id
                 AND retirement.retired_at > ${atParameter}
            )
          )`;
    }

    const rows = await this.driver.query(
      `SELECT ${prefix('fe', FACT_EVIDENCE_COLUMNS, 'fe_')},
              ${prefix('sa', ARTIFACT_COLUMNS, 'sa_')},
              s.id AS s_id, s.publisher AS s_publisher, s.domain AS s_domain,
              s.source_type AS s_source_type, s.authority_rank AS s_authority_rank,
              s.rights_classification AS s_rights_classification
         FROM fact_evidence fe
         JOIN source_records sr ON sr.id = fe.source_record_id
         JOIN source_artifacts sa ON sa.id = fe.artifact_id
        JOIN sources s ON s.id = sr.source_id
        WHERE fe.fact_id IN (${placeholders(factIds.length)})
        ${authorityAt}
        ORDER BY fe.observed_at, fe.id`,
      params,
    );

    for (const row of rows) {
      const evidence = mapFactEvidence(unprefix(row, 'fe_'));
      const artifact = mapSourceArtifact(unprefix(row, 'sa_'));
      const link: CandidateEvidence = {
        evidence,
        artifact: {
          id: artifact.id,
          url: artifact.url,
          retrieved_at: artifact.retrieved_at,
          content_hash: artifact.content_hash,
          policy_snapshot_id: artifact.policy_snapshot_id,
          acquisition_route: artifact.acquisition_route,
          account_or_product_plan: artifact.account_or_product_plan,
          acquisition_jurisdiction: artifact.acquisition_jurisdiction,
        },
        source: {
          source_id: String(row['s_id']) as SourceId,
          publisher: String(row['s_publisher']),
          domain: String(row['s_domain']),
          source_type: String(row['s_source_type']) as Source['source_type'],
          authority_rank: toNumber(row['s_authority_rank']),
          rights_classification: String(row['s_rights_classification']) as Source['rights_classification'],
        },
      };
      const bucket = byFact.get(evidence.fact_id);
      if (bucket === undefined) byFact.set(evidence.fact_id, [link]);
      else bucket.push(link);
    }
    return byFact;
  }

  async selectFact(
    entityId: EntityId,
    property: Identifier,
    policy: Partial<FactSelectionPolicyInput> = {},
  ): Promise<FactSelection> {
    const at = policy.at ?? nowIso();
    const candidates = await this.loadFactCandidates(entityId, property, at);
    return selectCanonicalFact(property, candidates, { ...policy, at });
  }

  async canonicalView(
    entityId: EntityId,
    policy: Partial<FactSelectionPolicyInput> = {},
  ): Promise<Map<Identifier, FactSelection>> {
    const at = policy.at ?? nowIso();
    const propertyRows = await this.driver.query<{ property: string }>(
      `SELECT DISTINCT property FROM facts
        WHERE entity_id = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
        ORDER BY property`,
      [entityId, at],
    );
    const view = new Map<Identifier, FactSelection>();
    for (const { property } of propertyRows) {
      const identifier = property as Identifier;
      view.set(identifier, await this.selectFact(entityId, identifier, { ...policy, at }));
    }
    return view;
  }
}

/**
 * Close a fact version. Only `valid_to` and `status` change — the guard from
 * the schema package rejects anything that would rewrite a recorded claim.
 */
async function closeVersion(tx: SqlExecutor, id: FactId, validTo: IsoDateTime): Promise<void> {
  assertNonDestructiveFactUpdate({ valid_to: validTo, status: 'SUPERSEDED' });
  await tx.query(`UPDATE facts SET valid_to = $2, status = 'SUPERSEDED' WHERE id = $1`, [id, validTo]);
}

interface StoredFactDependency extends SqlRow {
  readonly input_fact_id: string;
  readonly transformation_ref: string;
}

const compareFactDependencies = (
  left: StoredFactDependency,
  right: StoredFactDependency,
): number => compareCodeUnits(
  `${left.input_fact_id}\u0000${left.transformation_ref}`,
  `${right.input_fact_id}\u0000${right.transformation_ref}`,
);

const normalizeDependencies = (
  dependencies: readonly FactDependencyInput[],
): StoredFactDependency[] => dependencies
  .map((item) => ({
    input_fact_id: item.input_fact_id as string,
    transformation_ref: item.transformation_ref,
  }))
  .sort(compareFactDependencies);

async function loadDependencies(
  tx: SqlExecutor,
  factId: FactId,
): Promise<StoredFactDependency[]> {
  const rows = await tx.query<StoredFactDependency>(
    `SELECT input_fact_id, transformation_ref
       FROM fact_dependencies
      WHERE derived_fact_id = $1
      ORDER BY input_fact_id::text COLLATE "C", transformation_ref COLLATE "C"`,
    [factId],
  );
  return [...rows].sort(compareFactDependencies);
}

const dependenciesEqual = (
  left: readonly StoredFactDependency[],
  right: readonly StoredFactDependency[],
): boolean => left.length === right.length && left.every((item, index) => {
  const expected = right[index];
  return expected !== undefined &&
    item.input_fact_id === expected.input_fact_id &&
    item.transformation_ref === expected.transformation_ref;
});

function requireRow<T>(rows: readonly T[], table: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new NotFoundError(table, 'RETURNING produced no row');
  }
  return row;
}

/** `a, b` → `t.a AS p_a, t.b AS p_b`, for joined selects. */
function prefix(table: string, columns: string, alias: string): string {
  return columns
    .split(',')
    .map((column) => column.trim())
    .map((column) => `${table}.${column} AS ${alias}${column}`)
    .join(', ');
}

function unprefix(row: Record<string, unknown>, alias: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(alias)) out[key.slice(alias.length)] = value;
  }
  return out;
}

export type { FactVersionDraft };
export { prefix as prefixColumns, unprefix as unprefixRow };
