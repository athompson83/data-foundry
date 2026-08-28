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
  /**
   * Where a usage event goes after a request is served. Optional on purpose,
   * unlike the database: a Worker that cannot reach its own database has
   * nothing to serve, but a Worker that cannot meter still has a correct
   * answer to give. Missing this binding does not refuse requests — it is
   * `index.ts`'s job to make that state loud rather than silent, because the
   * alternative is metering that fails forever without anyone noticing.
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

  const apiKeyEnvironment = env.API_KEY_ENVIRONMENT ?? '';
  if (apiKeyEnvironment !== 'live' && apiKeyEnvironment !== 'test') {
    throw new EdgeConfigurationError(
      'API_KEY_ENVIRONMENT must be set explicitly to "live" or "test". ' +
        'A deployment must never infer which credential namespace it accepts.',
    );
  }

  return { connectionString, verticalSlug, apiKeyEnvironment };
}
