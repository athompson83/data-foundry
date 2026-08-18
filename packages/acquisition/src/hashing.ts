import { createHash } from 'node:crypto';
import type { ContentHash } from '@data-foundry/canonical-schema';

/**
 * Content addressing for raw evidence (AGENTS.md rule 10).
 *
 * Every artifact is keyed by the sha256 of its bytes, so storing the same
 * response twice is a no-op rather than a duplicate, and "did this page change?"
 * is a hash comparison rather than a diff.
 */
export function sha256Hex(input: Uint8Array | string): ContentHash {
  const hash = createHash('sha256');
  hash.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input));
  return hash.digest('hex');
}

/**
 * Deterministic, RFC-4122-shaped identifier derived from stable inputs.
 *
 * Ids in this package are *derived*, never random: re-running acquisition over
 * unchanged bytes must produce the same `SourceArtifactId` and the same
 * `PolicySnapshotId`, otherwise "idempotent" only means "does not write twice"
 * instead of "does not create a second row".
 *
 * The version nibble is forced to `5` and the variant nibble to `8..b` so the
 * output satisfies the canonical-schema UUID validators.
 */
export function deterministicUuid(...parts: readonly string[]): string {
  const hex = sha256Hex(parts.join('\u0000')).slice(0, 32);
  const variantNibble = '89ab'.charAt(Number.parseInt(hex.charAt(16), 16) % 4);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Key-ordered JSON, so that two structurally identical policy states hash to the
 * same digest regardless of how the objects were assembled.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const body = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',');
  return `{${body}}`;
}
