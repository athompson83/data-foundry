import type { z } from 'zod';
import { VerticalSchema } from './objects/verticals.js';
import { SourceSchema } from './objects/sources.js';
import { SourceArtifactSchema, SourceRecordSchema } from './objects/evidence.js';
import { EntityAliasSchema, EntityRedirectSchema, EntitySchema } from './objects/entities.js';
import { FactEvidenceSchema, FactSchema } from './objects/facts.js';
import { FactVerificationSchema } from './objects/verifications.js';
import { RelationshipEvidenceSchema, RelationshipSchema } from './objects/relationships.js';
import { ResolutionCandidateSchema, ResolutionJudgmentSchema } from './objects/resolution.js';
import { DatasetSnapshotSchema } from './objects/snapshots.js';
import { MediaAssetSchema } from './objects/media.js';
import { IngestionJobSchema } from './objects/ingestion-jobs.js';
import { JobStatusSchema } from './job-state.js';

/**
 * Every canonical object keyed by its Postgres table name.
 *
 * Used by the JSON Schema exporter and by contract tests that assert the
 * migrations and the Zod model have not drifted apart. Adding a canonical
 * object means adding it here, or it silently stops being exported.
 */
export const CANONICAL_OBJECT_SCHEMAS = {
  verticals: VerticalSchema,
  sources: SourceSchema,
  source_artifacts: SourceArtifactSchema,
  source_records: SourceRecordSchema,
  entities: EntitySchema,
  entity_aliases: EntityAliasSchema,
  entity_redirects: EntityRedirectSchema,
  facts: FactSchema,
  fact_evidence: FactEvidenceSchema,
  fact_verifications: FactVerificationSchema,
  relationships: RelationshipSchema,
  relationship_evidence: RelationshipEvidenceSchema,
  resolution_candidates: ResolutionCandidateSchema,
  resolution_judgments: ResolutionJudgmentSchema,
  dataset_snapshots: DatasetSnapshotSchema,
  media_assets: MediaAssetSchema,
  ingestion_jobs: IngestionJobSchema,
  job_status: JobStatusSchema,
} as const satisfies Record<string, z.ZodType>;

export type CanonicalObjectName = keyof typeof CANONICAL_OBJECT_SCHEMAS;
