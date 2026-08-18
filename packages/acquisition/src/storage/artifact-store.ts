import type { ContentHash, PolicySnapshotId, StorageUri } from '@data-foundry/canonical-schema';
import { sha256Hex } from '../hashing.js';
import { artifactStorageKey } from './keys.js';

/**
 * The raw evidence store (AGENTS.md rule 10: *"Preserve raw evidence. Do not
 * discard artifacts required to explain or reprocess canonical facts."*).
 *
 * Three properties are non-negotiable and are enforced by
 * {@link storeArtifactBytes} rather than left to each adapter:
 *
 * 1. **Content-addressed** — the key contains the sha256 of the bytes.
 * 2. **Idempotent** — identical bytes produce an identical key, and a second
 *    `put` performs no write at all.
 * 3. **Explainable** — `retrieved_at`, `http_status`, `mime_type`,
 *    `content_hash` and the policy snapshot are stored *with* the bytes, not
 *    only in a database that might be rebuilt.
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
  readonly key: string;
  readonly uri: StorageUri;
  readonly contentHash: ContentHash;
  readonly byteSize: number;
  /** True when identical bytes were already present and no write was performed. */
  readonly deduplicated: boolean;
  readonly metadata: ArtifactMetadata;
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
}

/**
 * Shared put pipeline. Adapters supply only the three primitive operations, so
 * the content-addressing and idempotency rules cannot drift between R2 and local
 * disk.
 */
export interface ArtifactStorePrimitives {
  readHead(key: string): Promise<ArtifactMetadata | null>;
  write(key: string, body: Uint8Array, metadata: ArtifactMetadata): Promise<void>;
}

export async function storeArtifactBytes(
  primitives: ArtifactStorePrimitives,
  uriFor: (key: string) => StorageUri,
  request: ArtifactPutRequest,
): Promise<StoredArtifact> {
  const contentHash = sha256Hex(request.body);
  const key = artifactStorageKey({
    vertical: request.vertical,
    source: request.source,
    retrievedAt: request.metadata.retrieved_at,
    contentHash,
  });

  const existing = await primitives.readHead(key);
  if (existing !== null) {
    // Same bytes, same day, same source: the artifact is already evidence. The
    // first retrieval's metadata is authoritative — overwriting it would rewrite
    // history, which doc 13 forbids.
    return {
      key,
      uri: uriFor(key),
      contentHash,
      byteSize: existing.byte_size,
      deduplicated: true,
      metadata: existing,
    };
  }

  const metadata: ArtifactMetadata = {
    ...request.metadata,
    content_hash: contentHash,
    byte_size: request.body.byteLength,
  };
  await primitives.write(key, request.body, metadata);

  return {
    key,
    uri: uriFor(key),
    contentHash,
    byteSize: metadata.byte_size,
    deduplicated: false,
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
