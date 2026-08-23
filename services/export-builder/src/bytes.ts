/**
 * Bytes, digests and deterministic JSON. Node built-ins only.
 *
 * Determinism is the property this module exists for. "The same input produces
 * the same checksum" is what makes a dataset snapshot quotable: a customer who
 * pins `2026-08-14.1` and re-downloads it must be able to prove the bytes did
 * not move under them, and a rebuild that produces a different digest from the
 * same canonical inputs makes every such claim unfalsifiable.
 *
 * Two things routinely break it and are both handled here:
 *
 *   - **Object key order.** `JSON.stringify` walks own keys in insertion order.
 *     Assemble the same manifest from two code paths and you can get the same
 *     data with different bytes. `stableJson` sorts keys by UTF-16 code unit at
 *     every level, so the serialization is a function of the *value*.
 *   - **Locale.** Nothing here calls `localeCompare`, `Intl` or
 *     `toLocaleString`; `compareCodeUnits` from `@data-foundry/canonical-schema`
 *     is the only comparator, exactly as `tests/contract/ordering-determinism`
 *     requires of every layer that decides what gets published.
 */
import { createHash } from 'node:crypto';
import { compareCodeUnits, type ContentHash } from '@data-foundry/canonical-schema';

/** Lowercase hex sha256 of the exact bytes that will be written. */
export function sha256(bytes: Uint8Array): ContentHash {
  return createHash('sha256').update(bytes).digest('hex') as ContentHash;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * `JSON.stringify` with object keys in code-unit order at every depth.
 *
 * Arrays keep their order — an array's order is data. `undefined` is not
 * representable and is rejected rather than silently dropped, because a field
 * that vanishes from a manifest is precisely the kind of quiet difference this
 * function exists to make impossible.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) {
      throw new TypeError('stableJson: undefined is not serializable; use null for "no value".');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`stableJson: ${String(value)} is not representable in JSON.`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sortDeep);

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort(compareCodeUnits)) {
    sorted[key] = sortDeep(source[key]);
  }
  return sorted;
}
