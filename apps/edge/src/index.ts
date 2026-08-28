/**
 * `@data-foundry/edge` - the Cloudflare Worker that serves the REST surface.
 *
 * ADR-0006 adopts Cloudflare as the deployment target, superseding ADR-0005's
 * "there is nothing deployable here yet". This module is the whole deployment:
 * a `fetch` handler, a composition root behind it, and no routing of its own.
 *
 * Read `adapter.ts` for why every method is handed through verbatim, and
 * `composition.ts` for why the object graph is built here rather than in
 * `apps/api`.
 */
import {
  UNMATCHED_ROUTE_KEY,
  validateOpaqueEdgeErrorEnvelope,
  type ApiRequestTelemetry,
} from '@data-foundry/api';
import { buildUsageEvent, type UsageEvent } from '@data-foundry/usage-events';
import { toApiRequest, toFetchResponse } from './adapter.js';
import { authenticate, toAuthResponse, type AuthFailure } from './auth.js';
import { getDeployment, type BuildOptions, type VerticalRuntime } from './composition.js';
import {
  EdgeConfigurationError,
  resolveEdgeConfig,
  type EdgeEnv,
  type DeploymentEnvironment,
  type ResolvedEdgeConfig,
} from './env.js';
import { RUNTIMES } from '../generated/runtime-registry.js';

export { toApiRequest, toFetchResponse } from './adapter.js';
export {
  authenticate,
  toAuthResponse,
  type AuthFailure,
  type AuthFailureReason,
  type AuthResponseBody,
  type AuthResult,
  type AuthSuccess,
} from './auth.js';
export {
  getDeployment,
  resetDeployments,
  type BuildOptions,
  type EdgeDeployment,
  type VerticalRuntime,
} from './composition.js';
export {
  EdgeConfigurationError,
  resolveEdgeConfig,
  type EdgeEnv,
  type DeploymentEnvironment,
  type QueueBinding,
  type RapidApiConfig,
  type ResolvedEdgeConfig,
} from './env.js';

/**
 * Runtimes compiled into this bundle.
 *
 * A Worker serves one vertical, but the bundle carries the compiled runtimes by
 * slug so that standing up vertical number two is a `VERTICAL_SLUG` change and a
 * deploy, not a fork of this package (AGENTS.md rule 4). `composition.ts`
 * refuses a mismatch rather than serving one vertical's data through another's
 * field metadata.
 */
export { BUNDLED_VERTICALS, RUNTIMES } from '../generated/runtime-registry.js';

/**
 * A configuration failure is a 503, and it is deliberately not a 500.
 *
 * 500 means "this request hit a bug". A Worker with no database bound is not a
 * request-level failure at all - every request will fail identically until an
 * operator changes something. Saying so plainly is what stops the outage being
 * diagnosed as a query bug. The body carries no configuration detail; the
 * operator channel gets the cause.
 */
function unavailable(reason: string, method = 'GET'): Response {
  const body = JSON.stringify(validateOpaqueEdgeErrorEnvelope({
    error: { code: 'SERVICE_UNAVAILABLE', message: 'This deployment is not configured to serve requests.' },
  }));
  return new Response(method.toUpperCase() === 'HEAD' ? null : body, {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(new TextEncoder().encode(body).byteLength),
      // A misconfiguration is not fixed by the client retrying immediately.
      'retry-after': '30',
      'x-unavailable-reason': reason,
    },
  });
}

/**
 * The response for a request that never reached `apps/api` at all. No usage
 * event is built for this path: `db/migrations/0011_api_tenancy.sql`'s own
 * comment calls metering a record of consumption, and a request an invalid
 * credential could not execute consumed nothing billable. What it did do —
 * present a bad credential — belongs in Workers logs, not a customer-facing
 * billing table.
 */
function authFailureResponse(request: Request, failure: AuthFailure): Response {
  const { status, body } = toAuthResponse(failure);
  const serialized = JSON.stringify(body);
  const bodyless = request.method.toUpperCase() === 'HEAD';
  return new Response(bodyless ? null : serialized, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(new TextEncoder().encode(serialized).byteLength),
    },
  });
}

const RAPIDAPI_PROXY_SECRET_HEADER = 'x-rapidapi-proxy-secret';

