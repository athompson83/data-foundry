import { z } from 'zod';
import { DatasetSnapshotIdSchema, VerticalIdSchema } from '../ids.js';
import {
  ContentHashSchema,
  IsoDateTimeSchema,
  SchemaVersionSchema,
  StorageUriSchema,
} from '../primitives.js';

export const SNAPSHOT_STATUSES = ['BUILDING', 'PUBLISHED', 'WITHDRAWN', 'FAILED'] as const;
export const SnapshotStatusSchema = z.enum(SNAPSHOT_STATUSES);
export type SnapshotStatus = z.infer<typeof SnapshotStatusSchema>;

/** Row counts per canonical object, keyed by table name. */
export const RecordCountsSchema = z.record(z.string(), z.number().int().min(0));
export type RecordCounts = z.infer<typeof RecordCountsSchema>;

/** Content hash per emitted export file, keyed by relative path within the snapshot. */
export const SnapshotChecksumsSchema = z.record(z.string(), ContentHashSchema);
export type SnapshotChecksums = z.infer<typeof SnapshotChecksumsSchema>;

/**
 * `dataset_snapshots` — immutable published versions.
 *
 * A snapshot is what makes "what did you publish on that date" answerable, and
 * what bulk/Parquet/JSONL consumers pin to. Snapshots are never rewritten; a
 * correction produces a new version and, if necessary, marks the old one
 * `WITHDRAWN`.
 */
export const DatasetSnapshotSchema = z.object({
  id: DatasetSnapshotIdSchema,
  vertical_id: VerticalIdSchema,
  /** Monotonic, human-quotable version, e.g. `2026-08-14.1`. */
  version: z.string().min(1).max(64),
  generated_at: IsoDateTimeSchema,
  record_counts: RecordCountsSchema,
  schema_version: SchemaVersionSchema,
  manifest_uri: StorageUriSchema,
  checksums: SnapshotChecksumsSchema,
  status: SnapshotStatusSchema,
  created_at: IsoDateTimeSchema,
});
export type DatasetSnapshot = z.infer<typeof DatasetSnapshotSchema>;

export const DatasetSnapshotInsertSchema = DatasetSnapshotSchema.omit({
  id: true,
  created_at: true,
});
export type DatasetSnapshotInsert = z.infer<typeof DatasetSnapshotInsertSchema>;
