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
  type Entity,
  type EntityAlias,
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
  type FactStatus,
  type FactVersionDraft,
  type Identifier,
  type IsoDateTime,
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
} from '@data-foundry/canonical-schema';
import { MissingEvidenceError, NotFoundError } from './errors.js';
import {
  selectCanonicalFact,
  type CandidateEvidence,
  type FactCandidate,
  type FactSelection,
  type FactSelectionPolicyInput,
} from './fact-selection.js';
import {
  ALIAS_COLUMNS,
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
  mapEntity,
  mapEntityAlias,
  mapEntityRedirect,
  mapFact,
  mapFactEvidence,
  mapRelationship,
  mapRelationshipEvidence,
  mapSource,
  mapSourceArtifact,
  mapSourceRecord,
  mapVertical,
  toIso,
  toNumber,
} from './rows.js';
import { placeholders, type SqlDriver, type SqlExecutor, type SqlParam } from './sql-driver.js';

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

/** Evidence for a relationship, minus the `relationship_id`. */
export interface RelationshipEvidenceInput {
  readonly artifact_id: SourceArtifact['id'];
  readonly source_record_id: SourceRecord['id'];
  readonly source_value: string;
  readonly locator_type: RelationshipEvidence['locator_type'];
  readonly locator_value: string;
  readonly observed_at: IsoDateTime;
}

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
  getVerticalBySlug(slug: Slug): Promise<Vertical | null>;
  upsertSource(input: SourceInsert): Promise<Source>;
  getSourceById(id: SourceId): Promise<Source | null>;

  recordSourceArtifact(input: SourceArtifactInsert): Promise<SourceArtifact>;
  recordSourceRecord(input: SourceRecordInsert): Promise<SourceRecord>;

  upsertEntity(input: EntityInsert): Promise<Entity>;
  getEntityById(id: EntityId): Promise<Entity | null>;
  getEntityBySlug(
    verticalId: VerticalId,
    entityType: Identifier,
    slug: Slug,
  ): Promise<Entity | null>;

  addAlias(input: EntityAliasInsert): Promise<EntityAlias>;
  listAliases(entityId: EntityId): Promise<EntityAlias[]>;
  lookupByAlias(query: AliasLookupQuery): Promise<AliasMatch[]>;

  /** The only way to record a fact. Evidence is required and written atomically. */
  appendFactWithEvidence(
    draft: FactVersionDraft,
    evidence: NonEmptyArray<FactEvidenceInput>,
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

  recordDatasetSnapshot(input: DatasetSnapshotInsert): Promise<DatasetSnapshot>;
  getDatasetSnapshot(verticalId: VerticalId, version: string): Promise<DatasetSnapshot | null>;

  /** Every claim about one property, with its evidence chain, for selection. */
  loadFactCandidates(
    entityId: EntityId,
    property: Identifier,
    at?: IsoDateTime,
  ): Promise<FactCandidate[]>;
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

  async upsertSource(input: SourceInsert): Promise<Source> {
    const rows = await this.driver.query(
      `INSERT INTO sources (vertical_id, publisher, domain, source_type, authority_rank,
                            rights_classification, attribution_requirement, robots_policy,
                            refresh_cadence, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (vertical_id, domain, source_type) DO UPDATE
         SET publisher = EXCLUDED.publisher,
             authority_rank = EXCLUDED.authority_rank,
             rights_classification = EXCLUDED.rights_classification,
             attribution_requirement = EXCLUDED.attribution_requirement,
             robots_policy = EXCLUDED.robots_policy,
             refresh_cadence = EXCLUDED.refresh_cadence,
             status = EXCLUDED.status,
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
    // Artifacts are immutable (rule 10): identical bytes from the same URL are
    // the same artifact. The no-op DO UPDATE exists only so the existing row is
    // RETURNING-able; nothing about the artifact is rewritten.
    const rows = await this.driver.query(
      `INSERT INTO source_artifacts (source_id, url, retrieved_at, content_hash, mime_type, r2_uri,
                                     http_status, extractor_version, policy_snapshot_id, byte_size,
                                     acquisition_provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (source_id, url, content_hash) DO UPDATE SET source_id = source_artifacts.source_id
       RETURNING ${ARTIFACT_COLUMNS}`,
      [
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
      ],
    );
    return mapSourceArtifact(requireRow(rows, 'source_artifacts'));
  }

  async recordSourceRecord(input: SourceRecordInsert): Promise<SourceRecord> {
    const rows = await this.driver.query(
      `INSERT INTO source_records (source_id, artifact_id, source_record_key, entity_type,
                                   raw_payload, normalized_payload, extraction_confidence,
                                   extractor_version)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
       ON CONFLICT (source_id, source_record_key) DO UPDATE
         SET artifact_id = EXCLUDED.artifact_id,
             raw_payload = EXCLUDED.raw_payload,
             normalized_payload = EXCLUDED.normalized_payload,
             extraction_confidence = EXCLUDED.extraction_confidence,
             extractor_version = EXCLUDED.extractor_version,
             updated_at = now()
       RETURNING ${SOURCE_RECORD_COLUMNS}`,
      [
        input.source_id,
        input.artifact_id,
        input.source_record_key,
        input.entity_type,
        json(input.raw_payload),
        input.normalized_payload === null ? null : json(input.normalized_payload),
        input.extraction_confidence,
        input.extractor_version,
      ],
    );
    return mapSourceRecord(requireRow(rows, 'source_records'));
  }

  /* ---------------- entities & aliases ---------------- */

  async upsertEntity(input: EntityInsert): Promise<Entity> {
    const rows = await this.driver.query(
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

  async getEntityById(id: EntityId): Promise<Entity | null> {
    const rows = await this.driver.query(`SELECT ${ENTITY_COLUMNS} FROM entities WHERE id = $1`, [id]);
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

  async addAlias(input: EntityAliasInsert): Promise<EntityAlias> {
    const rows = await this.driver.query(
      `INSERT INTO entity_aliases (entity_id, alias_type, alias_value, normalized_value, source_id,
                                   identity_confidence, valid_from, valid_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (entity_id, alias_type, normalized_value) DO UPDATE
         SET alias_value = EXCLUDED.alias_value,
             identity_confidence = GREATEST(entity_aliases.identity_confidence,
                                            EXCLUDED.identity_confidence),
             valid_to = EXCLUDED.valid_to
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

  async listAliases(entityId: EntityId): Promise<EntityAlias[]> {
    const rows = await this.driver.query(
      // `COLLATE "C"` because this order is a decision, not a display: the
      // first alias of the primary type is what rebuilds the entity's
      // canonical name. Left to the database's collation, the published name
      // would differ between a `C`-collated PGlite and an `en_US`-collated
      // hosted Postgres (#14).
      `SELECT ${ALIAS_COLUMNS} FROM entity_aliases WHERE entity_id = $1
        ORDER BY alias_type COLLATE "C", normalized_value COLLATE "C"`,
      [entityId],
    );
    return rows.map(mapEntityAlias);
  }

  async lookupByAlias(query: AliasLookupQuery): Promise<AliasMatch[]> {
    if (query.values.length === 0) return [];
    const params: SqlParam[] = [query.vertical_id, ...query.values];
    const valueList = placeholders(query.values.length, 1);
    let sql =
      `SELECT ${prefix('e', ENTITY_COLUMNS, 'e_')}, ${prefix('a', ALIAS_COLUMNS, 'a_')}
         FROM entity_aliases a
         JOIN entities e ON e.id = a.entity_id
        WHERE e.vertical_id = $1
          AND (a.normalized_value IN (${valueList}) OR a.alias_value IN (${valueList}))`;
    if (query.include_expired !== true) sql += ' AND a.valid_to IS NULL';
    if (query.alias_type !== undefined) {
      params.push(query.alias_type);
      sql += ` AND a.alias_type = $${params.length}`;
    }
    if (query.entity_type !== undefined) {
      params.push(query.entity_type);
      sql += ` AND e.entity_type = $${params.length}`;
    }
    sql += ' ORDER BY a.identity_confidence DESC, e.canonical_slug';
    const rows = await this.driver.query(sql, params);
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

      const identical = open.find(
        (fact) =>
          fact.value_type === draft.value_type &&
          fact.unit === draft.unit &&
          canonicalValuesEqual(fact.normalized_value, draft.normalized_value),
      );

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
        const { close, insert } = appendFactVersion(previous, draft);

        if (close !== null) {
          await closeVersion(tx, close.id, close.valid_to);
          supersededFactId = close.id;
        }

        const inserted = await tx.query(
          `INSERT INTO facts (entity_id, property, normalized_value, value_type, unit, valid_from,
                              valid_to, status, confidence, supersedes_fact_id, recorded_at)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING ${FACT_COLUMNS}`,
          [
            insert.entity_id,
            insert.property,
            json(insert.normalized_value),
            insert.value_type,
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
  ): Promise<RelationshipWriteResult> {
    if (evidence.length === 0) {
      throw new MissingEvidenceError(
        `relationship ${draft.subject_entity_id} -${draft.predicate}-> ${draft.object_entity_id}`,
      );
    }

    return this.driver.transaction(async (tx) => {
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
    });
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
                 AND status <> 'RETRACTED' AND valid_to IS NULL`;
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
        ORDER BY recorded_at DESC, id`,
      [entityId, property, at],
    );
    const facts = factRows.map(mapFact);
    if (facts.length === 0) return [];

    const evidenceByFact = await this.loadEvidenceChains(facts.map((fact) => fact.id));
    return facts.map((fact) => ({
      fact,
      evidence: evidenceByFact.get(fact.id) ?? [],
    }));
  }

  /** Evidence + source_record + artifact + source, for a set of facts. */
  private async loadEvidenceChains(
    factIds: readonly FactId[],
  ): Promise<Map<FactId, CandidateEvidence[]>> {
    const byFact = new Map<FactId, CandidateEvidence[]>();
    if (factIds.length === 0) return byFact;

    const rows = await this.driver.query(
      `SELECT ${prefix('fe', FACT_EVIDENCE_COLUMNS, 'fe_')},
              sa.id AS sa_id, sa.url AS sa_url, sa.retrieved_at AS sa_retrieved_at,
              sa.content_hash AS sa_content_hash,
              s.id AS s_id, s.publisher AS s_publisher, s.domain AS s_domain,
              s.source_type AS s_source_type, s.authority_rank AS s_authority_rank,
              s.rights_classification AS s_rights_classification
         FROM fact_evidence fe
         JOIN source_records sr ON sr.id = fe.source_record_id
         JOIN source_artifacts sa ON sa.id = fe.artifact_id
         JOIN sources s ON s.id = sr.source_id
        WHERE fe.fact_id IN (${placeholders(factIds.length)})
        ORDER BY fe.observed_at, fe.id`,
      [...factIds],
    );

    for (const row of rows) {
      const evidence = mapFactEvidence(unprefix(row, 'fe_'));
      const link: CandidateEvidence = {
        evidence,
        artifact: {
          id: evidence.artifact_id,
          url: String(row['sa_url']),
          retrieved_at: toIso(row['sa_retrieved_at']),
          content_hash: String(row['sa_content_hash']),
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
