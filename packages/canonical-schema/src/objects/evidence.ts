import { z } from 'zod';
import { ExtractionConfidenceSchema } from '../confidence.js';
import { AcquisitionMethodSchema } from '../rights.js';
import {
  PolicySnapshotIdSchema,
  SourceArtifactIdSchema,
  SourceIdSchema,
  SourceRecordIdSchema,
  SourceRecordKeySchema,
} from '../ids.js';
import {
  ContentHashSchema,
  ExtractorVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  StorageUriSchema,
} from '../primitives.js';

/**
 * `source_artifacts` — immutable evidence objects.
 *
 * Artifacts are never updated in place and never deleted while any published
 * fact cites them (AGENTS.md rule 10). Postgres holds the pointer and the hash;
 * the bytes live in R2 at `r2_uri`.
 */
export const SourceArtifactSchema = z.object({
  id: SourceArtifactIdSchema,
  source_id: SourceIdSchema,
  url: z.url(),
  retrieved_at: IsoDateTimeSchema,
  content_hash: ContentHashSchema,
  mime_type: z.string().min(1).max(255),
  r2_uri: StorageUriSchema,
  http_status: z.number().int().min(0).max(599),
  extractor_version: ExtractorVersionSchema,
  /** Rights/robots policy in force at retrieval time; null until backfilled. */
  policy_snapshot_id: PolicySnapshotIdSchema.nullable(),
  byte_size: z.number().int().min(0).nullable(),
  /** Acquisition adapter that produced this artifact (`browser-run`, `crawl4ai`, `http`). */
  acquisition_provider: z.string().min(1).max(120),
  /** Rights-relevant route that was approved for this retrieval. */
  acquisition_route: AcquisitionMethodSchema.nullable(),
  /** Contract/account tier used to acquire the bytes; explicit null means no tier was recorded. */
  account_or_product_plan: z.string().min(1).max(300).nullable(),
  /** Acquisition jurisdiction in force; explicit null means it was not recorded. */
  acquisition_jurisdiction: z.string().min(1).max(120).nullable(),
  created_at: IsoDateTimeSchema,
});
export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

export const SourceArtifactInsertSchema = SourceArtifactSchema.omit({
  id: true,
  created_at: true,
});
export type SourceArtifactInsert = z.infer<typeof SourceArtifactInsertSchema>;

/**
 * `source_records` — extracted source-native records, before canonical
 * resolution. A source record is a *claim*, not an entity.
 *
 * `source_id` is carried alongside `artifact_id` because the business key
 * `(source_id, source_record_key)` identifies one logical record. A current
 * immutable revision is replaced when a later artifact changes its payload;
 * historic revisions retain the evidence needed to explain earlier output.
 */
export const SourceRecordSchema = z.object({
  id: SourceRecordIdSchema,
  source_id: SourceIdSchema,
  artifact_id: SourceArtifactIdSchema,
  source_record_key: SourceRecordKeySchema,
  entity_type: IdentifierSchema,
  raw_payload: JsonObjectSchema,
  /** Populated by the normalization stage; null between EXTRACTED and NORMALIZED. */
  normalized_payload: JsonObjectSchema.nullable(),
  extraction_confidence: ExtractionConfidenceSchema,
  extractor_version: ExtractorVersionSchema,
  /** Hash of evidence-affecting validation/resolution semantics for no-op replays. */
  evidence_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /** Explicit lifecycle state; evidence may cite only a FINALIZED revision. */
  revision_state: z.enum(['PROVISIONAL', 'FINALIZED']),
  /** One revision per logical source record is current and eligible for new lineage. */
  is_current: z.boolean(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const SourceRecordInsertSchema = SourceRecordSchema.omit({
  id: true,
  evidence_fingerprint: true,
  revision_state: true,
  is_current: true,
  created_at: true,
  updated_at: true,
});
export type SourceRecordInsert = z.infer<typeof SourceRecordInsertSchema>;
