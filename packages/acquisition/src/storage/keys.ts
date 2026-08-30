import type { ContentHash, PolicySnapshotId } from '@data-foundry/canonical-schema';
import { ArtifactStoreError } from '../errors.js';
import { sha256Hex } from '../hashing.js';

/**
 * Raw evidence key layout.
 *
 * ```text
 * /raw/{vertical}/{source}/content/{aa}/{hash}                  the bytes
 * /raw/{vertical}/{source}/retrieved/{yyyy}/{mm}/{dd}/{hash}.json   a retrieval
 * ```
 *
 * Doc 02 specified one key, `/raw/{vertical}/{source}/{yyyy}/{mm}/{dd}/{hash}`,
 * conflating two different facts: *what the bytes are* and *when we fetched
 * them*. Deduplication keyed on the whole path, so identical bytes fetched on
 * two different days were two objects — 100% amplification on every refresh
 * cycle, growing without bound over a source's life. And because
 * `source_artifacts` deduplicates on `(source_id, url, content_hash)`, the
 * second copy was never cited by anything: it was an orphan the moment it was
 * written (finding #6).
 *
 * The two facts are now two objects.
 *
 * **Content** is addressed by digest alone and written once, ever. Re-fetching
 * the same page for a decade costs one object. Different bytes are a different
 * digest and therefore a different object, so history is preserved by
 * construction rather than by remembering not to overwrite (AGENTS.md rule 10).
 * The two-hex-character shard keeps any single directory or list page bounded.
 *
 * **Retrieval records** are small JSON documents, one per (source, day,
 * digest), naming the content they confirmed. They keep the date partition's
 * actual purpose — bounding a re-scan of "what did we fetch that week", a
 * question about our behaviour, not the document's — and they make the store
 * able to answer "when did we last re-check these bytes?", which nothing could
 * answer before: `source_artifacts` keeps only the *first* retrieval, and a
 * refresh that confirmed unchanged bytes left no trace at all.
 */
export const RAW_PREFIX = 'raw';
export const CONTENT_SEGMENT = 'content';
export const RETRIEVED_SEGMENT = 'retrieved';

const SEGMENT_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface ArtifactContentKeyParts {
  readonly vertical: string;
  readonly source: string;
  readonly contentHash: ContentHash;
}

export interface ArtifactRetrievalKeyParts extends ArtifactContentKeyParts {
  /** ISO-8601 instant; only the UTC date part is used. */
  readonly retrievedAt: string;
  /** Separates same-day retrievals made under different rights/policy states. */
  readonly policySnapshotId?: PolicySnapshotId | null;
  /** Current fetch receipt, bound to a caller scope + result URL + provider. */
  readonly retrievalReceiptId?: ContentHash | null;
}

const frame = (value: string): string =>
  `${new TextEncoder().encode(value).byteLength}:${value}`;

/** Stable receipt shared with the scheduled-run SQL guard. */
export function artifactRetrievalReceiptId(
  retrievalScopeId: string,
  resultUrl: string,
  provider: string,
): ContentHash {
  if (retrievalScopeId.trim() === '' || resultUrl.trim() === '' || provider.trim() === '') {
    throw new ArtifactStoreError('Retrieval receipt scope, result URL, and provider are required.');
  }
  return sha256Hex(
    [
      'artifact-retrieval-receipt-v1',
      retrievalScopeId.toLowerCase(),
      resultUrl,
      provider,
    ].map(frame).join('|'),
  );
}

function assertSegment(name: string, value: string): void {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      `Illegal ${name} segment "${value}" in artifact key: expected a lowercase slug ` +
        '(path separators and traversal are rejected outright).',
    );
  }
}

function assertParts(parts: ArtifactContentKeyParts): void {
  assertSegment('vertical', parts.vertical);
  assertSegment('source', parts.source);
  if (!HASH_PATTERN.test(parts.contentHash)) {
    throw new ArtifactStoreError(
      `Illegal content hash "${parts.contentHash}": expected a lowercase hex sha256 digest.`,
    );
  }
}

/** Where a source's immutable content objects live. */
export function artifactContentPrefix(vertical: string, source: string): string {
  assertSegment('vertical', vertical);
  assertSegment('source', source);
  return `${RAW_PREFIX}/${vertical}/${source}/${CONTENT_SEGMENT}`;
}

/** The one and only key for these bytes under this source. */
export function artifactContentKey(parts: ArtifactContentKeyParts): string {
  assertParts(parts);
  const shard = parts.contentHash.slice(0, 2);
  return `${artifactContentPrefix(parts.vertical, parts.source)}/${shard}/${parts.contentHash}`;
}

