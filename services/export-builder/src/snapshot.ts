/**
 * Recording a built export in `dataset_snapshots`.
 *
 * Kept apart from the builder for a boundary reason, not a tidiness one.
 * `QueryModel` deliberately exposes no store and no driver — its
 * `driver-boundary.test.ts` exists so a customer-facing surface cannot reach
 * raw SQL, including writes — so the builder reads through the query model and
 * has no way to write anything, which is correct. Persisting a snapshot is a
 * write, so it takes an injected `CanonicalStore` at the composition root,
 * exactly as the ingest worker does.
 *
 * The table is append-mostly by design: "Snapshots are never rewritten; a
 * correction produces a new version and, if necessary, marks the old one
 * WITHDRAWN". `recordDatasetSnapshot` upserts on `(vertical_id, version)`, so
 * re-running a build for a version that already exists updates that row rather
 * than minting a rival. Bump the version to publish a correction.
 */
import type { CanonicalStore } from '@data-foundry/canonical-store';
import type { DatasetSnapshot, SnapshotStatus } from '@data-foundry/canonical-schema';
import { toSnapshotInsert, type DatasetExportManifest } from './manifest.js';

/**
 * Write the snapshot row for a manifest.
 *
 * `status` defaults to whatever the manifest declares. Pass `BUILDING` before a
 * slow upload and `PUBLISHED` after it, or `FAILED` if the upload did not
 * finish — a snapshot row claiming `PUBLISHED` over a half-written prefix is
 * worse than no row.
 */
export async function recordDatasetSnapshot(
  store: CanonicalStore,
  manifest: DatasetExportManifest,
  status: SnapshotStatus = manifest.status,
): Promise<DatasetSnapshot> {
  return store.recordDatasetSnapshot(toSnapshotInsert(manifest, status));
}
