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

/** Cloudflare's Hyperdrive binding, narrowed to the one field we read. */
export interface HyperdriveBinding {
  readonly connectionString: string;
}

export interface EdgeEnv {
  /**
   * Hyperdrive binding. Preferred over `POSTGRES_URL`: it pools connections at
   * Cloudflare's edge, which is what makes Postgres viable from a Worker at all.
   */
  readonly HYPERDRIVE?: HyperdriveBinding;
  /** Direct connection string. A fallback for `wrangler dev` against a local database. */
  readonly POSTGRES_URL?: string;
  /** Which vertical this deployment serves. One vertical per Worker. */
  readonly VERTICAL_SLUG?: string;
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
}

/**
 * Read the deployment's configuration, or refuse.
 *
 * Hyperdrive wins over `POSTGRES_URL` when both are present: if an operator has
 * bound Hyperdrive, going around it to talk to the origin directly is never what
 * they meant.
 */
export function resolveEdgeConfig(env: EdgeEnv): ResolvedEdgeConfig {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
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

  return { connectionString, verticalSlug };
}
