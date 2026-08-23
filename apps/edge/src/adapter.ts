/**
 * The only file that knows about the Fetch API.
 *
 * `apps/api` states the contract this satisfies: "the handler is a pure function
 * from a request description to a response description … swapping the transport
 * (a Cloudflare `fetch` handler, say) changes no routing code." This is that
 * swap. It translates and nothing else — no routing, no status codes, no
 * envelopes, and above all no method policy.
 *
 * That last one is load-bearing. `createApiApp` rejects anything outside
 * GET/HEAD *before* it parses the target, so the read-only guarantee is a
 * property of the surface rather than of each route. An adapter that answered
 * `OPTIONS` itself, or normalised a method on the way in, would put a decision
 * in front of that check and reopen the hole it was placed first to close. So
 * every method is handed through verbatim and the app decides.
 */
import type { ApiRequest, ApiResponse } from '@data-foundry/api';

/** Header names the app reads. Copying the whole set would hand it cookies and authorization. */
const FORWARDED_HEADERS: readonly string[] = ['x-request-id'];

/**
 * A `Request` as the app describes one.
 *
 * The request target is path plus query only. A Worker sees an absolute URL;
 * the app parses against its own placeholder base and never fetches anything,
 * so passing the origin through would be noise at best and an SSRF-shaped
 * temptation at worst.
 */
export function toApiRequest(request: Request): ApiRequest {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { method: request.method, url: `${url.pathname}${url.search}`, headers };
}

/**
 * An `ApiResponse` as a `Response`.
 *
 * `body` is a JSON value, not a string — the app serializes once, here, so its
 * tests assert on structure rather than whitespace.
 *
 * HEAD is the case worth stating. RFC 9110 requires the same headers a GET
 * would carry, `content-length` included, with no body. The app therefore still
 * *computes* the body; the transport is what withholds it. Returning the
 * serialized string for a HEAD would send a body; computing no body would send
 * a `content-length` of 0 and lie about the resource's size.
 */
export function toFetchResponse(response: ApiResponse, method: string): Response {
  const serialized = JSON.stringify(response.body ?? null);
  const headers = new Headers(response.headers as Record<string, string>);
  headers.set('content-length', String(new TextEncoder().encode(serialized).byteLength));

  const bodyless = method.toUpperCase() === 'HEAD' || response.status === 204;
  return new Response(bodyless ? null : serialized, {
    status: response.status,
    headers,
  });
}
