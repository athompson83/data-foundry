import { ProviderTransportError } from '../errors.js';

/**
 * The minimum HTTP surface this package needs, expressed structurally.
 *
 * Typed structurally rather than as `typeof globalThis.fetch` for two reasons:
 * the real `fetch` still satisfies it (so production wires in nothing), and a
 * test can satisfy it with a plain function returning a plain object (so no test
 * needs a live server, a mock library, or a `Response` polyfill).
 */
export interface HttpRequestInit {
  readonly method?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly body?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  /**
   * Redirect handling. Providers pass `'manual'`.
   *
   * Without this field the interface could not express a redirect policy, so
   * the ambient `fetch` used its default — `'follow'` — and a permitted URL
   * answering 302 would have the client contact whatever host the `Location`
   * named. The gate sees one URL; the process would contact two.
   */
  readonly redirect?: 'follow' | 'manual' | 'error' | undefined;
}

export interface HttpHeadersLike {
  get(name: string): string | null;
  forEach(callback: (value: string, key: string) => void): void;
}

export interface HttpResponseLike {
  readonly status: number;
  readonly headers: HttpHeadersLike;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponseLike>;

/** The ambient `fetch`, if the runtime has one. Never assumed. */
export function globalFetch(): FetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  return typeof candidate === 'function' ? (candidate as FetchLike) : null;
}

export function requireFetch(provider: string, injected: FetchLike | undefined): FetchLike {
  const resolved = injected ?? globalFetch();
  if (resolved === null) {
    throw new ProviderTransportError(
      provider,
      'no fetch implementation available; inject one via the provider options.',
    );
  }
  return resolved;
}

/** Collect response headers into a lowercased plain record. */
export function headersToRecord(headers: HttpHeadersLike): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

/** `text/html; charset=utf-8` → `text/html`. */
export function parseMimeType(contentType: string | null | undefined, fallback: string): string {
  if (contentType === null || contentType === undefined) return fallback;
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === '' ? fallback : base;
}

/** An abort signal that fires after `timeoutMs`, when the runtime supports one. */
export function timeoutSignal(timeoutMs: number | undefined): AbortSignal | undefined {
  if (timeoutMs === undefined || timeoutMs <= 0) return undefined;
  const factory = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } })
    .AbortSignal;
  return factory?.timeout?.(timeoutMs);
}

/** Read a JSON body, degrading to a typed transport error rather than a raw SyntaxError. */
export async function readJson(
  provider: string,
  response: HttpResponseLike,
): Promise<unknown> {
  const text = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()));
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderTransportError(
      provider,
      `expected a JSON response but received ${text.slice(0, 200)}`,
      response.status,
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Header maps returned inside JSON payloads, normalised to lowercase strings. */
export function normalizeHeaderRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') record[key.toLowerCase()] = raw;
    else if (typeof raw === 'number') record[key.toLowerCase()] = String(raw);
  }
  return record;
}
