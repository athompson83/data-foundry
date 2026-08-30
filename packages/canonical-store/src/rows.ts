/**
 * Postgres row → canonical object mapping.
 *
 * Every read goes through a Zod parse from `@data-foundry/canonical-schema`
 * rather than a cast. That is deliberate: the schema package is the single
 * source of truth for the model (branded ids, branded confidence scores,
 * ISO-8601 timestamps), and a cast would let a drifted column shape reach the
 * query layer as a well-typed lie.
 *
 * The only translation this module performs is representational — `timestamptz`
 * arrives as a `Date` from both drivers and leaves as an ISO-8601 string with an
 * offset, because a `Date` does not survive a Postgres → JSON → Worker round
 * trip unambiguously.
 */
import {
  DatasetSnapshotSchema,
  FactVerificationSchema,
  EntityAliasSchema,
  EntityRedirectSchema,
  EntitySchema,
  FactEvidenceSchema,
  FactSchema,
  RelationshipEvidenceSchema,
  RelationshipSchema,
  SourceArtifactSchema,
  SourceRecordSchema,
  SourceSchema,
  VerticalSchema,
  type DatasetSnapshot,
  type FactVerification,
  type Entity,
  type EntityAlias,
  type EntityRedirect,
  type Fact,
  type FactEvidence,
  type IsoDateTime,
  type Relationship,
  type RelationshipEvidence,
  type Source,
  type SourceArtifact,
  type SourceRecord,
  type Vertical,
} from '@data-foundry/canonical-schema';
import { CanonicalStoreError } from './errors.js';
import type { SqlRow } from './sql-driver.js';

/** `timestamptz` → ISO-8601 with offset. Accepts `Date`, string or epoch ms. */
export function toIso(value: unknown): IsoDateTime {
  if (value instanceof Date) return value.toISOString() as IsoDateTime;
  if (typeof value === 'number') return new Date(value).toISOString() as IsoDateTime;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new CanonicalStoreError(`Not a parseable timestamp: ${value}`);
    }
    return parsed.toISOString() as IsoDateTime;
  }
  throw new CanonicalStoreError(`Not a timestamp: ${String(value)}`);
}

export function toIsoOrNull(value: unknown): IsoDateTime | null {
  return value === null || value === undefined ? null : toIso(value);
}

/** `double precision` arrives as a JS number from both drivers; `numeric` may not. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) throw new CanonicalStoreError(`Not a number: ${value}`);
    return parsed;
  }
  throw new CanonicalStoreError(`Not a number: ${String(value)}`);
}

export function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  throw new CanonicalStoreError(`Not text: ${String(value)}`);
}

export function toTextOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toText(value);
}

/**
 * `jsonb` is returned pre-parsed by both drivers, but a driver configured with
 * a raw parser may hand back a string. Accept both.
 */
export function toJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

const field = (row: SqlRow, name: string): unknown => row[name];

export function mapVertical(row: SqlRow): Vertical {
  return VerticalSchema.parse({
    id: field(row, 'id'),
    slug: field(row, 'slug'),
    name: field(row, 'name'),
    schema_version: field(row, 'schema_version'),
    status: field(row, 'status'),
    default_refresh_policy: toJson(field(row, 'default_refresh_policy')),
    created_at: toIso(field(row, 'created_at')),
    updated_at: toIso(field(row, 'updated_at')),
  });
}

export function mapSource(row: SqlRow): Source {
  return SourceSchema.parse({
    id: field(row, 'id'),
    vertical_id: field(row, 'vertical_id'),
    publisher: field(row, 'publisher'),
    domain: field(row, 'domain'),
    source_type: field(row, 'source_type'),
    authority_rank: toNumber(field(row, 'authority_rank')),
    rights_classification: field(row, 'rights_classification'),
    attribution_requirement: toJson(field(row, 'attribution_requirement')),
    robots_policy: toJson(field(row, 'robots_policy')),
    refresh_cadence: field(row, 'refresh_cadence'),
    status: field(row, 'status'),
    kill_switch_engaged: field(row, 'kill_switch_engaged') ?? null,
    created_at: toIso(field(row, 'created_at')),
    updated_at: toIso(field(row, 'updated_at')),
  });
}

