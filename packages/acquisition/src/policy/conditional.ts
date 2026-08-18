import type { ContentHash } from '@data-foundry/canonical-schema';

/**
 * Conditional requests (doc 05, "Refresh strategy": `ETag`, `Last-Modified`,
 * `modifiedSince`/cache-aware crawling).
 *
 * An incremental re-run of a source should cost one 304 per unchanged URL, not
 * one full download. The validators from the previous run are cached per
 * `(source, url)` and replayed as request headers; a 304 short-circuits before
 * anything is written to the evidence store.
 */
export interface ConditionalValidators {
  readonly etag?: string | undefined;
  /** HTTP-date string exactly as the origin sent it. */
  readonly lastModified?: string | undefined;
  /** Content hash of the last stored body — the fallback when the origin sends no validators. */
  readonly contentHash?: ContentHash | undefined;
}

export const EMPTY_VALIDATORS: ConditionalValidators = Object.freeze({});

export function hasValidators(validators: ConditionalValidators | null | undefined): boolean {
  if (validators === null || validators === undefined) return false;
  return (
    validators.etag !== undefined ||
    validators.lastModified !== undefined ||
    validators.contentHash !== undefined
  );
}

/** Build `If-None-Match` / `If-Modified-Since` from cached validators. */
export function conditionalHeaders(
  validators: ConditionalValidators | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (validators === null || validators === undefined) return headers;
  if (validators.etag !== undefined && validators.etag !== '') {
    headers['if-none-match'] = validators.etag;
  }
  if (validators.lastModified !== undefined && validators.lastModified !== '') {
    headers['if-modified-since'] = validators.lastModified;
  }
  return headers;
}

/** Read validators back off a response. */
export function validatorsFromHeaders(
  headers: Readonly<Record<string, string>>,
  contentHash?: ContentHash | undefined,
): ConditionalValidators {
  const etag = headers['etag'];
  const lastModified = headers['last-modified'];
  return {
    ...(etag !== undefined ? { etag } : {}),
    ...(lastModified !== undefined ? { lastModified } : {}),
    ...(contentHash !== undefined ? { contentHash } : {}),
  };
}

export function isNotModifiedStatus(status: number): boolean {
  return status === 304;
}

/**
 * Server-side evaluation of a conditional request. Used by providers that talk
 * to services with no native conditional support (fixtures, Crawl4AI) so that
 * "unchanged" behaves identically no matter which adapter is in play.
 */
export function matchesValidators(
  request: ConditionalValidators | null | undefined,
  current: ConditionalValidators,
): boolean {
  if (request === null || request === undefined) return false;
  if (request.etag !== undefined && current.etag !== undefined) {
    return normalizeEtag(request.etag) === normalizeEtag(current.etag);
  }
  if (request.lastModified !== undefined && current.lastModified !== undefined) {
    const since = Date.parse(request.lastModified);
    const modified = Date.parse(current.lastModified);
    if (Number.isFinite(since) && Number.isFinite(modified)) return modified <= since;
  }
  if (request.contentHash !== undefined && current.contentHash !== undefined) {
    return request.contentHash === current.contentHash;
  }
  return false;
}

/** `W/"abc"` and `"abc"` are the same entity for our purposes. */
export function normalizeEtag(etag: string): string {
  return etag.trim().replace(/^W\//i, '');
}

/**
 * Where the last run's validators live between runs.
 *
 * An interface rather than a table, because the ingest worker will back this
 * with Postgres while CI backs it with a Map, and neither the providers nor the
 * pipeline should care which.
 */
export interface ValidatorCache {
  get(sourceKey: string, url: string): Promise<ConditionalValidators | null>;
  set(sourceKey: string, url: string, validators: ConditionalValidators): Promise<void>;
  clear(): Promise<void>;
}

export class InMemoryValidatorCache implements ValidatorCache {
  readonly #entries = new Map<string, ConditionalValidators>();

  get(sourceKey: string, url: string): Promise<ConditionalValidators | null> {
    return Promise.resolve(this.#entries.get(`${sourceKey}\u0000${url}`) ?? null);
  }

  set(sourceKey: string, url: string, validators: ConditionalValidators): Promise<void> {
    if (hasValidators(validators)) {
      this.#entries.set(`${sourceKey}\u0000${url}`, validators);
    }
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.#entries.clear();
    return Promise.resolve();
  }

  get size(): number {
    return this.#entries.size;
  }
}
