/**
 * The transport-free request/response types — same discipline as
 * `apps/api/src/http.ts`: a pure function from a request description to a
 * response description, so routing is testable with no socket and no `fetch`
 * bound. `body` here is an already-serialized string (HTML/XML/plain text),
 * not a JSON value, because this surface renders documents, not an envelope.
 */

export interface WebRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

export interface WebResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type WebHandler = (request: WebRequest) => Promise<WebResponse>;
export type PublicCacheMode = 'cache' | 'no-store';

/**
 * Public content may be cached only when its caller has an invalidation model
 * that follows exact rights lifetimes. Production currently enforces no-store;
 * the bounded shared-cache policy remains available only to explicit local
 * development contexts.
 */
const PUBLIC_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';
const NO_STORE = 'no-store';

function headersFor(contentType: string, cache: string): Record<string, string> {
  return { 'content-type': contentType, 'cache-control': cache };
}

function successfulResponseCache(status: number, mode: PublicCacheMode): string {
  return status >= 200 && status < 300 && mode === 'cache' ? PUBLIC_CACHE : NO_STORE;
}

export function htmlResponse(
  status: number,
  html: string,
  extraHeaders: Readonly<Record<string, string>> = {},
  cacheMode: PublicCacheMode = 'cache',
): WebResponse {
  const cache = successfulResponseCache(status, cacheMode);
  return { status, headers: { ...headersFor('text/html; charset=utf-8', cache), ...extraHeaders }, body: html };
}

export function xmlResponse(status: number, xml: string, cacheMode: PublicCacheMode = 'cache'): WebResponse {
  return { status, headers: headersFor('application/xml; charset=utf-8', successfulResponseCache(status, cacheMode)), body: xml };
}

export function textResponse(
  status: number,
  text: string,
  extraHeaders: Readonly<Record<string, string>> = {},
  cacheMode: PublicCacheMode = 'cache',
): WebResponse {
  return {
    status,
    headers: {
      ...headersFor('text/plain; charset=utf-8', successfulResponseCache(status, cacheMode)),
      ...extraHeaders,
    },
    body: text,
  };
}

export function notFound(html: string): WebResponse {
  return { status: 404, headers: headersFor('text/html; charset=utf-8', NO_STORE), body: html };
}

/** Opaque, retryable refusal for bounded public work that cannot complete. */
export function serviceUnavailable(): WebResponse {
  return {
    status: 503,
    headers: {
      ...headersFor('text/plain; charset=utf-8', NO_STORE),
      'retry-after': '30',
    },
    body: 'Service unavailable.\n',
  };
}

/** Opaque refusal for a deterministic bound that retrying cannot change. */
export function capacityUnavailable(): WebResponse {
  return {
    status: 503,
    headers: headersFor('text/plain; charset=utf-8', NO_STORE),
    body: 'Service unavailable.\n',
  };
}
