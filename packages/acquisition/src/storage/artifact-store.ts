import type { ContentHash, PolicySnapshotId, StorageUri } from '@data-foundry/canonical-schema';
import { sha256Hex } from '../hashing.js';
import { artifactContentKey, artifactRetrievalKey } from './keys.js';

/**
 * The raw evidence store (AGENTS.md rule 10: *"Preserve raw evidence. Do not
 * discard artifacts required to explain or reprocess canonical facts."*).
 *
 * Four properties are non-negotiable and are enforced by
 * {@link storeArtifactBytes} rather than left to each adapter:
 *
 * 1. **Content-addressed** — the key is the sha256 of the bytes, and nothing
 *    else. Not the date, not the run: those belong to the *fetch*, not to the
 *    *evidence*, and folding them into the key is what made a refresh cycle
 *    duplicate every artifact it re-verified (finding #6).
 * 2. **Idempotent** — identical bytes are the same object however many times,
 *    and on however many days, they are fetched. A second `put` writes no
 *    bytes.
 * 3. **Explainable** — `retrieved_at`, `http_status`, `mime_type`,
 *    `content_hash` and the policy snapshot are stored *with* the bytes, not
 *    only in a database that might be rebuilt.
 * 4. **Accountable** — every fetch that confirmed a byte string leaves a small
 *    retrieval record under its own date, so "when did we last re-check this?"
 *    is answerable from the store alone. `source_artifacts` cannot answer it:
 *    it keeps the first retrieval and deduplicates the rest away.
 */

export interface ArtifactMetadata {
  readonly source_key: string;
  readonly vertical_slug: string;
  readonly url: string;
  readonly retrieved_at: string;
  readonly http_status: number;
  readonly mime_type: string;
  readonly content_hash: ContentHash;
  readonly byte_size: number;
  readonly policy_snapshot_id: PolicySnapshotId | null;
  readonly acquisition_provider: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
}

/** Everything the caller supplies; the store derives hash and size from the bytes. */
export type ArtifactMetadataInput = Omit<ArtifactMetadata, 'content_hash' | 'byte_size'>;

export interface ArtifactPutRequest {
  readonly vertical: string;
  readonly source: string;
  readonly body: Uint8Array;
  readonly metadata: ArtifactMetadataInput;
}

export interface StoredArtifact {
  /** The content key. Stable for the life of these bytes. */
  readonly key: string;
  readonly uri: StorageUri;
  readonly contentHash: ContentHash;
  readonly byteSize: number;
  /** True when identical bytes were already present and no bytes were written. */
  readonly deduplicated: boolean;
  /** Where this fetch was recorded, or null when this day's fetch was already recorded. */
  readonly retrievalKey: string | null;
  readonly metadata: ArtifactMetadata;
}

/**
 * A fetch that produced or confirmed one byte string.
 *
 * Deliberately not the same shape as {@link ArtifactMetadata}: that describes
 * the *first* retrieval and is frozen with the content, while this describes
 * one fetch among many and is written per day.
 */
export interface ArtifactRetrievalRecord {
  readonly content_key: string;
  readonly content_hash: ContentHash;
  readonly source_key: string;
  readonly vertical_slug: string;
  readonly url: string;
  readonly retrieved_at: string;
  readonly http_status: number;
  readonly byte_size: number;
  readonly policy_snapshot_id: PolicySnapshotId | null;
  readonly acquisition_provider: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
}

export interface ArtifactBody {
  readonly body: Uint8Array;
  readonly metadata: ArtifactMetadata;
}

export interface ArtifactStore {
  /** URI scheme this store addresses objects with (`r2`, `file`). */
  readonly scheme: string;
  put(request: ArtifactPutRequest): Promise<StoredArtifact>;
  head(key: string): Promise<ArtifactMetadata | null>;
  get(key: string): Promise<ArtifactBody | null>;
  uriFor(key: string): StorageUri;
  /** Every key under a prefix. Required so orphans can be *found*, not just feared. */
  list(prefix: string): Promise<readonly string[]>;
  /**
   * Remove one object. Reserved for {@link sweepOrphanedArtifacts}: an object
   * the canonical layer cites is historical evidence and deleting it is a rule
   * 10 violation, not a cleanup.
   */
  delete(key: string): Promise<void>;
}

/**
 * Shared put pipeline. Adapters supply only the three primitive operations, so
 * the content-addressing and idempotency rules cannot drift between R2 and local
 * disk.
 */
export interface ArtifactStorePrimitives {
  readHead(key: string): Promise<ArtifactMetadata | null>;
  write(key: string, body: Uint8Array, metadata: ArtifactMetadata): Promise<void>;
  /** True when this key already exists, whatever it holds. */
  exists(key: string): Promise<boolean>;
}

