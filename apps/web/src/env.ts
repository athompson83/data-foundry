/**
 * What a deployed Worker is configured with, and what it refuses to start
 * without. Same fail-closed reasoning as `apps/edge/src/env.ts`: a Worker with
 * no database bound must refuse, never fall back to an empty in-memory one.
 *
 * Unlike `apps/edge`, there is no `VERTICAL_SLUG` — this Worker serves every
 * vertical the bundle carries (ADR-0011).
 */

export interface HyperdriveBinding {
  readonly connectionString: string;
}

export interface WebEnv {
  /** Explicit production mode tightens topology checks; absence is local development. */
  readonly DEPLOYMENT_ENVIRONMENT?: string;
  readonly HYPERDRIVE?: HyperdriveBinding;
  readonly POSTGRES_URL?: string;
  /**
   * The public origin this deployment answers on, e.g. `https://example.com`.
   * Used only to render absolute URLs where a spec demands one — the sitemap
   * index and `<link rel="canonical">` — never to build a relative link.
   */
  readonly PUBLIC_ORIGIN?: string;
}

export class WebConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebConfigurationError';
  }
}

export interface ResolvedWebConfig {
  readonly connectionString: string;
  readonly publicOrigin: string;
  readonly deploymentEnvironment: DeploymentEnvironment;
}

export type DeploymentEnvironment = 'development' | 'production';

function resolveDeploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === undefined || value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new WebConfigurationError(
    'DEPLOYMENT_ENVIRONMENT must be exactly "development" or "production" when set.',
  );
}

export function resolveWebConfig(env: WebEnv): ResolvedWebConfig {
  const deploymentEnvironment = resolveDeploymentEnvironment(env.DEPLOYMENT_ENVIRONMENT);
  if (deploymentEnvironment === 'production' && env.HYPERDRIVE === undefined) {
    throw new WebConfigurationError(
      'Production requires the HYPERDRIVE binding; POSTGRES_URL is for local development only.',
    );
  }
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  if (connectionString.trim() === '') {
    throw new WebConfigurationError(
      'No database is configured. Bind HYPERDRIVE or set POSTGRES_URL. ' +
        'This Worker will not fall back to an empty in-memory database.',
    );
  }

  const publicOrigin = (env.PUBLIC_ORIGIN ?? '').trim();
  if (publicOrigin === '') {
    throw new WebConfigurationError(
      'PUBLIC_ORIGIN is required. Configure the exact public origin used for canonical URLs.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(publicOrigin);
  } catch {
    throw new WebConfigurationError(`PUBLIC_ORIGIN "${publicOrigin}" is not a valid absolute URL.`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new WebConfigurationError('PUBLIC_ORIGIN must use HTTPS (or HTTP for local development).');
  }

  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new WebConfigurationError(
      'PUBLIC_ORIGIN must be an origin only, without credentials, a path, query, or fragment.',
    );
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (parsed.protocol !== 'https:' && !localHosts.has(parsed.hostname)) {
    throw new WebConfigurationError('PUBLIC_ORIGIN must use HTTPS outside local development.');
  }

  return { connectionString, publicOrigin: parsed.origin, deploymentEnvironment };
}
