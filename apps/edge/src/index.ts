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
import { toApiRequest, toFetchResponse } from './adapter.js';
import { getDeployment, type VerticalRuntime } from './composition.js';
import { EdgeConfigurationError, type EdgeEnv } from './env.js';
import hvacRuntime from '../generated/hvac.runtime.json' with { type: 'json' };

export { toApiRequest, toFetchResponse } from './adapter.js';
export {
  getDeployment,
  resetDeployments,
  type BuildOptions,
  type EdgeDeployment,
  type VerticalRuntime,
} from './composition.js';
export { EdgeConfigurationError, resolveEdgeConfig, type EdgeEnv } from './env.js';

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

export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
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
        onError: (error, context) => {
          // Workers logs. Response bodies carry an opaque code; this is the only
          // channel that gets the cause.
          console.error(`[edge] ${context.path}`, error);
        },
      });

      const response = await deployment.app(toApiRequest(request));
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
  },
};