export function mapSourceArtifact(row: SqlRow): SourceArtifact {
  const byteSize = field(row, 'byte_size');
  return SourceArtifactSchema.parse({
    id: field(row, 'id'),
    source_id: field(row, 'source_id'),
    url: field(row, 'url'),
    retrieved_at: toIso(field(row, 'retrieved_at')),
    content_hash: field(row, 'content_hash'),
    mime_type: field(row, 'mime_type'),
    r2_uri: field(row, 'r2_uri'),
    http_status: toNumber(field(row, 'http_status')),
    extractor_version: field(row, 'extractor_version'),
    policy_snapshot_id: field(row, 'policy_snapshot_id') ?? null,
    byte_size: byteSize === null || byteSize === undefined ? null : toNumber(byteSize),
    acquisition_provider: field(row, 'acquisition_provider'),
    acquisition_route: field(row, 'acquisition_route') ?? null,
    account_or_product_plan: field(row, 'account_or_product_plan') ?? null,
    acquisition_jurisdiction: field(row, 'acquisition_jurisdiction') ?? null,
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapSourceRecord(row: SqlRow): SourceRecord {
  const normalized = field(row, 'normalized_payload');
  return SourceRecordSchema.parse({
    id: field(row, 'id'),
    source_id: field(row, 'source_id'),
    artifact_id: field(row, 'artifact_id'),
    source_record_key: field(row, 'source_record_key'),
    entity_type: field(row, 'entity_type'),
    raw_payload: toJson(field(row, 'raw_payload')),
    normalized_payload:
      normalized === null || normalized === undefined ? null : toJson(normalized),
    extraction_confidence: toNumber(field(row, 'extraction_confidence')),
    extractor_version: field(row, 'extractor_version'),
    is_current: field(row, 'is_current'),
    created_at: toIso(field(row, 'created_at')),
    updated_at: toIso(field(row, 'updated_at')),
  });
}

export function mapEntity(row: SqlRow): Entity {
  return EntitySchema.parse({
    id: field(row, 'id'),
    vertical_id: field(row, 'vertical_id'),
    entity_type: field(row, 'entity_type'),
    canonical_name: field(row, 'canonical_name'),
    canonical_slug: field(row, 'canonical_slug'),
    status: field(row, 'status'),
    quality_score: toNumber(field(row, 'quality_score')),
    first_seen_at: toIso(field(row, 'first_seen_at')),
    last_verified_at: toIsoOrNull(field(row, 'last_verified_at')),
    created_at: toIso(field(row, 'created_at')),
    updated_at: toIso(field(row, 'updated_at')),
  });
}

export function mapEntityAlias(row: SqlRow): EntityAlias {
  return EntityAliasSchema.parse({
    id: field(row, 'id'),
    entity_id: field(row, 'entity_id'),
    alias_type: field(row, 'alias_type'),
    alias_value: field(row, 'alias_value'),
    normalized_value: field(row, 'normalized_value'),
    source_id: field(row, 'source_id') ?? null,
    identity_confidence: toNumber(field(row, 'identity_confidence')),
    valid_from: toIso(field(row, 'valid_from')),
    valid_to: toIsoOrNull(field(row, 'valid_to')),
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapEntityRedirect(row: SqlRow): EntityRedirect {
  return EntityRedirectSchema.parse({
    id: field(row, 'id'),
    vertical_id: field(row, 'vertical_id'),
    from_entity_id: field(row, 'from_entity_id'),
    to_entity_id: field(row, 'to_entity_id'),
    from_slug: field(row, 'from_slug') ?? null,
    reason: field(row, 'reason'),
    judgment_id: field(row, 'judgment_id') ?? null,
    active: field(row, 'active'),
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapFact(row: SqlRow): Fact {
  return FactSchema.parse({
    id: field(row, 'id'),
    entity_id: field(row, 'entity_id'),
    property: field(row, 'property'),
    normalized_value: toJson(field(row, 'normalized_value')),
    value_type: field(row, 'value_type'),
    output_kind: field(row, 'output_kind') ?? null,
    unit: field(row, 'unit') ?? null,
    valid_from: toIso(field(row, 'valid_from')),
    valid_to: toIsoOrNull(field(row, 'valid_to')),
    status: field(row, 'status'),
    confidence: toNumber(field(row, 'confidence')),
    supersedes_fact_id: field(row, 'supersedes_fact_id') ?? null,
    recorded_at: toIso(field(row, 'recorded_at')),
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapFactEvidence(row: SqlRow): FactEvidence {
  return FactEvidenceSchema.parse({
    id: field(row, 'id'),
    fact_id: field(row, 'fact_id'),
    artifact_id: field(row, 'artifact_id'),
    source_record_id: field(row, 'source_record_id'),
    source_value: field(row, 'source_value'),
    locator_type: field(row, 'locator_type'),
    locator_value: field(row, 'locator_value'),
    observed_at: toIso(field(row, 'observed_at')),
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapRelationship(row: SqlRow): Relationship {
  return RelationshipSchema.parse({
    id: field(row, 'id'),
    vertical_id: field(row, 'vertical_id'),
    subject_entity_id: field(row, 'subject_entity_id'),
    predicate: field(row, 'predicate'),
    object_entity_id: field(row, 'object_entity_id'),
    confidence: toNumber(field(row, 'confidence')),
    valid_from: toIso(field(row, 'valid_from')),
    valid_to: toIsoOrNull(field(row, 'valid_to')),
    status: field(row, 'status'),
    supersedes_relationship_id: field(row, 'supersedes_relationship_id') ?? null,
    recorded_at: toIso(field(row, 'recorded_at')),
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapRelationshipEvidence(row: SqlRow): RelationshipEvidence {
  return RelationshipEvidenceSchema.parse({
    id: field(row, 'id'),
    relationship_id: field(row, 'relationship_id'),
    artifact_id: field(row, 'artifact_id'),
    source_record_id: field(row, 'source_record_id'),
    source_value: field(row, 'source_value'),
    locator_type: field(row, 'locator_type'),
    locator_value: field(row, 'locator_value'),
    observed_at: toIso(field(row, 'observed_at')),
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapDatasetSnapshot(row: SqlRow): DatasetSnapshot {
  return DatasetSnapshotSchema.parse({
    id: field(row, 'id'),
    vertical_id: field(row, 'vertical_id'),
    version: field(row, 'version'),
    generated_at: toIso(field(row, 'generated_at')),
    record_counts: toJson(field(row, 'record_counts')),
    schema_version: field(row, 'schema_version'),
    manifest_uri: field(row, 'manifest_uri'),
    checksums: toJson(field(row, 'checksums')),
    status: field(row, 'status'),
    created_at: toIso(field(row, 'created_at')),
  });
}

export function mapFactVerification(row: SqlRow): FactVerification {
  return FactVerificationSchema.parse({
    id: field(row, 'id'),
    entity_id: field(row, 'entity_id'),
    property: field(row, 'property'),
    fact_id: field(row, 'fact_id'),
    selected_value: toJson(field(row, 'selected_value')),
    unit: field(row, 'unit'),
    verified: field(row, 'verified'),
    reason: field(row, 'reason'),
    blockers: field(row, 'blockers'),
    signals: toJson(field(row, 'signals')),
    evidence_refs: toJson(field(row, 'evidence_refs')),
    selection_rule: field(row, 'selection_rule'),
    policy_version: field(row, 'policy_version'),
    evaluated_at: toIso(field(row, 'evaluated_at')),
    verdict_fingerprint: field(row, 'verdict_fingerprint'),
    created_at: toIso(field(row, 'created_at')),
  });
}

export const FACT_VERIFICATION_COLUMNS =
  'id, entity_id, property, fact_id, selected_value, unit, verified, reason, blockers, ' +
  'signals, evidence_refs, selection_rule, policy_version, evaluated_at, verdict_fingerprint, ' +
  'created_at';

/** Column lists, kept next to the mappers so a schema change breaks one file. */
export const ENTITY_COLUMNS =
  'id, vertical_id, entity_type, canonical_name, canonical_slug, status, quality_score, ' +
  'first_seen_at, last_verified_at, created_at, updated_at';

export const FACT_COLUMNS =
  'id, entity_id, property, normalized_value, value_type, output_kind, unit, valid_from, valid_to, ' +
  'status, confidence, supersedes_fact_id, recorded_at, created_at';

export const FACT_EVIDENCE_COLUMNS =
  'id, fact_id, artifact_id, source_record_id, source_value, locator_type, locator_value, ' +
  'observed_at, created_at';

export const RELATIONSHIP_COLUMNS =
  'id, vertical_id, subject_entity_id, predicate, object_entity_id, confidence, valid_from, ' +
  'valid_to, status, supersedes_relationship_id, recorded_at, created_at';

export const RELATIONSHIP_EVIDENCE_COLUMNS =
  'id, relationship_id, artifact_id, source_record_id, source_value, locator_type, ' +
  'locator_value, observed_at, created_at';

export const ALIAS_COLUMNS =
  'id, entity_id, alias_type, alias_value, normalized_value, source_id, identity_confidence, ' +
  'valid_from, valid_to, created_at';

export const SOURCE_COLUMNS =
  'id, vertical_id, publisher, domain, source_type, authority_rank, rights_classification, ' +
  'attribution_requirement, robots_policy, refresh_cadence, status, kill_switch_engaged, ' +
  'created_at, updated_at';

export const ARTIFACT_COLUMNS =
  'id, source_id, url, retrieved_at, content_hash, mime_type, r2_uri, http_status, ' +
  'extractor_version, policy_snapshot_id, byte_size, acquisition_provider, acquisition_route, ' +
  'account_or_product_plan, acquisition_jurisdiction, created_at';

export const SOURCE_RECORD_COLUMNS =
  'id, source_id, artifact_id, source_record_key, entity_type, raw_payload, ' +
  'normalized_payload, extraction_confidence, extractor_version, is_current, created_at, updated_at';

export const REDIRECT_COLUMNS =
  'id, vertical_id, from_entity_id, to_entity_id, from_slug, reason, judgment_id, active, created_at';

export const SNAPSHOT_COLUMNS =
  'id, vertical_id, version, generated_at, record_counts, schema_version, manifest_uri, ' +
  'checksums, status, created_at';
