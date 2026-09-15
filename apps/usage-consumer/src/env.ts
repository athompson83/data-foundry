/**
 * What this consumer is configured with, and what it refuses to start without.
 *
 * Same failure mode `apps/edge/src/env.ts` guards against, for the same
 * reason: `createDriverFromEnv` in the store falls back to an in-memory
 * PGlite database when unconfigured. For the edge that means silently
 * serving zero results; for this consumer it would mean silently
 * *discarding every usage event it ever receives* into a database nobody
 * can read, while acking every message as if it had been persisted. Both
 * are worse than refusing to start, so this module never calls that helper.
 */

/** Cloudflare's Hyperdrive binding, narrowed to the one field we read. */
export interface HyperdriveBinding {
  readonly connectionString: string;
}

export interface ConsumerEnv {
  /** Explicit deployment identity; absence is rejected. */
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
  /** Enables only the route-less, service-bound synthetic readiness probe. */
  readonly PRIVATE_CANARY_MODE?: string | undefined;
  /** Hyperdrive binding. Preferred over `POSTGRES_URL` for the same reason `apps/edge` prefers it. */
  readonly HYPERDRIVE?: HyperdriveBinding;
  /** Direct connection string. A fallback for `wrangler dev` against a local database. */
  readonly POSTGRES_URL?: string;
}

export class ConsumerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConsumerConfigurationError';
  }
}

export interface ResolvedConsumerConfig {
  readonly connectionString: string;
  readonly deploymentEnvironment: 'development' | 'production';
}

/**
 * Read this consumer's configuration, or refuse.
 *
 * Hyperdrive wins over `POSTGRES_URL` when both are present, matching
 * `apps/edge/src/env.ts`'s `resolveEdgeConfig` — going around a bound
 * Hyperdrive to reach the origin directly is never what an operator meant.
 */
export function resolveConsumerConfig(env: ConsumerEnv): ResolvedConsumerConfig {
  const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT;
  if (deploymentEnvironment !== 'development' && deploymentEnvironment !== 'production') {
    throw new ConsumerConfigurationError(
      'DEPLOYMENT_ENVIRONMENT must be exactly "development" or "production".',
    );
  }
  if (deploymentEnvironment === 'production' && env.HYPERDRIVE === undefined) {
    throw new ConsumerConfigurationError(
      'Production requires the HYPERDRIVE binding; POSTGRES_URL is for local development only.',
    );
  }
  const connectionString = deploymentEnvironment === 'production'
    ? env.HYPERDRIVE?.connectionString ?? ''
    : env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  if (connectionString.trim() === '') {
    throw new ConsumerConfigurationError(
      'No database is configured. Bind HYPERDRIVE or set POSTGRES_URL. ' +
        'This consumer will not fall back to an empty in-memory database — ' +
        'that would silently discard every usage event it receives.',
    );
  }
  return { connectionString, deploymentEnvironment };
}
