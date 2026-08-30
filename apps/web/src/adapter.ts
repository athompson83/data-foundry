/**
 * The only file that knows about the Fetch API — same contract as
 * `apps/edge/src/adapter.ts`: translate and nothing else. No routing, no
 * status codes, no method policy; `app.ts` decides all of that.
 */
import type { WebRequest, WebResponse } from './http.js';

export function toWebRequest(request: Request): WebRequest {
  const url = new URL(request.url);
  return { method: request.method, url: `${url.pathname}${url.search}` };
}

export function toFetchResponse(response: WebResponse, method: string): Response {
  const headers = new Headers(response.headers as Record<string, string>);
  headers.set('content-length', String(new TextEncoder().encode(response.body).byteLength));
  const bodyless = method.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 301;
  return new Response(bodyless ? null : response.body, { status: response.status, headers });
}