/** Where a source's retrieval records live. */
export function artifactRetrievalPrefix(vertical: string, source: string): string {
  assertSegment('vertical', vertical);
  assertSegment('source', source);
  return `${RAW_PREFIX}/${vertical}/${source}/${RETRIEVED_SEGMENT}`;
}

/** One record per (source, UTC day, content, policy state) that confirmed these bytes. */
export function artifactRetrievalKey(parts: ArtifactRetrievalKeyParts): string {
  assertParts(parts);
  const at = new Date(parts.retrievedAt);
  if (Number.isNaN(at.getTime())) {
    throw new ArtifactStoreError(`Illegal retrieved_at "${parts.retrievedAt}" in artifact key.`);
  }
  const year = String(at.getUTCFullYear()).padStart(4, '0');
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const day = String(at.getUTCDate()).padStart(2, '0');
  const prefix = artifactRetrievalPrefix(parts.vertical, parts.source);
  const policySuffix =
    parts.policySnapshotId === undefined || parts.policySnapshotId === null
      ? ''
      : `.${parts.policySnapshotId}`;
  const receiptSuffix =
    parts.retrievalReceiptId === undefined || parts.retrievalReceiptId === null
      ? ''
      : HASH_PATTERN.test(parts.retrievalReceiptId)
        ? `.${parts.retrievalReceiptId}`
        : (() => { throw new ArtifactStoreError('Illegal retrieval receipt id.'); })();
  return `${prefix}/${year}/${month}/${day}/${parts.contentHash}${policySuffix}${receiptSuffix}.json`;
}

/** The documented `/raw/...` form of a content key. */
export function artifactContentPath(parts: ArtifactContentKeyParts): string {
  return `/${artifactContentKey(parts)}`;
}

/** Sidecar key holding an object's metadata alongside its bytes. */
export function artifactMetadataKey(key: string): string {
  return `${key}.meta.json`;
}

export interface ParsedArtifactKey {
  readonly vertical: string;
  readonly source: string;
  readonly contentHash: ContentHash;
}

export interface ParsedRetrievalKey extends ParsedArtifactKey {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly policySnapshotId?: PolicySnapshotId;
  readonly retrievalReceiptId?: ContentHash;
}

export function parseArtifactContentKey(key: string): ParsedArtifactKey | null {
  const segments = key.replace(/^\//, '').split('/');
  if (segments.length !== 6) return null;
  const [prefix, vertical, source, marker, shard, contentHash] = segments;
  if (prefix !== RAW_PREFIX || marker !== CONTENT_SEGMENT) return null;
  if (vertical === undefined || source === undefined || contentHash === undefined) return null;
  if (!HASH_PATTERN.test(contentHash)) return null;
  if (shard !== contentHash.slice(0, 2)) return null;
  return { vertical, source, contentHash };
}

export function parseArtifactRetrievalKey(key: string): ParsedRetrievalKey | null {
  const segments = key.replace(/^\//, '').split('/');
  if (segments.length !== 8) return null;
  const [prefix, vertical, source, marker, year, month, day, file] = segments;
  if (prefix !== RAW_PREFIX || marker !== RETRIEVED_SEGMENT) return null;
  if (
    vertical === undefined ||
    source === undefined ||
    year === undefined ||
    month === undefined ||
    day === undefined ||
    file === undefined
  ) {
    return null;
  }
  const stem = file.replace(/\.json$/, '');
  if (stem === file) return null;
  const contentHash = stem.slice(0, 64);
  if (!HASH_PATTERN.test(contentHash)) return null;
  const suffix = stem.slice(64);
  if (suffix === '') return { vertical, source, year, month, day, contentHash };
  if (!suffix.startsWith('.')) return null;
  const parts = suffix.slice(1).split('.');
  if (parts.length < 1 || parts.length > 2) return null;
  let policySnapshotId: string | undefined;
  let retrievalReceiptId: string | undefined;
  for (const part of parts) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(part)) {
      if (policySnapshotId !== undefined) return null;
      policySnapshotId = part;
    } else if (HASH_PATTERN.test(part)) {
      if (retrievalReceiptId !== undefined) return null;
      retrievalReceiptId = part;
    } else {
      return null;
    }
  }
  return {
    vertical,
    source,
    year,
    month,
    day,
    contentHash,
    ...(policySnapshotId === undefined
      ? {}
      : { policySnapshotId: policySnapshotId as PolicySnapshotId }),
    ...(retrievalReceiptId === undefined
      ? {}
      : { retrievalReceiptId: retrievalReceiptId as ContentHash }),
  };
}
