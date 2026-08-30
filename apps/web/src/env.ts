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
  /** Explicit deployment identity; absence is rejected. */
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
  readonly HYPERDRIVE?: HyperdriveBinding;
  readonly POSTGRES_URL?: string;
  /**
   * The public origin this deployment answers on, e.g. `https://example.com`.
   * Used only to render absolute URLs where a spec demands one — the sitemap
   * index and `<link rel="canonical">` — never to build a relative link.
   */
  readonly PUBLIC_ORIGIN?: string;
  /** Explicit public-response caching posture; no-store is the revocation-safe incident mode. */
  readonly PUBLIC_CACHE_MODE?: string;
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
  readonly cacheMode: PublicCacheMode;
}

export type DeploymentEnvironment = 'development' | 'production';
export type PublicCacheMode = 'cache' | 'no-store';

function resolveDeploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new WebConfigurationError(
    'DEPLOYMENT_ENVIRONMENT must be exactly "development" or "production".',
  );
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (hostname === 'localhost' || hostname === '::1') return true;
  const octets = hostname.split('.');
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet)) && octets[0] === '127';
}

function resolveCacheMode(value: string | undefined, deployment: DeploymentEnvironment): PublicCacheMode {
  if (value === 'cache' || value === 'no-store') return value;
  if (deployment === 'development' && (value === undefined || value.trim() === '')) return 'cache';
  throw new WebConfigurationError(
    'PUBLIC_CACHE_MODE must be exactly "cache" or "no-store" and is required in production.',
  );
}

export function resolveWebConfig(env: WebEnv): ResolvedWebConfig {
  const deploymentEnvironment = resolveDeploymentEnvironment(env.DEPLOYMENT_ENVIRONMENT);
  if (deploymentEnvironment === 'production' && env.HYPERDRIVE === undefined) {
    throw new WebConfigurationError(
      'Production requires the HYPERDRIVE binding; POSTGRES_URL is for local development only.',
    );
  }
  const connectionString = deploymentEnvironment === 'production'
    ? env.HYPERDRIVE?.connectionString ?? ''
    : env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
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

  if (deploymentEnvironment === 'production' && (parsed.protocol !== 'https:' || isLoopbackHostname(parsed.hostname))) {
    throw new WebConfigurationError('PUBLIC_ORIGIN must use HTTPS and a non-loopback hostname in production.');
  }
  if (deploymentEnvironment === 'development' && parsed.protocol !== 'https:' && !isLoopbackHostname(parsed.hostname)) {
    throw new WebConfigurationError('PUBLIC_ORIGIN must use HTTPS outside local development.');
  }

  return {
    connectionString,
    publicOrigin: parsed.origin,
    deploymentEnvironment,
    cacheMode: resolveCacheMode(env.PUBLIC_CACHE_MODE, deploymentEnvironment),
  };
}
