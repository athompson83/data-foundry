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

/**
 * Public, cacheable content. Unlike `apps/api` (no-store: it is the metered,
 * per-customer surface), this is the free surface a crawler is meant to fetch
 * repeatedly — an hour of shared caching is real cost saved and no
 * correctness risk, because nothing here is personalized.
 */
const PUBLIC_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';
const NO_STORE = 'no-store';

function headersFor(contentType: string, cache: string): Record<string, string> {
  return { 'content-type': contentType, 'cache-control': cache };
}

export function htmlResponse(
  status: number,
  html: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): WebResponse {
  const cache = status === 200 ? PUBLIC_CACHE : NO_STORE;
  return { status, headers: { ...headersFor('text/html; charset=utf-8', cache), ...extraHeaders }, body: html };
}

export function xmlResponse(status: number, xml: string): WebResponse {
  return { status, headers: headersFor('application/xml; charset=utf-8', PUBLIC_CACHE), body: xml };
}

export function textResponse(status: number, text: string, cache: string = PUBLIC_CACHE): WebResponse {
  return { status, headers: headersFor('text/plain; charset=utf-8', cache), body: text };
}

export function notFound(html: string): WebResponse {
  return { status: 404, headers: headersFor('text/html; charset=utf-8', NO_STORE), body: html };
}
