/**
 * `@data-foundry/web` — the Cloudflare Worker serving the free, public,
 * multi-vertical human site (ADR-0011). Same shape as `apps/edge`: a `fetch`
 * handler, a composition root behind it, no routing of its own — the
 * difference is this bundle carries every vertical it was compiled for,
 * because this is the ONE Worker that is the parent site plus every child
 * industry site, not one Worker per industry.
 */
import { toWebRequest, toFetchResponse } from './adapter.js';
import { createWebApp } from './app.js';
import { withResolvedContext } from './config.js';
import { getDeployment } from './composition.js';
import { WebConfigurationError, type WebEnv } from './env.js';
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

export default {
  async fetch(request: Request, env: WebEnv): Promise<Response> {
    try {
      const deployment = await getDeployment({
        env,
        runtimes: RUNTIMES,
        onWarning: (message) => console.warn(`[web] ${message}`),
      });

      const response = await withResolvedContext(deployment, (context) =>
        createWebApp(context)(toWebRequest(request)),
      );
      return toFetchResponse(response, request.method);
    } catch (error) {
      if (error instanceof WebConfigurationError) {
        console.error('[web] configuration', error);
        return unavailable('configuration');
      }
      console.error('[web] startup', error);
      return unavailable('startup');
    }
  },
};
