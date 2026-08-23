/**
 * The transport-free request/response types.
 *
 * The handler is a pure function from a request description to a response
 * description. `node:http` appears in exactly one file (`server.ts`) and it
 * only translates between these types and sockets, so the entire contract —
 * routing, status codes, headers, envelopes, pagination — is testable without
 * binding a port, and swapping the transport (a Cloudflare `fetch` handler,
 * say) changes no routing code.
 *
 * `body` is a JSON value, not a string. Serializing once at the edge keeps the
 * tests asserting on structure rather than on whitespace.
 */

export interface ApiRequest {
  readonly method: string;
  /** Request target: path plus optional query string, e.g. `/v1/search?q=x`. */
  readonly url: string;
  /** Lowercased header names. Only `x-request-id` is read today. */
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export type ApiHandler = (request: ApiRequest) => Promise<ApiResponse>;

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * The header set every response carries.
 *
 * `x-api-version` is informational: the served version is decided by the path
 * and nothing else (see `router.ts`). It is emitted so a client reading a
 * cached or proxied response can tell which contract produced it.
 */
export function baseHeaders(version: string): Record<string, string> {
  return {
    'content-type': JSON_CONTENT_TYPE,
    'x-api-version': version,
    // A read-only surface over data that changes on an ingestion cadence, not
    // per request. Correctness first: no shared caching until there is a
    // documented invalidation story.
    'cache-control': 'no-store',
  };
}

export function jsonResponse(
  status: number,
  body: unknown,
  version: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): ApiResponse {
  return { status, headers: { ...baseHeaders(version), ...extraHeaders }, body };
}

/**
 * `x-request-id`, if the client sent one, reduced to something safe to echo.
 *
 * Echoing an arbitrary client string into a response body is how a header
 * becomes an injection vector for whatever reads the body next. Restricting it
 * to a short opaque token keeps the correlation value and none of the risk.
 */
export function requestId(request: ApiRequest): string | undefined {
  const raw = request.headers?.['x-request-id'];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim().slice(0, 64);
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : undefined;
}
