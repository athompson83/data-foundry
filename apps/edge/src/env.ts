/**
 * What a deployed Worker is configured with, and what it refuses to start without.
 *
 * Every field here fails closed. The reason is specific rather than defensive:
 * `createDriverFromEnv` in the store falls back to PGlite when no connection
 * string is set, which is exactly right for tests and catastrophic at the edge —
 * a misconfigured deployment would boot happily and serve an **empty in-memory
 * database** as though it were the product. Nobody would see an error; they
 * would see zero results. So this module never calls that helper, and a Worker
 * with no database refuses to answer at all.
 */

import type { KeyEnvironment } from '@data-foundry/api-keys';

/** Cloudflare's Hyperdrive binding, narrowed to the one field we read. */
export interface HyperdriveBinding {
  readonly connectionString: string;
}

/**
 * Cloudflare's Queue producer binding, narrowed to the one method a producer
 * calls. Named locally rather than pulled from `@cloudflare/workers-types` —
 * this repository types every Cloudflare binding it touches by the shape it
 * reads, the same choice `HyperdriveBinding` already made, so a binding this
 * Worker does not use cannot widen what it is trusted with.
 */
export interface QueueBinding<Message = unknown> {
  send(message: Message): Promise<void>;
}

export interface EdgeEnv {
  /** Explicit deployment identity; absence is rejected. */
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
  /**
   * Hyperdrive binding. Preferred over `POSTGRES_URL`: it pools connections at
   * Cloudflare's edge, which is what makes Postgres viable from a Worker at all.
   */
  readonly HYPERDRIVE?: HyperdriveBinding;
  /** Direct connection string. A fallback for `wrangler dev` against a local database. */
  readonly POSTGRES_URL?: string;
  /** Which vertical this deployment serves. One vertical per Worker. */
  readonly VERTICAL_SLUG?: string;
  /** Which credential namespace this deployment accepts. Never inferred. */
  readonly API_KEY_ENVIRONMENT?: string;
  /** Hostname reserved for requests proxied by RapidAPI. No scheme or path. */
  readonly RAPIDAPI_HOSTNAME?: string;
  /** RapidAPI's origin-verification secret. Configure as a Worker secret. */
  readonly RAPIDAPI_PROXY_SECRET?: string;
  /** Server-held Data Foundry key issued as RAPIDAPI/RAPIDAPI for one vertical. */
  readonly RAPIDAPI_API_KEY?: string;
  /**
   * Durable handoff for usage events. Optional in the type so local/test code
   * can prove the missing-binding failure; production configuration requires
   * it, and an authenticated GET/HEAD returns 503 unless `send` is accepted.
   * Database persistence remains asynchronous in the queue consumer.
   */
  readonly USAGE_EVENTS_QUEUE?: QueueBinding;
}

export class EdgeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdgeConfigurationError';
  }
}

export interface ResolvedEdgeConfig {
  readonly connectionString: string;
  readonly verticalSlug: string;
  readonly apiKeyEnvironment: KeyEnvironment;
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly rapidApi: RapidApiConfig | null;
}

export type DeploymentEnvironment = 'development' | 'production';

export interface RapidApiConfig {
  readonly hostname: string;
  readonly proxySecret: string;
  readonly apiKey: string;
}

function resolveDeploymentEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === 'development') return 'development';
  if (value === 'production') return 'production';
  throw new EdgeConfigurationError(
    'DEPLOYMENT_ENVIRONMENT must be exactly "development" or "production".',
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  const octets = normalized.split('.');
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet)) && octets[0] === '127';
}

function resolveRapidApiConfig(
  env: EdgeEnv,
  deploymentEnvironment: DeploymentEnvironment,
): RapidApiConfig | null {
  const anyConfigured =
    env.RAPIDAPI_HOSTNAME !== undefined ||
    env.RAPIDAPI_PROXY_SECRET !== undefined ||
    env.RAPIDAPI_API_KEY !== undefined;
  if (!anyConfigured) return null;

  const hostname = (env.RAPIDAPI_HOSTNAME ?? '').trim().toLowerCase();
  const proxySecret = env.RAPIDAPI_PROXY_SECRET ?? '';
  const apiKey = env.RAPIDAPI_API_KEY ?? '';
  if (hostname === '' || proxySecret === '' || apiKey === '') {
    throw new EdgeConfigurationError(
      'RapidAPI configuration is incomplete. RAPIDAPI_HOSTNAME, ' +
        'RAPIDAPI_PROXY_SECRET, and RAPIDAPI_API_KEY must be configured together.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${hostname}`);
  } catch {
    throw new EdgeConfigurationError('RAPIDAPI_HOSTNAME must be a hostname without a scheme or path.');
  }
  if (
    parsed.hostname.toLowerCase() !== hostname ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new EdgeConfigurationError('RAPIDAPI_HOSTNAME must be a hostname without a scheme or path.');
  }
  if (deploymentEnvironment === 'production' && isLoopbackHostname(hostname)) {
    throw new EdgeConfigurationError('RAPIDAPI_HOSTNAME must not be a loopback hostname in production.');
  }

  return { hostname, proxySecret, apiKey };
}

/**
 * Read the deployment's configuration, or refuse.
 *
 * Hyperdrive wins over `POSTGRES_URL` when both are present: if an operator has
 * bound Hyperdrive, going around it to talk to the origin directly is never what
 * they meant.
 */
export function resolveEdgeConfig(env: EdgeEnv): ResolvedEdgeConfig {
  const deploymentEnvironment = resolveDeploymentEnvironment(env.DEPLOYMENT_ENVIRONMENT);
  if (deploymentEnvironment === 'production' && env.HYPERDRIVE === undefined) {
    throw new EdgeConfigurationError(
      'Production requires the HYPERDRIVE binding; POSTGRES_URL is for local development only.',
    );
  }
  const connectionString = deploymentEnvironment === 'production'
    ? env.HYPERDRIVE?.connectionString ?? ''
    : env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  if (connectionString.trim() === '') {
    throw new EdgeConfigurationError(
      'No database is configured. Bind HYPERDRIVE or set POSTGRES_URL. ' +
        'This Worker will not fall back to an empty in-memory database.',
    );
  }

  const verticalSlug = (env.VERTICAL_SLUG ?? '').trim();
  if (verticalSlug === '') {
    throw new EdgeConfigurationError(
      'VERTICAL_SLUG is not set. A deployment serves exactly one vertical, ' +
        'because a QueryModel carries exactly one vertical’s field metadata.',
    );
  }

  const apiKeyEnvironment = env.API_KEY_ENVIRONMENT ?? '';
  if (apiKeyEnvironment !== 'live' && apiKeyEnvironment !== 'test') {
    throw new EdgeConfigurationError(
      'API_KEY_ENVIRONMENT must be set explicitly to "live" or "test". ' +
        'A deployment must never infer which credential namespace it accepts.',
    );
  }
  if (deploymentEnvironment === 'production' && apiKeyEnvironment !== 'live') {
    throw new EdgeConfigurationError('Production requires API_KEY_ENVIRONMENT="live".');
  }
  if (deploymentEnvironment === 'production' && env.USAGE_EVENTS_QUEUE === undefined) {
    throw new EdgeConfigurationError(
      'Production requires the USAGE_EVENTS_QUEUE binding for asynchronous metering.',
    );
  }

  return {
    connectionString,
    verticalSlug,
    apiKeyEnvironment,
    deploymentEnvironment,
    rapidApi: resolveRapidApiConfig(env, deploymentEnvironment),
  };
}