/** The retrieval record's media type, so adapters store it as readable JSON. */
export const RETRIEVAL_RECORD_MIME = 'application/json';

export async function storeArtifactBytes(
  primitives: ArtifactStorePrimitives,
  uriFor: (key: string) => StorageUri,
  request: ArtifactPutRequest,
): Promise<StoredArtifact> {
  const contentHash = sha256Hex(request.body);
  const key = artifactContentKey({
    vertical: request.vertical,
    source: request.source,
    contentHash,
  });

  const existing = await primitives.readHead(key);
  const metadata: ArtifactMetadata =
    // The first retrieval's metadata is authoritative — overwriting it would
    // rewrite history, which doc 13 forbids. A later fetch of the same bytes
    // is recorded as a retrieval, not as a correction of the original.
    existing ??
    ({
      ...request.metadata,
      content_hash: contentHash,
      byte_size: request.body.byteLength,
    } satisfies ArtifactMetadata);

  if (existing === null) await primitives.write(key, request.body, metadata);

  const retrievalKey = artifactRetrievalKey({
    vertical: request.vertical,
    source: request.source,
    retrievedAt: request.metadata.retrieved_at,
    contentHash,
  });
  const alreadyRecorded = await primitives.exists(retrievalKey);
  if (!alreadyRecorded) {
    const record: ArtifactRetrievalRecord = {
      content_key: key,
      content_hash: contentHash,
      source_key: request.metadata.source_key,
      vertical_slug: request.metadata.vertical_slug,
      url: request.metadata.url,
      retrieved_at: request.metadata.retrieved_at,
      http_status: request.metadata.http_status,
      byte_size: request.body.byteLength,
      policy_snapshot_id: request.metadata.policy_snapshot_id,
      acquisition_provider: request.metadata.acquisition_provider,
      etag: request.metadata.etag,
      last_modified: request.metadata.last_modified,
    };
    const recordBody = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
    await primitives.write(retrievalKey, recordBody, {
      ...metadata,
      mime_type: RETRIEVAL_RECORD_MIME,
      // This object is the retrieval record, not the content it points at. Its
      // own fetch instant and its own length, so `head(retrievalKey)` describes
      // the object that is actually there rather than the bytes it records.
      retrieved_at: request.metadata.retrieved_at,
      byte_size: recordBody.byteLength,
    });
  }

  return {
    key,
    uri: uriFor(key),
    contentHash,
    byteSize: metadata.byte_size,
    deduplicated: existing !== null,
    retrievalKey: alreadyRecorded ? null : retrievalKey,
    metadata,
  };
}

/** Metadata as a flat string map, for object-store user metadata headers. */
export function metadataToRecord(metadata: ArtifactMetadata): Record<string, string> {
  return {
    'source-key': metadata.source_key,
    'vertical-slug': metadata.vertical_slug,
    url: metadata.url,
    'retrieved-at': metadata.retrieved_at,
    'http-status': String(metadata.http_status),
    'mime-type': metadata.mime_type,
    'content-hash': metadata.content_hash,
    'byte-size': String(metadata.byte_size),
    'policy-snapshot-id': metadata.policy_snapshot_id ?? '',
    'acquisition-provider': metadata.acquisition_provider,
    etag: metadata.etag ?? '',
    'last-modified': metadata.last_modified ?? '',
  };
}

export function metadataFromRecord(
  record: Readonly<Record<string, string>> | undefined,
): ArtifactMetadata | null {
  if (record === undefined) return null;
  const hash = record['content-hash'];
  const retrievedAt = record['retrieved-at'];
  if (hash === undefined || retrievedAt === undefined) return null;
  const policySnapshot = record['policy-snapshot-id'];
  const etag = record['etag'];
  const lastModified = record['last-modified'];
  return {
    source_key: record['source-key'] ?? '',
    vertical_slug: record['vertical-slug'] ?? '',
    url: record['url'] ?? '',
    retrieved_at: retrievedAt,
    http_status: Number.parseInt(record['http-status'] ?? '0', 10),
    mime_type: record['mime-type'] ?? 'application/octet-stream',
    content_hash: hash,
    byte_size: Number.parseInt(record['byte-size'] ?? '0', 10),
    policy_snapshot_id:
      policySnapshot === undefined || policySnapshot === ''
        ? null
        : (policySnapshot as PolicySnapshotId),
    acquisition_provider: record['acquisition-provider'] ?? 'unknown',
    etag: etag === undefined || etag === '' ? null : etag,
    last_modified: lastModified === undefined || lastModified === '' ? null : lastModified,
  };
}