/**
 * Compare origin secrets without an early return on length or the first
 * differing byte. Hashing both values gives a fixed-size comparison, and the
 * XOR loop always visits all 32 SHA-256 bytes.
 */
async function matchesProxySecret(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [presentedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(presentedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

type RequestChannel =
  | {
      readonly ok: true;
      readonly authorizationHeader: string | null;
      readonly expectedBillingSource: 'DIRECT' | 'RAPIDAPI';
    }
  | AuthFailure;

function hasRapidApiHeader(request: Request): boolean {
  for (const name of request.headers.keys()) {
    if (name.toLowerCase().startsWith('x-rapidapi-')) return true;
  }
  return false;
}

/**
 * Select a trusted access channel before API-key authentication.
 *
 * The hostname decides whether this is the marketplace origin. A client cannot
 * opt into marketplace billing by sending a header to the direct origin, and a
 * marketplace request never gets to choose its Data Foundry tenant/key through
 * Authorization: the server-held RAPIDAPI/RAPIDAPI credential is the only one
 * handed to the existing authenticator.
 */
async function resolveRequestChannel(
  request: Request,
  config: ResolvedEdgeConfig,
): Promise<RequestChannel> {
  const hostname = new URL(request.url).hostname.toLowerCase();
  const rapidApiSignal = hasRapidApiHeader(request);

  if (config.rapidApi === null) {
    if (rapidApiSignal) {
      throw new EdgeConfigurationError('A RapidAPI-shaped request reached an unconfigured deployment.');
    }
    return {
      ok: true,
      authorizationHeader: request.headers.get('authorization'),
      expectedBillingSource: 'DIRECT',
    };
  }

  if (hostname === config.rapidApi.hostname) {
    const presented = request.headers.get(RAPIDAPI_PROXY_SECRET_HEADER);
    if (presented === null || !(await matchesProxySecret(presented, config.rapidApi.proxySecret))) {
      return { ok: false, reason: 'MISSING_CREDENTIAL' };
    }
    return {
      ok: true,
      authorizationHeader: `Bearer ${config.rapidApi.apiKey}`,
      expectedBillingSource: 'RAPIDAPI',
    };
  }

  // RapidAPI headers on any other host are spoofed or misrouted. Refuse them
  // instead of falling through to a valid direct Authorization header.
  if (rapidApiSignal) return { ok: false, reason: 'MISSING_CREDENTIAL' };
  return {
    ok: true,
    authorizationHeader: request.headers.get('authorization'),
    expectedBillingSource: 'DIRECT',
  };
}

/**
 * How many rows a response actually served, on a best effort. Every
 * successful `apps/api` envelope carries its payload under `data` — a single
 * entity, or a list — so this reads the shape the wire contract already
 * guarantees rather than inventing a second per-route counting rule. Not
 * exact for a route this heuristic does not anticipate; `0` is always a safe
 * under-count, never an over-count, for a usage-based number that only ever
 * feeds a future pricing decision this increment does not make.
 */
function roughRowsServed(body: unknown): number {
  if (body === null || typeof body !== 'object' || !('data' in body)) return 0;
  const data = (body as { data: unknown }).data;
  if (Array.isArray(data)) return data.length;
  return data === null || data === undefined ? 0 : 1;
}

/**
 * Cloudflare's `ExecutionContext`, retained in the exported Worker signature
 * for future non-durable background work. Usage handoff deliberately does not
 * use `waitUntil`: at-least-once delivery begins only after Queue.send resolves.
 */
export interface MinimalExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Begin at-least-once delivery before returning a metered response. Queue
 * acceptance may be on the availability path; usage-database writes are not.
 */
async function publishUsageEvent(env: EdgeEnv, event: UsageEvent): Promise<void> {
  if (env.USAGE_EVENTS_QUEUE === undefined) {
    throw new Error('USAGE_EVENTS_QUEUE is not bound');
  }
  await env.USAGE_EVENTS_QUEUE.send(event);
}

/**
 * Everything a request does, factored out from the exported `fetch` shape so
 * it is callable directly against an injected driver. `wrangler dev` and a
 * deployed Worker never pass `driverOverride`; `test/index.test.ts` always
 * does, the same way `test/composition.test.ts` composes against PGlite
 * through `getDeployment`'s own `openDriver` seam rather than a real socket.
 */
export async function serveRequest(
  request: Request,
  env: EdgeEnv,
  ctx: MinimalExecutionContext,
  driverOverride?: BuildOptions['openDriver'],
): Promise<Response> {
  // Durable usage handoff is awaited below; ExecutionContext is intentionally
  // not used to defer it past the response boundary.
  void ctx;
  const slug = (env.VERTICAL_SLUG ?? '').trim();
  const runtime = RUNTIMES[slug];

  try {
    if (runtime === undefined) {
      throw new EdgeConfigurationError(
        `No compiled runtime for vertical "${slug}". Run \`pnpm verticals:compile\` and ` +
          'rebuild, or set VERTICAL_SLUG to a vertical this bundle carries.',
      );
    }

    const config = resolveEdgeConfig(env);
    const channel = await resolveRequestChannel(request, config);
    if (!channel.ok) return authFailureResponse(request, channel);

    const deployment = await getDeployment({
      env,
      runtime,
      ...(driverOverride === undefined ? {} : { openDriver: driverOverride }),
      onError: (error, context) => {
        // Workers logs. Response bodies carry an opaque code; this is the only
        // channel that gets the cause.
        console.error(`[edge] ${context.path}`, error);
      },
    });
    // Authenticate, resolve tenant, enforce scope — all of it before a
    // route ever executes. `auth.ts` is the one place this deployment
    // reaches `api_keys`/`api_tenants`; nothing below this line does.
    const auth = await authenticate(
      deployment.driver,
      channel.authorizationHeader,
      {
        verticalId: deployment.verticalId,
        environment: config.apiKeyEnvironment,
        expectedBillingSource: channel.expectedBillingSource,
        now: new Date(),
      },
    );
    if (!auth.ok) return authFailureResponse(request, auth);

    // `onRequest` is a closure fresh to this one `fetch` call — see
    // `apps/api`'s `ApiHandler` doc comment for why that matters. Two
    // requests from two different tenants running concurrently in this
    // isolate each get their own `matched`, never the other's.
    // An object, not a bare `let`: TypeScript narrows a reassigned-only-in-
    // a-closure local to `never` at the read below, which is a type-checker
    // limitation, not a claim about the value. A mutated property does not
    // trigger that narrowing.
    const captured: { info: ApiRequestTelemetry | null } = { info: null };
    const onRequest = (info: ApiRequestTelemetry): void => {
      captured.info = info;
    };

    const startedAt = Date.now();
    const response = await deployment.app(toApiRequest(request), onRequest, {
      surface: auth.accessTier,
    });
    const durationMs = Date.now() - startedAt;

    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      let event: UsageEvent | undefined;
      try {
        event = buildUsageEvent({
          tenantId: auth.tenantId,
          apiKeyId: auth.apiKeyId,
          verticalId: auth.verticalId,
          // `captured.info` is always set by the time `deployment.app` resolves.
          // The fallback is the closed unmatched key, never the request target.
          routeKey: captured.info?.routeKey ?? UNMATCHED_ROUTE_KEY,
          method,
          status: response.status,
          accessTier: auth.accessTier,
          billingSource: auth.billingSource,
          rowsServed: roughRowsServed(response.body),
          durationMs,
        });
        await publishUsageEvent(env, event);
      } catch (error) {
        // Log only the closed event/route identifiers and the platform error;
        // never the request target, query, body, credential, or response.
        console.error('[edge] usage event publish failed', {
          ...(event === undefined ? {} : { eventId: event.id, routeKey: event.route_key }),
          error,
        });
        return unavailable('metering', request.method);
      }
    }

    return toFetchResponse(response, request.method);
  } catch (error) {
    if (error instanceof EdgeConfigurationError) {
      console.error('[edge] configuration', error);
      return unavailable('configuration', request.method);
    }
    // Anything else at this level is the composition root failing - the
    // database is unreachable, most likely. Still not a request-level bug.
    console.error('[edge] startup', error);
    return unavailable('startup', request.method);
  }
}

export default {
  fetch: (request: Request, env: EdgeEnv, ctx: MinimalExecutionContext): Promise<Response> =>
    serveRequest(request, env, ctx),
};
