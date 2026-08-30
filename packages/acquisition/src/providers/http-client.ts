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

export type HttpBodyReadResult =
  | { readonly done: false; readonly value: Uint8Array }
  | { readonly done: true; readonly value?: undefined };

export interface HttpBodyReaderLike {
  read(): Promise<HttpBodyReadResult>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

export interface HttpBodyLike {
  getReader(): HttpBodyReaderLike;
  cancel(reason?: unknown): Promise<void>;
}

export interface HttpResponseLike {
  readonly status: number;
  readonly headers: HttpHeadersLike;
  /** Fetch response body. Bounded transport readers consume this incrementally. */
  readonly body: HttpBodyLike | null;
}

export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponseLike>;

/**
 * Control-plane adapters decode JSON into strings and objects after the byte
 * read. Four MiB leaves conservative headroom for both representations inside
 * a 128 MiB Worker isolate.
 */
export const MAX_CONTROL_PLANE_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;

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

function declaredContentLength(value: string | null): bigint | null {
  const normalized = value?.trim() ?? '';
  if (normalized === '') return null;
  const values = normalized.split(',').map((part) => part.trim());
  if (values.some((part) => !/^[0-9]+$/.test(part))) return null;
  const parsed = values.map((part) => BigInt(part));
  const first = parsed[0];
  if (first === undefined || parsed.some((candidate) => candidate !== first)) return null;
  return first;
}

async function cancelBody(response: HttpResponseLike, reason: string): Promise<void> {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Cancellation is cleanup. Its failure must not replace the bounded refusal.
  }
}

/** Consume a Fetch body incrementally under an explicit finite byte ceiling. */
export async function readBoundedResponseBody(
  provider: string,
  response: HttpResponseLike,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new ProviderTransportError(provider, `${label} ceiling must be a positive integer.`);
  }
  const declared = declaredContentLength(response.headers.get('content-length'));
  if (declared !== null && declared > BigInt(maxBytes)) {
    const reason = `declared ${label} exceeds the ${maxBytes}-byte ceiling`;
    await cancelBody(response, reason);
    throw new ProviderTransportError(provider, reason, response.status);
  }
  if (response.body === null) {
    if (declared !== null && declared > 0n) {
      throw new ProviderTransportError(
        provider,
        `${label} is unavailable despite a positive Content-Length`,
        response.status,
      );
    }
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (value.byteLength > maxBytes - byteLength) {
        const reason = `${label} exceeded the ${maxBytes}-byte ceiling while streaming`;
        try {
          await reader.cancel(reason);
        } catch {
          // Cancellation is cleanup. The size refusal remains authoritative.
        }
        throw new ProviderTransportError(provider, reason, response.status);
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Read bounded JSON, degrading to a typed transport error rather than a raw SyntaxError. */
export async function readJson(
  provider: string,
  response: HttpResponseLike,
  maxBytes: number,
): Promise<unknown> {
  if (maxBytes > MAX_CONTROL_PLANE_JSON_RESPONSE_BYTES) {
    throw new ProviderTransportError(
      provider,
      `control-plane JSON response ceiling cannot exceed ${MAX_CONTROL_PLANE_JSON_RESPONSE_BYTES} bytes.`,
    );
  }
  const text = new TextDecoder().decode(
    await readBoundedResponseBody(
      provider,
      response,
      maxBytes,
      'control-plane JSON response body',
    ),
  );
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
