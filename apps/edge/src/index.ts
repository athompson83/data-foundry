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
import type { ApiRequestTelemetry } from '@data-foundry/api';
import { buildUsageEvent, type UsageEvent } from '@data-foundry/usage-events';
import { toApiRequest, toFetchResponse } from './adapter.js';
import { authenticate, toAuthResponse, type AuthFailure } from './auth.js';
import { getDeployment, type BuildOptions, type VerticalRuntime } from './composition.js';
import { EdgeConfigurationError, type EdgeEnv } from './env.js';
import hvacRuntime from '../generated/hvac.runtime.json' with { type: 'json' };

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
export { EdgeConfigurationError, resolveEdgeConfig, type EdgeEnv, type QueueBinding } from './env.js';

/**
 * Runtimes compiled into this bundle.
 *
 * A Worker serves one vertical, but the bundle carries the compiled runtimes by
 * slug so that standing up vertical number two is a `VERTICAL_SLUG` change and a
 * deploy, not a fork of this package (AGENTS.md rule 4). `composition.ts`
 * refuses a mismatch rather than serving one vertical's data through another's
 * field metadata.
 */
export const RUNTIMES: Readonly<Record<string, VerticalRuntime>> = {
  hvac: hvacRuntime as VerticalRuntime,
};

/**
 * A configuration failure is a 503, and it is deliberately not a 500.
 *
 * 500 means "this request hit a bug". A Worker with no database bound is not a
 * request-level failure at all - every request will fail identically until an
 * operator changes something. Saying so plainly is what stops the outage being
 * diagnosed as a query bug. The body carries no configuration detail; the
 * operator channel gets the cause.
 */
function unavailable(reason: string): Response {
  const body = JSON.stringify({
    error: { code: 'SERVICE_UNAVAILABLE', message: 'This deployment is not configured to serve requests.' },
  });
  return new Response(body, {
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
 * Cloudflare's `ExecutionContext`, narrowed to the one method a request
 * handler that meters asynchronously needs. Named locally for the same
 * reason `QueueBinding` is: this Worker is trusted with exactly the surface
 * it reads.
 */
export interface MinimalExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Publish a usage event without letting the queue's availability affect the
 * response the customer already received.
 *
 * This is the explicit policy for "queue publish failure": never retried
 * from here (a Worker about to be recycled is not where a durable retry
 * belongs), never thrown from here (nothing awaits this call), and never
 * silent — a failed publish is a lost usage record, and the operator channel
 * is where that has to be visible. `waitUntil` in the caller is what lets
 * this run after the response has already gone out.
 */
async function publishUsageEvent(env: EdgeEnv, event: UsageEvent): Promise<void> {
  if (env.USAGE_EVENTS_QUEUE === undefined) {
    console.error('[edge] usage event dropped: USAGE_EVENTS_QUEUE is not bound', event);
    return;
  }
  try {
    await env.USAGE_EVENTS_QUEUE.send(event);
  } catch (error) {
    console.error('[edge] usage event publish failed', { event, error });
  }
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
  const slug = (env.VERTICAL_SLUG ?? '').trim();
  const runtime = RUNTIMES[slug];

  try {
    if (runtime === undefined) {
      throw new EdgeConfigurationError(
        `No compiled runtime for vertical "${slug}". Run \`pnpm verticals:compile\` and ` +
          'rebuild, or set VERTICAL_SLUG to a vertical this bundle carries.',
      );
    }

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
      request.headers.get('authorization'),
      deployment.verticalId,
      new Date(),
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
    const response = await deployment.app(toApiRequest(request), onRequest);
    const durationMs = Date.now() - startedAt;

    const event = buildUsageEvent({
      tenantId: auth.tenantId,
      apiKeyId: auth.apiKeyId,
      // `captured.info` is always set by the time `deployment.app` resolves
      // — `onRequest` fires on every path out of it, success and error
      // alike. The fallback exists only for the type system; reaching it
      // would be `apps/api` breaking its own contract, not a case this
      // Worker causes.
      routeTemplate: captured.info?.routeTemplate ?? '/{unmatched}',
      method: request.method,
      status: response.status,
      rowsServed: roughRowsServed(response.body),
      durationMs,
    });
    // Never awaited: the response below returns whether or not the queue
    // has accepted the event yet. See `publishUsageEvent` for the policy on
    // what happens if it never does.
    ctx.waitUntil(publishUsageEvent(env, event));

    return toFetchResponse(response, request.method);
  } catch (error) {
    if (error instanceof EdgeConfigurationError) {
      console.error('[edge] configuration', error);
      return unavailable('configuration');
    }
    // Anything else at this level is the composition root failing - the
    // database is unreachable, most likely. Still not a request-level bug.
    console.error('[edge] startup', error);
    return unavailable('startup');
  }
}

export default {
  fetch: (request: Request, env: EdgeEnv, ctx: MinimalExecutionContext): Promise<Response> =>
    serveRequest(request, env, ctx),
};
