/**
 * `@data-foundry/web` — the Cloudflare Worker serving the free, public,
 * multi-vertical human site (ADR-0011). Same shape as `apps/edge`: a `fetch`
 * handler, a composition root behind it, no routing of its own — the
 * difference is this bundle carries every vertical it was compiled for,
 * because this is the ONE Worker that is the parent site plus every child
 * industry site, not one Worker per industry.
 */
import { toWebRequest, toFetchResponse } from './adapter.js';
import {
  createWebApp,
  executePreparedWebRequest,
  prepareWebRequest,
  type WebRoutingDeployment,
  type WebRoutingVertical,
} from './app.js';
import { withResolvedContext } from './config.js';
import { getDeployment } from './composition.js';
import { resolveWebConfig, WebConfigurationError, type WebEnv } from './env.js';
import type { WebRuntime } from './seo.js';
import { RUNTIMES as compiledRuntimes } from '../generated/runtime-registry.js';

export { toWebRequest, toFetchResponse } from './adapter.js';
export { createWebApp } from './app.js';
export {
  resolveContext,
  withResolvedContext,
  type WebContext,
} from './config.js';
export {
  getDeployment,
  resetDeployments,
  type BuildOptions,
  type CachedVerticalDeployment,
  type RequestWebDeployment,
  type VerticalDeployment,
  type WebDeployment,
} from './composition.js';
export { WebConfigurationError, resolveWebConfig, type WebEnv } from './env.js';

/** Every vertical this bundle carries, generated from the compiler's single bundle list. */
export const RUNTIMES = compiledRuntimes as unknown as Readonly<Record<string, WebRuntime>>;

type WebDeploymentLoader = typeof getDeployment;

interface WebWorkerDependencies {
  readonly loadDeployment?: WebDeploymentLoader;
  /** Test seam; production always uses the generated compiled registry. */
  readonly runtimes?: Readonly<Record<string, WebRuntime>>;
}

function routingVerticals(
  runtimes: Readonly<Record<string, WebRuntime>>,
): ReadonlyMap<string, WebRoutingVertical> {
  return new Map(Object.values(runtimes).map((runtime) => [
    runtime.vertical_slug,
    { slug: runtime.vertical_slug, runtime },
  ]));
}

/** Resolve only configuration and compiled metadata; this path never opens a driver. */
function resolveRoutingDeployment(
  env: WebEnv,
  verticals: ReadonlyMap<string, WebRoutingVertical>,
): WebRoutingDeployment {
  const config = resolveWebConfig(env);
  return {
    publicOrigin: config.publicOrigin,
    cacheMode: config.cacheMode,
    verticals,
  };
}

function unavailable(reason: string): Response {
  const body = '<!doctype html><title>Unavailable</title><h1>This deployment is not configured to serve requests.</h1>';
  return new Response(body, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '30',
      'x-unavailable-reason': reason,
    },
  });
}

export function createWebFetchHandler(
  dependencies: WebWorkerDependencies = {},
): (request: Request, env: WebEnv) => Promise<Response> {
  const loadDeployment = dependencies.loadDeployment ?? getDeployment;
  const runtimes = dependencies.runtimes ?? RUNTIMES;
  const verticals = routingVerticals(runtimes);

  return async (request: Request, env: WebEnv): Promise<Response> => {
    let deployment: Awaited<ReturnType<typeof getDeployment>> | undefined;
    try {
      const prepared = prepareWebRequest(
        resolveRoutingDeployment(env, verticals),
        toWebRequest(request),
      );
      if (prepared.kind === 'static') {
        return toFetchResponse(prepared.response, request.method);
      }

      deployment = await loadDeployment({
        env,
        runtimes,
        onWarning: (message) => console.warn(`[web] ${message}`),
      });

      const response = await withResolvedContext(deployment, (context) =>
        executePreparedWebRequest(prepared, context),
      );
      return toFetchResponse(response, request.method);
    } catch (error) {
      if (error instanceof WebConfigurationError) {
        console.error('[web] configuration', error);
        return unavailable('configuration');
      }
      console.error('[web] startup', error);
      return unavailable('startup');
    } finally {
      // Hyperdrive pools at the database side; this request's pg Client must
      // end before the Worker handles another request.
      if (env.HYPERDRIVE !== undefined && deployment !== undefined) {
        await deployment.close().catch(() => undefined);
      }
    }
  };
}

export default {
  fetch: createWebFetchHandler(),
};
