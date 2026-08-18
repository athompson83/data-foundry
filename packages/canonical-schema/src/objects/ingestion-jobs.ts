import { z } from 'zod';
import {
  IngestionJobIdSchema,
  SourceArtifactIdSchema,
  SourceIdSchema,
  SourceRecordIdSchema,
  VerticalIdSchema,
} from '../ids.js';
import { IsoDateTimeSchema, JsonObjectSchema } from '../primitives.js';
import { JobPipelineStateSchema, JobStateSchema, RetryMetadataSchema } from '../job-state.js';

export const JOB_TYPES = [
  'SOURCE_DISCOVERY',
  'ARTIFACT_FETCH',
  'ARTIFACT_EXTRACT',
  'RECORD_NORMALIZE',
  'ENTITY_RESOLVE',
  'FACT_VALIDATE',
  'SNAPSHOT_PUBLISH',
] as const;
export const JobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobTypeSchema>;

/**
 * `ingestion_jobs` — the durable, resumable unit of pipeline work.
 *
 * `idempotency_key` is what makes re-running a crawl safe: a job is identified
 * by (source, key), so a retry after a crash rejoins the existing row instead of
 * duplicating artifacts.
 *
 * The state columns are flattened for indexing/queue polling; `JobStatus` from
 * `job-state.ts` is the in-memory discriminated union they project to.
 */
export const IngestionJobSchema = z.object({
  id: IngestionJobIdSchema,
  vertical_id: VerticalIdSchema,
  source_id: SourceIdSchema,
  job_type: JobTypeSchema,
  idempotency_key: z.string().min(1).max(512),
  state: JobStateSchema,
  state_entered_at: IsoDateTimeSchema,
  /** Set only while `state = 'FAILED'`; records the stage that failed. */
  failed_from: JobPipelineStateSchema.nullable(),
  /** Set only while `state = 'FAILED'`. */
  retry: RetryMetadataSchema.nullable(),
  artifact_id: SourceArtifactIdSchema.nullable(),
  source_record_id: SourceRecordIdSchema.nullable(),
  payload: JsonObjectSchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type IngestionJob = z.infer<typeof IngestionJobSchema>;

export const IngestionJobInsertSchema = IngestionJobSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type IngestionJobInsert = z.infer<typeof IngestionJobInsertSchema>;
