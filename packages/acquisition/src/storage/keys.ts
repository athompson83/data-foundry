import type { ContentHash } from '@data-foundry/canonical-schema';
import { ArtifactStoreError } from '../errors.js';

/**
 * Raw evidence key layout, exactly as doc 02 specifies:
 *
 * ```text
 * /raw/{vertical}/{source}/{yyyy}/{mm}/{dd}/{hash}
 * ```
 *
 * Object stores do not use a leading slash in keys, so {@link artifactStorageKey}
 * emits the slash-free form and {@link artifactStoragePath} emits the documented
 * path form. Both describe the same location.
 *
 * The date partition comes from `retrieved_at` (when we saw it), not from any
 * publication date on the document — partitions exist to bound a re-scan of "what
 * did we fetch that week", which is a question about our behaviour.
 */
export const RAW_PREFIX = 'raw';

const SEGMENT_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export interface ArtifactKeyParts {
  readonly vertical: string;
  readonly source: string;
  /** ISO-8601 instant; only the UTC date part is used. */
  readonly retrievedAt: string;
  readonly contentHash: ContentHash;
}

function assertSegment(name: string, value: string): void {
  if (!SEGMENT_PATTERN.test(value)) {
    throw new ArtifactStoreError(
      `Illegal ${name} segment "${value}" in artifact key: expected a lowercase slug ` +
        '(path separators and traversal are rejected outright).',
    );
  }
}

export function artifactStorageKey(parts: ArtifactKeyParts): string {
  assertSegment('vertical', parts.vertical);
  assertSegment('source', parts.source);
  if (!/^[0-9a-f]{64}$/.test(parts.contentHash)) {
    throw new ArtifactStoreError(
      `Illegal content hash "${parts.contentHash}": expected a lowercase hex sha256 digest.`,
    );
  }

  const at = new Date(parts.retrievedAt);
  if (Number.isNaN(at.getTime())) {
    throw new ArtifactStoreError(`Illegal retrieved_at "${parts.retrievedAt}" in artifact key.`);
  }
  const year = String(at.getUTCFullYear()).padStart(4, '0');
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  const day = String(at.getUTCDate()).padStart(2, '0');

  return `${RAW_PREFIX}/${parts.vertical}/${parts.source}/${year}/${month}/${day}/${parts.contentHash}`;
}

/** The documented `/raw/...` form. */
export function artifactStoragePath(parts: ArtifactKeyParts): string {
  return `/${artifactStorageKey(parts)}`;
}

/** Sidecar key holding the artifact's metadata alongside its bytes. */
export function artifactMetadataKey(key: string): string {
  return `${key}.meta.json`;
}

export interface ParsedArtifactKey {
  readonly vertical: string;
  readonly source: string;
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly contentHash: ContentHash;
}

export function parseArtifactStorageKey(key: string): ParsedArtifactKey | null {
  const segments = key.replace(/^\//, '').split('/');
  if (segments.length !== 7) return null;
  const [prefix, vertical, source, year, month, day, contentHash] = segments;
  if (prefix !== RAW_PREFIX) return null;
  if (
    vertical === undefined ||
    source === undefined ||
    year === undefined ||
    month === undefined ||
    day === undefined ||
    contentHash === undefined
  ) {
    return null;
  }
  if (!/^[0-9a-f]{64}$/.test(contentHash)) return null;
  return { vertical, source, year, month, day, contentHash };
}
