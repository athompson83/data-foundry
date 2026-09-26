/**
 * The canonical public API contract is `https://api.data.aroqon.com/v1/<slug>/...`
 * (ADR-0012), while each vertical keeps its own isolated edge Worker (ADR-0011).
 * `apps/api` and the billing routes speak the internal, un-prefixed `/v1/...`
 * surface. This module is the whole translation between the two:
 *
 * - inbound, a public path under the prefix is mapped to its internal path
 *   (`/v1/vehicles/search` -> `/v1/search`); anything else has no internal
 *   path at all and the Worker answers 404 before authentication;
 * - outbound, every self-link the API or billing emits (the `Location` of a
 *   301 entity redirect, the redirect body, the contract document's route
 *   table, a route-not-found echo, the Checkout `success_url`) is mapped back.
 *
 * Route keys are decided by `apps/api` from the internal path, so metering is
 * unchanged by the prefix. With no prefix configured every function here is
 * an identity and the Worker's behaviour is byte-identical to before.
 */
import type { ApiResponse } from '@data-foundry/api';

/** The only accepted shape of `API_PATH_PREFIX`. */
export const API_PATH_PREFIX_PATTERN = /^\/v1\/[a-z][a-z0-9-]{0,62}$/;

/** The internal version root every prefix replaces. */
export const INTERNAL_API_ROOT = '/v1';

/**
 * The internal path for a public pathname, or `null` when the pathname is not
 * under the prefix. `null` prefix means "serve un-prefixed", so the pathname
 * passes through unchanged. Matching is by whole path segment: `/v1/vehicles`
 * never claims `/v1/vehicles-archive/...`.
 */
export function toInternalPath(pathname: string, prefix: string | null): string | null {
  if (prefix === null) return pathname;
  if (pathname === prefix) return INTERNAL_API_ROOT;
  if (pathname.startsWith(`${prefix}/`)) return `${INTERNAL_API_ROOT}${pathname.slice(prefix.length)}`;
  return null;
}

/**
 * The public spelling of an internal path-absolute reference (optionally with
 * a query string or fragment). Only the internal `/v1` root is rewritten; a
 * reference outside it is returned unchanged.
 */
export function toPublicPath(reference: string, prefix: string | null): string {
  if (prefix === null) return reference;
  if (reference === INTERNAL_API_ROOT) return prefix;
  const next = reference.charAt(INTERNAL_API_ROOT.length);
  if (reference.startsWith(INTERNAL_API_ROOT) && (next === '/' || next === '?' || next === '#')) {
    return `${prefix}${reference.slice(INTERNAL_API_ROOT.length)}`;
  }
  return reference;
}

/**
 * The public spelling of a self-link. A path-absolute reference is rewritten;
 * an absolute URL is rewritten only when it points back at `selfOrigin`, so a
 * third-party URL (a Stripe Checkout page, for example) is never touched.
 */
export function toPublicLink(value: string, prefix: string | null, selfOrigin: string): string {
  if (prefix === null) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return toPublicPath(value, prefix);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  if (parsed.origin !== selfOrigin) return value;
  const rewritten = toPublicPath(`${parsed.pathname}${parsed.search}${parsed.hash}`, prefix);
  return `${parsed.origin}${rewritten}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rewrite the known self-link positions of an `apps/api` response body. The
 * positions are enumerated rather than found by scanning every string: a
 * canonical fact value that happens to begin with `/v1/` is data, not a link,
 * and must be served exactly as stored.
 */
function publicBody(body: unknown, prefix: string): unknown {
  if (!isRecord(body)) return body;
  const redirect = body['redirect'];
  if (isRecord(redirect) && typeof redirect['location'] === 'string') {
    return { ...body, redirect: { ...redirect, location: toPublicPath(redirect['location'], prefix) } };
  }
  const error = body['error'];
  if (isRecord(error) && isRecord(error['details']) && typeof error['details']['path'] === 'string') {
    const details = error['details'];
    return { ...body, error: { ...error, details: { ...details, path: toPublicPath(details['path'] as string, prefix) } } };
  }
  const routes = body['routes'];
  if (Array.isArray(routes) && typeof body['version'] === 'string') {
    return {
      ...body,
      routes: routes.map((route: unknown) =>
        isRecord(route) && typeof route['path'] === 'string'
          ? { ...route, path: toPublicPath(route['path'], prefix) }
          : route,
      ),
    };
  }
  return body;
}

/** The API response as the public, prefixed contract spells it. */
export function toPublicApiResponse(
  response: ApiResponse,
  prefix: string | null,
  selfOrigin: string,
): ApiResponse {
  if (prefix === null) return response;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    headers[name] = name.toLowerCase() === 'location' || name.toLowerCase() === 'content-location'
      ? toPublicLink(value, prefix, selfOrigin)
      : value;
  }
  return { status: response.status, headers, body: publicBody(response.body, prefix) };
}

/** A Fetch `Response` with its `Location` header mapped to the public contract. */
export function toPublicFetchResponse(response: Response, prefix: string | null, selfOrigin: string): Response {
  if (prefix === null) return response;
  const location = response.headers.get('location');
  if (location === null) return response;
  const rewritten = toPublicLink(location, prefix, selfOrigin);
  if (rewritten === location) return response;
  const headers = new Headers(response.headers);
  headers.set('location', rewritten);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
